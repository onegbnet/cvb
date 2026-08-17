// 配置驱动的动态表单(v2):支持 month/tags/lines 结构化控件与
// 打字时校验(ccs Field 可用时接管,否则 blur 兜底)。
// kind=object:即改即存;kind=list 条目:提交按钮 + 提交门禁。
import { h, clear } from '../lib/dom.mjs';
import { tr } from '../lib/i18n.mjs';
import { uploadAvatar, isUnauthorized, redirectToUnlock } from '../lib/api.mjs';
import { openImproveDialog } from '../lib/ai.mjs';
import { isRealisticDate } from '../lib/schema.mjs';

const VALIDATORS = {
  email: {
    test: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    errorKey: 'error.email',
  },
  phone: {
    test: (v) => /^\+?\d[\d\s-]{4,19}$/.test(v),
    errorKey: 'error.phone',
    filter: /[^\d+\s-]/g,
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

const fromDisplay = (field, raw) => {
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
function attachValidation(inputEl, field, errorEl) {
  const validator = field.validate && VALIDATORS[field.validate];
  if (!validator) return;

  const message = () => tr(validator.errorKey);
  const check = (value) => value === '' || validator.test(value);

  if (window.Field && typeof window.Field.wrap === 'function') {
    window.Field.wrap(inputEl, {
      validate: (v) => check(v) || message(),
      errorEl,
      filter: validator.filter,
    });
    return;
  }
  inputEl.addEventListener('blur', () => {
    errorEl.textContent = check(inputEl.value) ? '' : message();
  });
}

function buildControl(field, value, notifyChange, errorEl) {
  switch (field.type) {
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
      // 日期:**界面讲究、存储简单**。
      // 标准允许三档精度(YYYY / YYYY-MM / YYYY-MM-DD),所以这里给一个精度切换,
      // 每档配对应的输入限定器 —— 年是 4 位数字框、年月是浏览器月份选择器、
      // 年月日是日期选择器。**存进去的永远只是那一个标准字符串**,不多存精度标记:
      // 精度由值本身的长度决定,读回来就能还原。
      //
      //(别退回单一的 <input type="month">:它只收 YYYY-MM,"只写年份"会被判非法
      // 而渲染成空,用户一存就把原值抹了 —— 静默丢数据。)
      const PRECISIONS = [
        { id: 'year', labelKey: 'field.date.year', len: 4 },
        { id: 'month', labelKey: 'field.date.month', len: 7 },
        { id: 'day', labelKey: 'field.date.day', len: 10 },
      ];
      const precisionOf = (v) => {
        const n = String(v || '').length;
        if (n >= 10) return 'day';
        if (n >= 7) return 'month';
        return 'year';
      };
      let precision = precisionOf(value);
      let cur = String(value || ''); // 控件自持当前值(buildControl 拿不到表单的 values)

      const wrap = h('div', { class: 'fc-date' });
      const inputHost = h('span', { class: 'fc-date-input' });

      /** 换精度时保留已填部分:变粗就截断,变细就补 01。 */
      const reshape = (v, target) => {
        const parts = String(v || '').split('-');
        if (!parts[0]) return '';
        if (target === 'year') return parts[0];
        if (target === 'month') return `${parts[0]}-${parts[1] || '01'}`;
        return `${parts[0]}-${parts[1] || '01'}-${parts[2] || '01'}`;
      };

      let dateInput = null;
      const buildInput = () => {
        const current = cur;
        const common = {
          class: 'fc-input fc-month',
          onInput: (e) => { cur = e.target.value; notifyChange(field.attributeId, cur); },
          onChange: (e) => { cur = e.target.value; notifyChange(field.attributeId, cur); },
        };
        if (precision === 'year') {
          dateInput = h('input', {
            ...common,
            type: 'number',
            min: '1900',
            max: '2100',
            step: '1',
            placeholder: 'YYYY',
            value: current.slice(0, 4),
          });
        } else if (precision === 'month') {
          dateInput = h('input', { ...common, type: 'month', value: current.slice(0, 7) });
        } else {
          dateInput = h('input', { ...common, type: 'date', value: current.slice(0, 10) });
        }
        clear(inputHost);
        inputHost.append(dateInput);
      };

      const switcher = h(
        'span',
        { class: 'fc-date-precision', role: 'group' },
        PRECISIONS.map((p) =>
          h(
            'button',
            {
              type: 'button',
              class: ['fc-date-precision-btn', p.id === precision && 'is-active'],
              onClick: (e) => {
                const btn = e.currentTarget;
                precision = p.id;
                for (const el of switcher.querySelectorAll('.fc-date-precision-btn')) {
                  el.classList.remove('is-active');
                }
                btn.classList.add('is-active');
                cur = reshape(cur, p.id);
                notifyChange(field.attributeId, cur);
                buildInput();
              },
            },
            tr(p.labelKey)
          )
        )
      );

      buildInput();
      wrap.append(inputHost, switcher);

      if (!field.presentKey) return wrap;

      // "至今/进行中" 复选:勾选 = endDate 置空并禁用输入
      const presentCheckbox = h('input', {
        type: 'checkbox',
        checked: !value,
        onChange: (e) => {
          const on = e.target.checked;
          inputHost.querySelectorAll('input').forEach((el) => {
            el.disabled = on;
            if (on) el.value = '';
          });
          if (on) { cur = ''; notifyChange(field.attributeId, ''); }
        },
      });
      if (!value) inputHost.querySelectorAll('input').forEach((el) => (el.disabled = true));
      return h(
        'div',
        { class: 'fc-month-row' },
        wrap,
        h('label', { class: 'fc-present' }, presentCheckbox, ` ${tr(field.presentKey)}`)
      );
    }

    case 'textArea':
    case 'tags':
    case 'lines': {
      const rows = field.rows || (field.type === 'tags' ? 2 : 4);
      return h('textarea', {
        class: 'fc-textarea',
        rows,
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
        onInput: (e) => notifyChange(field.attributeId, e.target.value),
      });
      attachValidation(input, field, errorEl);
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
 * @param {boolean} opts.isList 列表条目模式
 * @param {(values: object) => void} [opts.onChange] object 模式实时回调
 * @param {(values: object) => void} [opts.onSubmit] list 模式提交回调
 * @param {() => object} [opts.aiContext] 返回当前完整简历配置(AI 润色上下文)
 */
export function createFormCreator({ fields, value = {}, isList, onChange, onSubmit, aiContext }) {
  const values = { ...value };
  const errorEls = new Map();

  const notifyChange = (key, val) => {
    values[key] = val;
    const errorEl = errorEls.get(key);
    if (errorEl && !isList) errorEl.textContent = '';
    if (!isList && onChange) onChange({ ...values });
  };

  const items = fields.map((field) => {
    const errorEl = h('div', { class: 'fc-error' });
    errorEls.set(field.attributeId, errorEl);
    const control = buildControl(field, values[field.attributeId], notifyChange, errorEl);

    const aiButton =
      field.ai && aiContext
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small ai-improve-button',
              onClick: () =>
                openImproveDialog({
                  label: tr(field.labelKey),
                  sourceText: toDisplay(field, values[field.attributeId]),
                  config: aiContext(),
                  onApply: (text) => {
                    const parsed = fromDisplay(field, text);
                    values[field.attributeId] = parsed;
                    control.value = toDisplay(field, parsed);
                    if (!isList && onChange) onChange({ ...values });
                  },
                }),
            },
            tr('ai.improve')
          )
        : null;

    return h(
      'div',
      { class: 'form-item' },
      h(
        'div',
        { class: ['form-item-label', field.required && 'required'] },
        h('span', { class: 'form-item-label-text' }, tr(field.labelKey)),
        h('code', { class: 'form-item-json-path' }, field.jsonPath),
        aiButton
      ),
      h(
        'div',
        { class: ['form-item-control', field.type === 'checkbox' && 'form-item-checkbox'] },
        control,
        errorEl
      )
    );
  });

  const validate = () => {
    let ok = true;
    for (const field of fields) {
      const errorEl = errorEls.get(field.attributeId);
      const val = values[field.attributeId];
      const str = Array.isArray(val) ? val.join('') : String(val ?? '');
      if (field.required && str.trim() === '') {
        ok = false;
        if (errorEl) errorEl.textContent = tr('error.required');
        continue;
      }
      // month 类型统一按标准的 iso8601 校验(字段定义里不必再写 validate)
      const validator =
        (field.validate && VALIDATORS[field.validate]) || (field.type === 'month' ? VALIDATORS.month : null);
      if (validator && str !== '' && !validator.test(str)) {
        ok = false;
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
        ok = false;
        const errorEl = errorEls.get('endDate');
        if (errorEl) errorEl.textContent = tr('error.endBeforeStart');
      }
    }
    return ok;
  };

  const root = h('div', { class: 'form-creator' }, items);

  /** 当前表单值的快照。上层用它判断"这张表单有没有真的被改过"(见 list-editor)。 */
  root.getValues = () => ({ ...values });

  if (isList) {
    root.append(
      h(
        'div',
        { class: 'form-submit' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-accent',
            onClick: () => {
              if (!validate()) return;
              onSubmit && onSubmit({ ...values });
            },
          },
          tr('action.submit')
        )
      )
    );
  }

  return root;
}
