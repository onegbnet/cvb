// JSON Resume → LER-RS(Learning and Employment Record Resume Standard,HR Open Standards)。
//
// **只导「直接映射」那一档**(2026-08-19 用户裁定:能直接映射的先导,其余先落文档、
// 讨论定案后再实现)。74 个字段里 31 个有语义相同的槽,那 31 个走这里;
// 13 个「需要重塑」(散文拆数组、字符串包对象)与 30 个「没有结构位」(作品集/发表/荣誉/
// 推荐人/兴趣——LER-RS 里根本没有对应的节)一概**不产出**,而是由 `collectOmitted()`
// 如实报出来给界面显示。**宁可少导,也不悄悄改形状**。
//
// 三条照包实测、别照印象改的事实:
//
// ① **`type` 是个只有一个值的 enum,那个 URL 里写的是 `4.4`** —— 尽管这份 schema 来自
//    4.5 Final Release 包(`LER-RSType.json` 自报 `"version": "4.4"`)。写 4.5 过不了校验。
// ② **日期正好对上**:LER-RS 的 `FormattedDateTimeType` 是
//    `anyOf [DateType, DateTimeType, YearType, YearMonthType]` —— 和 cvb 的三档精度
//    (`YYYY` / `YYYY-MM` / `YYYY-MM-DD`)一致,不补零、不降精度,原样过。
// ③ **不产出 `verifications`**:那一档是 W3C 可验证凭证 + 签名,而 cvb 里全是求职者自陈的
//    事实,没有签发人。标准明说自陈也算(“recognizes all forms of job seeker qualifications,
//    both in verifiable formats and self-asserted formats”),所以如实标成自陈,不装作被验证过。
//
// 许可(HR Open Standards,免版税、允许衍生作品,但有两条硬要求):
//   Copyright (The HR Open Standards Consortium. All Rights Reserved. http://www.hropenstandards.org
//   This product implements and complies with the Version 4.5 Specifications as published by
//   the HR Open Standards Consortium at http://www.hropenstandards.org

/** 必填 `type` 的**唯一**合法值。见文件头 ①,别"顺手"改成 4.5。 */
import { splitName } from './name-parts.mjs';

export const LERRS_TYPE_URL =
  'http://schema.hropenstandards.org/4.4/recruiting/json/ler-rs/LER-RSType.json';

export const LERRS_NOTICE =
  'This product implements and complies with the Version 4.5 Specifications as published by ' +
  'the HR Open Standards Consortium at http://www.hropenstandards.org';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const has = (v) => str(v).length > 0;
const list = (v) => (Array.isArray(v) ? v : []);

/** 只在有内容时挂键 —— LER-RS 里空串同样是脏数据。 */
const put = (obj, key, value) => {
  if (value === undefined || value === null) return obj;
  if (typeof value === 'string' && !value.trim()) return obj;
  if (Array.isArray(value) && !value.length) return obj;
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return obj;
  obj[key] = typeof value === 'string' ? value.trim() : value;
  return obj;
};

const prune = (obj) => (Object.keys(obj).length ? obj : undefined);

/**
 * 机构:只带名字与网址(那是我们唯一有的两样)。
 * `nameKey` —— `OrganizationType` 同时允许 `name` 与 `tradeName`,
 * 官方样例里雇主用 `tradeName`、院校用 `name`,照着来。
 */
const organization = (name, url, nameKey = 'tradeName') => {
  const org = {};
  put(org, nameKey, name);
  if (has(url)) put(org, 'communication', { web: [{ url: str(url) }] });
  return prune(org);
};

/** 一段经历(work / volunteer 同构)。`relationship` 走 ResourceRelationshipCodeList。 */
const history = (entry, orgName, relationship) => {
  const row = {};
  put(row, 'organization', organization(orgName, entry.url));

  const position = {};
  put(position, 'title', entry.position);
  put(position, 'resourceRelationshipCode', relationship);
  put(row, 'positionHistories', prune(position) ? [position] : []);

  put(row, 'start', entry.startDate);
  put(row, 'end', entry.endDate);
  // 「至今」在 LER-RS 里有正式表达 —— 别只是把 end 留空
  if (has(entry.startDate) && !has(entry.endDate)) row.current = true;
  return prune(row);
};

/**
 * 把一份 JSON Resume 转成 LER-RS 文档(**只含直接映射的字段**)。
 * @param {object} resume 归一化后的简历
 * @returns {object} LER-RS 实例
 */
