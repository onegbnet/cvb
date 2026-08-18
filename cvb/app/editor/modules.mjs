// 编辑器模块描述符 — 每个导航模块声明:数据存取(get/set 对接 JSON Resume
// 结构)、字段定义(类型/校验/必填)、列表摘要字段。
// 字段类型:input | textArea | month | checkbox | select | tags(数组↔逗号分隔)
//          | lines(数组↔换行分隔)
// 校验(validate):email | phone | url(打字时经 ccs Field,提交时兜底)
import { tr } from '../lib/i18n.mjs';

const input = (attributeId, labelKey, opts = {}) => ({ type: 'input', attributeId, labelKey, ...opts });
const month = (attributeId, labelKey, opts = {}) => ({ type: 'month', attributeId, labelKey, ...opts });

/**
 * 版块(左侧一级导航)→ 页内 Group 的归属与顺序。**这就是那张表**:
 * 挪某个 Group 到别的版块、或调页内顺序,只改这里。
 */
export const SECTIONS = [
  { id: 'personal', labelKey: 'section.personal', groups: ['basics', 'summary', 'location', 'profiles', 'languages'] },
  { id: 'education', labelKey: 'section.education', groups: ['education', 'certificates', 'awards'] },
  { id: 'career', labelKey: 'section.career', groups: ['work', 'projects', 'skills', 'publications'] },
  { id: 'extra', labelKey: 'section.extra', groups: ['volunteer', 'interests', 'references'] },
];

/** 某版块下的 Group(按表里的顺序)。 */
export const sectionModules = (sectionId) => {
  const section = SECTIONS.find((s) => s.id === sectionId);
  if (!section) return [];
  return section.groups.map((key) => MODULES.find((m) => m.key === key)).filter(Boolean);
};

