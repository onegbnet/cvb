/** @jest-environment node */
// 定向裁剪的契约(app/apply/slots.mjs + app/apply/tailor.mjs)。
//
// 这一套盯的是**结构性护栏**,不是模型行为:模型是随机的、还会换池,
// 唯一能永久成立的保证是「它编造的东西落不进任何地方」。
// 每条否定式断言都配一条肯定式对照 —— 只验"编造的落不进去",
// 一个把所有东西都丢掉的实现也能全绿。
const S = await import('../slots.mjs');
const T = await import('../tailor.mjs');

const FACTS = () => ({
  basics: {
    name: 'San Zhang',
    label: '后端工程师',
    summary: '',
    location: { city: '深圳市', region: '广东省', countryCode: 'CN' },
    profiles: [],
  },
  work: [
    { name: '甲公司', position: '高级后端工程师', startDate: '2021-03',
      description: '甲公司做电商与支付。', summary: '负责核心交易系统。',
      highlights: ['把 P99 从 800ms 降到 120ms', '带 4 人小组', '写了灰度发布工具'] },
    { name: '乙公司', position: '后端工程师', startDate: '2018-06', endDate: '2021-02',
      highlights: ['维护订单服务'] },
    { name: '丙公司', position: '数据工程师', startDate: '2016-07', endDate: '2018-05',
      highlights: ['搭了第一条 ETL 流水线'] },
  ],
  education: [{ institution: '某大学', area: '计算机科学', studyType: '本科', startDate: '2012-09', endDate: '2016-06' }],
  skills: [{ name: '后端', level: '精通', keywords: ['Go', 'Java', 'Kafka'] }],
  languages: [{ language: 'English', fluency: 'Professional' }],
  references: [{ name: '某某', reference: '共事三年,推荐。' }],
  projects: [], awards: [], certificates: [], publications: [], volunteer: [], interests: [], meta: {},
});

describe('可写槽 —— 名称与资历断言在结构上就碰不到', () => {
  test('散文槽可写(肯定式对照,防止"全判假"也能过)', () => {
    for (const p of ['basics.summary', 'work.0.summary', 'work.0.description', 'work.0.highlights.2',
      'projects.1.description', 'awards.0.summary', 'publications.0.summary', 'volunteer.0.summary']) {
      expect({ p, ok: S.isWritableSlot(p) }).toEqual({ p, ok: true });
    }
  });

  test('**资历与机构断言一律只读**(用户 2026-08-26 裁定)', () => {
    // 实测背景:同一份数据上 claude-sonnet-5 两次里有一次把 8 个雇主/院校名全译成英文。
    // 简历上写一个不存在的雇主是硬伤,而提示词挡不住 —— 只能在结构上拿掉。
    for (const p of ['work.0.name', 'work.0.position', 'education.0.institution', 'education.0.studyType',
      'education.0.area', 'awards.0.awarder', 'certificates.0.issuer', 'certificates.0.name',
      'languages.0.fluency', 'skills.0.level', 'skills.0.name', 'basics.label']) {
      expect({ p, writable: S.isWritableSlot(p) }).toEqual({ p, writable: false });
    }
  });

  test('日期 / URL / 邮箱 / 姓名 / 国家码 / meta 连表都不在,自然只读', () => {
    for (const p of ['basics.name', 'basics.email', 'basics.url', 'basics.location.city',
      'basics.location.countryCode', 'work.0.startDate', 'work.0.endDate', 'work.0.url',
      'projects.0.type', 'education.0.score', 'meta.version', 'references.0.name']) {
      expect({ p, writable: S.isWritableSlot(p) }).toEqual({ p, writable: false });
    }
  });

  test('别人写的话不许改写 —— references.reference 是第三方陈述', () => {
    expect(S.isWritableSlot('references.0.reference')).toBe(false);
  });

  test('关键词可丢不可改写(改写 Go→Golang 是翻译,不是裁剪)', () => {
    expect(S.isWritableSlot('skills.0.keywords.1')).toBe(false);
    expect(S.droppableLists('skills')).toContain('keywords');
    expect(S.droppableLists('work')).toContain('highlights');
  });

  test('形状不对的路径一概判假', () => {
    for (const p of ['', null, 'work', 'work.x.summary', 'work.0', 'work.0.highlights',
      'work.0.highlights.x', 'nosuch.0.summary', 'basics']) {
      expect({ p: String(p), writable: S.isWritableSlot(p) }).toEqual({ p: String(p), writable: false });
    }
  });
});

