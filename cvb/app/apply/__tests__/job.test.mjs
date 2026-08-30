/** @jest-environment node */
// 职位信息的纯函数半边:输入形态判定、模型回包归一、由招聘地点推导投递规格。
//
// 这里盯的核心是一条**用户成文的规矩**:「推导文化模板,**多解时让用户手动选**」
// —— 所以恰好一套才自动选,多解与推不出都不许替他决定。
const { looksLikeUrl, normalizeJob, hasJobContent, jobPlaceText, deriveSpec, defaultLangForSpec, JOB_ERROR_KEYS } =
  await import('../job.mjs');
const { APPLY_SPECS } = await import('../specs.mjs');

describe('looksLikeUrl —— 一个框,给的是什么由机器认', () => {
  test('整段只有一条 http(s) 链接才算链接', () => {
    expect(looksLikeUrl('https://au.indeed.com/viewjob?jk=1')).toBe(true);
    expect(looksLikeUrl('  http://example.com/jobs/7  ')).toBe(true);
  });

  test('**正文里带链接不算链接** —— 招聘正文提一句公司官网是常事,那时要读的是正文', () => {
    expect(looksLikeUrl('Senior Engineer at Acme. See https://acme.com for more.')).toBe(false);
    expect(looksLikeUrl('https://acme.com 我们在招人')).toBe(false);
  });

  test('不是链接的一律当正文', () => {
    expect(looksLikeUrl('Senior Frontend Engineer')).toBe(false);
    expect(looksLikeUrl('')).toBe(false);
    expect(looksLikeUrl('ftp://x.com/a')).toBe(false);
    expect(looksLikeUrl('www.example.com/jobs')).toBe(false); // 没有协议头 → 当正文,不猜
  });
});

describe('normalizeJob —— 结构不靠模型自觉', () => {
  test('认得出的字段收下,别的一概不要', () => {
    const job = normalizeJob({
      title: '  Senior Engineer  ',
      org: 'Acme Pty Ltd',
      level: 'Senior',
      remote: true,
      location: { city: 'Sydney', region: 'NSW', country: 'Australia', countryCode: 'au' },
      responsibilities: ['Build things', '', null, 42, 'Ship things'],
      salary: '200k', // 模型自己加的字段
    });
    expect(job).toEqual({
      title: 'Senior Engineer',
      org: 'Acme Pty Ltd',
      level: 'Senior',
      remote: true,
      language: '', // 广告没说是什么语言就留空(**不猜**)
      location: { city: 'Sydney', region: 'NSW', country: 'Australia', countryCode: 'AU' },
      responsibilities: ['Build things', 'Ship things'],
    });
    expect('salary' in job).toBe(false);
  });

  test('countryCode 只认 ISO 两码;别的写法当没给(不猜)', () => {
    for (const bad of ['Australia', 'AUS', 'a', '澳大利亚', 12, null]) {
      expect(normalizeJob({ location: { countryCode: bad } }).location.countryCode).toBe('');
    }
    expect(normalizeJob({ location: { countryCode: 'nz' } }).location.countryCode).toBe('NZ');
  });

  test('回包是垃圾也不炸,得到一份空职位', () => {
    for (const bad of [null, undefined, 'nope', [], 7]) {
      const job = normalizeJob(bad);
      expect(job.title).toBe('');
      expect(job.responsibilities).toEqual([]);
      expect(hasJobContent(job)).toBe(false);
    }
  });

  test('remote 只认真正的 true —— 字符串 "false" 不许变成真', () => {
    expect(normalizeJob({ remote: 'false' }).remote).toBe(false);
    expect(normalizeJob({ remote: 'yes' }).remote).toBe(false);
    expect(normalizeJob({ remote: true }).remote).toBe(true);
  });
});

test('jobPlaceText:有什么写什么,不补也不猜', () => {
  expect(jobPlaceText(normalizeJob({ location: { city: 'Sydney', region: 'NSW', country: 'Australia' } })))
    .toBe('Sydney, NSW, Australia');
  expect(jobPlaceText(normalizeJob({ location: { country: 'China' } }))).toBe('China');
  expect(jobPlaceText(normalizeJob({}))).toBe('');
});

