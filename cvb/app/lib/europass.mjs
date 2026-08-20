// JSON Resume → Europass CV XML(`SkillsPassport`,命名空间 `http://europass.cedefop.europa.eu/Europass`)。
//
// **为什么是这一支而不是 Europass 2**(2026-08-19 调研,存档见 Gitea `gaobo/resume-standards`):
// Europass 有两支同名不同物的 schema。新的那支(Europass 2 CV,DG EMPL,v3.0.0,2020-02)覆盖面更宽,
// **但它的 XSD 从未公开发布** —— 规范只出了 PDF,官方 interoperability 页面对未登录用户 403,
// Wayback、GitHub、代码搜索全找过,没有镜像。而**这一支的 XSD 拿得到**(Wayback 里 v1.0→v3.3.0
// 一个不缺),许可是 **EUPL v1.1**,而且官方 FAQ 说旧 Europass CV 的 XML **可以导入**今天的 Europass。
// 所以能动手的是它。**版本号会骗人**:这一支的 v3.4.0 不是那一支 v3.0.0 的后继。
//
// **「导入得进去」这一条是按官方文档采信的,我们没有实测**(用户没有可用的 Europass 账号)。
// 将来若导入失败,先回来看这一句。
//
// 照 LER-RS 那边同一条政策:**只导能直接映射的**,需要重塑或没有落点的一概不产出,
// 由 `collectOmitted()` 如实报出来,导出前先问一句。**宁可少导,也不悄悄改形状。**
//
// 两处和 LER-RS 一样的好消息:
// - **日期正好对上**:`DateType` 是 `year` 必填 + `month` / `day` 可选的**属性**,
//   和 cvb 的 `YYYY` / `YYYY-MM` / `YYYY-MM-DD` 三档一致,不补零不降精度;
// - **不需要任何签发人**:这套 schema 里没有可验证凭证那一档,自陈就是它的常态。
//
// 一处仍然是**约定**的地方:`PersonName` 有 `FirstName` / `Surname` 但**没有中间名**,
// 所以中间名并进 `FirstName`。**姓名本身已经不用猜** —— `basics.name` 的存储次序规定为
// 「名 中间名 姓」(见 app/lib/name-parts.mjs),末段就是姓。
// 存成一个没有边界的串(「山田太郎」)才是猜:姓是「山」「山田」还是「太郎」根本读不出来。
//
// 许可:Europass XSD 为 EUPL v1.1,“Copyright European Union 2002-2014”。

/** 这一支的命名空间与我们声明的 XSD 版本。**别改成 Europass 2 的 `http://www.europass.eu/1.0`** —— 那是另一支。 */
import { splitName } from './name-parts.mjs';

export const EUROPASS_NS = 'http://europass.cedefop.europa.eu/Europass';
export const EUROPASS_XSD_VERSION = 'V3.3';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const has = (v) => str(v).length > 0;
const list = (v) => (Array.isArray(v) ? v : []);

/** XML 文本转义。属性与正文共用一套 —— 少一套就少一次漏。 */
const esc = (v) =>
  String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * 极小的 XML 构造器。节点形如 `{ tag, attrs, children | text }`;
 * **空节点直接消失** —— schema 里几乎所有元素都是 minOccurs="0",空壳只会招来校验错误。
 */
const el = (tag, attrs, children) => {
  const kids = (Array.isArray(children) ? children : [children]).filter(
    (c) => c !== null && c !== undefined && c !== false && c !== ''
  );
  const hasAttrs = attrs && Object.keys(attrs).length;
  if (!kids.length && !hasAttrs) return null;
  return { tag, attrs: attrs || {}, kids };
};

/** 空了也要出现的元素(schema 里 minOccurs 不为 0 的那几个)。 */
const forceEl = (tag, children) =>
  el(tag, null, children) || { tag, attrs: {}, kids: [] };

/** 文本节点:值为空就整个元素不出现。 */
const text = (tag, value) => (has(value) ? { tag, attrs: {}, kids: [{ raw: esc(str(value)) }] } : null);

