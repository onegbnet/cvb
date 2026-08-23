// 翻译映射的常驻回归网:结构永不出客户端 ——
// collect 只给散文/名称槽位,apply 只往既有字符串槽写(编造的路径落不进任何地方)。
import { collectTranslatables, applyTranslations } from '../translate-map.mjs';

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

test('collect:散文/名称槽位进映射,语言中立字段(日期/URL/邮箱/电话/国家码/meta)不进', () => {
  const entries = collectTranslatables(CONFIG);
  expect(entries['basics.name']).toBe('三 张');
  expect(entries['basics.location.city']).toBe('上海');
  expect(entries['work.0.highlights.1']).toBe('主导网关重写');
  expect(entries['skills.0.keywords.0']).toBe('分布式系统');
  const keys = Object.keys(entries).join('\n');
  expect(keys).not.toMatch(/email|url|phone|Date|countryCode|postalCode|meta/);
});

test('apply:同一数组的多条译文都落位(setter 按当前值重铺,不互相覆盖)', () => {
  const out = applyTranslations(CONFIG, {
    'work.0.highlights.0': 'Cut P99 from 800ms to 120ms',
    'work.0.highlights.1': 'Led the gateway rewrite',
  });
  expect(out.work[0].highlights).toEqual(['Cut P99 from 800ms to 120ms', 'Led the gateway rewrite']);
});

test('apply:编造的路径与非字符串值落不进任何地方,结构一字不多', () => {
  const out = applyTranslations(CONFIG, {
    'basics.invented': '塞不进去',
    'work.0.evil': 'x',
    'work.9.name': '越界',
    'skills.0.keywords.0': 42,
  });
  expect(JSON.stringify(Object.keys(out.basics).sort())).toBe(JSON.stringify(Object.keys(CONFIG.basics).sort()));
  expect(out.work[0].evil).toBeUndefined();
  expect(out.work.length).toBe(1);
  expect(out.skills[0].keywords[0]).toBe('分布式系统');
});

test('apply:深拷贝上写,入参原样不动;空映射 = 克隆恒等', () => {
  const before = JSON.stringify(CONFIG);
  const out = applyTranslations(CONFIG, { 'basics.name': 'San Zhang' });
  expect(JSON.stringify(CONFIG)).toBe(before);
  expect(out.basics.name).toBe('San Zhang');
  expect(JSON.stringify(applyTranslations(CONFIG, {}))).toBe(before);
});
