// 配置驱动的动态表单(v2):支持 month/tags/lines 结构化控件与
// 打字时校验(ccs Field 可用时接管,否则 blur 兜底)。
// **两种 kind 都是提交制**:notifyChange 只写闭包里的 values,必须点字段旁的 ✓
// (或列表条目的提交按钮)才会往上抛。文件头此前写的"kind=object:即改即存"与实现相反,
// 而正是那句话让 object 型 Group 一直漏在未提交拦截之外(2026-08-19 查出)。
import { h, clear } from '../lib/dom.mjs';
import { splitName, joinName } from '../lib/name-parts.mjs';
import { icon } from '../lib/icons.mjs';
import { tr, getLanguage } from '../lib/i18n.mjs';
import { uploadAvatar, isUnauthorized, redirectToUnlock } from '../lib/api.mjs';
import { openImproveDialog } from '../lib/ai.mjs';
import { isRealisticDate } from '../lib/schema.mjs';
import { createChipsInput } from './chips.mjs';
import { createStringList } from './string-list.mjs';

const CCS_RE = globalThis.CCSRe;
if (!CCS_RE) throw new Error('ccs/re must be loaded before the editor');

const VALIDATORS = {
  email: {
    ...CCS_RE.email,
    errorKey: 'error.email',
  },
  phone: {
    ...CCS_RE.phone,
    errorKey: 'error.phone',
  },
  url: {
    test: (v) => /^https?:\/\/\S+\.\S+/.test(v),
    errorKey: 'error.url',
  },
  // 三档精度都合法(YYYY / YYYY-MM / YYYY-MM-DD),但**比标准严一点**:
  // 标准那条正则连 2019-13 都放行,界面上不该让人存进去(见 schema.mjs isRealisticDate)。
  month: {
    test: (v) => isRealisticDate(v),
    errorKey: 'error.month',
    filter: /[^\d-]/g,
  },
};

const toDisplay = (field, value) => {
  if (value === null || value === undefined) return '';
  if (field.type === 'tags') return Array.isArray(value) ? value.join(', ') : String(value);
  if (field.type === 'lines') return Array.isArray(value) ? value.join('\n') : String(value);
  return String(value);
};