export const MODULES = [
  {
    key: 'basics',
    labelKey: 'nav.basics',
    icon: '📋',
    kind: 'object',
    get: (r) => ({
      name: r.basics.name,
      label: r.basics.label,
      phone: r.basics.phone,
      email: r.basics.email,
      url: r.basics.url,
      image: r.basics.image,
    }),
    set: (r, v) => {
      return {
        ...r,
        basics: {
          ...r.basics,
          name: v.name ?? '',
          label: v.label ?? '',
          phone: v.phone ?? '',
          email: v.email ?? '',
          url: v.url ?? '',
          image: v.image ?? '',
        },
      };
    },
    fields: [
      input('name', 'field.basics.name'),
      { type: 'avatar', attributeId: 'image', labelKey: 'field.basics.image', uploadOnly: true },
      input('phone', 'field.basics.phone', { validate: 'phone' }),
      input('email', 'field.basics.email', { validate: 'email' }),
      input('url', 'field.basics.url', { validate: 'url' }),
    ],
  },

  // 在线主页(JSON Resume 的 basics.profiles)。此前只有基本信息里那一个写死的
  // 「GitHub」输入框 —— 想放 LinkedIn / 个人博客 / 知乎无处可填,而数据模型本来就是数组。
  // 模板里的 GitHub 仍按 network 名从这份列表里挑,所以搬家不影响已有输出。
  {
    key: 'profiles',
    labelKey: 'nav.profiles',
    icon: '🔗',
    kind: 'list',
    summaryField: 'network',
    get: (r) => r.basics.profiles,
    set: (r, items) => ({ ...r, basics: { ...r.basics, profiles: items } }),
    fields: [
      input('network', 'field.profile.network', {
        placeholderKey: 'field.profile.network.hint',
      }),
      input('username', 'field.profile.username'),
      input('url', 'field.profile.url', { validate: 'url' }),
    ],
  },

  {
    key: 'summary', labelKey: 'nav.summary', icon: '📝', kind: 'object',
    get: (r) => ({ label: r.basics.label, summary: r.basics.summary }),
    set: (r, v) => ({ ...r, basics: { ...r.basics, label: v.label ?? '', summary: v.summary ?? '' } }),
    fields: [input('label', 'field.basics.label'), { type: 'textArea', attributeId: 'summary', labelKey: 'field.summary.text', rows: 8, ai: true }],
  },
  {
    key: 'location', labelKey: 'nav.location', icon: '📍', kind: 'object',
    get: (r) => ({ ...(r.basics.location || {}) }),
    set: (r, v) => ({ ...r, basics: { ...r.basics, location: { ...r.basics.location, ...v } } }),
    fields: [
      { type: 'select', attributeId: 'countryCode', labelKey: 'field.basics.countryCode', options: ['CN', 'AU', 'JP', 'US', 'GB', 'CA', 'DE', 'FR', 'IN', 'SG'].map((value) => ({ value, label: value })) },
      input('region', 'field.basics.region', { placeholderKey: 'field.basics.region.hint' }),
      input('city', 'field.basics.city'), input('address', 'field.basics.address'), input('postalCode', 'field.basics.postalCode'),
    ],
  },

  {
    key: 'education',
    labelKey: 'nav.education',
    icon: '🎓',
    kind: 'list',
    summaryField: 'institution',
    get: (r) => r.education,
    set: (r, items) => ({ ...r, education: items }),
    fields: [
      input('institution', 'field.education.institution'),
      input('area', 'field.education.area'),
      input('studyType', 'field.education.studyType'),
      month('startDate', 'field.education.startDate'),
      month('endDate', 'field.education.endDate'),
      input('score', 'field.education.score'),
      { type: 'lines', attributeId: 'courses', labelKey: 'field.education.courses', rows: 4 },
      input('url', 'field.education.url', { validate: 'url' }),
    ],
  },

  {
    key: 'work',
    labelKey: 'nav.work',
    icon: '💼',
    kind: 'list',
    summaryField: 'name',
    get: (r) => r.work,
    set: (r, items) => ({ ...r, work: items }),
    fields: [
      input('name', 'field.work.name'),
      // description = 这家公司是干什么的(标准举例 "Social Media Company")。
      // 原来这里是非标准的 department(部门),按"与标准严格对齐"已去掉。
      input('description', 'field.work.description', { placeholderKey: 'field.work.description.hint' }),
      input('position', 'field.work.position'),
      // 工作地点:澳新/北美版式排在右侧。模板早就在读,只是一直没人能填。
      input('location', 'field.work.location', { placeholderKey: 'field.work.location.hint' }),
      month('startDate', 'field.work.startDate'),
      month('endDate', 'field.work.endDate', { presentKey: 'field.work.current' }),
      { type: 'textArea', attributeId: 'summary', labelKey: 'field.work.summary', rows: 3, ai: true },
      // 要点(JSON Resume 标准字段,与项目经历同构):一行一条。
      { type: 'lines', attributeId: 'highlights', labelKey: 'field.work.highlights', rows: 6, ai: true },
      input('url', 'field.work.url', { validate: 'url' }),
    ],
  },

  {
    key: 'projects',
    labelKey: 'nav.projects',
    icon: '📊',
    kind: 'list',
    summaryField: 'name',
    get: (r) => r.projects,
    set: (r, items) => ({ ...r, projects: items }),
    fields: (r) => [
      input('name', 'field.project.name'),
      {
        type: 'select',
        attributeId: 'entity',
        labelKey: 'field.project.entity',
        options: [
          { value: '', labelKey: 'field.project.entity.none' },
          ...r.work
            .map((w) => w.name)
            .filter(Boolean)
            .map((name) => ({ value: name, label: name })),
        ],
      },
      { type: 'tags', attributeId: 'roles', labelKey: 'field.project.roles' },
      month('startDate', 'field.project.startDate'),
      month('endDate', 'field.project.endDate', { presentKey: 'field.project.ongoing' }),
      { type: 'textArea', attributeId: 'description', labelKey: 'field.project.description', rows: 3, ai: true },
      { type: 'lines', attributeId: 'highlights', labelKey: 'field.project.highlights', rows: 6, ai: true },
      { type: 'tags', attributeId: 'keywords', labelKey: 'field.project.keywords' },
      input('url', 'field.project.url', { validate: 'url' }),
      // type 是标准字段(自由文本,标准举例 volunteering / presentation / application)。
      // 我们此前把它写死成「作品集」开关、用户填不了 —— 现在放开。
      // 填成 portfolio 的条目会归到「作品集」模块,那只是同一份 projects[] 的另一个视图。
      input('type', 'field.project.type', { placeholderKey: 'field.project.type.hint' }),
    ],
  },

  {
    key: 'skills',
    labelKey: 'nav.skills',
    icon: '🛠️',
    kind: 'list',
    summaryField: 'name',
    get: (r) => r.skills,
    set: (r, items) => ({ ...r, skills: items }),
    fields: [
      input('name', 'field.skill.name'),
      input('level', 'field.skill.level', { placeholderKey: 'field.skill.level.hint' }),
      {
        type: 'tags',
        attributeId: 'keywords',
        labelKey: 'field.skill.keywords',
        placeholderKey: 'field.skill.keywords.hint',
        rows: 3,
      },
    ],
  },

  {
    key: 'certificates',
    labelKey: 'nav.certificates',
    icon: '📜',
    kind: 'list',
    summaryField: 'name',
    get: (r) => r.certificates,
    set: (r, items) => ({ ...r, certificates: items }),
    fields: [
      input('name', 'field.certificate.name'),
      input('issuer', 'field.certificate.issuer'),
      month('date', 'field.certificate.date'),
      input('url', 'field.certificate.url', { validate: 'url' }),
    ],
  },

  {
    key: 'awards',
    labelKey: 'nav.awards',
    icon: '🏆',
    kind: 'list',
    summaryField: 'title',
    get: (r) => r.awards,
    set: (r, items) => ({ ...r, awards: items }),
    fields: [
      input('title', 'field.award.title'),
      input('awarder', 'field.award.awarder'),
      month('date', 'field.award.date'),
      input('summary', 'field.award.summary'),
    ],
  },

  {
    key: 'languages',
    labelKey: 'nav.languages',
    icon: '🌐',
    kind: 'list',
    summaryField: 'language',
    get: (r) => r.languages,
    set: (r, items) => ({ ...r, languages: items }),
    fields: [
      input('language', 'field.language.language'),
      input('fluency', 'field.language.fluency'),
    ],
  },

  {
    key: 'interests',
    labelKey: 'nav.interests',
    icon: '🎯',
    kind: 'list',
    summaryField: 'name',
    get: (r) => r.interests,
    set: (r, items) => ({ ...r, interests: items }),
    fields: [
      input('name', 'field.interest.name'),
      { type: 'tags', attributeId: 'keywords', labelKey: 'field.interest.keywords' },
    ],
  },

  {
    key: 'volunteer',
    labelKey: 'nav.volunteer',
    icon: '🤝',
    kind: 'list',
    summaryField: 'organization',
    get: (r) => r.volunteer,
    set: (r, items) => ({ ...r, volunteer: items }),
    fields: [
      input('organization', 'field.volunteer.organization'),
      input('position', 'field.volunteer.position'),
      month('startDate', 'field.volunteer.startDate'),
      month('endDate', 'field.volunteer.endDate', { presentKey: 'field.volunteer.ongoing' }),
      { type: 'textArea', attributeId: 'summary', labelKey: 'field.volunteer.summary', rows: 3 },
      { type: 'lines', attributeId: 'highlights', labelKey: 'field.volunteer.highlights', rows: 4 },
      input('url', 'field.volunteer.url', { validate: 'url' }),
    ],
  },

  {
    key: 'publications',
    labelKey: 'nav.publications',
    icon: '📚',
    kind: 'list',
    summaryField: 'name',
    get: (r) => r.publications,
    set: (r, items) => ({ ...r, publications: items }),
    fields: [
      input('name', 'field.publication.name'),
      input('publisher', 'field.publication.publisher'),
      month('releaseDate', 'field.publication.releaseDate'),
      input('url', 'field.publication.url', { validate: 'url' }),
      { type: 'textArea', attributeId: 'summary', labelKey: 'field.publication.summary', rows: 3 },
    ],
  },

  {
    key: 'references',
    labelKey: 'nav.references',
    icon: '💬',
    kind: 'list',
    summaryField: 'name',
    get: (r) => r.references,
    set: (r, items) => ({ ...r, references: items }),
    fields: [
      input('name', 'field.reference.name'),
      { type: 'textArea', attributeId: 'reference', labelKey: 'field.reference.reference', rows: 3 },
    ],
  },

];

