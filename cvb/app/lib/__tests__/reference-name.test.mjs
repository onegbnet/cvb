/** @jest-environment node */
// 推荐人那一栏的拆与拼:`Name, Contact (Identity)`(2026-08-30 用户定的格式)。
//
// 第一条是**往返恒等** —— 与 name-parts 同一条纪律:没动过的值过一遍必须一字节不差。
// 老数据用的是全角括号,打开一次编辑器就被改写成半角是**静默改数据**。
const { splitReferenceName, formatReferenceName } = await import('../reference-name.mjs');

describe('往返恒等 —— 没动过的值一字节不差', () => {
  const cases = [
    '张代君（盛大创新院时，意法爱立信中国区总裁，我负责项目的客户 - 盛大手机芯片供应商）',
    'Carl Joseph Giardina（惠普中国时，任Notebook, Quality, Global 总监，我的上司）',
    '张代君, zhang@example.com (盛大创新院，意法爱立信中国区总裁)',
    '没有括号的人',
    '范德成, 13800000000',
    '',
  ];
  for (const raw of cases) {
    it(JSON.stringify(raw.slice(0, 24)), () => {
      expect(formatReferenceName(splitReferenceName(raw))).toBe(raw);
    });
  }
});

describe('拆', () => {
  it('三段齐全', () => {
    expect(splitReferenceName('张三, a@b.com (某公司 CTO)')).toMatchObject({
      name: '张三', contact: 'a@b.com', identity: '某公司 CTO',
    });
  });

  it('全角括号与全角逗号照认(老数据都是这一档)', () => {
    expect(splitReferenceName('张三，a@b.com（某公司 CTO）')).toMatchObject({
      name: '张三', contact: 'a@b.com', identity: '某公司 CTO',
    });
  });

  it('**只有名字 + 括号**:括号前面整段都是名字,不许硬拆出联系方式', () => {
    // 线上老数据正是这一档 —— 拆错了会把半个名字塞进"联系方式"栏
    expect(splitReferenceName('Carl Joseph Giardina（惠普中国时，任 Global 总监）')).toMatchObject({
      name: 'Carl Joseph Giardina', contact: '', identity: '惠普中国时，任 Global 总监',
    });
  });

  it('身份里带逗号不影响拆分 —— 逗号只在括号外面算数', () => {
    const p = splitReferenceName('张三, a@b.com (前 HP,后 Shanda,共事三年)');
    expect(p.contact).toBe('a@b.com');
    expect(p.identity).toBe('前 HP,后 Shanda,共事三年');
  });

  it('联系方式里带逗号:按**第一个**逗号切,后面整段都是联系方式', () => {
    expect(splitReferenceName('张三, 北京, 13800000000')).toMatchObject({
      name: '张三', contact: '北京, 13800000000',
    });
  });

  it('什么都没有就整串当名字;非字符串当空', () => {
    expect(splitReferenceName('张三')).toMatchObject({ name: '张三', contact: '', identity: '' });
    expect(splitReferenceName(null)).toMatchObject({ name: '', contact: '', identity: '' });
    expect(splitReferenceName(undefined).raw).toBe('');
  });
});

describe('拼', () => {
  it('空的那几段连分隔符一起不出现', () => {
    expect(formatReferenceName({ name: '张三' })).toBe('张三');
    expect(formatReferenceName({ name: '张三', contact: 'a@b.com' })).toBe('张三, a@b.com');
    expect(formatReferenceName({ name: '张三', identity: 'CTO' })).toBe('张三 (CTO)');
    expect(formatReferenceName({ name: '张三', contact: 'a@b.com', identity: 'CTO' }))
      .toBe('张三, a@b.com (CTO)');
  });

  it('只填了名字的人不该看到一个空括号', () => {
    expect(formatReferenceName({ name: '张三', contact: '', identity: '' })).toBe('张三');
    expect(formatReferenceName({ name: '张三', identity: '   ' })).toBe('张三');
  });

  it('改过就按新格式写(半角),没改过才保留原样', () => {
    const p = splitReferenceName('张三（CTO）');
    expect(formatReferenceName(p)).toBe('张三（CTO）'); // 没动
    expect(formatReferenceName({ ...p, identity: 'CEO' })).toBe('张三 (CEO)'); // 动了
  });

  it('两头空白剃掉;整体空就是空串', () => {
    expect(formatReferenceName({ name: '  张三  ', contact: ' a@b.com ' })).toBe('张三, a@b.com');
    expect(formatReferenceName({})).toBe('');
  });
});
