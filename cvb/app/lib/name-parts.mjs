// 姓名:一个标准字段,一个**规定的次序**。
//
// 底层只有 JSON Resume 标准的 `basics.name`(§3 纯标准无扩展仍然成立,没加任何字段)。
// 变的是**存进去的字样**:一律按 **名 中间名 姓**、空格分隔
// (2026-08-19 用户裁定:「底层存的字样是 名 中间名 姓 —— 展示在简历上再按文化拼」)。
//
// **为什么规定次序而不是各存一段**:次序一旦规定,**最后一段就是姓**,这件事就从"猜"
// 变成了"读"。于是:
// - 编辑器给 名 / 中间名 / 姓 三个框,拼成这个次序存下去;
// - Europass / LER-RS 导出直接按次序切,`FirstName` / `Surname` 各归各位,不再靠猜空格;
// - **简历上怎么印,留到排版那一步按当地规范决定** —— 中文模板印「张三」,
//   英文模板印「San Zhang」。姓在前还是在后本来就是文化规则(§0 卖点③),
//   把它固化进存储就等于提前替所有模板做了决定。
//
// **代价说清楚**:存下来的串对中文名是「三 张」而不是「张三」。别的 JSON Resume 工具
// 直接打印 `basics.name` 时会看到这个次序。这是用上面那条好处换的,不是疏忽 ——
// 换来的是"最后一段一定是姓"这个可依赖的事实。
//
// 拆分只有一条规则,没有分支:**按空格切,末段是姓,首段是名,中间的是中间名**。
// 没有空格 → 整串当姓(不猜复姓是一个字还是两个字,也不猜单串名字的边界)。

/** 三段 → 存储串。次序固定为 名 中间名 姓,空格分隔;空段不留空格。 */
export function joinName({ given = '', middle = '', family = '' } = {}) {
  return [given, middle, family]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' ');
}

/** 存储串 → 三段。**末段是姓**(次序是规定的,所以这不是猜)。 */
export function splitName(name) {
  const whole = String(name || '').trim();
  if (!whole) return { given: '', middle: '', family: '' };
  const parts = whole.split(/\s+/);
  if (parts.length === 1) return { given: '', middle: '', family: whole };
  const family = parts.pop();
  const given = parts.shift();
  return { given, middle: parts.join(' '), family };
}

/**
 * 按文化把三段拼成**印在简历上**的那一行。
 *
 * 这是排版侧的事,不是存储侧的 —— 模板知道自己服务哪个求职地,存储不知道。
 * @param {object} parts 三段(或直接传存储串)
 * @param {'cjk'|'latin'} [order='latin'] `cjk` = 姓在前不加空格;`latin` = 名在前空格分隔
 */
export function formatName(parts, order = 'latin') {
  const p = typeof parts === 'string' ? splitName(parts) : parts || {};
  const given = String(p.given || '').trim();
  const middle = String(p.middle || '').trim();
  const family = String(p.family || '').trim();
  if (order === 'cjk') return [family, middle, given].filter(Boolean).join('');
  return [given, middle, family].filter(Boolean).join(' ');
}
