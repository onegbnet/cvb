// i18n(ccs i18n-engine 形态,契约 Option A:服务端驱动):
// - worker 按 lang cookie / Accept-Language 决定语言,HTML 注入对应
//   per-lang bundle(app/i18n/i18n-<code>.min.js,build 时经 ccs
//   buildLangBundle 生成),bundle 暴露全局表 T 并自动应用 data-i18n*。
// - tr(key) 读全局 T;window.tr 供 ccs overlay 内建 label 使用。
// - 切换语言 = POST /api/prefs { lang } → Set-Cookie → reload。

export const SUPPORTED_LANGS = ['zh-cn', 'en'];

export function getLanguage() {
  const lang = (document.documentElement.lang || '').toLowerCase();
  return SUPPORTED_LANGS.includes(lang) ? lang : 'zh-cn';
}

export function tr(key, fallback) {
  const table = typeof window !== 'undefined' && window.T ? window.T : null;
  return (table && table[key]) ?? fallback ?? key;
}

if (typeof window !== 'undefined') {
  window.tr = tr;
}

/** 保留当前 query 构造站内链接。 */
export function buildLocalizedPath(page, extraQuery = {}) {
  const params = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(extraQuery)) {
    if (v === undefined || v === null || v === '') params.delete(k);
    else params.set(k, String(v));
  }
  const search = params.toString();
  return search ? `${page}?${search}` : page;
}

export async function switchLanguage(nextLang) {
  if (nextLang === getLanguage()) return;
  try {
    await fetch('/api/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: nextLang }),
    });
  } finally {
    window.location.reload();
  }
}