describe('deriveSpec —— 恰好一套才自动选', () => {
  test('唯一一套 → 选它', () => {
    const got = deriveSpec(normalizeJob({ location: { countryCode: 'NZ' } }));
    expect(got).toEqual({ status: 'one', spec: 'nz', candidates: ['nz'] });
  });

  test('**多解不替他选** —— 把候选交回去(将来 cn-tech / au-nsw 就是这种)', () => {
    const specs = [
      { id: 'cn-classic-spec', country: 'CN' },
      { id: 'cn-tech', country: 'CN' },
    ];
    const got = deriveSpec(normalizeJob({ location: { countryCode: 'CN' } }), specs);
    expect(got.status).toBe('many');
    expect(got.candidates).toEqual(['cn-classic-spec', 'cn-tech']);
    expect(got.spec).toBeUndefined(); // 没有"选中的那一个"
  });

  test('广告没写清国家 / 那个国家还没有规格 → 什么都不动', () => {
    expect(deriveSpec(normalizeJob({ location: { city: 'Sydney' } })).status).toBe('none');
    expect(deriveSpec(normalizeJob({ location: { countryCode: 'JP' } })).status).toBe('none');
    expect(deriveSpec(null).status).toBe('none');
  });

  test('现役三套规格都推得到自己(country 字段与 id 对得上)', () => {
    for (const spec of APPLY_SPECS) {
      expect(spec.country).toMatch(/^[A-Z]{2}$/);
      const got = deriveSpec({ location: { countryCode: spec.country } });
      expect(got).toEqual({ status: 'one', spec: spec.id, candidates: [spec.id] });
    }
  });
});

test('四种失败各说各的 —— 不混成一句「失败」', () => {
  const keys = Object.values(JOB_ERROR_KEYS);
  expect(new Set(keys).size).toBeGreaterThanOrEqual(5);
  for (const code of ['JOB_BAD_URL', 'JOB_FETCH_FAILED', 'JOB_NOT_TEXT', 'JOB_EMPTY']) {
    expect(JOB_ERROR_KEYS[code]).toMatch(/^apply\.jobErr/);
  }
});

test('用到的界面键在 en 表里真的存在', async () => {
  const en = (await import('../../i18n/lang/en.mjs')).default;
  const used = [
    'apply.job', 'apply.jobPlaceholder', 'apply.jobReading',
    'apply.jobEmpty', 'apply.jobDerived', 'apply.jobAmbiguous', 'apply.jobNoPlace',
    'apply.jobRemote', 'apply.jobDuties',
    // 职位落库之后的那一组(2026-08-30):芯片行、新建框、卡片
    'apply.jobs', 'apply.jobNew', 'apply.jobName', 'apply.jobNamePh',
    'apply.jobUntitled', 'apply.jobUnread',
    'apply.jobLang', 'apply.willTranslate', 'apply.translatingFacts', 'apply.translateFailed',
    ...Object.values(JOB_ERROR_KEYS),
  ];
  for (const key of used) expect(typeof en[key]).toBe('string');
  expect(en['apply.jobDuties']).toContain('{n}');
  // 两个占位符缺一个就会在界面上原样印出 {from} / {to}
  expect(en['apply.willTranslate']).toContain('{from}');
  expect(en['apply.willTranslate']).toContain('{to}');
  expect(en['apply.translateFailed']).toContain('{lang}');
});

// ---- 2026-08-30 状态穷举时查出来的几条(都是"我自己刚写的代码没走全状态")----

test('hasJobContent 只看 location.country,不看 countryCode —— 这是它的口径,别改', () => {
  // 它是给**模型抽取结果**把关的:只推出来一个国家码不算"读到了内容"。
  // 记下来是因为生成侧曾按它给「最小职位结构」把关,而那个结构只有 countryCode,
  // 于是一条只有 JD、读取又失败的记录被判成"没有职位" —— 指令框摆着、指令被丢掉。
  expect(hasJobContent(normalizeJob({ location: { countryCode: 'NZ' } }))).toBe(false);
  expect(hasJobContent(normalizeJob({ location: { country: 'New Zealand' } }))).toBe(true);
  expect(hasJobContent(normalizeJob({ title: '工程师' }))).toBe(true);
});

test('defaultLangForSpec —— 投递目标给出缺省简历语言,认不出就不猜', () => {
  // **这不是文化规范条目**(所以不在 specs.mjs 里),只是「投这个国家通常用什么
  // 语言写简历」的缺省值,人可以改。
  expect(defaultLangForSpec('nz')).toBe('en');
  expect(defaultLangForSpec('au')).toBe('en');
  expect(defaultLangForSpec('cn')).toBe('zh');
  // 认不出的一律空 —— 同 deriveSpec 那条:推不出来就什么都不动
  for (const bad of ['', null, undefined, 'xx', 'cn-tech']) expect(defaultLangForSpec(bad)).toBe('');
  // 每个现有规格都要有缺省(漏一个就是建职位时语言空着)
  for (const s of APPLY_SPECS) expect(defaultLangForSpec(s.id)).toMatch(/^[a-z]{2}$/);
});

test('广告语言:只认主语言子标签,认不出就留空', () => {
  // **广告是什么语言,简历就用什么语言交**(2026-08-30 用户裁定)——
  // 这个信号直接来自广告,比绕道猜国家可靠:一则英文广告哪怕没写清国家,
  // 也该出英文简历(那次真机上正是国家没推出来、于是出了一份中文简历)。
  expect(normalizeJob({ language: 'EN' }).language).toBe('en');
  expect(normalizeJob({ language: 'zh' }).language).toBe('zh');
  for (const bad of ['English', 'en-NZ', '', null, 42]) {
    expect(normalizeJob({ language: bad }).language).toBe('');
  }
});
