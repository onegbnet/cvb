// 定向裁剪(生成侧 B 段)的纯函数半边 —— 判断进 jest,渲染留在页面上(同 job.mjs 那条)。
//
// **模型的产物不是一份简历,是一份只能寻址既有事实的「裁剪计划」**:
//   { keep: {容器路径: [原下标]}, text: {槽路径: 新文本}, note: '给人看的说明' }
// 简历由客户端 applyTailorPlan(事实, 计划) 现算。这条形状不是审美选择,是三件事逼出来的:
//
// 1. **零扩展红线在结构上成立**(§3):模型碰不到结构,只能在既有槽里换字、在既有
//    记录里做取舍。编造的路径落不进任何地方 —— 与翻译那条(translate-map)同一条先例。
// 2. **让模型整份重吐简历,实测会撞墙**:满编简历上 claude-sonnet-5 要 85~117s、
//    deepseek-v4-flash 85~136s,而 mma 那侧的 Cloudflare 边缘 100s 就 524
//    (2026-08-26 实测拿到过一次 `HTTP 524 | 125176ms`),还截断过一次。
//    计划的产出体量小得多,而且**流式**下即便跑满 106s 也完整(同日实测)。
// 3. **名称类字段必须在结构上拿掉**:同一份数据上 claude-sonnet-5 两次里有一次把
//    8 个雇主/院校名全译成英文 —— 简历上写一个不存在的雇主是硬伤,靠提示词挡不住。
//    可写槽由 slots.mjs 收敛成散文(用户 2026-08-26 裁定「资历与机构断言默认只读」)。
//
// 取舍与改写是**两件事**:丢掉一段经历不需要改写任何文字(keep),
// 改一句话也不该动别的记录(text)。混成一个"新简历"就分不开了。
import { SECTIONS } from '../lib/translate-map.mjs';
import { isWritableSlot, proseStrings, proseLists, droppableLists } from './slots.mjs';

/** 与 AI 导入 / 职位读取同口径的素材上限。超了在客户端就拦下,不打上游。 */
export const MAX_TAILOR_CHARS = 60000;

/**
 * **空槽只对自我评价开口**(用户 2026-08-26 裁定):新西兰与澳大利亚的官方规范都点名
 * 要求 Personal Statement,而大量事实库里这一节是空的 —— 不给它,卖点③在最显眼的
 * 一条上结构性地做不到。**别推广到别的空槽**:一段没写过职责概述的工作经历,
 * 让模型"补"出来就是凭空编造,那是这一整条设计要避免的事。
 */
const EMPTY_WRITABLE = new Set(['basics.summary']);

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

/** 记录的一行摘要,只给模型判相关性用 —— **只读、不进契约**,不许回写。 */
const RECORD_LABEL = {
  work: (r) => [r.name, r.position].filter(Boolean).join(' · '),
  volunteer: (r) => [r.organization, r.position].filter(Boolean).join(' · '),
  education: (r) => [r.institution, r.studyType, r.area].filter(Boolean).join(' · '),
  awards: (r) => [r.title, r.awarder].filter(Boolean).join(' · '),
  certificates: (r) => [r.name, r.issuer].filter(Boolean).join(' · '),
  publications: (r) => [r.name, r.publisher].filter(Boolean).join(' · '),
  skills: (r) => [r.name, r.level].filter(Boolean).join(' · '),
  languages: (r) => [r.language, r.fluency].filter(Boolean).join(' · '),
  interests: (r) => r.name || '',
  references: (r) => r.name || '',
  projects: (r) => [r.name, r.entity].filter(Boolean).join(' · '),
};

const periodOf = (r) =>
  [r.startDate, r.endDate].some(Boolean)
    ? `${r.startDate || ''}~${r.endDate || ''}`
    : r.date || r.releaseDate || '';

/**
 * 事实 → 送给模型的素材。**只送这套模板真会印出来的分节**(sections 由
 * app/tex/templates 声明并现算,不在这里手抄):喂了模板不印的节,模型在那儿使劲,
 * 结果是「AI 说改了但 PDF 一个像素没变」,而排查会先怀疑提示词和模型。
 *
 * 回 `{ slots, records, chars }`:
 *   slots   —— 「路径 → 当前文本」,**模型唯一能写的键集**;
 *   records —— 「分节 → [{i, label, period, lists}]」,只读,给模型排相关性与做取舍。
 */
