// 逐条清单 —— **句子**数组的编辑控件(工作/项目/志愿的亮点、要点)。
// 实现住 ccs `string-list` 模块(2026-08-22 平移,页面以 <script> 挂 `window.StringList`);
// 这里是 cvb 侧的薄封装:注入本站文案(× 的可访问名)与表单控件类(fc-input,
// 让每格吃到本站输入框的边框/圆角/焦点环),API 原样透传。
// 为什么不是芯片、为什么条界只认格子:见 ccs/string-list/client.mjs 与 CLAUDE.md §3
// 「多值字段按内容形态分两种控件」(textarea 里一行一条被判不专业,2026-08-21 用户)。
import { tr } from '../lib/i18n.mjs';

/**
 * @param {object} opts 见 ccs/string-list:{value, placeholder, ariaLabel, onChange}
 * @returns 控件根元素,带 setValues(arr) 供取消回滚 / AI 回填整体重置
 */
export const createStringList = (opts) =>
  window.StringList.create({ deleteLabel: tr('action.delete'), inputClass: 'fc-input', ...opts });
