// 轻记录的行内编辑面 —— profiles / skills / languages / interests / references
// 这五个集合(两三个键值对,无日期)。
//
// 为什么单独一档:`languages` 就是 {语言, 熟练度} 两个词。让它走
// 「展开 Group → 点添加 → 填表单 → 点提交」四步流程,是把轻的东西当重的东西对待 ——
// 这正是旧界面最官僚的地方。这里**每条记录就是一行输入框**,末尾常驻一行空的,
// 打字即新增,失焦即存,没有添加按钮、没有展开、没有提交。
//
// **这个组件自己管 DOM,不接受上层重渲染**(2026-08-19 审计抓到两条丢数据):
// 原来提交后走 onChange → main.renderDoc() 整页重建,而浏览器那一刻正在把焦点
// 移向同一行的下一格 —— 那个节点已经被 detach,焦点掉回 body,接着打的字全进了空气。
// 现在:草稿变真记录 = 原地追加一行新草稿;删除 = 只摘掉那一个行节点。焦点不动。
import { h } from '../lib/dom.mjs';
import { icon } from '../lib/icons.mjs';
import { tr } from '../lib/i18n.mjs';

/** 多值字段在**一行输入框**里的写法:逗号分隔。`tags` 在这个组件里另有芯片输入(见 buildRow)。 */
const MULTI = new Set(['tags', 'lines']);
/** 需要多行的字段(如 references 的引述)。 */
const MULTILINE = new Set(['textArea']);

