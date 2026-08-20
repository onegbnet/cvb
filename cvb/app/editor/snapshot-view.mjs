// 快照只读视图 —— `/edit?snapshot=<key>`,由快照列表上的「查看」按钮在新窗口打开。
//
// **为什么是另一条渲染路径,而不是把编辑器"禁用掉"**:
// 编辑器上能改数据的地方有几十处(行内输入失焦即存、记录编辑器的保存、头像上传、
// 管理抽屉的导入与恢复)。逐个 disable 是"漏一个就写脏真实事实库"的形态 ——
// 而这里看的是快照,写进去的却会是当前事实。所以这条路径**根本不装那套机器**:
// 它只有取值和排版,连 saveResume 都没 import。
//
// 信息架构照文档那一页:同样 15 个分节、同样的分节名与字段名(共用 modules.mjs 的
// `get` 与 `fields`),这样看快照和看事实是同一张地图。
import { h } from '../lib/dom.mjs';
import { icon } from '../lib/icons.mjs';
import { tr } from '../lib/i18n.mjs';
import { SECTIONS, sectionModules, getModuleName } from './modules.mjs';

const EMPTY = '—';

/** 把一个字段的值排成能读的文字。数组按类型分行/分隔,空值一律 EMPTY。 */
function renderValue(field, value) {
  if (field.type === 'avatar') {
    return value
      ? h('img', { class: 'snapv-avatar', src: value, alt: tr('field.basics.image') })
      : h('span', { class: 'snapv-empty' }, EMPTY);
  }
  if (Array.isArray(value)) {
    if (!value.length) return h('span', { class: 'snapv-empty' }, EMPTY);
    // `lines`(如课程)一行一条;`tags`(如关键词)排成一串
    return field.type === 'lines'
      ? h('div', { class: 'snapv-lines' }, value.map((v) => h('div', {}, String(v))))
      : h('div', { class: 'snapv-tags' }, value.map((v) => h('span', { class: 'snapv-tag' }, String(v))));
  }
  const text = value === undefined || value === null ? '' : String(value);
  if (!text.trim()) return h('span', { class: 'snapv-empty' }, EMPTY);
  // 长文(自我评价、经历描述)要保留换行
  return h('div', { class: field.type === 'textArea' ? 'snapv-prose' : 'snapv-text' }, text);
}

const fieldRow = (field, record) =>
  h(
    'div',
    { class: 'snapv-field' },
    h('span', { class: 'snapv-label' }, tr(field.labelKey)),
    renderValue(field, record ? record[field.attributeId] : undefined)
  );

function renderModule(module, config) {
  let body;
  try {
    if (module.kind === 'list') {
      const items = module.get(config) || [];
      body = items.length
        ? h('div', { class: 'snapv-records' },
            items.map((item) => h('div', { class: 'snapv-record' }, module.fields.map((f) => fieldRow(f, item)))))
        : h('p', { class: 'snapv-none' }, tr('snapshot.view.none'));
    } else {
      body = h('div', { class: 'snapv-record' }, module.fields.map((f) => fieldRow(f, module.get(config) || {})));
    }
  } catch {
    // 快照可能是很久以前的形态 —— 取值抛了就照实说,别整页炸掉
    body = h('p', { class: 'snapv-none' }, tr('snapshot.view.unreadable'));
  }

  const count = module.kind === 'list' ? (() => { try { return module.get(config).length; } catch { return 0; } })() : 0;
  return h(
    'section',
    { class: 'blk', id: `m-${module.key}` },
    h(
      'h2',
      { class: 'blk-title' },
      h('span', { class: 'blk-icon' }, icon(module.icon)),
      getModuleName(module),
      h('span', { class: 'blk-count num' }, count > 0 ? String(count) : '')
    ),
    h('div', { class: 'blk-body' }, body)
  );
}

/**
 * @param {object} config 快照里的事实(已 normalizeResume)
 * @param {{when?: string, note?: string}} meta 顶部横幅上要说清楚的"这是哪一份"
 */
export function renderSnapshotView(config, meta = {}) {
  // 横幅**置顶常驻**(sticky):滚到第 12 个分节时也得知道自己看的不是当前事实。
  const banner = h(
    'div',
    { class: 'snapv-banner', role: 'status' },
    h('span', { class: 'snapv-banner-icon' }, icon('history')),
    h(
      'span',
      { class: 'snapv-banner-text' },
      h('strong', {}, tr('snapshot.view.title')),
      // **只说这是快照,不解释"所以你改不了"** —— 说清楚是什么,读的人自己就明白了;
      // 多一句"改不了也存不了"是在替读者做他自己会做的推理。
      h('span', { class: 'snapv-banner-sub' },
        [meta.when, meta.note].filter(Boolean).join(' · ') || '')
    )
  );

  const doc = h('main', { class: 'doc snapv-doc' });
  for (const section of SECTIONS) {
    for (const module of sectionModules(section.id)) doc.append(renderModule(module, config));
  }

  // 索引照文档那一页的形态(分节标题 + 锚点),纯锚点跳转 —— 这里没有"记录编辑器"要先退出
  const index = h('nav', { class: 'doc-index' });
  for (const section of SECTIONS) {
    index.append(h('div', { class: 'doc-index-title' }, tr(section.labelKey)));
    for (const module of sectionModules(section.id)) {
      index.append(h('a', { class: 'doc-index-item', href: `#m-${module.key}` }, getModuleName(module)));
    }
  }

  return h('div', { class: 'snapv' }, banner, h('div', { class: 'resume-editor' },
    h('div', { class: 'editor-content' }, index, doc)));
}
