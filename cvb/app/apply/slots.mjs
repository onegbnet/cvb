// 定向裁剪时**模型能改哪些槽** —— 这是 B 段的第一道结构性护栏。
//
// 用户 2026-08-26 裁定:**「资历与机构断言」类字段默认只读**(公司名、院校名、
// 职位头衔、语言熟练度)。理由不是洁癖,是实测:同一份满编简历上,
// claude-sonnet-5 两次里有一次把 8 个雇主/院校名**全部译成了英文** ——
// 简历上写一个不存在的雇主是硬伤,而这条靠提示词挡不住(两次跑的提示词一模一样)。
// 所以不指望模型守规矩,直接在结构上拿掉:名称类槽根本不进可写集合,
// 模型连那个键都看不见,改无可改。
//
// **能改的只有散文**:自我评价、公司在做什么、职责概述、亮点要点、项目描述。
// 取舍与排序不走这里 —— 那是 keep(见 tailor.mjs),丢一条经历不需要改写任何文字。
//
// **空槽也算合法**(用户 2026-08-26 裁定「空自我评价可以现写,但标成新增」):
// translate-map 的收集用 isStr 跳过空串 —— 那是**为翻译定的边界**(空的东西无需翻译),
// 拿到写作场景就错了:新西兰与澳大利亚的官方规范都点名要求 Personal Statement,
// 而大量事实库里这一节就是空的。跳过空槽 = 卖点③在最显眼的一条上结构性地做不到。
//
// 字段表的单一真相仍在 app/lib/translate-map.mjs(那边是翻译的边界),这里只做**减法**:
// 从它的表里挑出散文槽。别在这里另抄一份字段清单 —— 标准加了字段两边会漂。
import { BASICS_STRINGS, LOCATION_STRINGS, SECTIONS } from '../lib/translate-map.mjs';

/**
 * 散文槽:值是「写给人读的句子」,改写它不改变任何事实断言。
 * 逐节列出字段名;没列到的一律只读。
 */
const PROSE_FIELDS = {
  basics: ['summary'], // label(自我头衔)不在内:它也是一句头衔断言,同 work.position
  work: { strings: ['description', 'summary'], lists: ['highlights'] },
  volunteer: { strings: ['summary'], lists: ['highlights'] },
  projects: { strings: ['description'], lists: ['highlights'] },
  awards: { strings: ['summary'], lists: [] },
  publications: { strings: ['summary'], lists: [] },
  // education / certificates / skills / languages / interests / references 一个散文槽都没有:
  //   education.area·studyType 是学位与专业(资历断言)、certificates 只有名称与颁发方、
  //   skills.level 与 languages.fluency 是熟练度断言、interests 是事实、
  //   references.reference 是**别人写的话** —— 改写它是伪造第三方陈述。
  //   这几节仍然可以整条丢掉或重排(那是 keep 的事),只是不许改字。
};

const listOf = (v) => (Array.isArray(v) ? v : []);

/** 某一节的散文字符串字段。 */
export const proseStrings = (section) =>
  section === 'basics' ? listOf(PROSE_FIELDS.basics) : listOf((PROSE_FIELDS[section] || {}).strings);

/** 某一节的散文字符串**数组**字段(亮点要点这类,逐条可改可丢)。 */
export const proseLists = (section) =>
  section === 'basics' ? [] : listOf((PROSE_FIELDS[section] || {}).lists);

/**
 * 只读字段的名册 —— **由减法现算,不手抄**:凡是 translate-map 认得、
 * 而这里没归进散文的,一律只读。手抄一份清单的下场是标准加字段时两边漂。
 */
export const readonlyFields = () => {
  const out = { basics: [], 'basics.location': [...LOCATION_STRINGS] };
  const prose = new Set(proseStrings('basics'));
  out.basics = BASICS_STRINGS.filter((f) => !prose.has(f));
  for (const [section, spec] of Object.entries(SECTIONS)) {
    const ps = new Set(proseStrings(section));
    const pl = new Set(proseLists(section));
    out[section] = [
      ...spec.strings.filter((f) => !ps.has(f)),
      ...spec.lists.filter((f) => !pl.has(f)),
    ];
  }
  return out;
};

/**
 * 这条路径是不是模型可以改写的槽。路径形如:
 *   `basics.summary` / `work.0.summary` / `work.0.highlights.2` / `projects.1.description`
 *
 * **日期、URL、邮箱、电话、姓名、国家码、meta 一概判假** —— 它们连
 * translate-map 的表都不在,这里自然也认不出来(不是靠另写一张黑名单挡的)。
 */
export const isWritableSlot = (path) => {
  const parts = String(path || '').split('.');
  if (parts.length === 2 && parts[0] === 'basics') {
    return proseStrings('basics').includes(parts[1]);
  }
  const [section, idx, field, sub] = parts;
  if (!SECTIONS[section]) return false;
  if (!/^\d+$/.test(String(idx))) return false;
  if (parts.length === 3) return proseStrings(section).includes(field);
  if (parts.length === 4) return proseLists(section).includes(field) && /^\d+$/.test(String(sub));
  return false;
};

/**
 * 一条记录里的**可丢数组**(亮点要点、关键词这类):裁剪要能逐条丢,
 * 否则中国大陆「一页纸」那条惯例收不住 —— 只能整段丢掉一份工作,太粗。
 * 与 isWritableSlot 分开:关键词不许改写(改写 `Go`→`Golang` 是翻译不是裁剪),
 * 但**允许丢**。
 */
export const droppableLists = (section) => listOf((SECTIONS[section] || {}).lists);