const asText = (field, v) => {
  if (Array.isArray(v)) return v.join(MULTI.has(field.type) ? ', ' : '\n');
  return String(v ?? '');
};
const fromText = (field, s) => {
  if (MULTI.has(field.type)) {
    return String(s || '')
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return String(s || '');
};
const isBlank = (field, v) => asText(field, v).trim() === '';
const sameRecord = (fields, a, b) =>
  fields.every((f) => asText(f, a[f.attributeId]) === asText(f, b[f.attributeId]));

/**
 * @param {object} opts
 * @param {Array} opts.fields 已解析字段
 * @param {Array<object>} opts.items
 * @param {(items:Array<object>)=>void} opts.onChange 提交整份新数组(**上层只存,不要重渲染**)
 */
export function createInlineRows({ fields, items, onChange }) {
  // 组件自己持有一份 —— 上层不会因为 onChange 把我们重建,所以状态得在这里。
  let data = items.map((it) => ({ ...it }));

  // `tags` 字段不占列 —— 它是不封顶的列表,挤在一列里(行宽 ÷ 列数)排不开,
  // 自己占行内的第二条整宽线(2026-08-21 用户定的 B 方案:行内芯片,不为它升重记录)。
  const scalarFields = fields.filter((f) => f.type !== 'tags');
  const tagFields = fields.filter((f) => f.type === 'tags');

  const root = h('div', {
    class: 'inl',
    // 列数必须**显式**给:CSS 里写 repeat(auto-fit, minmax(0,1fr)) 定不出轨道数,
    // 会塌成一列、输入框全挤在左边(2026-08-19 真机拍到)。
    style: { '--inl-cols': `repeat(${scalarFields.length}, minmax(0, 1fr))` },
  });

  root.append(
    h(
      'div',
      { class: 'inl-head' },
      scalarFields.map((f) => h('span', { class: 'inl-th' }, tr(f.labelKey))),
      h('span', { class: 'inl-th inl-th-act' })
    )
  );

  const push = () => onChange(data.map((it) => ({ ...it })));

  /** 造一行。isDraft = 末尾那一行空的。 */
  function buildRow(record, isDraft) {
    const buf = { ...record };            // 输入框正在写的那一份
    let committed = { ...record };        // **上一次落库的样子**
    let slot = isDraft ? null : record;   // data 里对应的那个对象(身份靠它找)
    let draft = isDraft;
    const row = h('div', { class: ['inl-row', draft && 'inl-row-draft'] });

    // **committed 必须是独立快照**:草稿转正后如果让 data 里存的就是 buf 本身,
    // 「变了没有」的比较就成了拿自己跟自己比、永远相等 —— 于是转正之后
    // 同一行第二个字段再怎么改都提交不上去(2026-08-19 真机抓到:
    // 打完「英语」Tab 过去打「流利」,落库只有 language)。
    const commit = () => {
      const allBlank = fields.every((f) => isBlank(f, buf[f.attributeId]));
      if (draft) {
        if (allBlank) return; // 空草稿不产生记录
        // 就地转正:不重建任何已有节点,焦点不受影响
        draft = false;
        row.classList.remove('inl-row-draft');
        row.querySelector('.inl-act')?.remove();
        // 只清标量框的占位;芯片输入的「回车或逗号添加」是操作说明,得常驻
        for (const el of row.querySelectorAll('.inl-input')) el.placeholder = '';
        slot = { ...buf };
        committed = { ...buf };
        data.push(slot);
        row.append(delButton());
        root.append(buildRow({}, true));
        push();
        return;
      }
      const index = data.indexOf(slot);
      if (index < 0) return;
      if (allBlank) {
        data.splice(index, 1);
        row.remove();
        push();
        return;
      }
      if (sameRecord(fields, buf, committed)) return;
      committed = { ...buf };
      slot = { ...buf };
      data[index] = slot;
      push();
    };

    function delButton() {
      return h(
        'button',
        {
          type: 'button',
          class: 'inl-del',
          title: tr('action.delete'),
          'aria-label': tr('action.delete'),
          // 两三个词的东西删错了重打一遍就是,不值得一个确认框挡路
          onClick: () => {
            const i = data.indexOf(slot);
            if (i >= 0) data.splice(i, 1);
            row.remove();
            push();
          },
        },
        icon('close')
      );
    }

    /**
     * `tags` 字段的芯片输入:回车/逗号成一枚,退格删最后一枚,粘贴逗号串自动拆,
     * 失焦把没敲完的半截也收进去(打了一半的词不许丢)再走同一个 commit。
     * 存的还是那个字符串数组,只是不再要求用户自己维护分隔符。
     */
    function buildChips(field) {
      // **数组永不原地改,每次赋新的**:commit 的快照(committed/slot)是浅拷,
      // 原地 push/splice 会让 buf 与快照共享同一个数组 —— 比较变成自己跟自己比,
      // 永远相等,第二次编辑就再也提交不上去(sameRecord 的老坑,见文件头)。
      buf[field.attributeId] = Array.isArray(record[field.attributeId])
        ? [...record[field.attributeId]]
        : [];
      const input = h('input', {
        type: 'text',
        class: 'inl-chip-in',
        placeholder: tr(field.placeholderKey || field.labelKey),
        'aria-label': tr(field.labelKey),
      });
      // input 是 box 的末子 —— 芯片一律 insertBefore(chip, input) 插在它前面
      const box = h('div', { class: 'inl-chips', onClick: (e) => e.target === box && input.focus() }, input);

      const addChip = (word) => {
        const chip = h(
          'span',
          { class: 'inl-chip' },
          word,
          h(
            'button',
            {
              type: 'button',
              class: 'inl-chip-x',
              'aria-label': `${tr('action.delete')} ${word}`,
              onClick: () => {
                // 同名词可能重复,按元素位置定下标,别 indexOf(word)
                const i = [...box.querySelectorAll('.inl-chip')].indexOf(chip);
                if (i >= 0) {
                  buf[field.attributeId] = buf[field.attributeId].filter((_, k) => k !== i);
                }
                chip.remove();
                commit(); // 点 × 是完成动作,当场落库(同整行的删除按钮)
              },
            },
            icon('close')
          )
        );
        box.insertBefore(chip, input);
      };

      /** 把输入框里的文字收成芯片;有收到东西返回 true。 */
      const chipify = () => {
        const parts = String(input.value || '')
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
        input.value = '';
        if (parts.length) {
          buf[field.attributeId] = [...buf[field.attributeId], ...parts];
          for (const word of parts) addChip(word);
        }
        return parts.length > 0;
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // 有字就收成芯片继续敲下一枚;空着回车 = 收工,走失焦即存
          if (!chipify()) input.blur();
        } else if (e.key === 'Backspace' && input.value === '' && buf[field.attributeId].length) {
          const chips = box.querySelectorAll('.inl-chip');
          buf[field.attributeId] = buf[field.attributeId].slice(0, -1);
          chips[chips.length - 1].remove();
        }
      });
      // 逗号(含全角)一落就收 —— 粘贴「Java, Go」也从这里拆开
      input.addEventListener('input', () => /[,，]/.test(input.value) && chipify());
      input.addEventListener('blur', () => {
        chipify();
        commit();
      });

      for (const word of buf[field.attributeId]) addChip(word);
      return box;
    }

    for (const field of scalarFields) {
      // **按字段类型分派**,别一律 input[type=text]:`lines` 是多值,
      // 单行框里塞不进换行 —— 原来 ['Go','Rust','K8s'] 会显示成 "GoRustK8s"、
      // 回写恒为单元素数组(2026-08-19 审计抓到,丢数据)。
      const multiline = MULTILINE.has(field.type);
      const el = h(multiline ? 'textarea' : 'input', {
        ...(multiline ? { rows: 2 } : { type: 'text' }),
        class: ['fc-input', 'inl-input', multiline && 'inl-input-multi'],
        value: asText(field, record[field.attributeId]),
        placeholder: draft ? tr(field.labelKey) : '',
        'aria-label': tr(field.labelKey),
        onInput: (e) => {
          buf[field.attributeId] = fromText(field, e.target.value);
        },
        onBlur: commit,
        onKeydown: (e) => {
          if (e.key === 'Enter' && !multiline) {
            e.preventDefault();
            e.target.blur();
          }
        },
      });
      row.append(el);
    }

    // 芯片行排在标量列之后、删除按钮之前(Tab 序:名称 → 熟练度 → 清单 → 删除);
    // 删除按钮由 CSS 钉在首行末列,不吃 DOM 次序
    for (const field of tagFields) row.append(buildChips(field));

    row.append(draft ? h('span', { class: 'inl-act' }) : delButton());
    return row;
  }

  for (const record of data) root.append(buildRow(record, false));
  root.append(buildRow({}, true));

  // 行内编辑没有"未提交"的概念(失焦即存),所以恒为 false —— 上层的导航拦截靠它。
  root.hasPendingEdit = () => false;
  return root;
}
