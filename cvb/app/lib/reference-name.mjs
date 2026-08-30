// 推荐人那一栏:**`Name, Contact (Identity)`**(2026-08-30 用户定的格式)。
//
// **为什么要有这条**:JSON Resume 的 `references` 只有 `name` 与 `reference` 两个字段,
// 「这人是谁」「怎么联系他」没有别的地方可放 —— 于是全塞进 `name`。
// 后果在 2026-08-30 的真机 PDF 上露出来:英文简历的 Referees 一节留着一段中文,
// 因为 `references[].name` 整个被排除在翻译之外(理由是"人名不翻译",见 translate-map)。
//
// 修法**不是拿正则去猜哪一段是名字**,而是**把边界摆进界面**(用户裁定):
// 编辑器给三栏 —— 姓名 / 联系方式 / 身份 —— 存回去时拼成一个标准串。
// 这与 §3「姓名留一个空格,这件事就从『猜』变成『读』」是同一条思路:
// 不去猜,只认人自己标出来的边界。**读别人的 JSON 也按同一条规则解**,
// 所以拼与拆是一条规则的两面,不是两套。
//
// **零扩展红线不动**:`basics`/`references` 里没长出任何字段,三栏是虚的,
// 只活在编辑器边界内(modules.mjs 的 get/set 里拆与拼)。

/** 结尾那一对括号(半角或全角)—— 老数据多是全角,两种都要认。 */
const TRAILING_BRACKET = /[（(]([^（）()]*)[）)]\s*$/;

/** 第一个逗号(半角或全角)。名字里一般没有逗号,而联系方式常有(邮箱、电话)。 */
const FIRST_COMMA = /[,，]/;

/**
 * `张代君, zhang@x.com (盛大创新院,意法爱立信中国区总裁)` → 三段。
 *
 * 三条退让规则,都是为了**老数据不丢**:
 * - 没有括号 → 身份为空,整串按逗号拆名字与联系方式;
 * - 没有逗号 → 联系方式为空,括号前面整段都是名字(线上老数据正是这一档);
 * - 什么都没有 → 整串就是名字。
 *
 * `raw` 原样带着,供 formatReferenceName 做**往返恒等**(见那边)。
 */
export const splitReferenceName = (value) => {
  const raw = typeof value === 'string' ? value : '';
  let rest = raw.trim();
  let identity = '';
  const m = TRAILING_BRACKET.exec(rest);
  if (m) {
    identity = m[1].trim();
    rest = rest.slice(0, m.index).trim();
  }
  let name = rest;
  let contact = '';
  const c = FIRST_COMMA.exec(rest);
  if (c) {
    name = rest.slice(0, c.index).trim();
    contact = rest.slice(c.index + 1).trim();
  }
  return { name, contact, identity, raw };
};

/**
 * 三段 → `Name, Contact (Identity)`。空的那几段连同它的分隔符一起不出现
 * —— 只填了名字的人不该在简历上看到一个空括号。
 *
 * **往返恒等**:没动过的值原样还回去。否则老数据里的全角括号会因为
 * "打开过一次编辑器"就被改写成半角 —— 那是静默改数据(同 name-parts 那条)。
 */
export const formatReferenceName = (parts) => {
  const p = parts && typeof parts === 'object' ? parts : {};
  const name = String(p.name || '').trim();
  const contact = String(p.contact || '').trim();
  const identity = String(p.identity || '').trim();

  if (typeof p.raw === 'string' && p.raw) {
    const again = splitReferenceName(p.raw);
    if (again.name === name && again.contact === contact && again.identity === identity) return p.raw;
  }

  let out = name;
  if (contact) out = out ? `${out}, ${contact}` : contact;
  if (identity) out = out ? `${out} (${identity})` : `(${identity})`;
  return out;
};