const render = (node, indent = '') => {
  if (!node) return '';
  if (node.raw !== undefined) return node.raw;
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('');
  if (!node.kids.length) return `${indent}<${node.tag}${attrs}/>`;
  if (node.kids.length === 1 && node.kids[0].raw !== undefined) {
    return `${indent}<${node.tag}${attrs}>${node.kids[0].raw}</${node.tag}>`;
  }
  const inner = node.kids.map((k) => render(k, indent + '  ')).filter(Boolean).join('\n');
  return `${indent}<${node.tag}${attrs}>\n${inner}\n${indent}</${node.tag}>`;
};

/**
 * `YYYY` / `YYYY-MM` / `YYYY-MM-DD` → `<Tag year="2020" month="--01" day="---15"/>`。
 * `month` 是 `xsd:gMonth`(`--MM`)、`day` 是 `xsd:gDay`(`---DD`)—— 这两个前缀不是笔误,是类型要求。
 */
const dateEl = (tag, value) => {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(str(value));
  if (!m) return null;
  const attrs = { year: m[1] };
  if (m[2]) attrs.month = `--${m[2]}`;
  if (m[3]) attrs.day = `---${m[3]}`;
  return { tag, attrs, kids: [] };
};

/** `LabelType` 一律是 `<Code>` + `<Label>`;我们只有人话,所以只给 Label。 */
const labelEl = (tag, value) => el(tag, null, [text('Label', value)]);

const period = (startDate, endDate) => {
  const from = dateEl('From', startDate);
  if (!from) return null;
  const to = dateEl('To', endDate);
  return el('Period', null, [from, to, !to ? text('Current', 'true') : null]);
};

const websiteList = (urls) => {
  const sites = urls.filter(has).map((u) => el('Website', null, [text('Contact', u)]));
  return sites.length ? el('WebsiteList', null, sites) : null;
};

/**
 * **机构的 ContactInfo 和人的不是同一个类型**:`OrganisationalContactInfoType` 只有
 * `Address` 与**单个** `Website`(没有 `WebsiteList`)。写错了 xmllint 会直接指出来 ——
 * 这一处就是它替我抓的。
 */
const orgContactInfo = (url) =>
  has(url) ? el('ContactInfo', null, [el('Website', null, [text('Contact', url)])]) : null;

const addressInfo = (loc) =>
  el('Contact', null, [
    text('AddressLine', loc.address),
    text('PostalCode', loc.postalCode),
    text('Municipality', loc.city),
    has(loc.countryCode) ? el('Country', null, [text('Code', String(loc.countryCode).toUpperCase())]) : null,
  ]);


