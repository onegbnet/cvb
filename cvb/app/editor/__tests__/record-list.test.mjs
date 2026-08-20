/** @jest-environment jsdom */
// 排序的常驻回归网。
//
// 这一页**没有手动排序也没有撤销**(CLAUDE.md §8 队列 6),而保存任意一条记录都会
// 对整个集合重排并落库 —— 排错了就回不去。所以这几条必须留在仓里。
//
// 2026-08-19 审计抓到的两个错都在这里钉住:
// ① 勾了「至今」的记录 endDate 是空串,原来它退化成拿 startDate 去跟别人的 endDate 比,
//    结果**还在做的那份工作被排到已经离职的后面**;
// ② '2019' < '2019-03' 是字符串事实不是时间事实,同年只写年份的会被压到年月的后面。
window.T = { 'preview.present': '至今' };
const { sortByDateDesc, recordPeriod } = await import('../record-list.mjs');

const names = (items) => items.map((x) => x.name);

describe('sortByDateDesc', () => {
  it('按结束时间倒序', () => {
    const items = [
      { name: '早期', startDate: '2016-07', endDate: '2019-02' },
      { name: '近期', startDate: '2019-03', endDate: '2024-06' },
    ];
    expect(names(sortByDateDesc(items))).toEqual(['近期', '早期']);
  });

  it('**「至今」排最前** —— 现职不能被排到已离职之后', () => {
    const items = [
      { name: '长期顾问', startDate: '2015-01', endDate: '' },
      { name: '某某科技', startDate: '2019-03', endDate: '2024-06' },
    ];
    expect(names(sortByDateDesc(items, { hasPresent: true }))).toEqual(['长期顾问', '某某科技']);
  });

  it('多条同时进行中:按开始时间倒序互比', () => {
    const items = [
      { name: '旧的兼职', startDate: '2015-01', endDate: '' },
      { name: '新的主业', startDate: '2021-06', endDate: '' },
    ];
    expect(names(sortByDateDesc(items, { hasPresent: true }))).toEqual(['新的主业', '旧的兼职']);
  });

  it('**没有「至今」概念的集合**(院校/证书)不许把空 endDate 当成进行中', () => {
    const items = [
      { name: '只填了入学', startDate: '2012', endDate: '' },
      { name: '完整的一段', startDate: '2016', endDate: '2020' },
    ];
    expect(names(sortByDateDesc(items))).toEqual(['完整的一段', '只填了入学']);
  });

  it('精度不齐按较短的一侧截齐 —— 同年不许因为写法不同而倒置', () => {
    const items = [
      { name: '只写年份', endDate: '2020' },
      { name: '写到月', endDate: '2020-03' },
    ];
    expect(names(sortByDateDesc(items))).toEqual(['只写年份', '写到月']);
  });

  it('一个日期都没有的集合原样返回 —— 别去动用户自己摆的顺序', () => {
    const items = [{ name: 'C' }, { name: 'A' }, { name: 'B' }];
    expect(names(sortByDateDesc(items))).toEqual(['C', 'A', 'B']);
  });

  it('single-date 集合(证书/奖项/发表)用它自己的日期字段', () => {
    const items = [
      { name: '旧证', date: '2018-05' },
      { name: '新证', date: '2023-11' },
    ];
    expect(names(sortByDateDesc(items))).toEqual(['新证', '旧证']);
  });

  it('不改原数组', () => {
    const items = [{ name: 'a', endDate: '2019' }, { name: 'b', endDate: '2024' }];
    const copy = [...items];
    sortByDateDesc(items);
    expect(items).toEqual(copy);
  });
});

describe('recordPeriod', () => {
  it('起止都有就给区间', () => {
    expect(recordPeriod({ startDate: '2019-03', endDate: '2024-06' })).toBe('2019-03 – 2024-06');
  });

  it('没有结束时间就说「至今」', () => {
    expect(recordPeriod({ startDate: '2019-03', endDate: '' })).toBe('2019-03 – 至今');
  });

  it('单日期字段直接印它', () => {
    expect(recordPeriod({ date: '2023-11' })).toBe('2023-11');
    expect(recordPeriod({ releaseDate: '2021-02' })).toBe('2021-02');
  });

  it('一个日期都没有就是空串(列表右端不占位)', () => {
    expect(recordPeriod({ name: 'x' })).toBe('');
  });
});
