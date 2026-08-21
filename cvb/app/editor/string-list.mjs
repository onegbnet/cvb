// 逐条清单 —— **句子**数组的编辑控件(工作/项目/志愿的亮点、要点)。
// 每条自己一格(自动长高的单条输入),末尾常驻一格空的:打字即新增、回车跳下一条、
// 清空失焦即摘行、× 删指定一条。存放单元的边界在界面上**看得见** ——
// 「textarea 里一行一条、让用户看不出一行是一个存放单元」被判不专业(2026-08-21 用户)。
// 句子里就有逗号,所以它不走 chips.mjs 的分隔符逻辑:条界只认格子,粘贴按换行拆。
import { h } from '../lib/dom.mjs';
import { icon } from '../lib/icons.mjs';
import { tr } from '../lib/i18n.mjs';

/**
 * @param {object} opts
 * @param {string[]} [opts.value] 初始值
 * @param {string} [opts.placeholder] 末尾空格子的提示
 * @param {string} [opts.ariaLabel]
 * @param {(arr: string[]) => void} [opts.onChange] 每次变化回调(新数组,按格子顺序、剔空)
 * @returns 控件根元素,带 setValues(arr) 供取消回滚 / AI 回填整体重置
 */
export function createStringList({ value = [], placeholder = '', ariaLabel = '', onChange }) {
  const root = h('div', { class: 'strlist' });

  const collect = () =>
    [...root.querySelectorAll('.strlist-in')].map((el) => el.value.trim()).filter(Boolean);
  const notify = () => onChange && onChange(collect());

  // 单条输入用 textarea 只为了长句自动换行长高;条与条的边界靠格子,不靠换行 ——
  // 所以回车不进内容,拦下来当"跳下一条"
  const grow = (el) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  function buildRow(text, isDraft) {
    let draft = isDraft;
    const ta = h('textarea', {
      class: 'fc-input strlist-in',
      rows: 1,
      value: text,
      placeholder: draft ? placeholder : '',
      'aria-label': ariaLabel,
    });
    const del = () =>
      h(
        'button',
        {
          type: 'button',
          class: 'strlist-del',
          'aria-label': `${tr('action.delete')} ${ta.value || ''}`.trim(),
          onClick: () => {
            row.remove();
            notify();
          },
        },
        icon('close')
      );
    const row = h('div', { class: ['strlist-row', draft && 'strlist-row-draft'] }, ta);
    row.append(draft ? h('span', { class: 'strlist-pad' }) : del());

    // 就地转正:不动已有节点,焦点不受影响(同 inline-rows 的草稿转正)
    const convert = () => {
      if (!draft) return;
      draft = false;
      row.classList.remove('strlist-row-draft');
      ta.placeholder = '';
      row.querySelector('.strlist-pad')?.remove();
      row.append(del());
      root.append(buildRow('', true));
    };

    ta.addEventListener('input', () => {
      grow(ta);
      if (ta.value.trim() !== '') convert();
      notify();
    });
    // 多行粘贴按换行拆:第一行进当前格,其余各落一格排在后面 ——
    // 不接的话换行会整段进一个格子,条界又变得看不见了
    ta.addEventListener('paste', (e) => {
      const pasted = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
      if (!/\n/.test(pasted)) return;
      e.preventDefault();
      const parts = pasted
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length) return;
      ta.value = `${ta.value}${parts.shift()}`.trim();
      if (ta.value !== '') convert();
      let anchor = row;
      for (const p of parts) {
        const r = buildRow(p, false);
        anchor.after(r);
        anchor = r;
      }
      requestAnimationFrame(() => root.querySelectorAll('.strlist-in').forEach(grow));
      notify();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const inputs = [...root.querySelectorAll('.strlist-in')];
      const next = inputs[inputs.indexOf(ta) + 1];
      if (next) next.focus();
      else ta.blur();
    });
    ta.addEventListener('blur', () => {
      // 清空的格子失焦即摘(末尾常驻的空格子除外)
      if (!draft && ta.value.trim() === '') {
        row.remove();
        notify();
      }
    });
    return row;
  }

  const mount = (arr) => {
    for (const item of arr) root.append(buildRow(item, false));
    root.append(buildRow('', true));
    // 长句要长高,而 scrollHeight 要等挂进文档才有 —— renderDoc 是同步挂载,rAF 落在其后
    requestAnimationFrame(() => root.querySelectorAll('.strlist-in').forEach(grow));
  };

  mount(Array.isArray(value) ? value : []);

  /** 整体重置(取消回滚 / AI 回填)。不触发 onChange —— 调用方自己知道值是什么。 */
  root.setValues = (next) => {
    for (const row of root.querySelectorAll('.strlist-row')) row.remove();
    mount(Array.isArray(next) ? [...next] : []);
  };

  return root;
}
