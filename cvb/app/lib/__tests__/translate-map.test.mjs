// 翻译映射的常驻回归网:结构永不出客户端 ——
// collect 只给散文/名称槽位,apply 只往既有字符串槽写(编造的路径落不进任何地方)。
import { collectTranslatables, applyTranslations, wrapUnit, unwrapUnit } from '../translate-map.mjs';

const CONFIG = {
  basics: {
    name: '三 张',
    label: '资深后端工程师',
    email: 'a@b.c',
    url: 'https://example.com',
    phone: '+86 13800000000',
    location: { city: '上海', countryCode: 'CN', postalCode: '200000' },
  },
  work: [
    {
      name: '某某科技',
      position: '后端工程师',
      url: 'https://corp.example.com',
      startDate: '2020-04',
      highlights: ['把 P99 从 800ms 降到 120ms', '主导网关重写'],
    },
  ],
  skills: [{ name: '后端', level: '精通', keywords: ['分布式系统', 'Go'] }],
  meta: { version: 'v1' },
};

test('collect:散文/名称槽进映射;语言中立字段与**人名**(根本不翻)不进', () => {
  const entries = collectTranslatables(CONFIG);
  expect(entries['basics.name']).toBeUndefined(); // 姓名根本不翻译(2026-08-23 用户裁定)
  expect(entries['basics.location.city']).toBe('上海');
  expect(entries['work.0.highlights.1']).toBe('主导网关重写');
  expect(entries['skills.0.keywords.0']).toBe('分布式系统');
  // 不翻的是**人名**(basics.name / references[].name);公司名 work.*.name、
  // 技能名 skills.*.name 是要翻的 —— 别把"字段叫 name"当成"是人名"
  expect(entries['work.0.name']).toBe('某某科技');
  const keys = Object.keys(entries).join('\n');
  expect(keys).not.toMatch(/email|url|phone|Date|countryCode|postalCode|meta/);
  // references[].name 同为人名,不进映射
  const withRef = collectTranslatables({ ...CONFIG, references: [{ name: '王 老师', reference: '极为可靠' }] });
  expect(withRef['references.0.name']).toBeUndefined();
  expect(withRef['references.0.reference']).toBe('极为可靠');
});

test('apply:同一数组的多条译文都落位(setter 按当前值重铺,不互相覆盖)', () => {
  const out = applyTranslations(CONFIG, {
    'work.0.highlights.0': 'Cut P99 from 800ms to 120ms',
    'work.0.highlights.1': 'Led the gateway rewrite',
  });
  expect(out.work[0].highlights).toEqual(['Cut P99 from 800ms to 120ms', 'Led the gateway rewrite']);
});

test('apply:编造的路径、非字符串值、**人名路径**都落不进任何地方', () => {
  const out = applyTranslations(CONFIG, {
    'basics.invented': '塞不进去',
    'basics.name': 'San Zhang', // 人名不是可写槽 —— 谁给译文都落不进
    'work.0.evil': 'x',
    'work.9.name': '越界',
    'skills.0.keywords.0': 42,
  });
  expect(out.basics.name).toBe('三 张');
  expect(JSON.stringify(Object.keys(out.basics).sort())).toBe(JSON.stringify(Object.keys(CONFIG.basics).sort()));
  expect(out.work[0].evil).toBeUndefined();
  expect(out.work.length).toBe(1);
  expect(out.skills[0].keywords[0]).toBe('分布式系统');
});

test('apply:深拷贝上写,入参原样不动;空映射 = 克隆恒等', () => {
  const before = JSON.stringify(CONFIG);
  const out = applyTranslations(CONFIG, { 'basics.label': 'Senior Backend Engineer' });
  expect(JSON.stringify(CONFIG)).toBe(before);
  expect(out.basics.label).toBe('Senior Backend Engineer');
  expect(JSON.stringify(applyTranslations(CONFIG, {}))).toBe(before);
});

test('wrapUnit/unwrapUnit:单元与 mini-config 对偶(逐条翻译的桥)', () => {
  // 重记录一条:按分节名平铺到索引 0
  const rec = { name: '某某科技', position: '后端工程师', startDate: '2020-04' };
  const mini = wrapUnit('work', rec);
  expect(collectTranslatables(mini)['work.0.position']).toBe('后端工程师');
  expect(unwrapUnit('work', mini)).toEqual(rec);

  // 行内整组:整个数组来回
  const rows = [{ language: '中文', fluency: '母语' }, { language: '英语', fluency: '流利' }];
  const miniList = wrapUnit('languages', rows);
  expect(collectTranslatables(miniList)['languages.1.fluency']).toBe('流利');
  expect(unwrapUnit('languages', miniList, { isList: true })).toEqual(rows);

  // 身份块单例:summary 住 basics 下、location 住 basics.location 下
  const sum = wrapUnit('summary', { label: '资深后端工程师', summary: '十年经验' });
  expect(collectTranslatables(sum)['basics.label']).toBe('资深后端工程师');
  expect(unwrapUnit('summary', sum)).toEqual({ label: '资深后端工程师', summary: '十年经验' });
  const loc = wrapUnit('location', { city: '上海', countryCode: 'CN' });
  expect(collectTranslatables(loc)['basics.location.city']).toBe('上海');
  expect(unwrapUnit('location', loc)).toEqual({ city: '上海', countryCode: 'CN' });
});
