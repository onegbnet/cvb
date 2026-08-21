// 编辑器模块描述符 — 每个导航模块声明:数据存取(get/set 对接 JSON Resume
// 结构)、字段定义(类型/校验/必填)、列表摘要字段。
// 字段类型:input | textArea | month | checkbox | select | tags(数组↔逗号分隔)
//          | lines(数组↔换行分隔)
// 校验(validate):email | phone | url(打字时经 ccs Field,提交时兜底)
import { tr, getLanguage } from '../lib/i18n.mjs';

const ISO_COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' ');
const countryDisplayNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames([getLanguage()], { type: 'region' })
  : null;
const countryName = (code) => countryDisplayNames?.of(code) || code;
const COUNTRY_CODE_OPTIONS = [...ISO_COUNTRY_CODES].sort().map((value) => ({ value, label: `${value} · ${countryName(value)}` }));

// 国际区号不是 ISO 标准的一对一映射；这里只保留常用/无歧义的国家映射。
// 同一区号对应多个地区时，名称合并展示，实际保存的仍是完整电话号码。
const CALLING_CODE_COUNTRIES = {
  '+1': ['US', 'CA'], '+7': ['RU', 'KZ'], '+20': ['EG'], '+27': ['ZA'], '+30': ['GR'],
  '+31': ['NL'], '+32': ['BE'], '+33': ['FR'], '+34': ['ES'], '+36': ['HU'], '+39': ['IT'],
  '+40': ['RO'], '+41': ['CH'], '+43': ['AT'], '+44': ['GB'], '+45': ['DK'], '+46': ['SE'],
  '+47': ['NO'], '+48': ['PL'], '+49': ['DE'], '+51': ['PE'], '+52': ['MX'], '+53': ['CU'],
  '+54': ['AR'], '+55': ['BR'], '+56': ['CL'], '+57': ['CO'], '+58': ['VE'], '+60': ['MY'],
  '+61': ['AU'], '+62': ['ID'], '+63': ['PH'], '+64': ['NZ'], '+65': ['SG'], '+66': ['TH'],
  '+81': ['JP'], '+82': ['KR'], '+84': ['VN'], '+86': ['CN'], '+90': ['TR'], '+91': ['IN'],
  '+92': ['PK'], '+93': ['AF'], '+94': ['LK'], '+95': ['MM'], '+98': ['IR'], '+211': ['SS'],
  '+212': ['MA'], '+213': ['DZ'], '+216': ['TN'], '+218': ['LY'], '+220': ['GM'], '+221': ['SN'],
  '+234': ['NG'], '+254': ['KE'], '+255': ['TZ'], '+256': ['UG'], '+351': ['PT'], '+352': ['LU'],
  '+353': ['IE'], '+354': ['IS'], '+358': ['FI'], '+359': ['BG'], '+370': ['LT'], '+371': ['LV'],
  '+372': ['EE'], '+380': ['UA'], '+381': ['RS'], '+385': ['HR'], '+386': ['SI'], '+420': ['CZ'],
  '+421': ['SK'], '+852': ['HK'], '+853': ['MO'], '+886': ['TW'], '+971': ['AE'], '+972': ['IL'],
  '+222': ['MR'], '+223': ['ML'], '+224': ['GN'], '+225': ['CI'], '+226': ['BF'],
  '+227': ['NE'], '+228': ['TG'], '+229': ['BJ'], '+230': ['MU'], '+231': ['LR'], '+232': ['SL'],
  '+233': ['GH'], '+235': ['TD'], '+236': ['CF'], '+237': ['CM'], '+238': ['CV'], '+239': ['ST'],
  '+240': ['GQ'], '+241': ['GA'], '+242': ['CG'], '+243': ['CD'], '+244': ['AO'], '+245': ['GW'],
  '+246': ['IO'], '+247': ['SH'], '+248': ['SC'], '+249': ['SD'], '+250': ['RW'], '+251': ['ET'],
  '+252': ['SO'], '+253': ['DJ'], '+257': ['BI'], '+258': ['MZ'], '+260': ['ZM'], '+261': ['MG'],
  '+262': ['RE'], '+263': ['ZW'], '+264': ['NA'], '+265': ['MW'], '+266': ['LS'], '+267': ['BW'],
  '+268': ['SZ'], '+269': ['KM'], '+290': ['SH'], '+291': ['ER'], '+297': ['AW'], '+298': ['FO'],
  '+299': ['GL'], '+350': ['GI'], '+355': ['AL'], '+356': ['MT'], '+357': ['CY'], '+373': ['MD'],
  '+374': ['AM'], '+375': ['BY'], '+376': ['AD'], '+377': ['MC'], '+378': ['SM'], '+382': ['ME'],
  '+383': ['XK'], '+387': ['BA'], '+389': ['MK'], '+423': ['LI'], '+500': ['FK'], '+501': ['BZ'],
  '+502': ['GT'], '+503': ['SV'], '+504': ['HN'], '+505': ['NI'], '+506': ['CR'], '+507': ['PA'],
  '+508': ['PM'], '+509': ['HT'], '+590': ['GP', 'BL', 'MF'], '+591': ['BO'], '+592': ['GY'],
  '+593': ['EC'], '+594': ['GF'], '+595': ['PY'], '+596': ['MQ'], '+597': ['SR'], '+598': ['UY'],
  '+599': ['CW', 'BQ'], '+670': ['TL'], '+672': ['NF'], '+673': ['BN'], '+674': ['NR'], '+675': ['PG'],
  '+676': ['TO'], '+677': ['SB'], '+678': ['VU'], '+679': ['FJ'], '+680': ['PW'], '+681': ['WF'],
  '+682': ['CK'], '+683': ['NU'], '+685': ['WS'], '+686': ['KI'], '+687': ['NC'], '+688': ['TV'],
  '+689': ['PF'], '+690': ['TK'], '+691': ['FM'], '+692': ['MH'], '+850': ['KP'], '+855': ['KH'],
  '+856': ['LA'], '+880': ['BD'], '+960': ['MV'], '+961': ['LB'], '+962': ['JO'], '+963': ['SY'],
  '+964': ['IQ'], '+965': ['KW'], '+966': ['SA'], '+967': ['YE'], '+968': ['OM'], '+970': ['PS'],
  '+973': ['BH'], '+974': ['QA'], '+975': ['BT'], '+976': ['MN'], '+977': ['NP'], '+992': ['TJ'],
  '+993': ['TM'], '+994': ['AZ'], '+995': ['GE'], '+996': ['KG'], '+998': ['UZ'],
};
// 各区号的示例号码 —— 占位符用。三条约束决定了它长这样:
// ① ccs `re` 的 phone.filter 是 /[^\d]/g,**只留数字**,所以示例不能带空格或横线,
//    否则就是在教一个字段自己会吃掉的格式;
// ② 选了国际区号就意味着**去掉国内长途前缀的 0**,故这里存的是「国内有效号码」;
// ③ 有官方虚构号段的按官方来(美加 555-01xx、英国 Ofcom 07700 900xxx、
//    澳洲 ACMA 0491 570 xxx),其余给符合该国实际位数与首位规则的示例。
// 没收录的区号一律不给占位符 —— 编不出可信的示例就不编,别拿 13800000000 顶(踩过)。
const CALLING_CODE_EXAMPLES = {
  '+1': '2015550123', '+7': '9123456789', '+27': '711234567', '+30': '6912345678',
  '+31': '612345678', '+32': '470123456', '+33': '612345678', '+34': '612345678',
  '+39': '3123456789', '+41': '781234567', '+43': '664123456', '+44': '7700900123',
  '+45': '32123456', '+46': '701234567', '+47': '40612345', '+48': '512345678',
  '+49': '15123456789', '+52': '5512345678', '+55': '11961234567', '+61': '491570006',
  '+64': '211234567', '+65': '81234567', '+81': '9012345678', '+82': '1012345678',
  '+86': '13800138000', '+90': '5012345678', '+91': '9876543210', '+351': '912345678',
  '+353': '851234567', '+358': '412345678', '+852': '51234567', '+886': '912345678',
  '+966': '501234567', '+971': '501234567',
};

