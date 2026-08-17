// 简历数据层 —— **纯 JSON Resume 标准**(jsonresume.org),没有任何自定义扩展。
//
// 规矩:标准分节里只放标准字段;我们自己的东西一件也不加(连 meta 下的扩展位都不用)。
//   · `projects[].type = 'portfolio'` 标记作品集 —— 字段是标准的,值是我们的约定
//   · 日期三档精度:YYYY / YYYY-MM / YYYY-MM-DD(标准的 iso8601 就是这三档)
//   · 发出去之前过 stampMeta():盖 $schema/version/lastModified + 剔空值
// JSON Resume 标准对象是事实源；视图模型是模板的唯一消费面。
import { fetchResume } from './api.mjs';
import { tr, getLanguage } from './i18n.mjs';

const MAX_MIX_LEVEL = 5;

const isPlainObject = (value) => {
  if (typeof value !== 'object' || value === null) return false;
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  let proto = value;
  while (Object.getPrototypeOf(proto) !== null) proto = Object.getPrototypeOf(proto);
  return Object.getPrototypeOf(value) === proto;
};

const deep = (dist, src, level = 0) => {
  for (const key of Object.keys(src)) {
    const value = src[key];
    if (!value) {
      dist[key] = value;
    } else if (isPlainObject(value)) {
      if (!isPlainObject(dist[key])) dist[key] = {};
      if (level < MAX_MIX_LEVEL) deep(dist[key], value, level + 1);
      else dist[key] = value;
    } else {
      dist[key] = value;
    }
  }
};

/** 深合并(数组整体替换)。 */
export function customAssign(rst, ...args) {
  for (const arg of args) deep(rst, arg || {});
  return rst;
}

// ---- 日期 ----
//
// **三档精度都合法**,这是 JSON Resume 标准定的(schema 的 `iso8601` 定义,原文注释
// "each section after the year is optional")。只认 YYYY-MM 会让标准允许的值存不下来。

/** 标准的 iso8601:YYYY | YYYY-MM | YYYY-MM-DD。 */
export const ISO8601_DATE = /^([1-2][0-9]{3}-[0-1][0-9]-[0-3][0-9]|[1-2][0-9]{3}-[0-1][0-9]|[1-2][0-9]{3})$/;

/** 标准口径:这个值是不是 JSON Resume 认的日期。 */
export const isValidMonth = (value) => ISO8601_DATE.test(String(value || ''));

/**
 * 界面口径:标准之外再要求月份 01–12、日 01–31。
 *
 * 标准那条正则是**松的**(`[0-1][0-9]` 连 `2019-13`、`2019-00` 都放行,日更是 `[0-3][0-9]`),
 * 照单全收等于让用户把 13 月存进去。比标准严不算偏离标准 —— 我们产出的值仍然全部合标,
 * 只是不产出那些"合标但不存在"的日期。
 */
export const isRealisticDate = (value) => {
  const v = String(value || '');
  if (!ISO8601_DATE.test(v)) return false;
  const [, mo, d] = v.split('-');
  if (mo !== undefined && (Number(mo) < 1 || Number(mo) > 12)) return false;
  if (d !== undefined && (Number(d) < 1 || Number(d) > 31)) return false;
  return true;
};

/** 按文化风格格式化;精度跟随输入(只有年就只出年,有日就带日)。 */
export const formatMonthStyle = (value, style = 'dot') => {
  const m = String(value || '').match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return '';
  const [, y, mo, d] = m;
  if (style === 'iso') return [y, mo, d].filter(Boolean).join('-');
  if (!mo) return style === 'jp' ? y + '年' : y;
  if (style === 'de') return (d ? d + '.' : '') + mo + '.' + y;
  if (style === 'jp') return y + '年' + Number(mo) + '月' + (d ? Number(d) + '日' : '');
  if (style === 'us') {
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const name = names[Number(mo) - 1] || '';
    return d ? `${name} ${Number(d)}, ${y}` : `${name} ${y}`;
  }
  return [y, mo, d].filter(Boolean).join('.');
};

/** '2019-06' → '2019.06';'2019' 原样;'2019-06-01' → '2019.06.01';空 → ''。 */
export const formatMonth = (value) => (value ? String(value).replaceAll('-', '.') : '');

export const formatDateRange = (startDate, endDate, presentLabel = tr('preview.present')) => {
  const start = formatMonth(startDate);
  const end = formatMonth(endDate);
  if (!start && !end) return '';
  if (!start) return end;
  return end ? `${start} ~ ${end}` : `${start} ~ ${presentLabel}`;
};

const monthToNumber = (value) => {
  const m = String(value || '').match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return null;
  return Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0);
};

