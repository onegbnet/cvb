// 翻译映射:从纯标准 JSON Resume 里收集「值是散文/名称」的字符串槽位。
//
// 结构永不出客户端 —— 模型只见「路径 → 文本」的平面映射,译文按路径写回
// **既有**字符串槽;写不进任何新字段、改不了任何结构(§3 零扩展红线在结构上成立)。
// 语言中立字段(日期/URL/邮箱/电话/国家码/邮编/meta)不进映射,原样带过去 ——
// 这正是「新增语种从所选语种翻译」承诺的那一半。

// 人名**根本不进映射**(2026-08-23 用户裁定「姓名根本不翻译」):姓名是身份标识,
// 不是待翻译的散文 —— 实测没有一条机器路靠得住(DeepL 把「三 张」直译成
// "Three Zhangs";LLM 转写同名两次拼法不同、还会 2 段变 3 段撕破姓名存储契约)。
// basics.name 与 references[].name 原样带过去,要改进编辑器自己改。
export const BASICS_STRINGS = ['label', 'summary'];
export const LOCATION_STRINGS = ['address', 'city', 'region'];

// 每个列表节:哪些字段是字符串、哪些是字符串数组。没列出的(url/date/score…)不碰。
//
// **这三张表现在是两处的字段边界真相**:翻译(本文件)与定向裁剪(app/apply/slots.mjs)。
// 裁剪那边只做减法(从这里挑出散文槽),**别另抄一份清单** —— 标准加了字段两边会漂。
export const SECTIONS = {
  work: { strings: ['name', 'position', 'description', 'summary', 'location'], lists: ['highlights'] },
  volunteer: { strings: ['organization', 'position', 'summary'], lists: ['highlights'] },
  education: { strings: ['institution', 'area', 'studyType'], lists: ['courses'] },
  awards: { strings: ['title', 'awarder', 'summary'], lists: [] },
  certificates: { strings: ['name', 'issuer'], lists: [] },
  publications: { strings: ['name', 'publisher', 'summary'], lists: [] },
  skills: { strings: ['name', 'level'], lists: ['keywords'] },
  languages: { strings: ['language', 'fluency'], lists: [] },
  interests: { strings: ['name'], lists: ['keywords'] },
  references: { strings: ['reference'], lists: [] }, // name 是人名,只译括号里那段(见 PARTIAL_STRINGS)
  // projects.type 是 portfolio 标记(值是约定),不翻
  projects: { strings: ['name', 'description', 'entity'], lists: ['highlights', 'keywords', 'roles'] },
};

// ---- 只译一部分的字段(2026-08-30)----
//
// **`references[].name` 实际存的不只是名字**:标准的 references 只有 name / reference,
// 「这人是谁」没有别的地方可放,于是人们写成
// 「张代君(盛大创新院时,意法爱立信中国区总裁,我负责项目的客户)」。
// 整个字段排除在翻译之外的话,英文简历的 Referees 一节就会留着一段中文
// —— 2026-08-30 在真机出的 PDF 上看到的。
//
// 规矩:**括号外的一个字都不碰(那是名字),只译括号里的**。括号是个人写下的、
// 看得见的边界,同「姓名留一个空格,这件事就从猜变成读」是同一条思路 ——
// 不猜哪一段是名字,只认他自己标出来的那段说明。没有括号就什么都不译(不退步)。
const PARTIAL_STRINGS = { references: ['name'] };

/** 每次现造,别共用带 /g 的正则(lastIndex 是有状态的,共用必出隔次失灵的怪事)。 */
const bracketRe = () => /（[^（）]*）|\([^()]*\)/g;

/** 串里每一段括号内容:[{ k: 第几个括号(含空的), text }],空括号不算槽位。 */
const bracketParts = (str) => {
  const out = [];
  const re = bracketRe();
  let m;
  let i = 0;
  while ((m = re.exec(str))) {
    const inner = m[0].slice(1, -1);
    if (inner.trim()) out.push({ k: i, text: inner });
    i += 1;
  }
  return out;
};

/** 把第 k 个括号的内容换掉,括号本身与外面的字一个都不动。 */
const replaceBracket = (str, k, value) => {
  let i = 0;
  return str.replace(bracketRe(), (m) => {
    const cur = i;
    i += 1;
    return cur === k ? m[0] + value + m[m.length - 1] : m;
  });
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
      // 只译括号里那段的字段(references[].name)—— 路径带 `#k` 标是第几个括号
      for (const f of PARTIAL_STRINGS[section] || []) {
        if (!isStr(item[f])) continue;
        for (const { k, text } of bracketParts(item[f])) {
          cb(`${section}.${i}.${f}#${k}`, text, (v) => {
            // 按**当前值**重算:同一个字段有多个括号时,抓着旧串会让后一次盖掉前一次
            item[f] = replaceBracket(item[f], k, v);
          });
        }
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

// ---- 条目级翻译的桥(2026-08-23 语种平权:任一条目可从任一语种的对应条目翻译)----
// 编辑器的「单元」(一条重记录 / 身份块的三个单例 / 一个行内节的整组行)包成
// translate-map 认识的 mini-config,翻完再解回 —— 收集/写回逻辑因此零分叉。
// 对应关系按**分节 + 索引**(标准记录没有稳定 id,位置是唯一的结构性对应)。

const UNIT_WRAP = {
  // 身份块三单例:各自住 basics 下的自然位置
  basics: { wrap: (v) => ({ basics: { ...v } }), unwrap: (c) => ({ ...(c.basics || {}) }) },
  summary: { wrap: (v) => ({ basics: { ...v } }), unwrap: (c) => ({ ...(c.basics || {}) }) },
  location: {
    wrap: (v) => ({ basics: { location: { ...v } } }),
    unwrap: (c) => ({ ...((c.basics && c.basics.location) || {}) }),
  },
};

/** 单元 → mini-config。列表节(重记录一条 / 行内整组)按分节名平铺。 */
export const wrapUnit = (moduleKey, unit) => {
  const special = UNIT_WRAP[moduleKey];
  if (special) return special.wrap(unit || {});
  return { [moduleKey]: Array.isArray(unit) ? unit.map((it) => ({ ...it })) : [{ ...(unit || {}) }] };
};

/** mini-config → 单元(与 wrapUnit 对偶;isList 指该单元本来就是整组行)。 */
export const unwrapUnit = (moduleKey, mini, { isList = false } = {}) => {
  const special = UNIT_WRAP[moduleKey];
  if (special) return special.unwrap(mini || {});
  const arr = Array.isArray((mini || {})[moduleKey]) ? mini[moduleKey] : [];
  return isList ? arr : arr[0] || {};
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
