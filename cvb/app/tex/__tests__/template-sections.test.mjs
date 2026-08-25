/** @jest-environment node */
// 模板消费面的**双向对账** —— TEX_TEMPLATES[*].sections 声明的必须与 renderTex 实际印的一致。
//
// 为什么要有这层网:生成侧 B 段的定向裁剪只该把"这套模板真的会印出来的分节"喂给模型。
// 喂了模板不印的节,模型在那儿使劲,结果是「AI 说改了但 PDF 一个像素没变」,
// 而排查会先怀疑提示词和模型 —— 一条极贵的假线索。
// 而清单**不许手抄进裁剪逻辑**:§4 的路线是逐套增加 N 套模板,待接的 rireki.sty
//(日文履歴書)消费面与现在三套不同,手抄就会在那天静默出错。
// 所以清单住注册表,由这份测试逐项实测钉住。
//
// 判据是产物本身,不是读代码:
//   · **已声明**的节 → 只填那一节,产物必须比空简历**长**(声明多了会红);
//   · **未声明**的节 → 只填那一节,产物必须与空简历**逐字节相同**(声明漏了会红)。
// 「不更长」不够 —— 换了字节也是消费,所以未声明那一侧比的是全等而不是长度。
//
// renderTex 的入参是**完整 JSON Resume 配置**(它自己会过 normalizeResume + getResumeViewModel),
// 不是已经转好的视图模型 —— 喂视图模型不报错,只会静默得到空日期。
const { TEX_TEMPLATES, DEFAULT_TEMPLATE, templateSections } = await import('../templates/index.mjs');
const { normalizeResume, collectDroppedPaths, EMPTY_RESUME } = await import('../../lib/schema.mjs');

// JSON Resume 标准的顶层节:basics(3 个单例合成的身份块)+ 11 个记录集合。
const STANDARD_SECTIONS = Object.keys(EMPTY_RESUME()).filter((k) => k !== 'meta');

/** 每节一份"只有这一节有内容"的配置。字段名照标准,值都填满以免某个分支没走到。 */
const SAMPLES = {
  basics: {
    basics: {
      name: 'San Zhang',
      label: 'Engineer',
      email: 'a@b.com',
      phone: '13800000000',
      url: 'https://example.com',
      summary: 'Line one.\nLine two.',
      location: { address: '1 Main St', postalCode: '2000', city: 'Sydney', region: 'NSW', countryCode: 'AU' },
      profiles: [{ network: 'GitHub', username: 'x', url: 'https://github.com/x' }],
    },
  },
  work: {
    work: [{
      name: 'Acme', location: 'Sydney', description: 'Software', position: 'Dev',
      url: 'https://acme.example.com', startDate: '2019-06', endDate: '2021-03',
      summary: 'Did stuff.', highlights: ['Shipped X'],
    }],
  },
  volunteer: {
    volunteer: [{
      organization: 'Red Cross', position: 'Helper', url: 'https://redcross.example.com',
      startDate: '2018-01', endDate: '2018-06', summary: 'Helped.', highlights: ['Helped more'],
    }],
  },
  education: {
    education: [{
      institution: 'Uni', url: 'https://uni.example.com', area: 'CS', studyType: 'BSc',
      startDate: '2015-09', endDate: '2019-06', score: '3.9', courses: ['Algorithms'],
    }],
  },
  awards: { awards: [{ title: 'Best Dev', date: '2020-05', awarder: 'Acme', summary: 'For work.' }] },
  certificates: { certificates: [{ name: 'AWS SA', date: '2021-02', url: 'https://aws.example.com', issuer: 'Amazon' }] },
  publications: {
    publications: [{
      name: 'A Paper', publisher: 'ACM', releaseDate: '2020-01',
      url: 'https://acm.example.com', summary: 'Abstract.',
    }],
  },
  skills: { skills: [{ name: 'Backend', level: 'Advanced', keywords: ['Go', 'Rust'] }] },
  languages: { languages: [{ language: 'English', fluency: 'Native' }] },
  interests: { interests: [{ name: 'Hiking', keywords: ['Alps'] }] },
  references: { references: [{ name: 'Jane Doe', reference: 'Great engineer.' }] },
  // type 刻意**不是** 'portfolio':那个值走 vm.portfolio(作品集),与 vm.projects 是两条路。
  projects: {
    projects: [{
      name: 'Proj', description: 'A project.', highlights: ['Won'], keywords: ['Go'],
      startDate: '2020-01', endDate: '2020-12', url: 'https://p.example.com',
      roles: ['Lead'], entity: 'Acme', type: 'application',
    }],
  },
};

test('夹具覆盖每个标准分节 —— 漏一节,那一节的两侧对账都会变成空跑', () => {
  expect(Object.keys(SAMPLES).sort()).toEqual([...STANDARD_SECTIONS].sort());
});

test('夹具的每个值都活过 normalizeResume —— 否则"没变长"证明不了模板不消费', () => {
  for (const [section, sample] of Object.entries(SAMPLES)) {
    const dropped = collectDroppedPaths(sample, normalizeResume(sample));
    expect({ section, dropped }).toEqual({ section, dropped: [] });
  }
});

describe.each(Object.keys(TEX_TEMPLATES))('%s 的 sections 声明', (id) => {
  const entry = TEX_TEMPLATES[id];
  const declared = entry.sections;
  const empty = entry.renderTex({});

  test('声明存在、只含标准节、无重复', () => {
    expect(Array.isArray(declared)).toBe(true);
    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(declared).size).toBe(declared.length);
    for (const s of declared) expect(STANDARD_SECTIONS).toContain(s);
  });

  test.each(STANDARD_SECTIONS)('%s', (section) => {
    const out = entry.renderTex(SAMPLES[section]);
    if (declared.includes(section)) {
      // 声明了就得印:产物比空简历长。
      expect(out.length).toBeGreaterThan(empty.length);
    } else {
      // 没声明就一个字节都不许动 —— 换字节(而非变长)同样是消费。
      expect(out).toBe(empty);
    }
  });
});

describe('templateSections', () => {
  test('返回该模板声明的那一份', () => {
    for (const [id, entry] of Object.entries(TEX_TEMPLATES)) {
      expect(templateSections(id)).toEqual(entry.sections);
    }
  });

  test('认不出的 id 回落默认模板 —— 与 resolveTemplate 同一口径,否则裁剪清单会与真正编译的模板错位', () => {
    for (const bad of ['us-ats', '', null, undefined, 'nope']) {
      expect(templateSections(bad)).toEqual(TEX_TEMPLATES[DEFAULT_TEMPLATE].sections);
    }
  });

  test('给的是副本 —— 调用方改它改不到注册表', () => {
    // 哨兵故意不是任何真节名:拿真节名当哨兵,这条会在"那一节将来真被声明"时误红。
    const before = [...TEX_TEMPLATES[DEFAULT_TEMPLATE].sections];
    templateSections(DEFAULT_TEMPLATE).push('__sentinel__');
    expect(TEX_TEMPLATES[DEFAULT_TEMPLATE].sections).toEqual(before);
  });
});
