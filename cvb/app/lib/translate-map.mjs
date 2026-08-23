// 翻译映射:从纯标准 JSON Resume 里收集「值是散文/名称」的字符串槽位。
//
// 结构永不出客户端 —— 模型只见「路径 → 文本」的平面映射,译文按路径写回
// **既有**字符串槽;写不进任何新字段、改不了任何结构(§3 零扩展红线在结构上成立)。
// 语言中立字段(日期/URL/邮箱/电话/国家码/邮编/meta)不进映射,原样带过去 ——
// 这正是「新增语种以真相源为底稿」承诺的那一半。

const BASICS_STRINGS = ['name', 'label', 'summary'];
const LOCATION_STRINGS = ['address', 'city', 'region'];

// 每个列表节:哪些字段是字符串、哪些是字符串数组。没列出的(url/date/score…)不碰。
const SECTIONS = {
  work: { strings: ['name', 'position', 'description', 'summary', 'location'], lists: ['highlights'] },
  volunteer: { strings: ['organization', 'position', 'summary'], lists: ['highlights'] },
  education: { strings: ['institution', 'area', 'studyType'], lists: ['courses'] },
  awards: { strings: ['title', 'awarder', 'summary'], lists: [] },
  certificates: { strings: ['name', 'issuer'], lists: [] },
  publications: { strings: ['name', 'publisher', 'summary'], lists: [] },
  skills: { strings: ['name', 'level'], lists: ['keywords'] },
  languages: { strings: ['language', 'fluency'], lists: [] },
  interests: { strings: ['name'], lists: ['keywords'] },
  references: { strings: ['name', 'reference'], lists: [] },
  // projects.type 是 portfolio 标记(值是约定),不翻
  projects: { strings: ['name', 'description', 'entity'], lists: ['highlights', 'keywords', 'roles'] },
};

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

/** 遍历所有可翻译槽位:cb(path, value, setter)。collect 与 apply 共用同一个走法。 */
const walkSlots = (config, cb) => {
  if (!config || typeof config !== 'object') return;
  const basics = config.basics;
  if (basics && typeof basics === 'object') {
    for (const f of BASICS_STRINGS) {
      if (isStr(basics[f])) cb(`basics.${f}`, basics[f], (v) => { basics[f] = v; });
    }
    const loc = basics.location;
    if (loc && typeof loc === 'object') {
      for (const f of LOCATION_STRINGS) {
        if (isStr(loc[f])) cb(`basics.location.${f}`, loc[f], (v) => { loc[f] = v; });
      }
    }
  }
  for (const [section, spec] of Object.entries(SECTIONS)) {
    const list = config[section];
    if (!Array.isArray(list)) continue;
    list.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      for (const f of spec.strings) {
        if (isStr(item[f])) cb(`${section}.${i}.${f}`, item[f], (v) => { item[f] = v; });
      }
      for (const f of spec.lists) {
        const arr = item[f];
        if (!Array.isArray(arr)) continue;
        arr.forEach((entry, j) => {
          // 红线:数组不原地改 —— 赋新数组(见 §3 共享数组引用的老坑)。
          // set 时按 item[f] 的**当前值**重铺:同一数组落多条译文时,
          // 抓着遍历时的 arr 会让后一次把前一次盖掉。
          if (isStr(entry)) {
            cb(`${section}.${i}.${f}.${j}`, entry, (v) => {
              item[f] = item[f].map((x, k) => (k === j ? v : x));
            });
          }
        });
      }
    });
  }
};

/** 收集可翻译槽位 → { 路径: 原文 }。 */
export const collectTranslatables = (config) => {
  const entries = {};
  walkSlots(config, (path, value) => { entries[path] = value; });
  return entries;
};

/**
 * 把译文按路径写回(深拷贝上写,不动入参)。
 * 只认 collect 会给出的路径 —— 模型编造的路径落不进任何地方。
 */
export const applyTranslations = (config, translations) => {
  const copy = JSON.parse(JSON.stringify(config || {}));
  const map = translations && typeof translations === 'object' ? translations : {};
  walkSlots(copy, (path, _value, set) => {
    const next = map[path];
    if (typeof next === 'string' && next.trim() !== '') set(next);
  });
  return copy;
};
