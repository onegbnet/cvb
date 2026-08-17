// tex writer 共享层 — 数据 → .tex 的公共积木。
// **排版全部来自上游开源件**(见 tex/ 下 vendor 的 .cls/.sty),这里只产字符串:
//   转义(escapeTex,唯一转义源)、日期区间、bullets、颜色、
//   以及字体接线(CJK 检测与注入、拉丁字族声明、texEngineAssets 自报资产)。
// 自研的 cvb.cls 宏层与配套的 buildPreamble/buildDocument 已于 2026-08-14 随
// 自研模板一并退役 —— 每套上游件的导言区形态不同,由各自的生成器直接拼。
// 纯 ESM、无 DOM、无 node:*,浏览器与 Node 通吃。
import { escapeTex, escapeTexUrl } from '../lib/tex-escape.mjs';
import { formatMonthStyle } from '../lib/schema.mjs';

export { escapeTex, escapeTexUrl };

// ---- 颜色 ----

/** CSS 十六进制 → xcolor HTML 模型参数:去 #、3 位展开、大写;非法输入返回 ''。 */
export const texHexColor = (css) => {
  const raw = String(css || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return raw.toUpperCase().split('').map((c) => c + c).join('');
  }
  return /^[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : '';
};

// ---- 字体接线(CJK 与拉丁;字体一律**不进数据包**,按需喂进编译 CWD) ----
//
// 拉丁圈模板遇到中日韩数据一样要出字——真相源是母语,而模板按**求职地**选,
// 于是"中文简历套澳新模板"是常态而非例外。所以 CJK 是公共能力,不是某几套的特性。
//
// renderTex 是同步的、取字体字节是异步的,所以这里**不取字节**,只让产出的 .tex
// 自报家门:消费方(预览页 / 冒烟驱动)用 texEngineAssets() 扫出需要哪几件,
// 各自去 fetchEngineAsset / 读盘。**注意**:上游件常把字体声明藏在 vendor 的 .sty 里,
// 那时 .tex 扫不到 —— 必须在注册表的 `fonts` 字段显式声明(见 templates/index.mjs)。

/** 引擎资产目录下的三语子集字体(文件名即编译期 CWD 里的路径)。 */
export const CJK_FONT_FILES = { sc: 'cjk-sc.otf', jp: 'cjk-jp.otf', kr: 'cjk-kr.otf' };

/** 中文的补充字面:宋体正文 + 真粗体(子集只有 Regular 一档,粗体不给就得合成)。 */
export const CJK_EXTRA_FILES = ['cjk-sc-serif.otf', 'cjk-sc-bold.otf'];

/**
 * 拉丁字体族(同样住引擎资产目录、按需取)。
 * carlito = Calibri 的 OFL 度量克隆 —— 澳新两国官方指南都点名 Calibri 11
 * (见 culture/nz.md、culture/au.md),**字体属于文化规范的一部分**。
 */
export const LATIN_FONT_FAMILIES = {
  carlito: ['carlito-regular.ttf', 'carlito-bold.ttf', 'carlito-italic.ttf', 'carlito-bolditalic.ttf'],
};

/** fontspec 四面声明(文件随编译喂进 CWD,故 Path=./)。 */
export function latinFontPreamble(family) {
  const files = LATIN_FONT_FAMILIES[family];
  if (!files) return [];
  const [r, b, i, bi] = files;
  return [
    '\\usepackage{fontspec}',
    `\\setmainfont{${r}}[Path=./,BoldFont=${b},ItalicFont=${i},BoldItalicFont=${bi}]`,
  ];
}

// 假名 / 谚文优先——它们唯一指向语种;汉字与全角标点只能说明"是 CJK",落到默认。
const RE_KANA = /[぀-ヿ]/;
const RE_HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;
const RE_HAN = /[㐀-䶿一-鿿豈-﫿　-〿！-｠]/;

/** 文本用的是哪套 CJK 字形;没有 CJK 返回 null。 */
export function detectCjkScript(text) {
  const s = String(text || '');
  if (RE_KANA.test(s)) return 'jp';
  if (RE_HANGUL.test(s)) return 'kr';
  if (RE_HAN.test(s)) return 'sc';
  return null;
}

/**
 * 定下这份文档该用哪套字形。
 *   pref === false → 永不注入;pref 是 sc/jp/kr → 文化优先(日文汉字用中文字形是事故);
 *   缺省/'auto' → 按正文检测。**正文没有 CJK 一律返回 null**,不为空跑一趟 xeCJK。
 */
export function resolveCjkScript(pref, text) {
  if (pref === false) return null;
  const detected = detectCjkScript(text);
  if (!detected) return null;
  return CJK_FONT_FILES[pref] ? pref : detected;
}

/**
 * xeCJK 导言区。三个要点,少一个就出错且**未必报错**:
 *   - 选项写在**字体名之前**(`[...]{file}`):xeCJK 的 \setCJK*font 只认这个签名,
 *     fontspec 那套后置写法在这里是 "font not found";
 *   - `Path=./`:字体是随编译喂进 CWD 的散件,不在 texmf 树里;
 *   - 子集只有 Regular 一档,**加粗与倾斜必须合成**,否则 \textbf 下的中文静默回落常规字重。
 */
export function cjkPreambleLines(script) {
  const file = CJK_FONT_FILES[script];
  if (!file) return [];
  const fake = 'Path=./,AutoFakeBold=2.5,AutoFakeSlant=0.15';
  return [
    '\\usepackage{xeCJK}',
    `\\setCJKmainfont[${fake}]{${file}}`,
    `\\setCJKsansfont[${fake}]{${file}}`,
    `\\setCJKmonofont[${fake}]{${file}}`,
  ];
}

/**
 * 产出的 .tex 需要哪些引擎侧资产。消费方按 `asset` 去引擎资产目录取字节,
 * 放到编译 CWD 的 `path`。返回 [] 表示这份文档自足(纯拉丁且未点名字体)。
 */
export function texEngineAssets(tex) {
  const s = String(tex || '');
  const want = [
    ...Object.values(CJK_FONT_FILES),
    ...CJK_EXTRA_FILES,
    ...Object.values(LATIN_FONT_FAMILIES).flat(),
  ];
  return want.filter((f) => s.includes(f)).map((f) => ({ path: f, asset: `fonts/${f}` }));
}

// ---- 日期(成品字符串在 JS 层,TeX 只 \mbox 防折行) ----

/** formatMonthStyle 直通(us/de/jp/dot/iso)。 */
export const texMonth = (value, style = 'us') => formatMonthStyle(value, style);

/** 非空才包 \mbox。 */
export const mbox = (text) => (text ? `\\mbox{${text}}` : '');

/**
 * 日期区间 → 端到端 \mbox 包裹的成品字符串。
 * 语义对齐 HTML 模板 usRange:无起始只出结束月;有起始无结束补 present;全空 ''。
 * present/sep 须是 TeX 安全字面量(默认 'Present' / ' -- ' en dash)。
 */
export function texDateRange(startDate, endDate, { style = 'us', present = 'Present', sep = ' -- ' } = {}) {
  const start = formatMonthStyle(startDate, style);
  if (!start) return mbox(formatMonthStyle(endDate, style));
  const end = endDate ? formatMonthStyle(endDate, style) : present;
  return mbox(`${start}${sep}${end}`);
}

// ---- 多行文本 → bullets ----

/** 多行文本拆行(trim + 去空);数组输入(highlights)原样走同一清洗。 */
export const splitLines = (text) =>
  (Array.isArray(text) ? text : String(text || '').split('\n'))
    .map((s) => String(s).trim())
    .filter(Boolean);

/**
 * 多行文本/数组 → bullet 块。行文本经 escapeTex;无内容返回 ''。
 *   mode 'hangbullet'(默认,逐行 \hangbullet)| 'cvlist'(itemize 环境)
 *   symbol   hangbullet 模式的符号(TeX 字面量,默认 \textbullet)
 *   listKeys cvlist 模式的 enumitem 参数(keyval 字符串)
 */
export function texBullets(text, { mode = 'hangbullet', symbol = '\\textbullet', listKeys = '' } = {}) {
  const lines = splitLines(text);
  if (!lines.length) return '';
  if (mode === 'cvlist') {
    const opts = listKeys ? `[${listKeys}]` : '';
    return [`\\begin{cvlist}${opts}`, ...lines.map((l) => `  \\item ${escapeTex(l)}`), '\\end{cvlist}'].join('\n');
  }
  return lines.map((l) => `\\hangbullet{${symbol}}{${escapeTex(l)}}`).join('\n');
}

// ---- 杂项 ----

/** 过滤空段后按分隔符拼接(段落须已各自转义)。 */
export const joinNonEmpty = (parts, sep) => parts.filter(Boolean).join(sep);

/** \url 包装(escapeTexUrl 最小转义,断行交给 xurl);空返回 ''。 */
export const texUrl = (url) => (url ? `\\url{${escapeTexUrl(url)}}` : '');
