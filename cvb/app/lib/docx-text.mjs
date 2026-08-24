// .docx → 纯文本(AI 导入用)。**不引第三方解析库**:
// docx 就是个 ZIP,正文在 `word/document.xml`;解压用浏览器自带的
// DecompressionStream('deflate-raw'),XML 取字用正则 —— 我们只要文字,
// 不要样式、不要保真度,几十行足够,不值得为它往 ccs 塞一个库
// (house 原则:能不占资源就不占,但也别为一次性需求引依赖)。
//
// 走**中央目录**读条目,不扫本地头:流式写出的 zip 本地头里的大小可能是 0
// (真正的大小在数据描述符里),照本地头读会截断。

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** 找 EOCD(末尾 22 字节起,注释最长 65535)。 */
const findEocd = (b) => {
  const min = Math.max(0, b.length - 22 - 65535);
  for (let i = b.length - 22; i >= min; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return i;
  }
  return -1;
};

/** 从中央目录里找一个条目 → {method, offset, size}。找不到回 null。 */
const findEntry = (b, wanted) => {
  const eocd = findEocd(b);
  if (eocd < 0) return null;
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) return null; // 中央目录头签名对不上 = 不是我们认得的 zip
    const method = u16(b, p + 10);
    const compressedSize = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const localOffset = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) {
      // 本地头长度可变(文件名/扩展区各自的长度),数据起点要按本地头现算
      const lnameLen = u16(b, localOffset + 26);
      const lextraLen = u16(b, localOffset + 28);
      const start = localOffset + 30 + lnameLen + lextraLen;
      return { method, start, size: compressedSize };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
};

const inflateRaw = async (bytes) => {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream unavailable');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/**
 * WordprocessingML → 文本。段落(`<w:p>`)成行,`<w:tab/>` 成制表,`<w:br/>` 成换行;
 * 其余标签一律丢掉 —— 表格单元格也按其中的段落出行,顺序即阅读顺序。
 */
export const docxXmlToText = (xml) => {
  const text = String(xml || '')
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    // 取 <w:t> 的内容,其余标签删掉(w:t 可能带 xml:space="preserve")
    .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_m, s) => s)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
};

/**
 * @param {ArrayBuffer|Uint8Array} buf .docx 字节
 * @returns {Promise<string>} 抽不到文字时返回空串(调用方如实告诉用户,别谎称解析失败)
 */
export async function extractDocxText(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const entry = findEntry(bytes, 'word/document.xml');
  if (!entry) throw new Error('not a docx (word/document.xml not found)');
  const raw = bytes.subarray(entry.start, entry.start + entry.size);
  let xmlBytes;
  if (entry.method === 0) xmlBytes = raw; // stored
  else if (entry.method === 8) xmlBytes = await inflateRaw(raw);
  else throw new Error(`unsupported zip method ${entry.method}`);
  return docxXmlToText(new TextDecoder().decode(xmlBytes));
}