export const collectTailorFacts = (config, { sections = null } = {}) => {
  const cfg = config && typeof config === 'object' ? config : {};
  const want = sections ? new Set(sections) : null;
  const on = (s) => !want || want.has(s);

  const slots = {};
  const records = {};

  if (on('basics')) {
    const basics = cfg.basics && typeof cfg.basics === 'object' ? cfg.basics : {};
    for (const f of proseStrings('basics')) {
      const path = `basics.${f}`;
      if (isStr(basics[f]) || EMPTY_WRITABLE.has(path)) slots[path] = String(basics[f] || '');
    }
  }

  for (const [section, spec] of Object.entries(SECTIONS)) {
    if (!on(section)) continue;
    const list = Array.isArray(cfg[section]) ? cfg[section] : [];
    if (!list.length) continue;
    records[section] = [];
    list.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      // 可丢数组:**只读的那些要把值也给出来**,否则模型看得见有几条、
      // 却不知道哪一条是哪一条 —— 2026-08-26 真机上「把 Kafka 从技能里去掉」
      // 就是这样落空的:关键词不可改写(改写 Go→Golang 是翻译),所以不进 SLOTS,
      // 而 RECORDS 当时只给了条数。可改写的那些(亮点要点)值已经在 SLOTS 里,不重复送。
      const lists = {};
      const writableLists = new Set(proseLists(section));
      for (const f of spec.lists) {
        const arr = Array.isArray(item[f]) ? item[f] : [];
        if (!arr.length) continue;
        lists[f] = writableLists.has(f) ? arr.length : arr.map((x) => clip(x, 80));
      }
      records[section].push({
        i,
        label: clip((RECORD_LABEL[section] || (() => ''))(item), 120),
        period: clip(periodOf(item), 24),
        lists,
      });
      for (const f of proseStrings(section)) {
        if (isStr(item[f])) slots[`${section}.${i}.${f}`] = String(item[f]);
      }
      for (const f of proseLists(section)) {
        const arr = Array.isArray(item[f]) ? item[f] : [];
        arr.forEach((entry, j) => {
          if (isStr(entry)) slots[`${section}.${i}.${f}.${j}`] = String(entry);
        });
      }
    });
    if (!records[section].length) delete records[section];
  }

  const chars = JSON.stringify({ slots, records }).length;
  return { slots, records, chars };
};

/** 素材预算:客户端先算,超了**不发**,如实说是哪一样太大 —— 不让请求打到服务端才 413。 */
export const estimateTailorPayload = ({ facts, refs = [], jobText = '', job = null, instructions = '' } = {}) => {
  const breakdown = {
    facts: facts && typeof facts.chars === 'number' ? facts.chars : 0,
    refs: refs.reduce((n, r) => n + (r && typeof r.chars === 'number' ? r.chars : 0), 0),
    jobText: String(jobText || '').length,
    job: job ? JSON.stringify(job).length : 0,
    instructions: String(instructions || '').length,
  };
  const chars = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const biggest = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0];
  return { chars, overBudget: chars > MAX_TAILOR_CHARS, breakdown, biggest: biggest ? biggest[0] : '' };
};

/**
 * 事实指纹。计划是**相对某一份事实**算出来的:事实在别处改过之后再套用旧计划,
 * 下标全错位 —— 那是静默改错人经历,比报错糟得多。指纹对不上就硬失败。
 */
export const factsFingerprint = ({ lang = '', updatedAt = 0 } = {}) => `${lang || ''}@${updatedAt || 0}`;

const DROP_REASONS = [
  'unknown-container',
  'unknown-path',
  'not-writable',
  'index-out-of-range',
  'duplicate-index',
  'not-an-integer',
  'bad-value',
];

/** 容器路径 → 它在事实里的数组长度;认不出回 -1。 */
const containerLength = (cfg, path) => {
  const parts = String(path).split('.');
  if (parts.length === 1) {
    return Array.isArray(cfg[parts[0]]) && SECTIONS[parts[0]] ? cfg[parts[0]].length : -1;
  }
  if (parts.length === 3) {
    const [section, idx, field] = parts;
    if (!SECTIONS[section] || !/^\d+$/.test(idx)) return -1;
    if (!droppableLists(section).includes(field)) return -1;
    const rec = Array.isArray(cfg[section]) ? cfg[section][Number(idx)] : null;
    return rec && Array.isArray(rec[field]) ? rec[field].length : -1;
  }
  return -1;
};

