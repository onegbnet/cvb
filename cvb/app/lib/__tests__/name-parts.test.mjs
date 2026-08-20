// 姓名:一个标准字段(`basics.name`),一个**规定的次序**(名 中间名 姓,空格分隔)。
//
// **为什么要规定次序**:存成一个没有边界的串,姓就再也读不出来了 ——
// 「山田太郎」的姓是「山」「山田」「山田太」还是「太郎」?不留边界就只能去收全世界的
// 姓氏库来猜,而复姓、双姓、中间名照样猜不准。留一个空格就把这件事从"猜"变成"读"。
//
// 所以这里最要紧的两条是:**末段一定是姓**,以及**往返恒等**
//(没动过的名字过一遍不许变,否则打开一次编辑器就把人家的名字改了)。
import { splitName, joinName, formatName } from '../name-parts.mjs';

describe('splitName / joinName', () => {
  test('**往返恒等**:拆了再拼,原样不动', () => {
    for (const n of ['太郎 山田', 'San Zhang', 'John Fitzgerald Kennedy',
      'Ludwig van Beethoven', '三 张', '张三', '', '  ']) {
      expect(joinName(splitName(n))).toBe(n.trim().replace(/\s+/g, ' '));
    }
  });

  test('**末段是姓**,首段是名,中间的是中间名 —— 次序是规定的,所以这不是猜', () => {
    expect(splitName('John Fitzgerald Kennedy')).toEqual({ given: 'John', middle: 'Fitzgerald', family: 'Kennedy' });
    expect(splitName('太郎 山田')).toEqual({ given: '太郎', middle: '', family: '山田' });
    expect(splitName('三 张')).toEqual({ given: '三', middle: '', family: '张' });
  });

  test('没有空格就**不猜**:整串当姓', () => {
    // 老数据里的「山田太郎」就是这一档 —— 边界当初没留下,现在也造不出来
    expect(splitName('山田太郎')).toEqual({ given: '', middle: '', family: '山田太郎' });
    expect(splitName('欧阳修').family).toBe('欧阳修');
  });

  test('拼接一律是 名 中间名 姓,空段不留空格', () => {
    expect(joinName({ given: '三', family: '张' })).toBe('三 张');
    expect(joinName({ given: 'San', family: 'Zhang' })).toBe('San Zhang');
    expect(joinName({ given: 'John', middle: 'F', family: 'Kennedy' })).toBe('John F Kennedy');
    expect(joinName({ family: 'Zhang' })).toBe('Zhang');
    expect(joinName({})).toBe('');
    expect(joinName({ given: ' San ', family: ' Zhang ' })).toBe('San Zhang');
  });

  test('**按文化印**是排版侧的事:同一份数据,中文模板印「张三」,英文模板印「San Zhang」', () => {
    expect(formatName('三 张', 'cjk')).toBe('张三');
    expect(formatName('三 张', 'latin')).toBe('三 张');
    expect(formatName('San Zhang', 'latin')).toBe('San Zhang');
    expect(formatName('太郎 山田', 'cjk')).toBe('山田太郎');
    expect(formatName({ given: 'John', middle: 'F', family: 'Kennedy' }, 'cjk')).toBe('KennedyFJohn');
  });

  test('formatName 也吃三段对象,默认按拉丁', () => {
    expect(formatName({ given: 'San', family: 'Zhang' })).toBe('San Zhang');
    expect(formatName('')).toBe('');
  });
});