/** 由工作经历自动计算总年限(去重叠合并区间,四舍五入到整年)。 */
export function computeTotalYears(work = [], nowMonth) {
  const now =
    monthToNumber(nowMonth) ??
    new Date().getFullYear() * 12 + new Date().getMonth();
  const ranges = work
    .map((w) => {
      const start = monthToNumber(w.startDate);
      if (start === null) return null;
      const end = monthToNumber(w.endDate) ?? now;
      return end >= start ? [start, end] : null;
    })
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
  let months = 0;
  let curStart = null;
  let curEnd = null;
  for (const [s, e] of ranges) {
    if (curStart === null) {
      [curStart, curEnd] = [s, e];
    } else if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      months += curEnd - curStart;
      [curStart, curEnd] = [s, e];
    }
  }
  if (curStart !== null) months += curEnd - curStart;
  return months > 0 ? Math.round(months / 12) : 0;
}

// ---- v2 骨架 ----

export const EMPTY_RESUME = () => ({
  basics: {
    name: '',
    label: '',
    image: '',
    email: '',
    phone: '',
    url: '',
    summary: '',
    // JSON Resume 的完整地址结构(此前骨架里只有 city,别的字段存不住)
    location: { address: '', postalCode: '', city: '', countryCode: '', region: '' },
    profiles: [],
  },
  work: [],
  education: [],
  projects: [],
  skills: [],
  certificates: [],
  awards: [],
  languages: [],
  interests: [],
  volunteer: [],
  publications: [],
  references: [],
  // meta 只有标准的三个字段。**没有 cvb 扩展**(2026-08-15 整包移除):
  // 模板/主题/头像设置/期望工作地/分节标题/多语言覆盖都属于「生成简历」侧,
  // 不是求职者的事实,不该混在真相源里。需要时逐项加回。
  meta: {
    canonical: '', // 这份简历最新版的 URL
    version: '', // semver,如 v1.0.0
    lastModified: '', // ISO 8601:YYYY-MM-DDThh:mm:ss
  },
});

/** 我们产出的简历遵循的 JSON Resume 版本(写进 meta.version,并作为 $schema 的依据)。 */
export const JSON_RESUME_VERSION = 'v1.0.0';
export const JSON_RESUME_SCHEMA_URL =
  'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json';

/**
 * 剔除空值(空串 / 空数组 / 剔完变空的对象);**布尔与数字一律保留**
 *(false 与 0 是有意义的值,不能当空处理)。
 *
 * 为什么必须做:标准给 email / url / canonical 标了 `format`,而**空串过不了 format 校验**
 * —— 官方 resume-cli 就是用 ajv 校验的。骨架里那些占位的 `''` 一旦原样导出,
 * 别的 JSON Resume 工具会直接判整份不合法。2026-08-15 用官方 schema 实测撞到。
 */
export function pruneEmpty(value) {
  if (Array.isArray(value)) {
    const arr = value.map(pruneEmpty).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const pruned = pruneEmpty(v);
      if (pruned !== undefined) out[k] = pruned;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  return value === null || value === undefined ? undefined : value;
}

/**
 * 盖上标准 meta:lastModified(ISO 8601,秒级)、version、$schema,并剔除空值。
 * 保存前调一次 —— 这三样标准要求有,但不该让用户手填。
 */
export function stampMeta(config, now = new Date()) {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, '');
  const clean = pruneEmpty(config) || {};
  return {
    $schema: JSON_RESUME_SCHEMA_URL,
    ...clean,
    meta: {
      // 用剔空后的 meta:骨架里的 canonical:'' 会被 format=uri 判非法
      ...(clean.meta || {}),
      version: (clean.meta && clean.meta.version) || JSON_RESUME_VERSION,
      lastModified: iso,
    },
  };
}

const STANDARD_LIST_FIELDS = {
  work: ['name', 'location', 'description', 'position', 'url', 'startDate', 'endDate', 'summary', 'highlights'],
  volunteer: ['organization', 'position', 'url', 'startDate', 'endDate', 'summary', 'highlights'],
  education: ['institution', 'url', 'area', 'studyType', 'startDate', 'endDate', 'score', 'courses'],
  awards: ['title', 'date', 'awarder', 'summary'],
  certificates: ['name', 'date', 'url', 'issuer'],
  publications: ['name', 'publisher', 'releaseDate', 'url', 'summary'],
  skills: ['name', 'level', 'keywords'],
  languages: ['language', 'fluency'],
  interests: ['name', 'keywords'],
  references: ['name', 'reference'],
  projects: ['name', 'description', 'highlights', 'keywords', 'startDate', 'endDate', 'url', 'roles', 'entity', 'type'],
};