const callingCodeLabel = (value) => {
  const countries = CALLING_CODE_COUNTRIES[value] || [];
  return countries.length ? `${value} · ${countries.map(countryName).join(' / ')}` : value;
};
const CALLING_CODE_OPTIONS = ['+1', '+7', '+20', '+27', '+30', '+31', '+32', '+33', '+34', '+36', '+39', '+40', '+41', '+43', '+44', '+45', '+46', '+47', '+48', '+49', '+51', '+52', '+53', '+54', '+55', '+56', '+57', '+58', '+60', '+61', '+62', '+63', '+64', '+65', '+66', '+81', '+82', '+84', '+86', '+90', '+91', '+92', '+93', '+94', '+95', '+98', '+211', '+212', '+213', '+216', '+218', '+220', '+221', '+222', '+223', '+224', '+225', '+226', '+227', '+228', '+229', '+230', '+231', '+232', '+233', '+234', '+235', '+236', '+237', '+238', '+239', '+240', '+241', '+242', '+243', '+244', '+245', '+246', '+248', '+249', '+250', '+251', '+252', '+253', '+254', '+255', '+256', '+257', '+258', '+260', '+261', '+262', '+263', '+264', '+265', '+266', '+267', '+268', '+269', '+290', '+291', '+297', '+298', '+299', '+350', '+351', '+352', '+353', '+354', '+355', '+356', '+357', '+358', '+359', '+370', '+371', '+372', '+373', '+374', '+375', '+376', '+377', '+378', '+380', '+381', '+382', '+383', '+385', '+386', '+387', '+389', '+420', '+421', '+423', '+500', '+501', '+502', '+503', '+504', '+505', '+506', '+507', '+508', '+509', '+590', '+591', '+592', '+593', '+594', '+595', '+596', '+597', '+598', '+599', '+670', '+672', '+673', '+674', '+675', '+676', '+677', '+678', '+679', '+680', '+681', '+682', '+683', '+685', '+686', '+687', '+688', '+689', '+690', '+691', '+692', '+850', '+852', '+853', '+855', '+856', '+880', '+886', '+960', '+961', '+962', '+963', '+964', '+965', '+966', '+967', '+968', '+970', '+971', '+972', '+973', '+974', '+975', '+976', '+977', '+992', '+993', '+994', '+995', '+996', '+998'].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((value) => ({ value, label: callingCodeLabel(value) }));