/**
 * 模型回包 → 干净计划。**结构不靠模型自觉**:认不出的一概不要,并逐条如实报出来。
 *
 * keep 的三种语义(缺一不可):
 *   分节**缺席** = 整节原样保留 —— 模型最自然的回法就是只对 work 表态,
 *     那时别的节必须一根汗毛都不动。出错方向因此是「没裁到」,不是「毁数据」;
 *   `[]`      = 显式清空这一节;
 *   `[2,0,1]` = 只留这几条,并**按此顺序**呈现(§3 写明顺序是呈现决策,归 /apply 管)。
 */
export const normalizeTailorPlan = (raw, config) => {
  const cfg = config && typeof config === 'object' ? config : {};
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const dropped = [];
  const drop = (path, reason) => dropped.push({ path: String(path).slice(0, 200), reason });

  const keep = {};
  const rawKeep = src.keep && typeof src.keep === 'object' && !Array.isArray(src.keep) ? src.keep : {};
  for (const [path, value] of Object.entries(rawKeep)) {
    const len = containerLength(cfg, path);
    if (len < 0) { drop(path, 'unknown-container'); continue; }
    if (!Array.isArray(value)) { drop(path, 'bad-value'); continue; }
    const seen = new Set();
    const out = [];
    for (const item of value) {
      if (!Number.isInteger(item)) { drop(`${path}[${item}]`, 'not-an-integer'); continue; }
      if (item < 0 || item >= len) { drop(`${path}[${item}]`, 'index-out-of-range'); continue; }
      if (seen.has(item)) { drop(`${path}[${item}]`, 'duplicate-index'); continue; }
      seen.add(item);
      out.push(item);
    }
    // **清洗剩下空的,不等于「清空这一节」**:模型说 `work:[9]`(下标越界)时,它的意思
    // 是"留第 9 条",不是"一条都不留" —— 照单收下就把整节删了,而这正是这条设计
    // 要避免的「毁数据」方向。只有模型**本来就给了 `[]`** 才是显式清空。
    if (!out.length && value.length) { drop(path, 'bad-value'); continue; }
    keep[path] = out;
  }

  const text = {};
  const rawText = src.text && typeof src.text === 'object' && !Array.isArray(src.text) ? src.text : {};
  const offered = collectTailorFacts(cfg).slots;
  for (const [path, value] of Object.entries(rawText)) {
    if (typeof value !== 'string' || !value.trim()) { drop(path, 'bad-value'); continue; }
    if (!isWritableSlot(path)) { drop(path, 'not-writable'); continue; }
    if (!(path in offered)) { drop(path, 'unknown-path'); continue; }
    text[path] = value.trim();
  }

  return {
    plan: { keep, text, note: clip(src.note, 300) },
    dropped,
    // 一轮什么都没改,不许伪装成成功 —— 那会让人对着原封不动的 PDF 以为它裁过了
    empty: !Object.keys(keep).length && !Object.keys(text).length,
  };
};

export { DROP_REASONS };

/**
 * 计划 → 裁剪后的简历(深拷贝上算,**不动入参**)。
 *
 * 顺序要紧:**先按原下标写字、再按原下标做取舍**。反过来的话,
 * 过滤已经改变了下标,后写的文字会落到别人身上(而且不报错)。
 * 数组一律赋新数组,不原地 splice —— §3 那条共享数组引用的老坑。
 */