export function toEuropass(resume, now = '2026-01-01T00:00:00Z') {
  const r = resume || {};
  const basics = r.basics || {};
  const loc = basics.location || {};

  // ---- 姓名:**存储次序是规定的**(名 中间名 姓),所以末段就是姓,不用猜 ----
  // Europass 的 `PersonNameType` 只有 `FirstName` / `Surname`(**没有中间名**),
  // 所以中间名并进 FirstName —— 这一条仍是约定,照旧报进 collectOmitted。
  const { given, middle, family } = splitName(basics.name);
  const first = [given, middle].filter(Boolean).join(' ');
  const surname = family;

  const identification = el('Identification', null, [
    el('PersonName', null, [text('FirstName', first), text('Surname', surname)]),
    el('ContactInfo', null, [
      el('Address', null, [addressInfo(loc)]),
      has(basics.email) ? el('Email', null, [text('Contact', basics.email)]) : null,
      has(basics.phone) ? el('TelephoneList', null, [el('Telephone', null, [text('Contact', basics.phone)])]) : null,
      websiteList([basics.url, ...list(basics.profiles).map((p) => p && p.url)]),
    ]),
  ]);

  // 身份标签 → Headline(LER-RS 里没有这个位置)
  const headline = has(basics.label)
    ? el('Headline', null, [labelEl('Description', basics.label)])
    : null;

  const work = list(r.work)
    .map((w) =>
      el('WorkExperience', null, [
        period(w.startDate, w.endDate),
        labelEl('Position', w.position),
        el('Employer', null, [text('Name', w.name), orgContactInfo(w.url)]),
      ])
    )
    .filter(Boolean);

  const education = list(r.education)
    .map((e) =>
      el('Education', null, [
        period(e.startDate, e.endDate),
        text('Title', e.studyType),
        el('Organisation', null, [text('Name', e.institution), orgContactInfo(e.url)]),
        labelEl('Field', e.area),
      ])
    )
    .filter(Boolean);

  // 语言:母语无从判断(cvb 不存"哪个是母语"),所以**全部当外语列**,只给名字不给等级 ——
  // `fluency` 是自由文本,而 Europass 要 CEFR 六项等级,硬映射就是编数据。
  // `ForeignLanguage/Description` 是 `ForeignLanguageType`(`LabelType` 的限制:Code + Label),
  // **不是纯文本** —— 直接塞字符串 xmllint 会报 "content type is 'element-only'"。
  const languages = list(r.languages)
    .map((l) => el('ForeignLanguage', null, [labelEl('Description', l.language)]))
    .filter(Boolean);
  const skills = languages.length
    ? el('Skills', null, [el('Linguistic', null, [el('ForeignLanguageList', null, languages)])])
    : null;

  // 荣誉 / 发表 / 作品集 / 兴趣 / 推荐人 → AchievementList。
  // 这不是"没地方放只好塞进去":schema 自己写着这一节是给
  // “participation to conferences, workshops, memberships to organisations, list of publications, etc.” 的。
  const achievement = (title, description) =>
    el('Achievement', null, [labelEl('Title', title), text('Description', description)]);
  const achievements = [
    ...list(r.awards).map((a) => achievement(a.title, a.awarder)),
    ...list(r.publications).map((p) => achievement(p.name, p.publisher)),
    ...list(r.projects).map((p) => achievement(p.name, p.description)),
    ...list(r.interests).map((i) => achievement(i.name, '')),
    ...list(r.references).map((x) => achievement(x.name, x.reference)),
  ].filter(Boolean);

  const doc = el('SkillsPassport', { xmlns: EUROPASS_NS, locale: 'en' }, [
    el('DocumentInfo', null, [
      text('DocumentType', 'ECV'),
      text('CreationDate', now),
      text('LastUpdateDate', now),
      text('XSDVersion', EUROPASS_XSD_VERSION),
      text('Generator', 'CV Builder'),
    ]),
    // **`LearnerInfo` 必须出现**,哪怕整份是空的 —— schema 要求 `SkillsPassport` 至少有
    // `PrintingPreferences` 或 `LearnerInfo`,而 el() 会把空节点整个丢掉。
    // 这一条也是 xmllint 替我抓的(空简历那一档)。
    forceEl('LearnerInfo', [
      identification,
      headline,
      work.length ? el('WorkExperienceList', null, work) : null,
      education.length ? el('EducationList', null, education) : null,
      skills,
      achievements.length ? el('AchievementList', null, achievements) : null,
    ]),
  ]);

  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(doc)}\n`;
}

/**
 * 有数据却没能导出去的部分。只报真的有内容的那些。
 * @returns {{key: string, reason: 'reshape'|'noslot'|'convention'}[]}
 */
export function collectOmitted(resume) {
  const r = resume || {};
  const basics = r.basics || {};
  const out = [];
  const add = (key, reason) => out.push({ key, reason });
  const anyField = (arr, field) => list(arr).some((x) => has(x && x[field]));
  const anyList = (arr, field) => list(arr).some((x) => list(x && x[field]).length);

  // 约定而非事实:Europass 没有中间名字段,中间名并进 FirstName
  if (has(splitName(basics.name).middle)) add('basics.name(中间名)', 'convention');
  if (has(basics.image)) add('basics.image', 'noslot');
  if (has(basics.summary)) add('basics.summary', 'noslot'); // Headline 是 Code+Label,装不下散文

  if (anyField(r.work, 'summary')) add('work.summary', 'reshape');
  if (anyList(r.work, 'highlights')) add('work.highlights', 'reshape');
  if (anyField(r.work, 'location')) add('work.location', 'reshape');
  if (anyField(r.work, 'description')) add('work.description', 'reshape');
  if (anyField(r.volunteer, 'organization')) add('volunteer', 'noslot'); // 这一支没有志愿经历节
  if (anyList(r.education, 'courses')) add('education.courses', 'reshape');
  if (anyField(r.education, 'score')) add('education.score', 'noslot');
  if (list(r.certificates).length) add('certificates', 'reshape');
  if (list(r.skills).length) add('skills', 'reshape'); // 只有一个 Description 文本块,装不下逐条技能
  if (anyField(r.languages, 'fluency')) add('languages.fluency', 'reshape'); // 要 CEFR 六项,自由文本硬映射就是编数据
  return out;
}
