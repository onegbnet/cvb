// 芯片输入 —— **词组**数组的编辑控件(技能清单/关键词/课程/角色),
// 行内轻记录与重记录表单共用。逗号、顿号、分号、回车都收一枚,
// 粘贴「Java, Go」自动拆 —— 词组里不含这些符号,拿它们当分隔符不伤内容。
// **句子数组(亮点/要点)不归这里**:句子里就有逗号,芯片化会把一句话剁碎,
// 那类字段用 string-list.mjs 的逐条清单(2026-08-21 用户裁定)。
//
// 一条红线:**数组永不原地 push/splice,每次赋新的** —— 消费方(行内的 commit、
// 表单的 dirty 比较)拿浅拷快照对比,原地改会让新旧共享同一个数组、比较永远相等,
// 第二轮编辑就再也提交不上去(inline-rows sameRecord 的老坑)。
import { h } from '../lib/dom.mjs';
import { icon } from '../lib/icons.mjs';
import { tr } from '../lib/i18n.mjs';

const SPLIT = /[\n,，、;；]+/;

/**
 * @param {object} opts
 * @param {string[]} [opts.value] 初始值
 * @param {string} [opts.placeholder] 常驻操作提示
 * @param {string} [opts.ariaLabel]
 * @param {(arr: string[], reason: 'add'|'remove-x'|'remove-backspace') => void} [opts.onChange]
 *   每次变化回调,arr 是新数组(可安全持有)
 * @param {() => void} [opts.onBlur] 输入框失焦(半截词已先收进去)
 * @returns 控件根元素,带 setValues(arr) 供取消回滚 / AI 回填整体重置
 */
export function createChipsInput({ value = [], placeholder = '', ariaLabel = '', onChange, onBlur }) {
  let arr = [...value];

  const input = h('input', {
    type: 'text',
    class: 'chip-in',
    placeholder,
    'aria-label': ariaLabel,
  });
  // input 是 box 的末子 —— 芯片一律 insertBefore(chip, input) 插在它前面
  const box = h('div', { class: 'chips', onClick: (e) => e.target === box && input.focus() }, input);

  const addChipEl = (word) => {
    const chip = h(
      'span',
      { class: 'chip' },
      word,
      h(
        'button',
        {
          type: 'button',
          class: 'chip-x',
          'aria-label': `${tr('action.delete')} ${word}`,
          onClick: () => {
            // 同名词可能重复,按元素位置定下标,别 indexOf(word)
            const i = [...box.querySelectorAll('.chip')].indexOf(chip);
            if (i >= 0) arr = arr.filter((_, k) => k !== i);
            chip.remove();
            onChange && onChange([...arr], 'remove-x');
          },
        },
        icon('close')
      )
    );
    box.insertBefore(chip, input);
  };

  /** 把输入框里的文字(可拼上粘贴来的)收成芯片;有收到东西返回 true。 */
  const chipify = (extra = '') => {
    const parts = (String(input.value || '') + String(extra))
      .split(SPLIT)
      .map((s) => s.trim())
      .filter(Boolean);
    input.value = '';
    if (!parts.length) return false;
    arr = [...arr, ...parts];
    for (const word of parts) addChipEl(word);
    onChange && onChange([...arr], 'add');
    return true;
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // 有字就收成芯片继续敲下一枚;空着回车 = 收工,交还焦点流(触发 onBlur)
      if (!chipify()) input.blur();
    } else if (e.key === 'Backspace' && input.value === '' && arr.length) {
      const chips = box.querySelectorAll('.chip');
      arr = arr.slice(0, -1);
      chips[chips.length - 1].remove();
      onChange && onChange([...arr], 'remove-backspace');
    }
  });
  // 分隔符一落就收
  input.addEventListener('input', () => SPLIT.test(input.value) && chipify());
  // 粘贴要自己接:<input> 会把剪贴板里的换行剁掉,按换行分隔的粘贴件边界就没了
  input.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
    if (!SPLIT.test(text)) return; // 单个词照常走默认粘贴
    e.preventDefault();
    chipify(text);
  });
  input.addEventListener('blur', () => {
    chipify(); // 敲了一半的词收进去,不丢
    onBlur && onBlur();
  });

  for (const word of arr) addChipEl(word);

  /** 整体重置(取消回滚 / AI 回填)。不触发 onChange —— 调用方自己知道值是什么。 */
  box.setValues = (next) => {
    arr = Array.isArray(next) ? [...next] : [];
    for (const chip of box.querySelectorAll('.chip')) chip.remove();
    input.value = '';
    for (const word of arr) addChipEl(word);
  };

  return box;
}
