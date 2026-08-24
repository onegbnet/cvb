/** @jest-environment jsdom */
// 顶栏保存状态字样的映射:失败 > 在途 > 干净,三档要判对,i18n 键要真的存在
// (键写错不会报错,只会把裸键名印在页眉上)。
const { saveStatusView } = await import('../save-status.mjs');
const zh = (await import('../../i18n/lang/zh-cn.mjs')).default;
const en = (await import('../../i18n/lang/en.mjs')).default;

describe('saveStatusView', () => {
  it('干净 → 静默(完成确认是事件不是状态,不常驻)', () => {
    expect(saveStatusView({ dirty: false, saving: false, error: '' })).toEqual({
      key: '',
      err: false,
    });
  });

  it('刚落盘的短显窗口里 → 已保存', () => {
    expect(saveStatusView({ dirty: false, saving: false, error: '' }, { savedFlash: true })).toEqual({
      key: 'editor.saveStateSaved',
      err: false,
    });
  });

  it('短显窗口盖不过忙态:窗口里又开始改,照标保存中', () => {
    expect(saveStatusView({ dirty: true, saving: false, error: '' }, { savedFlash: true }).key).toBe(
      'editor.saveStateSaving'
    );
  });

  it('防抖窗口里(dirty、还没发请求)就算保存中 —— 对用户而言"改了没落盘"是一件事', () => {
    expect(saveStatusView({ dirty: true, saving: false, error: '' })).toEqual({
      key: 'editor.saveStateSaving',
      err: false,
    });
  });

  it('请求在途 → 保存中', () => {
    expect(saveStatusView({ dirty: true, saving: true, error: '' })).toEqual({
      key: 'editor.saveStateSaving',
      err: false,
    });
  });

  it('失败盖过在途:退避重试期间也要如实标未保存,成功那一刻才翻回', () => {
    expect(saveStatusView({ dirty: true, saving: true, error: '保存失败' })).toEqual({
      key: 'editor.saveStateFailed',
      err: true,
    });
  });

  it('失败后错误清掉(flushSave 成功)→ 短显已保存,然后静默', () => {
    expect(saveStatusView({ dirty: false, saving: false, error: '' }, { savedFlash: true }).key).toBe(
      'editor.saveStateSaved'
    );
    expect(saveStatusView({ dirty: false, saving: false, error: '' }).key).toBe('');
  });

  it('三个键在两个语言表里都真的存在(静默档的空键不查表)', () => {
    for (const [state, opts] of [
      [{ dirty: false, saving: false, error: '' }, { savedFlash: true }],
      [{ dirty: true, saving: false, error: '' }, undefined],
      [{ dirty: true, saving: false, error: 'x' }, undefined],
    ]) {
      const { key } = saveStatusView(state, opts);
      expect(typeof zh[key]).toBe('string');
      expect(typeof en[key]).toBe('string');
    }
  });
});