export function toLerRs(resume) {
  const r = resume || {};
  const basics = r.basics || {};
  const loc = basics.location || {};
  const doc = { type: LERRS_TYPE_URL };

  // ---- person ----
  // `basics.name` 的存储次序规定为「名 中间名 姓」(见 app/lib/name-parts.mjs),
  // 末段就是姓 —— 而 LER-RS 的 `PersonNameType` 正好有 given / middle / family,直接对上。
  // `formattedName` 也照给,那是"拼好的那一行",两者不冲突。
  const parts = splitName(basics.name);
  const person = {};
  const nm = {};
  put(nm, 'formattedName', basics.name);
  put(nm, 'given', parts.given);
  put(nm, 'middle', parts.middle);
  put(nm, 'family', parts.family);
  put(person, 'name', prune(nm));
  put(doc, 'person', prune(person));

  // ---- communication ----
  const communication = {};
  const address = {};
  put(address, 'line', loc.address);
  put(address, 'postalCode', loc.postalCode);
  put(address, 'city', loc.city);
  put(address, 'countryCode', loc.countryCode);
  put(communication, 'address', prune(address) ? [address] : []);
  if (has(basics.phone)) communication.phone = [{ formattedNumber: str(basics.phone) }];
  if (has(basics.email)) communication.email = [{ address: str(basics.email) }];
  // 个人主页与社交账号分开放:`web` 是主页,`social` 是 profiles(那边有专门的 handle)
  if (has(basics.url)) communication.web = [{ name: 'Homepage', url: str(basics.url) }];
  const social = list(basics.profiles)
    .map((p) => {
      const row = {};
      put(row, 'name', p.network);
      put(row, 'handle', p.username);
      put(row, 'url', p.url);
      return prune(row);
    })
    .filter(Boolean);
  put(communication, 'social', social);
  put(doc, 'communication', prune(communication));

  // ---- 经历:work 与 volunteer 同一个节,靠 resourceRelationshipCode 区分 ----
  const employment = [
    ...list(r.work).map((w) => history(w, w.name, 'Employee')),
    ...list(r.volunteer).map((v) => history(v, v.organization, 'Volunteer')),
  ].filter(Boolean);
  put(doc, 'employmentHistories', employment);

  // ---- 教育 ----
  const education = list(r.education)
    .map((e) => {
      const row = {};
      put(row, 'institution', organization(e.institution, e.url, 'name'));
      if (has(e.studyType)) row.educationDegrees = [{ name: str(e.studyType) }];
      put(row, 'start', e.startDate);
      put(row, 'end', e.endDate);
      put(row, 'programs', list(e.courses).map(str).filter(Boolean));
      return prune(row);
    })
    .filter(Boolean);
  put(doc, 'educationAndLearnings', education);

  // ---- 证书 ----
  const certifications = list(r.certificates)
    .map((c) => {
      const row = {};
      put(row, 'name', c.name);
      put(row, 'firstIssued', c.date);
      put(row, 'issuingAuthority', organization(c.issuer, '', 'name'));
      return prune(row);
    })
    .filter(Boolean);
  put(doc, 'certifications', certifications);

  // ---- 技能:只有名字。level 是熟练度,LER-RS 的 SkillType 没有这个槽(它只有
  //      interestLevel 兴趣程度与 yearsOfExperience);keywords 那边是 {name,value} 对,要重塑 ----
  const skills = list(r.skills)
    .map((s) => (has(s.name) ? { name: str(s.name) } : null))
    .filter(Boolean);
  put(doc, 'skills', skills);

  return doc;
}

/**
 * 这一份简历里,**有数据却没能导出去**的部分。
 *
 * 只报真的有内容的那些 —— 没填过 projects 还提示"作品集会丢"是噪音。
 * 界面拿它在导出前如实说一句,别让人以为导出的是全部。
 * @returns {{key: string, reason: 'reshape'|'noslot'}[]}
 */
export function collectOmitted(resume) {
  const r = resume || {};
  const basics = r.basics || {};
  const loc = basics.location || {};
  const out = [];
  const add = (key, reason) => out.push({ key, reason });
  const anyField = (arr, field) => list(arr).some((x) => has(x && x[field]));
  const anyList = (arr, field) => list(arr).some((x) => list(x && x[field]).length);

  if (has(basics.label)) add('basics.label', 'noslot');
  if (has(basics.image)) add('basics.image', 'noslot');
  if (has(basics.summary)) add('basics.summary', 'reshape');
  if (has(loc.region)) add('basics.location.region', 'reshape');

  if (anyField(r.work, 'location')) add('work.location', 'reshape');
  if (anyField(r.work, 'description')) add('work.description', 'reshape');
  if (anyField(r.work, 'summary')) add('work.summary', 'reshape');
  if (anyList(r.work, 'highlights')) add('work.highlights', 'reshape');
  if (anyField(r.volunteer, 'summary')) add('volunteer.summary', 'reshape');
  if (anyList(r.volunteer, 'highlights')) add('volunteer.highlights', 'reshape');
  if (anyField(r.education, 'area')) add('education.area', 'reshape');
  // score **有**位置(`educationDegrees[].score.scoresText[].value`),只是要包两层 ——
  // 我最初在对照表里判成「无位」,查 ScoreType 之后订正。这一轮不实现重塑档,所以照样报出来。
  if (anyField(r.education, 'score')) add('education.score', 'reshape');
  if (anyField(r.certificates, 'url')) add('certificates.url', 'reshape');
  if (anyField(r.skills, 'level')) add('skills.level', 'noslot');
  if (anyList(r.skills, 'keywords')) add('skills.keywords', 'reshape');

  // 整节没有落点的:LER-RS 是一份「招聘记录」,不是完整简历
  for (const key of ['awards', 'publications', 'projects', 'interests', 'references', 'languages']) {
    if (list(r[key]).length) add(key, 'noslot');
  }
  return out;
}
