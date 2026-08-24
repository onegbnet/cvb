/** @jest-environment node */
// 投递规格:与 culture 语料、模板注册表的对账 —— 这三样一旦对不上,
// 界面上就会出现「选得到规格却没有版式」或「加了模板却选不到」。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const { APPLY_SPECS, resolveSpec, templateForSpec, pdfFileNameFor, specById } = await import('../specs.mjs');
const { TEX_TEMPLATES } = await import('../../tex/templates/index.mjs');

const ROOT = path.join(process.cwd());

test('每个规格都指名一份真实存在的 culture 语料', () => {
  for (const spec of APPLY_SPECS) {
    expect(existsSync(path.join(ROOT, spec.culture))).toBe(true);
  }
});

test('规格里的版式都在模板注册表里;每套模板都归得进某个规格', () => {
  const registered = Object.keys(TEX_TEMPLATES);
  const covered = new Set();
  for (const spec of APPLY_SPECS) {
    expect(spec.templates.length).toBeGreaterThan(0);
    for (const id of spec.templates) {
      expect(registered).toContain(id); // 规格里写了个不存在的模板 → 选了就编译不出来
      covered.add(id);
    }
  }
  // 反过来:新加了模板却忘了归规格,界面上根本选不到它
  expect([...registered].sort()).toEqual([...covered].sort());
});

test('照片政策只认三态,**待查一律 null**(不许替语料补)', () => {
  for (const spec of APPLY_SPECS) {
    expect([null, 'no', 'required']).toContain(spec.photo);
  }
  // au.md 明写「S1、S2 均未明文规定」——所以它必须是 null,不是猜一个
  expect(specById('au').photo).toBe(null);
  expect(specById('nz').photo).toBe('no'); // "don't use images"
  expect(specById('cn').photo).toBe('required'); // 与澳新的正面冲突项
});

test('页数上限抄的是语料里更严的那个口径', () => {
  expect(specById('cn').maxPages).toBe(1); // 「一般情况下简历都是一页A4纸」
  expect(specById('au').maxPages).toBe(2); // "no more than 2 pages"(州级 1–3 页取更严)
  expect(specById('nz').maxPages).toBe(2);
});

test('换规格时版式跟着换:不合规的回落到该规格第一套', () => {
  expect(templateForSpec('cn', 'cn-modern')).toBe('cn-modern');
  expect(templateForSpec('cn', 'anz-tech')).toBe('cn-classic'); // 中文规格不给英文模板
  expect(templateForSpec('au', 'cn-modern')).toBe('anz-tech');
  expect(resolveSpec('nope')).toBe('cn');
});

test('文件名按规格的命名惯例:nz 官方点名「名-姓-CV.pdf」', () => {
  const nameParts = { given: 'Sam', middle: '', family: 'Henderson' };
  expect(pdfFileNameFor({ specId: 'nz', nameParts, fallbackName: 'Sam Henderson', date: '2026-08-24' }))
    .toBe('sam-henderson-CV.pdf');
  // 没有命名惯例的规格:姓名-日期
  expect(pdfFileNameFor({ specId: 'cn', nameParts, fallbackName: '三 张', date: '2026-08-24' }))
    .toBe('三-张-2026-08-24.pdf');
  // 连名字都没有:也得给出个能用的名字
  expect(pdfFileNameFor({ specId: 'au', nameParts: null, fallbackName: '', date: '2026-08-24' }))
    .toBe('resume-2026-08-24.pdf');
});

test('语料里的硬规则与注册表不许漂移:页数与字体在 md 里找得到', () => {
  const cn = readFileSync(path.join(ROOT, 'culture/cn.md'), 'utf8');
  expect(cn).toMatch(/一页A4纸/); // maxPages: 1 的出处
  const nz = readFileSync(path.join(ROOT, 'culture/nz.md'), 'utf8');
  expect(nz).toMatch(/don't use images/); // photo: 'no' 的出处
  expect(nz).toMatch(/sam-henderson-CV\.pdf/); // fileName 惯例的出处
});