export const fromDisplay = (field, raw) => {
  if (field.type === 'tags') {
    return String(raw)
      .split(/[\n,，、;；]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (field.type === 'lines') {
    return String(raw)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return raw;
};

/** 打字时校验:优先 ccs Field(过滤 + 格式),否则 blur 校验兜底。 */
export function sanitizeInput(value, validator) {
  return validator?.filter ? value.replace(validator.filter, '') : value;
}

function attachValidation(inputEl, field, errorEl, onSanitize) {
  const validator = field.validate && VALIDATORS[field.validate];
  if (!validator) return;

  const message = () => tr(validator.errorKey);
  const check = (value) => value === '' || validator.test(value);

  if (window.Field && typeof window.Field.wrap === 'function') {
    window.Field.wrap(inputEl, {
      validate: (v) => check(v) || message(),
      errorEl,
      filter: validator.filter,
      rejectChars: validator.filter,
      onSanitize,
    });
    return;
  }
  inputEl.addEventListener('input', () => {
    const sanitized = sanitizeInput(inputEl.value, validator);
    const changed = sanitized !== inputEl.value;
    if (changed) inputEl.value = sanitized;
    if (changed) onSanitize?.(sanitized);
    errorEl.textContent = check(sanitized) ? '' : message();
  });
  inputEl.addEventListener('blur', () => {
    errorEl.textContent = check(inputEl.value) ? '' : message();
  });
}

// 可搜索选择器(datalist)。两条行为是踩出来的,别改回去:
// ① **打字的中间态不许清值** —— 原来写的是 `notifyChange(match ? match.value : '')`,
//    于是「澳大」这种打了半截的输入会把已经选好的国家清成空,而框里还显示着字,
//    看上去选着、实际已经空了(静默丢数据)。现在只在真的匹配上时才提交。
// ② **blur 必须归位** —— 匹配上就回填规范标签(打 `+61` 会补成 `+61 · 澳大利亚`),
//    清空是明确意图、照办,打了半截没选中则退回上一次的有效选择,不留幻影文字。
function searchableOptions(field, value, notifyChange) {
  const options = field.options || [];
  const byLabel = new Map(options.map((option) => [option.label, option]));
  const byValue = new Map(options.map((option) => [option.value, option]));
  const listId = `options-${field.attributeId}-${Math.random().toString(36).slice(2)}`;
  let current = byValue.get(value) || null;
  const commit = (option) => {
    current = option;
    notifyChange(field.attributeId, option ? option.value : '');
  };
  const input = h('input', {
    class: 'fc-input fc-searchable-select', type: 'search', list: listId,
    value: current?.label || value || '',
    placeholder: tr('action.search', 'Search'),
    onInput: (event) => {
      const raw = event.target.value.trim();
      const match = byLabel.get(raw) || byValue.get(raw);
      if (match && match.value !== current?.value) commit(match);
    },
  });
  input.addEventListener('blur', () => {
    const raw = input.value.trim();
    const match = byLabel.get(raw) || byValue.get(raw);
    if (match) {
      input.value = match.label;
      if (match.value !== current?.value) commit(match);
      return;
    }
    if (raw === '') {
      if (current) commit(null);
      return;
    }
    input.value = current?.label || '';
  });
  const datalist = h('datalist', { id: listId }, options.map((option) => h('option', { value: option.label })));
  const wrap = h('div', { class: 'searchable-select' }, input, datalist);
  // 外部(如 resetPhone 的取消回滚)改显示值时必须走这里,否则 current 会留在旧值上,
  // 下一次 blur 就把刚回滚掉的选择又填回来。
  wrap.setSelected = (nextValue) => {
    current = byValue.get(nextValue) || null;
    input.value = current?.label || nextValue || '';
  };
  return wrap;
}

function buildControl(field, value, notifyChange, errorEl) {
  if (field.type === 'phone') {
    const phoneParts = CCS_RE.phone.split(value, '+86', (field.options || []).map((option) => option.value));
    let code = phoneParts.code;
    let local = phoneParts.local;
    const codeField = { ...field, attributeId: `${field.attributeId}-code` };
    // 占位符跟着区号走 —— 写死一个国内号码,对一个「地域感知的全球化」产品是自相矛盾的
    const examples = field.examples || {};
    const applyExample = () => { numberEl.placeholder = examples[code] || ''; };
    const codeEl = searchableOptions(codeField, code, (_attributeId, nextCode) => {
      code = nextCode || code;
      applyExample();
      notifyChange(field.attributeId, CCS_RE.phone.compose(code, local));
    });
    const numberEl = h('input', { type: 'tel', class: 'fc-input', value: local, placeholder: examples[code] || '', onInput: (e) => { local = sanitizeInput(e.target.value, VALIDATORS.phone); e.target.value = local; notifyChange(field.attributeId, CCS_RE.phone.compose(code, local)); } });
    attachValidation(numberEl, field, errorEl);
    const phoneControl = h('div', { class: 'phone-input' }, codeEl, numberEl);
    phoneControl.resetPhone = (nextValue) => {
      const next = CCS_RE.phone.split(nextValue, '+86', (field.options || []).map((option) => option.value));
      code = next.code;
      local = next.local;
      codeEl.setSelected(code);
      numberEl.value = local;
      applyExample();
    };
    return phoneControl;
  }
  if (field.type === 'avatar') {
    // 头像。此前这里只有一个「上传」按钮 + 一行「已上传头像」的字 ——
    // **看不见传的是哪张、不能换、不能删**。现在给缩略图与两个明确的动作。
    //
    // `/files/*` 现在在门禁之后,而编辑器本来就在登录态里,所以 <img src> 直接能取到
    // (同源请求带 cookie)。**不要给头像开任何公开读路径** —— 它要出现在简历上,
    // 是在登录态编译时嵌进 PDF(2026-08-19 用户裁定)。
    const wrap = h('div', { class: 'avatar' });
    const fileInput = h('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      style: { display: 'none' },
      onChange: async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
          const url = await uploadAvatar(file);
          notifyChange(field.attributeId, url);
          paint(url);
          window.Toast && window.Toast.ok(tr('editor.uploadOk'));
        } catch (err) {
          if (isUnauthorized(err)) redirectToUnlock();
          else window.Toast && window.Toast.err(String(err.message || err));
        }
      },
    });

    const pick = () => fileInput.click();

    function paint(url) {
      clear(wrap);
      if (url) {
        const img = h('img', { class: 'avatar-img', src: url, alt: tr('field.basics.image') });
        // 取不到就退回空态 —— 比挂一个碎图标好
        img.addEventListener('error', () => paint(''));
        wrap.append(
          img,
          h(
            'span',
            { class: 'avatar-actions' },
            h('button', { type: 'button', class: 'btn btn-small', onClick: pick }, tr('action.replace')),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-small avatar-remove',
                onClick: () => {
                  notifyChange(field.attributeId, '');
                  paint('');
                },
              },
              tr('action.remove')
            )
          )
        );
      } else {
        wrap.append(
          h(
            'button',
            { type: 'button', class: 'avatar-drop', onClick: pick, 'aria-label': tr('action.upload') },
            icon('basics')
          ),
          h(
            'span',
            { class: 'avatar-actions' },
            h('button', { type: 'button', class: 'btn btn-small', onClick: pick }, tr('action.upload'))
          )
        );
      }
      // 照片放不放是**当地规范**决定的(英美澳新刻意不放),而这一页不知道你会选哪套模板 ——
      // 所以只陈述事实,不替它下结论
      wrap.append(h('span', { class: 'avatar-hint' }, tr('editor.avatarHint')), fileInput);
    }

    paint(String(value || ''));
    wrap.resetAvatar = (next) => paint(String(next || ''));
    return wrap;
  }

  switch (field.type) {
    // 姓名:三个框 → **一个标准字段 `basics.name`**,按规定的次序 名 中间名 姓 存
    // (没有加任何自定义字段,§3 仍然成立)。次序一规定,"最后一段是姓"就从猜变成读 ——
    // 导出侧据此切分,**简历上怎么印留到排版那一步按当地规范决定**。见 app/lib/name-parts.mjs。
    case 'personName': {
      const parts = splitName(value);
      const box = (key, labelKey) =>
        h(
          'label',
          { class: 'fc-namepart' },
          h('span', { class: 'fc-namepart-label' }, tr(labelKey)),
          h('input', {
            type: 'text',
            class: 'fc-input',
            value: parts[key],
            onInput: (e) => {
              parts[key] = e.target.value;
              notifyChange(field.attributeId, joinName(parts));
            },
          })
        );
      // **框的先后跟着界面语言走**:中文界面 姓 → 中间名 → 名,英文界面 名 → 中间名 → 姓 ——
      // 填表的人按自己的书写习惯从左往右念下来,不用在脑子里倒一次。
      // **存储次序不受影响**,永远是 名 中间名 姓(joinName 说了算);
      // 印在简历上又是另一回事(formatName,按模板服务的求职地)。三处各管各的。
      const boxes = [box('middle', 'field.basics.middleName')];
      if (getLanguage() === 'zh-cn') {
        boxes.unshift(box('family', 'field.basics.familyName'));
        boxes.push(box('given', 'field.basics.givenName'));
      } else {
        boxes.unshift(box('given', 'field.basics.givenName'));
        boxes.push(box('family', 'field.basics.familyName'));
      }
      return h('div', { class: 'fc-name' }, ...boxes);
    }

    case 'searchableSelect':
      return searchableOptions(field, value, notifyChange);
    case 'checkbox':
      return h('input', {
        type: 'checkbox',
        class: 'fc-checkbox',
        checked: Boolean(value),
        onChange: (e) => notifyChange(field.attributeId, e.target.checked),
      });

    case 'select':
      return h(
        'select',
        { class: 'fc-select', onChange: (e) => notifyChange(field.attributeId, e.target.value) },
        (field.options || []).map((opt) =>
          h(
            'option',
            { value: opt.value, selected: (value ?? '') === opt.value },
            opt.labelKey ? tr(opt.labelKey) : opt.label
          )
        )
      );

    case 'date':
      return h('input', {
        type: 'date',
        class: 'fc-input fc-month',
        value: /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : '',
        onChange: (e) => notifyChange(field.attributeId, e.target.value),
      });

    case 'month': {
      // **一个文本框,自己打**。三档精度(YYYY / YYYY-MM / YYYY-MM-DD)是 schema 的
      // 真实属性,但"分段控件 + 换输入器"是为打字的人造的机器 —— 直接给占位符加即时校验
      // 更快、也更诚实(存的本来就是一个字符串)。原来那套还带来两个 bug:
      // 勾着「至今」换精度能填出结束日期、✕ 取消后内部状态不复位。
      const dateEl = h('input', {
        type: 'text',
        class: 'fc-input fc-date-text',
        inputmode: 'numeric',
        autocomplete: 'off',
        spellcheck: 'false',
        value: String(value || ''),
        placeholder: tr('field.date.hint'),
        onInput: (e) => notifyChange(field.attributeId, e.target.value.trim()),
      });
      attachValidation(dateEl, field, errorEl);

      if (!field.presentKey) return dateEl;

      // 「至今 / 进行中」:勾上 = endDate 置空并禁用输入
      const presentBox = h('input', {
        type: 'checkbox',
        checked: !value,
        onChange: (e) => {
          const on = e.target.checked;
          dateEl.disabled = on;
          if (on) {
            dateEl.value = '';
            notifyChange(field.attributeId, '');
          }
        },
      });
      dateEl.disabled = !value;
      const row = h(
        'div',
        { class: 'fc-date-row' },
        dateEl,
        h('label', { class: 'fc-present' }, presentBox, ` ${tr(field.presentKey)}`)
      );
      // 取消回滚时把两半一起复位(光改 input.value 会让复选框和禁用态留在旧状态)
      row.resetDate = (nextValue) => {
        const on = !nextValue;
        presentBox.checked = on;
        dateEl.disabled = on;
        dateEl.value = String(nextValue || '');
      };
      return row;
    }

    // 词组数组 → 芯片;句子数组 → 逐条清单。两者都把存放单元的边界摆在界面上 ——
    // 「textarea 里一行一条、让用户看不出一行是一个存放单元」被判不专业(2026-08-21)。
    case 'tags':
      return createChipsInput({
        value: Array.isArray(value) ? value : [],
        placeholder: field.placeholderKey ? tr(field.placeholderKey) : '',
        ariaLabel: tr(field.labelKey),
        onChange: (arr) => notifyChange(field.attributeId, arr),
      });

    case 'lines':
      return createStringList({
        value: Array.isArray(value) ? value : [],
        placeholder: field.placeholderKey ? tr(field.placeholderKey) : '',
        ariaLabel: tr(field.labelKey),
        onChange: (arr) => notifyChange(field.attributeId, arr),
      });

    case 'textArea': {
      return h('textarea', {
        class: 'fc-textarea',
        rows: field.rows || 4,
        placeholder: field.placeholderKey ? tr(field.placeholderKey) : field.placeholder || '',
        value: toDisplay(field, value),
        onInput: (e) => notifyChange(field.attributeId, fromDisplay(field, e.target.value)),
      });
    }

    default: {
      const input = h('input', {
        type: 'text',
        class: 'fc-input',
        placeholder: field.placeholderKey ? tr(field.placeholderKey) : field.placeholder || '',
        value: toDisplay(field, value),
        onInput: (e) => {
          const validator = field.validate && VALIDATORS[field.validate];
          const sanitized = sanitizeInput(e.target.value, validator);
          if (sanitized !== e.target.value) e.target.value = sanitized;
          notifyChange(field.attributeId, sanitized);
        },
      });
      attachValidation(input, field, errorEl, (sanitized) => notifyChange(field.attributeId, sanitized));
      if (!field.upload) return input;

      const fileInput = h('input', {
        type: 'file',
        accept: 'image/png,image/jpeg,image/webp,image/gif',
        style: { display: 'none' },
        onChange: async (e) => {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!file) return;
          try {
            const url = await uploadAvatar(file);
            input.value = url;
            notifyChange(field.attributeId, url);
            window.Toast && window.Toast.ok(tr('editor.uploadOk'));
          } catch (err) {
            if (isUnauthorized(err)) {
              redirectToUnlock();
              return;
            }
            window.Toast && window.Toast.err(String(err.message || err));
          }
        },
      });
      return h(
        'div',
        { class: 'input-with-upload' },
        input,
        h('button', { type: 'button', class: 'btn btn-small', onClick: () => fileInput.click() }, tr('action.upload')),
        fileInput
      );
    }
  }
}

