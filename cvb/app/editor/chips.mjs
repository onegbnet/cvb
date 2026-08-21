// 芯片输入 —— **词组**数组的编辑控件(技能清单/关键词/课程/角色)。
// 实现住 ccs `chips` 模块(2026-08-22 平移,页面以 <script> 挂 `window.Chips`);
// 这里是 cvb 侧的薄封装:注入本站文案(× 的可访问名),API 原样透传。
// 行为与红线(分隔符集合、半截词失焦不丢、数组永不原地改)见 ccs/chips/client.mjs。
// **句子数组(亮点/要点)不归这里**:句子里就有逗号,芯片化会把一句话剁碎,
// 那类字段用 string-list.mjs 的逐条清单(2026-08-21 用户裁定)。
import { tr } from '../lib/i18n.mjs';

/**
 * @param {object} opts 见 ccs/chips:{value, placeholder, ariaLabel, onChange, onBlur}
 * @returns 控件根元素,带 setValues(arr) 供取消回滚 / AI 回填整体重置
 */
export const createChipsInput = (opts) =>
  window.Chips.create({ deleteLabel: tr('action.delete'), ...opts });