describe('collectTailorFacts —— 送出去的键集就是模型唯一能写的键集', () => {
  test('只送这套模板真会印的分节', () => {
    const all = T.collectTailorFacts(FACTS());
    const only = T.collectTailorFacts(FACTS(), { sections: ['basics', 'work'] });
    expect(Object.keys(all.records)).toEqual(expect.arrayContaining(['work', 'education', 'skills']));
    expect(Object.keys(only.records)).toEqual(['work']);
    expect(Object.keys(only.slots).every((p) => p.startsWith('basics.') || p.startsWith('work.'))).toBe(true);
  });

  test('**空的自我评价也送**(用户裁定:当地规范点名要求 Personal Statement)', () => {
    const { slots } = T.collectTailorFacts(FACTS());
    expect(slots['basics.summary']).toBe('');
  });

  test('**别的空槽不送** —— 让模型"补"一段没写过的职责概述就是凭空编造', () => {
    const cfg = FACTS();
    cfg.work[1].summary = '';
    const { slots } = T.collectTailorFacts(cfg);
    expect('work.1.summary' in slots).toBe(false);
    expect('work.0.summary' in slots).toBe(true); // 肯定式对照
  });

  test('记录摘要只读,带得出标签与时段(给模型排相关性用)', () => {
    const { records } = T.collectTailorFacts(FACTS());
    expect(records.work[0]).toEqual({ i: 0, label: '甲公司 · 高级后端工程师', period: '2021-03~', lists: { highlights: 3 } });
    // **只读的可丢数组要把值给出来** —— 只给条数,模型就不知道哪一条是哪一条。
    // 2026-08-26 真机上「把 Kafka 从技能里去掉」正是这样落空的。
    expect(records.skills[0].lists).toEqual({ keywords: ['Go', 'Java', 'Kafka'] });
    expect(records.work.map((r) => r.i)).toEqual([0, 1, 2]);
  });
});