export const applyTailorPlan = (config, plan) => {
  const out = JSON.parse(JSON.stringify(config || {}));
  const p = plan && typeof plan === 'object' ? plan : {};
  const text = p.text && typeof p.text === 'object' ? p.text : {};
  const keep = p.keep && typeof p.keep === 'object' ? p.keep : {};

  // ① 按**原下标**写字
  for (const [path, value] of Object.entries(text)) {
    const parts = path.split('.');
    if (parts.length === 2 && parts[0] === 'basics') {
      out.basics = { ...(out.basics || {}), [parts[1]]: value };
      continue;
    }
    const [section, idx, field, sub] = parts;
    const list = Array.isArray(out[section]) ? out[section] : null;
    const rec = list && list[Number(idx)];
    if (!rec) continue;
    if (parts.length === 3) {
      list[Number(idx)] = { ...rec, [field]: value };
    } else if (parts.length === 4 && Array.isArray(rec[field])) {
      const j = Number(sub);
      list[Number(idx)] = { ...rec, [field]: rec[field].map((x, k) => (k === j ? value : x)) };
    }
  }

  // ② 记录**内部**的数组取舍(亮点要点这类)—— 仍按原下标,且在外层过滤之前
  for (const [path, indices] of Object.entries(keep)) {
    const parts = path.split('.');
    if (parts.length !== 3) continue;
    const [section, idx, field] = parts;
    const list = Array.isArray(out[section]) ? out[section] : null;
    const rec = list && list[Number(idx)];
    if (!rec || !Array.isArray(rec[field])) continue;
    list[Number(idx)] = { ...rec, [field]: indices.map((i) => rec[field][i]) };
  }

  // ③ 分节取舍与排序 —— 最后做
  for (const [path, indices] of Object.entries(keep)) {
    if (path.includes('.')) continue;
    if (!Array.isArray(out[path])) continue;
    out[path] = indices.map((i) => out[path][i]).filter((x) => x !== undefined);
  }

  return out;
};

/**
 * 差异表:这一轮裁掉了什么、改写了什么。**别用 collectDroppedPaths** ——
 * 那个函数按数组下标 1:1 对齐(它的前提只对 normalizeResume 成立),
 * work=[A,B,C] 裁成 [A,C] 时它报的是 work[2] 的值,路径错、值错,
 * 还完全没提到真正没了的 B。裁剪要的是"哪一条不见了",与它要回答的问题不是一回事。
 */
export const tailorDiff = (before, after, plan) => {
  const p = plan && typeof plan === 'object' ? plan : {};
  const keep = p.keep && typeof p.keep === 'object' ? p.keep : {};
  const text = p.text && typeof p.text === 'object' ? p.text : {};
  const rows = [];

  for (const section of Object.keys(SECTIONS)) {
    const src = Array.isArray((before || {})[section]) ? before[section] : [];
    if (!src.length) continue;
    const indices = Array.isArray(keep[section]) ? keep[section] : src.map((_, i) => i);
    const kept = new Set(indices);
    const label = (i) => clip((RECORD_LABEL[section] || (() => ''))(src[i] || {}), 120);
    const droppedRecords = src.map((_, i) => i).filter((i) => !kept.has(i)).map((i) => ({ index: i, label: label(i) }));
    const reordered = indices.length > 1 && indices.some((v, k) => k > 0 && v < indices[k - 1]);
    const rewritten = Object.keys(text)
      .filter((path) => path.startsWith(`${section}.`))
      .map((path) => ({ path, before: pathValue(before, path), after: text[path] }));
    const innerDropped = Object.keys(keep)
      .filter((path) => path.startsWith(`${section}.`) && path.split('.').length === 3)
      .reduce((n, path) => {
        const [, idx, field] = path.split('.');
        const arr = (src[Number(idx)] || {})[field];
        return n + (Array.isArray(arr) ? arr.length - keep[path].length : 0);
      }, 0);
    if (!droppedRecords.length && !reordered && !rewritten.length && !innerDropped) continue;
    rows.push({ section, total: src.length, kept: indices.length, droppedRecords, reordered, rewritten, innerDropped });
  }

  const basicsRewritten = Object.keys(text)
    .filter((path) => path.startsWith('basics.'))
    .map((path) => ({ path, before: pathValue(before, path), after: text[path] }));
  if (basicsRewritten.length) {
    rows.unshift({ section: 'basics', total: 1, kept: 1, droppedRecords: [], reordered: false, rewritten: basicsRewritten, innerDropped: 0 });
  }
  return rows;
};

/** 取路径当前值(只读,给差异表摆 before)。认不出回空串,不抛。 */
export const pathValue = (config, path) => {
  const parts = String(path || '').split('.');
  let node = config;
  for (const part of parts) {
    if (node == null) return '';
    node = Array.isArray(node) ? node[Number(part)] : node[part];
  }
  return typeof node === 'string' ? node : '';
};

/** 这一处改写是「新增」还是「改写」—— 空自我评价现写出来的那一段要标成新增(用户裁定)。 */
export const isNewText = (before, path) => !isStr(pathValue(before, path));
