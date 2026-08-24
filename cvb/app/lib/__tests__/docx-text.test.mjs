/** @jest-environment node */
// .docx 抽文本:自己读 zip 中央目录 + 解 WordprocessingML。
// 夹具在测试里现造(stored 与 deflate 两种存法都造),不进仓一个二进制文件。
import { deflateRawSync, crc32 } from 'node:zlib';
const { extractDocxText, docxXmlToText } = await import('../docx-text.mjs');

/** 造一个只含 word/document.xml 的最小 zip;method 0=stored / 8=deflate。 */
const makeZip = (name, content, method) => {
  const nameB = Buffer.from(name, 'utf8');
  const raw = Buffer.from(content, 'utf8');
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const crc = typeof crc32 === 'function' ? crc32(raw) : 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc >>> 0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameB.length, 26);
  const localPart = Buffer.concat([local, nameB, data]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc >>> 0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameB.length, 28);
  central.writeUInt32LE(0, 42); // local header offset
  const centralPart = Buffer.concat([central, nameB]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return new Uint8Array(Buffer.concat([localPart, centralPart, eocd]));
};

const DOC_XML =
  '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>' +
  '<w:p><w:r><w:t xml:space="preserve">张三</w:t></w:r><w:r><w:t> · 资深工程师</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>华为</w:t><w:tab/><w:t>2019-06 至今</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>要点一</w:t><w:br/><w:t>要点二</w:t></w:r></w:p>' +
  '<w:p/>' +
  '<w:p><w:r><w:t>R&amp;D &lt;核心&gt;</w:t></w:r></w:p>' +
  '</w:body></w:document>';

test('docxXmlToText:段落成行、tab/br 保留、实体还原、空段丢弃', () => {
  expect(docxXmlToText(DOC_XML).split('\n')).toEqual([
    '张三 · 资深工程师',
    '华为\t2019-06 至今',
    '要点一',
    '要点二',
    'R&D <核心>',
  ]);
});

test('stored(不压缩)的 docx 读得出来', async () => {
  expect(await extractDocxText(makeZip('word/document.xml', DOC_XML, 0))).toContain('张三 · 资深工程师');
});

test('deflate 的 docx 读得出来 —— 走 DecompressionStream,不引解析库', async () => {
  const text = await extractDocxText(makeZip('word/document.xml', DOC_XML, 8));
  expect(text).toContain('华为\t2019-06 至今');
  expect(text).toContain('R&D <核心>');
});

test('不是 docx(没有 word/document.xml)就抛,不装作读到了空文档', async () => {
  await expect(extractDocxText(makeZip('other.xml', '<a/>', 0))).rejects.toThrow(/docx/);
  await expect(extractDocxText(new Uint8Array([1, 2, 3]))).rejects.toThrow();
});