describe('normalizeTailorPlan —— 结构不靠模型自觉', () => {
  const run = (raw) => T.normalizeTailorPlan(raw, FACTS());

  test('编造的容器 / 越界 / 重复 / 非整数各带对的理由', () => {
    const { plan, dropped } = run({
      keep: { nosuch: [0], work: [0, 0, 2, 9, 1.5], 'work.0.highlights': [0, 2] },
      text: {},
    });
    const by = Object.fromEntries(dropped.map((d) => [d.path, d.reason]));
    expect(by.nosuch).toBe('unknown-container');
    expect(by['work[9]']).toBe('index-out-of-range');
    expect(by['work[0]']).toBe('duplicate-index');
    expect(by['work[1.5]']).toBe('not-an-integer');
    expect(plan.keep.work).toEqual([0, 2]); // 肯定式对照:合法的留下了
    expect(plan.keep['work.0.highlights']).toEqual([0, 2]);
    for (const d of dropped) expect(T.DROP_REASONS).toContain(d.reason);
  });

  test('**清洗剩下空的 ≠ 清空这一节** —— 全非法的 keep 整条丢掉,那一节原样不动', () => {
    // 模型说 work:[9] 的意思是"留第 9 条",不是"一条都不留"。
    // 照单收下就把整节删了 —— 这条设计的出错方向必须是「没裁到」而不是「毁数据」。
    const { plan, dropped } = run({ keep: { work: [9] }, text: {} });
    expect('work' in plan.keep).toBe(false);
    expect(dropped.map((d) => d.reason)).toContain('bad-value');
    const after = T.applyTailorPlan(FACTS(), plan);
    expect(after.work).toHaveLength(3);
  });

  test('模型本来就给 `[]` 才是显式清空(与上一条的对照)', () => {
    const { plan } = run({ keep: { references: [] }, text: {} });
    expect(plan.keep.references).toEqual([]);
    expect(T.applyTailorPlan(FACTS(), plan).references).toEqual([]);
  });

  test('分节缺席 = 整节原样保留(模型最自然的回法就是只谈 work)', () => {
    const { plan } = run({ keep: { work: [0] }, text: {} });
    const after = T.applyTailorPlan(FACTS(), plan);
    expect(after.work).toHaveLength(1);
    expect(after.education).toHaveLength(1);
    expect(after.skills).toHaveLength(1);
    expect(after.languages).toHaveLength(1);
  });

  test('编造的路径与只读字段一个都落不进去', () => {
    const { plan, dropped } = run({
      keep: {},
      text: {
        'work.0.name': 'Company A',
        'work.0.startDate': '2020-01',
        'basics.name': 'John Smith',
        'languages.0.fluency': 'Native',
        'work.9.summary': '不存在的记录',
        'projects.0.description': '不存在的记录',
        'work.0.summary': '主导核心交易系统。',
      },
    });
    expect(Object.keys(plan.text)).toEqual(['work.0.summary']); // 肯定式对照
    const by = Object.fromEntries(dropped.map((d) => [d.path, d.reason]));
    expect(by['work.0.name']).toBe('not-writable');
    expect(by['work.0.startDate']).toBe('not-writable');
    expect(by['basics.name']).toBe('not-writable');
    expect(by['languages.0.fluency']).toBe('not-writable');
    expect(by['work.9.summary']).toBe('unknown-path');
    expect(by['projects.0.description']).toBe('unknown-path');
  });

  test('空串 / 非字符串的改写值不要', () => {
    const { plan, dropped } = run({ keep: {}, text: { 'work.0.summary': '   ', 'work.0.description': 42 } });
    expect(plan.text).toEqual({});
    expect(dropped.every((d) => d.reason === 'bad-value')).toBe(true);
  });

  test('一轮什么都没改 → empty 为真,不让空转伪装成成功', () => {
    expect(run({}).empty).toBe(true);
    expect(run({ keep: { work: [0] } }).empty).toBe(false);
    expect(run({ text: { 'basics.summary': 'x' } }).empty).toBe(false);
  });

  test('note 只给人看,截断到 300 字', () => {
    expect(run({ keep: { work: [0] }, note: 'x'.repeat(400) }).plan.note).toHaveLength(300);
  });
});

describe('applyTailorPlan —— 先按原下标写字,再按原下标做取舍', () => {
  test('取舍 + 排序 + 改写同轮生效,且改写没有落到别人身上', () => {
    // 顺序反了(先过滤后写回)的话,work.2 的改写会落到过滤后的第 2 条(不存在)或错人身上。
    const { plan } = T.normalizeTailorPlan({
      keep: { work: [2, 0] },
      text: { 'work.2.highlights.0': '搭了公司第一条数据流水线', 'work.0.summary': '主导核心交易系统。' },
    }, FACTS());
    const after = T.applyTailorPlan(FACTS(), plan);
    expect(after.work.map((w) => w.name)).toEqual(['丙公司', '甲公司']);
    expect(after.work[0].highlights[0]).toBe('搭了公司第一条数据流水线');
    expect(after.work[1].summary).toBe('主导核心交易系统。');
  });

  test('记录内部的数组逐条丢(cn 一页纸靠这个收得住)', () => {
    const { plan } = T.normalizeTailorPlan({ keep: { 'work.0.highlights': [0, 2] } }, FACTS());
    const after = T.applyTailorPlan(FACTS(), plan);
    expect(after.work[0].highlights).toEqual(['把 P99 从 800ms 降到 120ms', '写了灰度发布工具']);
  });

  test('同一数组里两条改写都落位(赋新数组的反向验证)', () => {
    const { plan } = T.normalizeTailorPlan({
      text: { 'work.0.highlights.0': '甲', 'work.0.highlights.2': '丙' },
    }, FACTS());
    const after = T.applyTailorPlan(FACTS(), plan);
    expect(after.work[0].highlights).toEqual(['甲', '带 4 人小组', '丙']);
  });

  test('**不动入参**,且空计划 = 克隆恒等', () => {
    const before = FACTS();
    const snapshot = JSON.stringify(before);
    const after = T.applyTailorPlan(before, { keep: {}, text: {} });
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(JSON.stringify(after)).toBe(snapshot);
  });

  test('产物里雇主名、日期、姓名一个字节都没变', () => {
    const { plan } = T.normalizeTailorPlan({
      keep: { work: [0, 1] },
      text: { 'basics.summary': '八年后端。', 'work.0.summary': '改过的。' },
    }, FACTS());
    const after = T.applyTailorPlan(FACTS(), plan);
    expect(after.basics.name).toBe('San Zhang');
    expect(after.work.map((w) => w.name)).toEqual(['甲公司', '乙公司']);
    expect(after.work.map((w) => w.startDate)).toEqual(['2021-03', '2018-06']);
    expect(after.education[0].institution).toBe('某大学');
  });
});

