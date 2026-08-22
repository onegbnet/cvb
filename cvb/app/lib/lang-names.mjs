// 20 门界面语言的自名 —— 镜像 ccs i18n-engine 的官方清单(ccs/i18n-engine/view.html
// 的 20 个 option;浏览器模块进不了 ccs 的 mjs/,所以这里抄一份,顺序也照它)。
// 自名与界面语言无关 —— 语言选择器里每一项用它自己的语言写,谁都找得到自己的。
export const UI_LANG_NAMES = {
  en: 'English',
  eo: 'Esperanto',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
  nl: 'Nederlands',
  da: 'Dansk',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  ms: 'Bahasa Melayu',
  vi: 'Tiếng Việt',
  th: 'ไทย',
  ta: 'தமிழ்',
  my: 'မြန်မာ',
  uk: 'Українська',
  he: 'עברית',
  ar: 'العربية',
};

/** 界面语言 → 事实语言(主语言子标签):zh-cn/zh-tw → zh。 */
export const factsLangOfUi = (uiLang) => String(uiLang || '').split('-')[0];

/**
 * 事实语言 → 界面语言。同族变体不折腾:当前界面已是该族(zh-tw 看 zh 事实)就保持;
 * 否则取官方清单里第一个匹配(zh → zh-cn)。没有界面包回 null(界面不动)。
 */
export const uiLangForFacts = (code, currentUi, supported) => {
  if (factsLangOfUi(currentUi) === code) return currentUi;
  return supported.find((l) => l === code || l.startsWith(`${code}-`)) || null;
};
