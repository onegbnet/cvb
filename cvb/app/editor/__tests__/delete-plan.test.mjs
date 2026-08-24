/** @jest-environment node */
// 删语种问哪些问题:有问题才问,没问题不问,一个都没有就不该弹框。
const { planDeleteQuestions, snapChoiceToFlags } = await import('../delete-plan.mjs');

const plan = (o) =>
  planDeleteQuestions({ isDefault: false, remainingCount: 3, modified: true, snapshotCount: 0, ...o });

describe('planDeleteQuestions', () => {
  test('没改过 + 无快照 + 非默认 → 一个问题都没有,不弹框', () => {
    expect(plan({ modified: false, snapshotCount: 0 })).toEqual({
      ask: false,
      askDefault: false,
      snapOptions: [],
    });
  });

  test('有历史快照 → 快照三档', () => {
    expect(plan({ snapshotCount: 4 }).snapOptions).toEqual(['keepAll', 'keepFinal', 'wipe']);
  });

  test('改过但没有历史快照 → 只有两档(「保留全部」与「只留删前」本来就等价)', () => {
    expect(plan({ modified: true, snapshotCount: 0 }).snapOptions).toEqual(['keepOne', 'keepNone']);
  });

  test('默认语种:删后剩不止一个才问新默认', () => {
    expect(plan({ isDefault: true, remainingCount: 2 }).askDefault).toBe(true);
    expect(plan({ isDefault: true, remainingCount: 1 }).askDefault).toBe(false); // 那一个自动继任
    expect(plan({ isDefault: true, remainingCount: 0 }).askDefault).toBe(false); // 回空库
    expect(plan({ isDefault: false, remainingCount: 5 }).askDefault).toBe(false);
  });

  test('没改过但要指定新默认 → 仍要弹框(只问那一行)', () => {
    const p = plan({ isDefault: true, remainingCount: 3, modified: false, snapshotCount: 0 });
    expect(p).toEqual({ ask: true, askDefault: true, snapOptions: [] });
  });

  test('没改过但有遗留快照 → 问快照(那些快照是真东西)', () => {
    expect(plan({ modified: false, snapshotCount: 2 }).snapOptions.length).toBe(3);
  });
});

describe('snapChoiceToFlags', () => {
  test('三档映射到服务端的两个开关', () => {
    expect(snapChoiceToFlags('keepAll')).toEqual({ snapshot: true, purge: false });
    expect(snapChoiceToFlags('keepFinal')).toEqual({ snapshot: true, purge: true });
    expect(snapChoiceToFlags('wipe')).toEqual({ snapshot: false, purge: true });
  });

  test('两档(无历史)与「不问」都不给没改过的文档造快照', () => {
    expect(snapChoiceToFlags('keepOne')).toEqual({ snapshot: true, purge: false });
    expect(snapChoiceToFlags('keepNone')).toEqual({ snapshot: false, purge: false });
    expect(snapChoiceToFlags('')).toEqual({ snapshot: false, purge: false });
  });
});