describe('差异表与预算', () => {
  test('tailorDiff 报的是**真正没了的那一条**', () => {
    // collectDroppedPaths 按下标 1:1 对齐(前提只对 normalizeResume 成立),
    // work=[甲,乙,丙] 裁成 [甲,丙] 时它会报 work[2] 的值 —— 路径错、值错,
    // 还完全没提到真正没了的「乙公司」。所以裁剪另写比较器。
    const { plan } = T.normalizeTailorPlan({ keep: { work: [0, 2] } }, FACTS());
    const after = T.applyTailorPlan(FACTS(), plan);
    const row = T.tailorDiff(FACTS(), after, plan).find((r) => r.section === 'work');
    expect(row.total).toBe(3);
    expect(row.kept).toBe(2);
    expect(row.droppedRecords).toEqual([{ index: 1, label: '乙公司 · 后端工程师' }]);
  });

  test('重排会被点名', () => {
    const { plan } = T.normalizeTailorPlan({ keep: { work: [2, 0, 1] } }, FACTS());
    const rows = T.tailorDiff(FACTS(), T.applyTailorPlan(FACTS(), plan), plan);
    expect(rows.find((r) => r.section === 'work').reordered).toBe(true);
    const { plan: p2 } = T.normalizeTailorPlan({ keep: { work: [0, 1, 2] } }, FACTS());
    expect(T.tailorDiff(FACTS(), FACTS(), p2).find((r) => r.section === 'work')).toBeUndefined();
  });

  test('改写带 before/after 原文;空槽写出来的那段标成「新增」', () => {
    const { plan } = T.normalizeTailorPlan({
      text: { 'basics.summary': '八年后端。', 'work.0.summary': '主导核心交易系统。' },
    }, FACTS());
    const rows = T.tailorDiff(FACTS(), T.applyTailorPlan(FACTS(), plan), plan);
    const basics = rows.find((r) => r.section === 'basics');
    expect(basics.rewritten[0]).toEqual({ path: 'basics.summary', before: '', after: '八年后端。' });
    expect(T.isNewText(FACTS(), 'basics.summary')).toBe(true);
    expect(T.isNewText(FACTS(), 'work.0.summary')).toBe(false);
  });

  test('指纹认得出事实换过了', () => {
    expect(T.factsFingerprint({ lang: 'zh', updatedAt: 1 })).toBe(T.factsFingerprint({ lang: 'zh', updatedAt: 1 }));
    expect(T.factsFingerprint({ lang: 'zh', updatedAt: 1 })).not.toBe(T.factsFingerprint({ lang: 'zh', updatedAt: 2 }));
    expect(T.factsFingerprint({ lang: 'zh', updatedAt: 1 })).not.toBe(T.factsFingerprint({ lang: 'en', updatedAt: 1 }));
  });

  test('素材预算:超了在客户端就拦下,并说得出是哪一样太大', () => {
    const facts = T.collectTailorFacts(FACTS());
    const ok = T.estimateTailorPayload({ facts, jobText: 'x'.repeat(1000) });
    expect(ok.overBudget).toBe(false);
    const over = T.estimateTailorPayload({ facts, jobText: 'x'.repeat(T.MAX_TAILOR_CHARS + 1) });
    expect(over.overBudget).toBe(true);
    expect(over.biggest).toBe('jobText');
  });
});