const input = (attributeId, labelKey, opts = {}) => ({ type: 'input', attributeId, labelKey, ...opts });
const month = (attributeId, labelKey, opts = {}) => ({ type: 'month', attributeId, labelKey, ...opts });

/**
 * 版块(左侧一级导航)→ 页内 Group 的归属与顺序。**这就是那张表**:
 * 挪某个 Group 到别的版块、或调页内顺序,只改这里。
 */
export const SECTIONS = [
  { id: 'personal', labelKey: 'section.personal', groups: ['basics', 'summary', 'location', 'profiles', 'languages'] },
  { id: 'education', labelKey: 'section.education', groups: ['education', 'certificates'] },
  { id: 'career', labelKey: 'section.career', groups: ['work', 'projects', 'skills'] },
  { id: 'extra', labelKey: 'section.extra', groups: ['awards', 'publications', 'volunteer', 'interests', 'references'] },
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
    icon: 'basics',
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
      // 姓名在界面上拆成 名 / 中间名 / 姓 三个框,**存的仍是标准的那一个 `basics.name`**,
      // 只是次序规定为「名 中间名 姓」(见 app/lib/name-parts.mjs)
      { type: 'personName', attributeId: 'name', labelKey: 'field.basics.name' },
      { type: 'avatar', attributeId: 'image', labelKey: 'field.basics.image', uploadOnly: true },
      { type: 'phone', attributeId: 'phone', labelKey: 'field.basics.phone', validate: 'phone', options: CALLING_CODE_OPTIONS, examples: CALLING_CODE_EXAMPLES },
      input('email', 'field.basics.email', { validate: 'email' }),
      input('url', 'field.basics.url', { validate: 'url' }),
    ],
  },

  // 在线主页(JSON Resume 的 basics.profiles)。此前只有基本信息里那一个写死的
  // 「GitHub」输入框 —— 想放 LinkedIn / 个人博客 / 知乎无处可填,而数据模型本来就是数组。
  // 模板里的 GitHub 仍按 network 名从这份列表里挑,所以搬家不影响已有输出。
  {
    key: 'profiles',
    // 轻记录:两三个键值对,**行内直接编辑** —— 不走「列表 → 展开 → 表单 → 提交」那套四步流程。
    // 显式标注而不是按"字段数 ≤ 3"派生:加一个字段就静默翻档,那种规则守不住。
    inline: true,
    labelKey: 'nav.profiles',
    icon: 'profiles',
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
    key: 'summary', labelKey: 'nav.summary', icon: 'summary', kind: 'object',
    get: (r) => ({ label: r.basics.label, summary: r.basics.summary }),
    set: (r, v) => ({ ...r, basics: { ...r.basics, label: v.label ?? '', summary: v.summary ?? '' } }),
    fields: [input('label', 'field.basics.label'), { type: 'textArea', attributeId: 'summary', labelKey: 'field.summary.text', rows: 8, ai: true }],
  },
  {
    key: 'location', labelKey: 'nav.location', icon: 'location', kind: 'object',
    get: (r) => ({ ...(r.basics.location || {}) }),
    set: (r, v) => ({ ...r, basics: { ...r.basics, location: { ...r.basics.location, ...v } } }),
    fields: [
      { type: 'searchableSelect', attributeId: 'countryCode', labelKey: 'field.basics.countryCode', options: COUNTRY_CODE_OPTIONS },
      input('region', 'field.basics.region', { placeholderKey: 'field.basics.region.hint' }),
      input('city', 'field.basics.city'), input('address', 'field.basics.address'), input('postalCode', 'field.basics.postalCode'),
    ],
  },

  {
    key: 'education',
    labelKey: 'nav.education',
    icon: 'education',
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
    icon: 'work',
    kind: 'list',
    summaryField: 'name',
    get: (r) => r.work,
    set: (r, items) => ({ ...r, work: items }),
    fields: [
      input('name', 'field.work.name'),
      // description = 这家公司是干什么的(标准举例 "Social Media Company")。
      // 原来这里是非标准的 department(部门),按"与标准严格对齐"已去掉。
      input('description', 'field.work.description', { placeholderKey: 'field.work.description.hint' }),
      input('url', 'field.work.url', { validate: 'url' }),
      input('position', 'field.work.position'),
      // 工作地点:澳新/北美版式排在右侧。模板早就在读,只是一直没人能填。
      input('location', 'field.work.location', { placeholderKey: 'field.work.location.hint' }),
      month('startDate', 'field.work.startDate'),
      month('endDate', 'field.work.endDate', { presentKey: 'field.work.current' }),
      { type: 'textArea', attributeId: 'summary', labelKey: 'field.summary.text', rows: 3, ai: true },
      // 要点(JSON Resume 标准字段,与项目经历同构):一行一条。
      { type: 'lines', attributeId: 'highlights', labelKey: 'field.work.highlights', rows: 6, ai: true },
    ],
  },

  {
    key: 'projects',
    labelKey: 'nav.projects',
    icon: 'projects',
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
      { type: 'lines', attributeId: 'roles', labelKey: 'field.project.roles', rows: 3 },
      month('startDate', 'field.project.startDate'),
      month('endDate', 'field.project.endDate', { presentKey: 'field.project.ongoing' }),
      { type: 'textArea', attributeId: 'description', labelKey: 'field.project.description', rows: 3, ai: true },
      { type: 'lines', attributeId: 'highlights', labelKey: 'field.project.highlights', rows: 6, ai: true },
      { type: 'lines', attributeId: 'keywords', labelKey: 'field.project.keywords', rows: 3 },
      input('url', 'field.project.url', { validate: 'url' }),
      {
        type: 'select',
        attributeId: 'type',
        labelKey: 'field.project.type',
        options: [
          { value: '', labelKey: 'field.project.type.none' },
          { value: 'enterprise', labelKey: 'field.project.type.enterprise' },
          { value: 'academic', labelKey: 'field.project.type.academic' },
          { value: 'commercial', labelKey: 'field.project.type.commercial' },
          { value: 'hobby', labelKey: 'field.project.type.hobby' },
        ],
      },
    ],
  },

  {
    key: 'skills',
    // 轻记录:两三个键值对,**行内直接编辑** —— 不走「列表 → 展开 → 表单 → 提交」那套四步流程。
    // 显式标注而不是按"字段数 ≤ 3"派生:加一个字段就静默翻档,那种规则守不住。
    inline: true,
    labelKey: 'nav.skills',
    icon: 'skills',
    kind: 'list',
    summaryField: 'name',
    get: (r) => r.skills,
    set: (r, items) => ({ ...r, skills: items }),
    fields: [
      input('name', 'field.skill.name'),
      input('level', 'field.skill.level', { placeholderKey: 'field.skill.level.hint' }),
      {
        // tags 不是 lines:行内是芯片输入,快照视图排成一串小签(两处都按这个类型分派)
        type: 'tags',
        attributeId: 'keywords',
        labelKey: 'field.skill.keywords',
        placeholderKey: 'field.tags.hint',
      },
    ],
  },

  {
    key: 'certificates',
    labelKey: 'nav.certificates',
    icon: 'certificates',
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
    icon: 'awards',
    kind: 'list',
    summaryField: 'title',
    get: (r) => r.awards,
    set: (r, items) => ({ ...r, awards: items }),
    fields: [
      input('title', 'field.award.title'),
      input('awarder', 'field.award.awarder'),
      month('date', 'field.award.date'),
      { type: 'textArea', attributeId: 'summary', labelKey: 'field.summary.text', rows: 3 },
    ],
  },

  {
    key: 'languages',
    // 轻记录:两三个键值对,**行内直接编辑** —— 不走「列表 → 展开 → 表单 → 提交」那套四步流程。
    // 显式标注而不是按"字段数 ≤ 3"派生:加一个字段就静默翻档,那种规则守不住。
    inline: true,
    labelKey: 'nav.languages',
    icon: 'languages',
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
    // 轻记录:两三个键值对,**行内直接编辑** —— 不走「列表 → 展开 → 表单 → 提交」那套四步流程。
    // 显式标注而不是按"字段数 ≤ 3"派生:加一个字段就静默翻档,那种规则守不住。
    inline: true,
    labelKey: 'nav.interests',
    icon: 'interests',
    kind: 'list',
    summaryField: 'name',
    get: (r) => r.interests,
    set: (r, items) => ({ ...r, interests: items }),
    fields: [
      input('name', 'field.interest.name'),
      {
        type: 'tags',
        attributeId: 'keywords',
        labelKey: 'field.interest.keywords',
        placeholderKey: 'field.tags.hint',
      },
    ],
  },

  {
    key: 'volunteer',
    labelKey: 'nav.volunteer',
    icon: 'volunteer',
    kind: 'list',
    summaryField: 'organization',
    get: (r) => r.volunteer,
    set: (r, items) => ({ ...r, volunteer: items }),
    fields: [
      input('organization', 'field.volunteer.organization'),
      input('position', 'field.volunteer.position'),
      month('startDate', 'field.volunteer.startDate'),
      month('endDate', 'field.volunteer.endDate', { presentKey: 'field.volunteer.ongoing' }),
      { type: 'textArea', attributeId: 'summary', labelKey: 'field.summary.text', rows: 3 },
      { type: 'lines', attributeId: 'highlights', labelKey: 'field.volunteer.highlights', rows: 4 },
      input('url', 'field.volunteer.url', { validate: 'url' }),
    ],
  },

  {
    key: 'publications',
    labelKey: 'nav.publications',
    icon: 'publications',
    kind: 'list',
    summaryField: 'name',
    get: (r) => r.publications,
    set: (r, items) => ({ ...r, publications: items }),
    fields: [
      input('name', 'field.publication.name'),
      input('publisher', 'field.publication.publisher', { placeholderKey: 'field.publication.publisher.hint' }),
      month('releaseDate', 'field.publication.releaseDate'),
      input('url', 'field.publication.url', { validate: 'url' }),
      { type: 'textArea', attributeId: 'summary', labelKey: 'field.summary.text', rows: 3 },
    ],
  },

  {
    key: 'references',
    // 轻记录:两三个键值对,**行内直接编辑** —— 不走「列表 → 展开 → 表单 → 提交」那套四步流程。
    // 显式标注而不是按"字段数 ≤ 3"派生:加一个字段就静默翻档,那种规则守不住。
    inline: true,
    labelKey: 'nav.references',
    icon: 'references',
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
