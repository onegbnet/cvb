// 事实语言的文档栏 —— 多语种事实的编辑入口(2026-08-22)。
//
// **两个语言轴是正交的**(用户点出的设计难点):页眉的 中/En 是**界面语言**(偏好),
// 这条栏是**事实语言**(文档身份)—— 你不是在"切换语言",是在**打开另一份文档**。
// 三条防混淆的规矩:
//   ① 每门语言用**它自己的语言**写名字(中文/English/日本語)—— 自我标识,
//      不随界面语言翻译,和页眉的 中/En 在字面上就不会撞;
//   ② 栏的标签(「事实库:」)才随界面语言走;
//   ③ 切换走"打开文档"的全套礼数(未保存闸门、重载、回页顶)—— 由上层 onSwitch 负责。
import { h } from '../lib/dom.mjs';
import { tr } from '../lib/i18n.mjs';

/** 常见语言的自名。不是 i18n 表 —— 自名与界面语言无关,这正是它防混淆的原理。 */
const FACTS_LANG_NAMES = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
  ru: 'Русский',
  ar: 'العربية',
  nl: 'Nederlands',
};

export const factsLangName = (code) => FACTS_LANG_NAMES[code] || code;

/**
 * @param {object} opts
 * @param {{source: string, langs: Array<{lang: string}>}} opts.langsInfo
 * @param {string} opts.current 当前打开的事实语言
 * @param {(code: string) => void} opts.onSwitch
 * @param {() => void} opts.onAdd
 */
export function buildFactsBar({ langsInfo, current, onSwitch, onAdd }) {
  return h(
    'div',
    { class: 'facts-bar' },
    h('span', { class: 'facts-bar-label' }, tr('facts.bar.label')),
    langsInfo.langs.map(({ lang }) =>
      h(
        'button',
        {
          type: 'button',
          class: ['facts-lang', lang === current && 'is-current'],
          'aria-pressed': lang === current ? 'true' : 'false',
          onClick: () => lang !== current && onSwitch(lang),
        },
        factsLangName(lang),
        lang === langsInfo.source ? h('span', { class: 'facts-source-tag' }, tr('facts.source.tag')) : null
      )
    ),
    h('button', { type: 'button', class: 'facts-lang facts-lang-add', onClick: onAdd }, `＋ ${tr('facts.add')}`)
  );
}

/**
 * 「添加语言」框:常见语言里挑一门(已有的不列)。
 * 框里那一句是**行为陈述**(点了会发生什么:以真相源为底稿克隆),不是说明书。
 * @param {object} opts
 * @param {string[]} opts.existing 已有语种
 * @param {(code: string) => void} opts.onPick
 */
export function openAddLangDialog({ existing, onPick }) {
  if (!window.Overlay || typeof window.Overlay.show !== 'function') return;
  const candidates = Object.keys(FACTS_LANG_NAMES).filter((code) => !existing.includes(code));
  const body = h(
    'div',
    { class: 'facts-add' },
    h('p', { class: 'facts-add-note' }, tr('facts.add.note')),
    h(
      'div',
      { class: 'facts-add-grid' },
      candidates.map((code) =>
        h(
          'button',
          {
            type: 'button',
            class: 'btn facts-add-item',
            onClick: () => {
              handle && handle.close();
              onPick(code);
            },
          },
          factsLangName(code)
        )
      )
    )
  );
  const handle = window.Overlay.show({ variant: 'box', title: tr('facts.add.title'), body });
}
