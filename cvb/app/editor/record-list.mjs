// 重记录的列表面 —— work / education / projects / volunteer / publications /
// awards / certificates 这七个集合(带日期、带散文)。
//
// **一条记录只占一行**:左边是它是什么(标题 + 副标题),右边是时间范围。
// 点开不是"就地展开",而是**整块换成这条记录的编辑器**(由 main 负责)——
// 你在编一条记录时不需要看见列表,一次只做一件事,也就没有"卡里的卡里的卡"。
//
// 顺序**不由用户手动摆**:带日期的集合按日期倒序自动排(简历本来就是倒序的),
// 所以这里没有上下移、没有拖拽。顺序是呈现决策,而呈现归 /apply 管 —— 这一页只管事实。
import { h } from '../lib/dom.mjs';
import { icon } from '../lib/icons.mjs';
import { tr } from '../lib/i18n.mjs';
import { confirmAction } from '../lib/confirm.mjs';

const text = (v) => (Array.isArray(v) ? v.filter(Boolean).join('、') : String(v ?? '')).trim();

/** 这条记录的时间范围,按集合实际有的字段挑。没有日期就返回空串。 */
export function recordPeriod(item) {
  const single = text(item.date) || text(item.releaseDate);
  if (single) return single;
  const from = text(item.startDate);
  const to = text(item.endDate);
  if (!from && !to) return '';
  return `${from || '—'} – ${to || tr('preview.present')}`;
}

/** 排序键:能比就比,比不了的沉底(保持相对顺序)。 */
const sortKey = (item) => text(item.endDate) || text(item.date) || text(item.releaseDate) || text(item.startDate);

/**
 * 这条记录是不是**还在进行中**(勾了「至今」)。
 * 只有本来就有「至今」这个概念的集合才算(work / projects / volunteer)——
 * education / certificates 的空 endDate 只是没填,不是"至今"。
 */
const isOngoing = (item, hasPresent) => hasPresent && !text(item.endDate) && Boolean(text(item.startDate));

/** 两端精度可能不同('2019' vs '2019-03'),按较短的一侧截齐再比。 */
const cmp = (a, b) => {
  const n = Math.min(a.length, b.length);
  const x = a.slice(0, n);
  const y = b.slice(0, n);
  if (x === y) return 0;
  return x < y ? -1 : 1;
};

/**
 * 带日期的集合按日期**倒序**排。返回新数组,不改原数组。
 * 没有任何日期的集合原样返回 —— 别去动用户自己摆的顺序。
 *
 * 两条是踩出来的:
 * ① **「至今」排最前**。原来拿 endDate 当键,而勾了至今的记录 endDate 是空串,
 *    于是它退化成拿自己的 startDate 去跟别人的 endDate 比 —— 还在做的那份工作
 *    被排到已经离职的后面,而这一页既没有手动排序也没有撤销(2026-08-19 审计抓到)。
 * ② **精度要截齐**。'2019' < '2019-03' 是字符串事实,但不是时间事实;
 *    同年只写年份的那条会被压到年月那条后面。
 *
 * @param {Array<object>} items
 * @param {{hasPresent?: boolean}} [opts] 这个集合有没有「至今」的概念
 */
export function sortByDateDesc(items, opts = {}) {
  const hasPresent = Boolean(opts.hasPresent);
  if (!items.some((item) => sortKey(item) || isOngoing(item, hasPresent))) return items.slice();
  return items
    .map((item, index) => ({ item, index, key: sortKey(item), ongoing: isOngoing(item, hasPresent) }))
    .sort((a, b) => {
      // 进行中的一律在前;两条都进行中就按开始时间倒序互比
      if (a.ongoing !== b.ongoing) return a.ongoing ? -1 : 1;
      if (a.ongoing && b.ongoing) {
        const r = cmp(text(a.item.startDate), text(b.item.startDate));
        return r === 0 ? a.index - b.index : -r;
      }
      if (!a.key && !b.key) return a.index - b.index;
      if (!a.key) return 1;
      if (!b.key) return -1;
      const r = cmp(a.key, b.key);
      return r === 0 ? a.index - b.index : -r;
    })
    .map((x) => x.item);
}

/**
 * @param {object} opts
 * @param {object} opts.module 模块描述符
 * @param {Array<object>} opts.items
 * @param {Array} opts.fields 已解析字段(用来挑副标题)
 * @param {(index:number)=>void} opts.onOpen
 * @param {()=>void} opts.onAdd
 * @param {(index:number)=>void} opts.onDelete
 */
export function createRecordList({ module, items, fields, onOpen, onAdd, onDelete }) {
  // 副标题取"第一个不是摘要字段、也不是日期/链接的短文本字段" —— 对 work 是职位、
  // 对 education 是专业、对 awards 是颁发方。不写死每个集合一张表,那种表会漂。
  const subtitleField = fields.find(
    (f) =>
      f.attributeId !== module.summaryField &&
      f.type !== 'month' &&
      f.type !== 'textArea' &&
      f.type !== 'lines' &&
      f.type !== 'tags' &&
      !/url|image/i.test(f.attributeId)
  );

  const rows = items.map((item, index) => {
    const title = text(item[module.summaryField]) || tr('editor.untitledItem');
    const sub = subtitleField ? text(item[subtitleField.attributeId]) : '';
    const period = recordPeriod(item);
    return h(
      'div',
      { class: 'rec-row' },
      h(
        'button',
        {
          type: 'button',
          class: 'rec-open',
          onClick: () => onOpen(index),
        },
        h(
          'span',
          { class: 'rec-name' },
          title,
          sub ? h('span', { class: 'rec-sub' }, sub) : null
        ),
        period ? h('span', { class: 'rec-period num' }, period) : null
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'rec-del',
          title: tr('action.delete'),
          'aria-label': `${tr('action.delete')} ${title}`,
          onClick: () => confirmAction(tr('action.confirmDelete'), () => onDelete(index)),
        },
        icon('trash')
      )
    );
  });

  return h(
    'div',
    { class: 'rec-list' },
    // 空集合**不说废话**:"暂无内容,点击添加创建第一条"里那个按钮就在下面一行,
    // 让它自己说话就够了。六个空集合各占一段文字是纯噪声。
    rows,
    h(
      'button',
      { type: 'button', class: 'rec-add', onClick: onAdd },
      icon('plus'),
      ` ${tr('action.add')}`
    )
  );
}