const pickFields = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => fields.includes(key)));
};

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
const isValidPhone = (value) => /^\+?\d[\d\s-]{4,19}$/.test(String(value));
const isValidUrl = (value) => {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const DATE_FIELDS = new Set(['startDate', 'endDate', 'date', 'releaseDate']);
const FORMAT_VALIDATORS = {
  email: isValidEmail,
  phone: isValidPhone,
  url: isValidUrl,
  image: isValidUrl,
};

const sanitizeFormattedFields = (value, fields) => {
  const clean = { ...value };
  for (const field of fields) {
    if (clean[field] === undefined || clean[field] === '') continue;
    if (DATE_FIELDS.has(field) && !isRealisticDate(clean[field])) delete clean[field];
    if (FORMAT_VALIDATORS[field] && !FORMAT_VALIDATORS[field](clean[field])) delete clean[field];
  }
  return clean;
};

/**
 * 只保留 JSON Resume 标准字段。
 * Schema 本身允许 additionalProperties,但 cvb 的事实源不允许自定义扩展；
 * 这样旧数据(如 work[].department)在加载、导入和保存前都会被清掉。
 */
export function sanitizeResume(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  const basics = sanitizeFormattedFields(
    pickFields(config.basics, ['name', 'label', 'image', 'email', 'phone', 'url', 'summary', 'location', 'profiles']),
    ['image', 'email', 'phone', 'url']
  );
  if (config.basics?.location) {
    basics.location = pickFields(config.basics.location, ['address', 'postalCode', 'city', 'countryCode', 'region']);
  }
  if (Array.isArray(config.basics?.profiles)) {
    basics.profiles = config.basics.profiles.map((item) =>
      sanitizeFormattedFields(pickFields(item, ['network', 'username', 'url']), ['url'])
    );
  }

  const clean = { basics };
  for (const [section, fields] of Object.entries(STANDARD_LIST_FIELDS)) {
    clean[section] = Array.isArray(config[section])
      ? config[section].map((item) => sanitizeFormattedFields(pickFields(item, fields), fields))
      : config[section];
  }
  clean.meta = pickFields(config.meta, ['canonical', 'version', 'lastModified']);
  if (typeof config.$schema === 'string') clean.$schema = config.$schema;
  return clean;
}

/** 归一:补全骨架、严格清理非标准字段、旧数据自动升级。 */
export function normalizeResume(config) {
  const base = EMPTY_RESUME();
  const merged = customAssign(base, sanitizeResume(config || {}));

  for (const key of Object.keys(STANDARD_LIST_FIELDS)) {
    if (!Array.isArray(merged[key])) merged[key] = [];
  }
  if (!Array.isArray(merged.basics.profiles)) merged.basics.profiles = [];
  return merged;
}

// ---- 配置加载 ----

let defaultResumePromise = null;

export function loadDefaultResumeConfig() {
  if (!defaultResumePromise) {
    defaultResumePromise = fetch('/static/resume.json').then((res) => {
      if (!res.ok) throw new Error(`Failed to load default resume: ${res.status}`);
      return res.json();
    });
  }
  return defaultResumePromise;
}

export async function loadPersistedResumeConfig() {
  const config = (await fetchResume()) || (await loadDefaultResumeConfig());
  return normalizeResume(config);
}

// ---- 视图模型(模板唯一消费面) ----

export function getDefaultSectionTitles() {
  return {
    summary: tr('resume.summary'),
    education: tr('resume.education'),
    work: tr('resume.work'),
    projects: tr('resume.projects'),
    skills: tr('resume.skills'),
    certificates: tr('resume.certificates'),
    awards: tr('resume.awards'),
    languages: tr('resume.languages'),
    portfolio: tr('resume.portfolio'),
    interests: tr('resume.interests'),
    volunteer: tr('resume.volunteer'),
    publications: tr('resume.publications'),
    references: tr('resume.references'),
  };
}

export function getResumeViewModel(config) {
  const r = normalizeResume(config);
  const presentLabel = tr('preview.present');
  const range = (item) => formatDateRange(item.startDate, item.endDate, presentLabel);

  const workProjects = r.projects.filter((p) => p.type !== 'portfolio');
  const portfolio = r.projects.filter((p) => p.type === 'portfolio');
  const totalYears = computeTotalYears(r.work);
  const github = (r.basics.profiles.find((x) => /github/i.test(x.network || '')) || {}).url || '';
  const otherProfiles = r.basics.profiles.filter((x) => !/github/i.test(x.network || ''));

  return {
    name: r.basics.name,
    label: r.basics.label,
    // 头像只剩标准的 basics.image;形状/隐藏那两个呈现开关随 meta.cvb 一起去掉了
    avatar: { src: r.basics.image },
    phone: r.basics.phone,
    email: r.basics.email,
    url: r.basics.url,
    city: (r.basics.location && r.basics.location.city) || '',
    region: (r.basics.location && r.basics.location.region) || '',
    countryCode: (r.basics.location && r.basics.location.countryCode) || '',
    github,
    profiles: otherProfiles,
    summaryLines: String(r.basics.summary || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    totalYears,
    experienceLabel: totalYears > 0 ? `${totalYears}${tr('preview.yearsSuffix')}` : '',
    // 分节标题只有本语言的默认值(自定义标题属于生成侧,已移除)
    sectionTitles: getDefaultSectionTitles(),
    presentLabel,

    education: r.education.map((e) => ({
      startDate: e.startDate || '',
      endDate: e.endDate || '',
      institution: e.institution,
      area: e.area,
      studyType: e.studyType,
      score: e.score || '',
      courses: e.courses || [],
      url: e.url || '',
      dateLabel: range(e),
    })),
    work: r.work.map((w) => ({
      startDate: w.startDate || '',
      endDate: w.endDate || '',
      name: w.name,
      // description 是标准字段:这家公司是干什么的(标准举例 "Social Media Company")。
      // 此前这里是非标准的 department —— 2026-08-15 按"与标准严格对齐"去掉了。
      description: w.description || '',
      position: w.position || '',
      // location:澳新/北美版式把工作地点排在右侧,anz-tech 一直在读它 ——
      // 这里不给,那一栏就永远是空的(不报错,只是静默少一项)。
      location: w.location || '',
      summary: w.summary || '',
      // highlights 是 JSON Resume 的标准字段(与 projects 同构)。此前 work 只有 summary,
      // 模板靠 splitLines(summary) 把它当 bullet 用 —— 能出活,但导出的 JSON 给别的
      // JSON Resume 工具吃时,一堆要点会被当成一段概述。故补回标准字段:
      // summary = 概述段,highlights = 要点。老数据的多行 summary 仍按行渲染,不受影响。
      highlights: w.highlights || [],
      url: w.url || '',
      dateLabel: range(w),
    })),
    projects: workProjects.map((p) => ({
      keywords: p.keywords || [],
      keywordsLabel: (p.keywords || []).join(' / '),
      startDate: p.startDate || '',
      endDate: p.endDate || '',
      name: p.name,
      entity: p.entity || '',
      type: p.type || '',
      rolesLabel: (p.roles || []).join(' / '),
      description: p.description || '',
      highlights: p.highlights || [],
      url: p.url || '',
      dateLabel: range(p),
    })),
    portfolio: portfolio.map((p) => ({
      name: p.name,
      url: p.url || '',
      description: p.description || '',
      keywords: p.keywords || [],
      highlights: p.highlights || [],
      roles: p.roles || [],
      rolesLabel: (p.roles || []).join(' / '),
      entity: p.entity || '',
      startDate: p.startDate || '',
      endDate: p.endDate || '',
      dateLabel: range(p),
    })),
    skills: r.skills.map((s) => ({
      name: s.name,
      level: s.level || '',
      keywords: s.keywords || [],
      keywordsLabel: (s.keywords || []).join(' / '),
    })),
    certificates: r.certificates.map((c) => ({
      name: c.name,
      issuer: c.issuer || '',
      url: c.url || '',
      dateLabel: formatMonth(c.date),
    })),
    awards: r.awards.map((a) => ({
      title: a.title,
      awarder: a.awarder || '',
      summary: a.summary || '',
      dateLabel: formatMonth(a.date),
    })),
    languages: r.languages.map((l) => ({ language: l.language, fluency: l.fluency || '' })),
    interests: r.interests.map((i) => ({
      name: i.name,
      keywordsLabel: (i.keywords || []).join(' / '),
    })),
    volunteer: r.volunteer.map((v) => ({
      startDate: v.startDate || '',
      endDate: v.endDate || '',
      organization: v.organization,
      position: v.position || '',
      summary: v.summary || '',
      highlights: v.highlights || [],
      url: v.url || '',
      dateLabel: range(v),
    })),
    publications: r.publications.map((p) => ({
      releaseDate: p.releaseDate || '',
      name: p.name,
      publisher: p.publisher || '',
      url: p.url || '',
      summary: p.summary || '',
      dateLabel: formatMonth(p.releaseDate),
    })),
    references: r.references.map((x) => ({ name: x.name, reference: x.reference || '' })),
  };
}

// ---- 杂项 ----

export function resolveAssetUrl(src) {
  if (!src) return '';
  if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) {
    return src;
  }
  return src.replace(/^\//, '');
}

export function exportDataToLocal(data, fileName) {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  const a = document.createElement('a');
  a.download = fileName;
  a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  a.click();
}

/** 编辑器读取当前语言(worker 注入 <html lang>)。 */
export { getLanguage };
