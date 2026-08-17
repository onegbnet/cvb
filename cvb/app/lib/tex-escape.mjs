// LaTeX 转义 — tex writer 唯一共享入口(施工矩阵风险#10)。
// escapeTex:正文文本;escapeTexUrl:\url{} 参数的最小转义(换行/断行一律交给 writer 与 xurl)。
// 单次扫描替换:每个源字符只被替换一次,天然规避「\ 必须最先处理」的顺序陷阱。

// 正文特殊字符表。规约点名九个(\ { } & % # _ ~ ^);$ 额外纳入——
// 简历正文常见("$120k"),裸 $ 会误开数学模式。
const TEX_CHAR_MAP = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  '#': '\\#',
  _: '\\_',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  $: '\\$',
};

const TEX_CHAR_RE = /[\\{}&%#_~^$]/g;

export const escapeTex = (text) => {
  if (text === null || text === undefined) return '';
  return String(text).replace(TEX_CHAR_RE, (ch) => TEX_CHAR_MAP[ch]);
};

// \url{} 参数:仅处理会破坏宏参数解析的 % # { } \(pandoc 同款取舍),
// 其余字符(: / ? = ~ 等)由 xurl 按原样排版并负责断行。
const URL_CHAR_MAP = {
  '%': '\\%',
  '#': '\\#',
  '{': '\\{',
  '}': '\\}',
  '\\': '\\textbackslash{}',
};

const URL_CHAR_RE = /[%#{}\\]/g;

export const escapeTexUrl = (url) => {
  if (url === null || url === undefined) return '';
  return String(url).replace(URL_CHAR_RE, (ch) => URL_CHAR_MAP[ch]);
};
