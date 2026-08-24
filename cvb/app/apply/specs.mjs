// 投递规格 —— 「这份简历投到哪里」。
//
// **对用户不可见的是规格的内容,不是规格本身**(2026-08-24 用户裁定):
// 界面上只让人选一个目标(国别 / 将来的 国别-职种 / 国别-地域),
// 字体、页数、照片政策这些**不摆成规则表给人读** —— 它们是机器该遵守的约束,
// 不是让求职者学习的功课。规格在背后决定:可选哪几套版式、文件名怎么起,
// 以及(§8 队列 2 ②)将来喂给 AI 定向裁剪的当地规范上下文。
//
// **每条值都手抄自 `culture/<id>.md` 的硬规则表**,并保留来源标记 ——
// 那份语料的规矩是「每条带原文引用 + 来源 URL + 抓取日期,没写的标待查」
// (culture/README.md)。这里同理:**md 里没写的,这里写 null,不许替它补**。
// 语料改了要回来对一遍(所以 `culture` 字段指名到文件)。
//
// id 的形状留了余地:现在是国别(au / nz / cn),将来 `cn-tech`、`au-nsw`
// 这类「国别-职种」「国别-地域」照样是一个 id 一份 md,不必改结构。
//
// **`country` 是显式字段,不许从 id 切**(2026-08-25 接职位信息推导时定):
// 现在 id 恰好等于国别码的小写,切一下也对 —— 但 id 的形状本来就留了余地,
// `cn-tech` 一出现,"按 id 前缀切"就成了一条会在将来某天静默出错的规则。
// 职位信息推导规格靠的就是这个字段(app/apply/job.mjs 的 deriveSpec):
// 招聘机构在哪个国家 → 哪几套规格,**恰好一套才自动选,多套或没有就让人自己选**。

/** @typedef {{id:string, labelKey:string, country:string, culture:string, templates:string[],
 *   paper:string, maxPages:number|null, photo:'no'|'required'|null,
 *   fileName:'given-family-CV'|null}} ApplySpec */

/** @type {ApplySpec[]} */
export const APPLY_SPECS = [
  {
    id: 'au',
    labelKey: 'spec.au',
    country: 'AU',
    culture: 'culture/au.md',
    templates: ['anz-tech'],
    paper: 'A4',
    maxPages: 2, // "no more than 2 pages"(S1);州级口径 1–3 页,取更严的
    photo: null, // **待查**:au.md 明写「S1、S2 均未明文规定」—— 不许替它补
    fileName: null,
  },
  {
    id: 'nz',
    labelKey: 'spec.nz',
    country: 'NZ',
    culture: 'culture/nz.md',
    templates: ['anz-tech'],
    paper: 'A4',
    maxPages: 2, // "keep your CV to 2 pages if you can"
    photo: 'no', // "don't use images"
    fileName: 'given-family-CV', // "sam-henderson-CV.pdf"
  },
  {
    id: 'cn',
    labelKey: 'spec.cn',
    country: 'CN',
    culture: 'culture/cn.md',
    templates: ['cn-classic', 'cn-modern'],
    paper: 'A4',
    maxPages: 1, // 「一般情况下简历都是一页A4纸」
    photo: 'required', // 与澳新的正面冲突项:中国要证件照(见 cn.md「正面冲突项」)
    fileName: null,
  },
];

export const DEFAULT_SPEC = 'cn';

export const specById = (id) => APPLY_SPECS.find((s) => s.id === id) || null;

/** 归一:认不出的 id 一律回落默认规格(同 resolveTemplate 的做法)。 */
export const resolveSpec = (id) => (specById(id) ? id : DEFAULT_SPEC);

/**
 * 这个规格下该用哪套版式:给定的还合规就留着,否则回落到该规格的第一套。
 * 换规格时版式跟着换 —— 拿中文模板去投澳洲是**文化不合规**,不是个人偏好。
 */
export const templateForSpec = (specId, wanted) => {
  const spec = specById(resolveSpec(specId));
  return spec.templates.includes(wanted) ? wanted : spec.templates[0];
};

/**
 * PDF 文件名。规格写明了命名惯例就照它(nz 官方点名 `名-姓-CV.pdf`),
 * 否则用「姓名-日期」。**这是规格真的在起作用的地方之一** ——
 * 它不摆在界面上,但确实按当地规矩办事。
 */
export const pdfFileNameFor = ({ specId, nameParts, fallbackName, date }) => {
  const spec = specById(resolveSpec(specId));
  const clean = (s) =>
    String(s || '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '');
  if (spec.fileName === 'given-family-CV' && nameParts && (nameParts.given || nameParts.family)) {
    const parts = [nameParts.given, nameParts.family].map(clean).filter(Boolean);
    return `${parts.join('-').toLowerCase()}-CV.pdf`;
  }
  const base = clean(fallbackName) || 'resume';
  return `${base}-${date}.pdf`;
};
