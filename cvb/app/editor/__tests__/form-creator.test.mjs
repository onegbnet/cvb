/** @jest-environment jsdom */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ccsSandbox = { document, console };
ccsSandbox.window = ccsSandbox;
const ccsContext = vm.createContext(ccsSandbox);
vm.runInContext(readFileSync('/workspace/ccs/re/client.mjs', 'utf8'), ccsContext, { filename: 'ccs/re/client.mjs' });
vm.runInContext(readFileSync('/workspace/ccs/field/client.mjs', 'utf8'), ccsContext, { filename: 'ccs/field/client.mjs' });
globalThis.CCSRe = ccsSandbox.CCSRe;
globalThis.Field = ccsSandbox.Field;
window.CCSRe = ccsSandbox.CCSRe;
window.Field = ccsSandbox.Field;
const { fromDisplay, sanitizeInput, createFormCreator } = await import('../form-creator.mjs');

describe('form creator leaf arrays', () => {
  it('splits lines, removes blank lines, trims edges, and preserves commas', () => {
    expect(fromDisplay({ type: 'lines' }, ' Java, Go\n\n  \t\nKubernetes  \n')).toEqual([
      'Java, Go',
      'Kubernetes',
    ]);
  });

  it('does not split comma-separated values for lines fields', () => {
    expect(fromDisplay({ type: 'lines' }, 'C++, Rust')).toEqual(['C++, Rust']);
  });

});

// 提交模型换过一轮(2026-08-19):原来是"每个字段旁挂 ✓/✕、按一下提交整份表单",
// 现在是**一条记录一次保存** —— 表单底部一对按钮,脏了才能按。
// 换掉的理由见 form-creator.mjs 的注释:那个混血模型是三个丢数据 bug 的共同来源。
describe('form-level save / cancel', () => {
  const fields = [
    {
      type: 'phone', attributeId: 'phone', validate: 'phone', labelKey: 'field.basics.phone',
      options: [{ value: '+86', label: '中国 +86' }, { value: '+1', label: 'United States +1' }],
    },
    { type: 'text', attributeId: 'email', validate: 'email', labelKey: 'field.basics.email' },
  ];

  beforeEach(() => {
    globalThis.tr = (key) => key;
    document.body.innerHTML = '';
  });

  const makeForm = (opts = {}) =>
    createFormCreator({
      fields,
      value: { phone: '+8613812345678', email: 'a@example.com' },
      ...opts,
    });

  const save = (form) => form.querySelector('.form-save');
  const groupFor = (form, key) =>
    [...form.querySelectorAll('.form-group')].find((g) => g.textContent.includes(`field.basics.${key}`));

  it('没改动时保存是禁用的', () => {
    const form = makeForm();
    document.body.append(form);
    expect(save(form).disabled).toBe(true);
  });

  it('改一个字段就解锁保存;点取消复原并重新锁上', () => {
    const form = makeForm();
    document.body.append(form);
    const input = groupFor(form, 'email').querySelector('input[type="text"]');
    input.value = 'changed@example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(save(form).disabled).toBe(false);

    form.querySelector('.form-cancel').click();
    expect(input.value).toBe('a@example.com');
    expect(save(form).disabled).toBe(true);
  });

  it('保存交出整份记录的值', () => {
    let submitted = null;
    const form = makeForm({ onSubmit: (v) => { submitted = v; } });
    document.body.append(form);
    const input = groupFor(form, 'email').querySelector('input[type="text"]');
    input.value = 'new@example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    save(form).click();
    expect(submitted).toEqual({ phone: '+8613812345678', email: 'new@example.com' });
  });

  it('**值不合法时保存不提交**,而是把人带到出问题的那一行', () => {
    let submitted = null;
    const form = makeForm({ onSubmit: (v) => { submitted = v; } });
    document.body.append(form);
    const input = groupFor(form, 'email').querySelector('input[type="text"]');
    input.value = 'not-an-email';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    save(form).click();
    expect(submitted).toBeNull();
    expect(groupFor(form, 'email').querySelector('.fc-error').textContent).toBe('error.email');
  });

  it('电话按 ccs re 的口径归一后再比脏 —— 同一个号码不同写法不算改动', () => {
    const form = makeForm();
    document.body.append(form);
    const number = groupFor(form, 'phone').querySelector('input[type="tel"]');
    number.value = '13812345678';
    number.dispatchEvent(new Event('input', { bubbles: true }));
    expect(save(form).disabled).toBe(true);
  });

  it('hasPendingEdit 跟着脏不脏走(上层靠它拦"改到一半就走人")', () => {
    const form = makeForm();
    document.body.append(form);
    expect(form.hasPendingEdit()).toBe(false);
    const input = groupFor(form, 'email').querySelector('input[type="text"]');
    input.value = 'x@example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(form.hasPendingEdit()).toBe(true);
  });
});