export const getModule = (key) => MODULES.find((m) => m.key === key);

const FIELD_PATHS = {
  basics: { name: 'basics.name', label: 'basics.label', phone: 'basics.phone', email: 'basics.email', url: 'basics.url', image: 'basics.image' },
  location: { city: 'basics.location.city', region: 'basics.location.region', countryCode: 'basics.location.countryCode', postalCode: 'basics.location.postalCode', address: 'basics.location.address' },
  profiles: { network: 'basics.profiles[].network', username: 'basics.profiles[].username', url: 'basics.profiles[].url' },
  summary: { label: 'basics.label', summary: 'basics.summary' },
  work: Object.fromEntries(['name', 'location', 'description', 'position', 'url', 'startDate', 'endDate', 'summary', 'highlights']
    .map((key) => [key, `work[].${key}`])),
  volunteer: Object.fromEntries(['organization', 'position', 'url', 'startDate', 'endDate', 'summary', 'highlights']
    .map((key) => [key, `volunteer[].${key}`])),
  education: Object.fromEntries(['institution', 'url', 'area', 'studyType', 'startDate', 'endDate', 'score', 'courses']
    .map((key) => [key, `education[].${key}`])),
  awards: Object.fromEntries(['title', 'date', 'awarder', 'summary'].map((key) => [key, `awards[].${key}`])),
  certificates: Object.fromEntries(['name', 'date', 'url', 'issuer'].map((key) => [key, `certificates[].${key}`])),
  publications: Object.fromEntries(['name', 'publisher', 'releaseDate', 'url', 'summary']
    .map((key) => [key, `publications[].${key}`])),
  skills: Object.fromEntries(['name', 'level', 'keywords'].map((key) => [key, `skills[].${key}`])),
  languages: Object.fromEntries(['language', 'fluency'].map((key) => [key, `languages[].${key}`])),
  interests: Object.fromEntries(['name', 'keywords'].map((key) => [key, `interests[].${key}`])),
  references: Object.fromEntries(['name', 'reference'].map((key) => [key, `references[].${key}`])),
  projects: Object.fromEntries(['name', 'description', 'highlights', 'keywords', 'startDate', 'endDate', 'url', 'roles', 'entity', 'type']
    .map((key) => [key, `projects[].${key}`])),
};