/**
 * @param {object} opts
 * @param {Array} opts.fields 字段定义(modules.mjs)
 * @param {object} opts.value 初始值
 * @param {(values: object) => void} [opts.onSubmit] 显式保存回调
 * @param {() => void} [opts.onCancel] 取消回调
 * @param {() => object} [opts.aiContext] 返回当前完整简历配置(AI 润色上下文)
 */
export function createFormCreator({ fields, value = {}, onSubmit, onCancel, aiContext }) {
  const values = { ...value };
  const initialValues = { ...value };
  const errorEls = new Map();
  /** 字段 id → 那一整行(revealInvalid 要按 id 找到行并点亮它)。 */
  const rowRefs = new Map();
  // 同一页上有多张表单(身份块三张 + 记录编辑器),id 必须带实例前缀,否则 for 会指错
  const formUid = `f${(createFormCreator.seq = (createFormCreator.seq || 0) + 1)}`;
  const controlRefs = new Map();
  const normalizeValue = (field, value) => {
    if (field.type === 'phone') {
      const knownCodes = (field.options || []).map((option) => option.value);
      const { code, local } = CCS_RE.phone.split(value, '+86', knownCodes);
      return CCS_RE.phone.compose(code, local);
    }
    return Array.isArray(value) ? value.join('\u0000') : String(value ?? '').trim();
  };

  const sameValue = (field, a, b) => normalizeValue(field, a) === normalizeValue(field, b);

  const validationText = (field, value) => {
    if (field.type === 'phone') return CCS_RE.phone.split(value, '+86', (field.options || []).map((option) => option.value)).local;
    return Array.isArray(value) ? value.join('') : String(value ?? '');
  };

  const fieldIsValid = (field) => {
    const text = validationText(field, values[field.attributeId]);
    if (field.required && text.trim() === '') return false;
    const validator =
      (field.validate && VALIDATORS[field.validate]) || (field.type === 'month' ? VALIDATORS.month : null);
    return !validator || text === '' || validator.test(text);
  };

  /** 表单整体有没有改动 —— 决定底部「保存」能不能按。 */
  const isDirty = () =>
    fields.some((field) => !sameValue(field, values[field.attributeId], initialValues[field.attributeId]));

  let footerEl = null;
  const refreshActions = () => {
    if (!footerEl) return;
    const dirty = isDirty();
    footerEl.classList.toggle('is-dirty', dirty);
    const save = footerEl.querySelector('.form-save');
    if (save) save.disabled = !dirty;
  };

  const resetControl = (field, value) => {
    const control = controlRefs.get(field.attributeId);
    if (!control) return;
    const elements = control.matches?.('input,textarea,select')
      ? [control]
      : [...control.querySelectorAll('input,textarea,select')];
    if (field.type === 'phone') {
      if (typeof control.resetPhone === 'function') {
        control.resetPhone(value);
        return;
      }
      const { code, local } = CCS_RE.phone.split(value, '+86', (field.options || []).map((option) => option.value));
      const search = elements.find((el) => el.type === 'search');
      const number = elements.find((el) => el.type === 'tel');
      const option = (field.options || []).find((item) => item.value === code);
      if (search) search.value = option?.label || code;
      if (number) number.value = local;
    } else if (field.type === 'avatar' && typeof control.resetAvatar === 'function') {
      control.resetAvatar(value);
    } else if (field.type === 'month' && typeof control.resetDate === 'function') {
      control.resetDate(value);
    } else if (typeof control.setValues === 'function') {
      // 芯片 / 逐条清单:整体重置,别把 toDisplay 的拼接串塞进内部输入框
      control.setValues(Array.isArray(value) ? value : []);
    } else if (elements[0]) {
      elements[0].value = toDisplay(field, value);
    }
  };

  const notifyChange = (key, val) => {
    values[key] = val;
    const errorEl = errorEls.get(key);
    if (errorEl) errorEl.textContent = '';
    refreshActions();
  };

  const items = fields.map((field) => {
    const errorEl = h('div', { class: 'fc-error' });
    errorEls.set(field.attributeId, errorEl);
    const control = buildControl(field, values[field.attributeId], notifyChange, errorEl);
    controlRefs.set(field.attributeId, control);

    const aiButton =
      field.ai && aiContext
        ? h(
            'button',
            {
              type: 'button',
              // 不是按钮而是**校对记号**:语义是"批注这一条",不是"生成"。
              // 与控件行右端的 ✓/✕ 在语义上分层 —— AI 动标签行,✓/✕ 动控件行。
              class: 'ai-improve-button',
              onClick: () =>
                openImproveDialog({
                  label: tr(field.labelKey),
                  sourceText: toDisplay(field, values[field.attributeId]),
                  config: aiContext(),
                  onApply: (text) => {
                    const parsed = fromDisplay(field, text);
                    values[field.attributeId] = parsed;
                    // 逐条清单(亮点)是复合控件,回填走整体重置;textarea 直接赋值
                    if (typeof control.setValues === 'function') control.setValues(parsed);
                    else control.value = toDisplay(field, parsed);
                    refreshActions();
                  },
                }),
            },
            h('span', { class: 'ai-caret', 'aria-hidden': 'true' }, '\u2038'),
            tr('ai.improve')
          )
        : null;

    // ---- 可访问名接线 ----
    // 光有 .form-label 是不够的:label 没有 for、控件没有 id,读屏把 9 个字段
    // 一律念成「编辑 空白」,鼠标点标签也不聚焦(2026-08-19 审计抓到)。
    const fieldId = `fc-${formUid}-${field.attributeId}`;
    const errorId = `${fieldId}-err`;
    errorEl.id = errorId;
    // 校验文案要能被读出来 —— 它是 revealInvalid 之后用户唯一的线索
    errorEl.setAttribute('role', 'alert');

    // 单控件用 for/id;复合控件(电话、日期+至今、头像、可搜索选择器)内部不止一个
    // 可聚焦元素,for 只能指一个,所以改用 role=group + aria-labelledby。
    const single = control.matches?.('input, textarea, select') ? control : null;
    const labelAttrs = { class: ['form-label', field.required && 'required'], title: field.jsonPath || '' };
    if (single) {
      single.id = fieldId;
      labelAttrs.for = fieldId;
      single.setAttribute('aria-describedby', errorId);
      if (field.required) single.setAttribute('aria-required', 'true');
    } else {
      labelAttrs.id = `${fieldId}-label`;
      control.setAttribute?.('role', 'group');
      control.setAttribute?.('aria-labelledby', `${fieldId}-label`);
      control.setAttribute?.('aria-describedby', errorId);
      if (field.required) control.setAttribute?.('aria-required', 'true');
    }

    const row = h(
      'div',
      { class: 'form-group' },
      h(
        'div',
        { class: 'form-group-head' },
        h('label', labelAttrs, tr(field.labelKey)),
        aiButton
      ),
      control,
      errorEl
    );
    rowRefs.set(field.attributeId, row);
    return row;
  });

  /**
   * 整表校验。**返回第一个不合格字段的 id**(全过则返回 null),不再只回 true/false ——
   * 字段旁那个 ✓ 是"整表提交",被同一张表单里别的字段挡住时原来是 `if (!validate()) return`,
   * 点下去毫无反应:错误提示在别处、不在你点的那一行旁边(2026-08-19 查出)。
   */
  const firstInvalidField = () => {
    let bad = null;
    for (const field of fields) {
      const errorEl = errorEls.get(field.attributeId);
      const val = values[field.attributeId];
      const str = validationText(field, val);
      if (field.required && str.trim() === '') {
        bad = bad || field.attributeId;
        if (errorEl) errorEl.textContent = tr('error.required');
        continue;
      }
      // month 类型统一按标准的 iso8601 校验(字段定义里不必再写 validate)
      const validator =
        (field.validate && VALIDATORS[field.validate]) || (field.type === 'month' ? VALIDATORS.month : null);
      if (validator && str !== '' && !validator.test(str)) {
        bad = bad || field.attributeId;
        if (errorEl) errorEl.textContent = tr(validator.errorKey);
        continue;
      }
      if (errorEl) errorEl.textContent = '';
    }
    // 起止时间顺序:两端精度可能不同('2019' vs '2019-06'),按较短的那个截齐再比,
    // 否则 "2019-06 ~ 2019" 会被误判成倒序。
    const trimTo = (a, b) => {
      const n = Math.min(a.length, b.length);
      return [a.slice(0, n), b.slice(0, n)];
    };
    if (values.startDate && values.endDate) {
      const [s, e] = trimTo(String(values.startDate), String(values.endDate));
      if (e < s) {
        bad = bad || 'endDate';
        const errorEl = errorEls.get('endDate');
        if (errorEl) errorEl.textContent = tr('error.endBeforeStart');
      }
    }
    return bad;
  };

  /** 把不合格的那一行滚进视野并聚焦 —— 点了 ✓ 没反应是最难受的一种"没反应"。 */
  const revealInvalid = (attributeId) => {
    const control = controlRefs.get(attributeId);
    const target = control?.matches?.('input,textarea,select')
      ? control
      : control?.querySelector?.('input,textarea,select');
    const row = rowRefs.get(attributeId) || target?.closest?.('.form-group');
    row?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    row?.classList.add('is-blocking');
    setTimeout(() => row?.classList.remove('is-blocking'), 1200);
    try {
      target?.focus?.({ preventScroll: true });
    } catch {
      target?.focus?.();
    }
  };

  // 底部**一对按钮**。一条记录一次保存 —— 这是整套架构里最要紧的一条:
  // 原来是"每个字段旁挂 ✓/✕、按一下提交整份表单",那个混血模型既不是即改即存
  // 也不是表单提交,今天修的三个丢数据 bug 全部出自它(未提交的值散在闭包里,
  // 任何一次重渲染都能把它铲掉)。一条记录一个保存,这一整类 bug 从结构上消失。
  const saveBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-primary form-save',
      disabled: true,
      onClick: () => {
        const blocking = firstInvalidField();
        if (blocking !== null) {
          revealInvalid(blocking);
          return;
        }
        onSubmit && onSubmit({ ...values });
      },
    },
    tr('action.submit')
  );

  footerEl = h(
    'div',
    { class: 'form-actions' },
    h(
      'button',
      {
        type: 'button',
        class: 'btn form-cancel',
        onClick: () => {
          for (const field of fields) {
            values[field.attributeId] = initialValues[field.attributeId];
            resetControl(field, values[field.attributeId]);
            const errorEl = errorEls.get(field.attributeId);
            if (errorEl) errorEl.textContent = '';
          }
          refreshActions();
          onCancel && onCancel();
        },
      },
      tr('action.cancel')
    ),
    saveBtn
  );

  const root = h('div', { class: 'form-creator' }, items, footerEl);

  /** 当前表单值的快照。 */
  root.getValues = () => ({ ...values });

  /** 有没有还没保存的改动 —— 上层用它拦"改到一半就走人"。 */
  root.hasPendingEdit = isDirty;

  /**
   * 提交成功后把"初值"就地推进到刚存下的那一份 —— 于是表单回到干净态、保存按钮重新锁上,
   * **而不必重建 DOM**。身份块保存后原来是整页 renderDoc(),那会把同一页上别的表单里
   * 还没保存的内容一起铲掉(2026-08-19 审计抓到,是这次重做自己引入的丢数据路径)。
   */
  root.markSaved = (saved) => {
    for (const field of fields) initialValues[field.attributeId] = saved[field.attributeId];
    refreshActions();
  };

  refreshActions();

  return root;
}