const ARRAY_FIELDS = new Set(['highlights', 'courses', 'keywords', 'roles']);

export const getModuleFields = (module, config) => {
  const fields = typeof module.fields === 'function' ? module.fields(config) : module.fields;
  const paths = FIELD_PATHS[module.key] || {};
  return fields.map((field) => ({
    ...field,
    jsonPath: paths[field.attributeId] + (ARRAY_FIELDS.has(field.attributeId) ? '[]' : ''),
  }));
};

/**
 * 该模块里"必填还空着"的条目数(object 模块返回 0 或 1)。
 *
 * 为什么要这个:必填校验此前只在**提交那一刻**出现,一旦条目已经存在(比如导入进来的、
 * 或早年填了一半的),界面上再没有任何地方提示它不完整 —— 得逐个点开才发现。
 * 编辑事实这一页的职责就是"事实是否完整准确",那就得把不完整这件事显示出来。
 */
export function moduleIssues(module, config) {
  const required = getModuleFields(module, config).filter((f) => f.required);
  if (!required.length) return 0;
  const incomplete = (item) =>
    required.some((f) => {
      const v = item ? item[f.attributeId] : '';
      const s = Array.isArray(v) ? v.join('') : String(v ?? '');
      return s.trim() === '';
    });
  if (module.kind === 'list') return module.get(config).filter(incomplete).length;
  return incomplete(module.get(config)) ? 1 : 0;
}

/** 模块显示名。自定义分节标题已随 meta.cvb 移除(那属于生成侧的文化规范)。 */
export const getModuleName = (module) => tr(module.labelKey);
