// 首页两张入口大标(内联 SVG)。
//
// 为什么是内联 SVG 而不是图片:自包含(不多一次请求、不受 CDN 影响)、随主题变色
// (统一走 currentColor)、任意分辨率都清晰。与 app/lib/icons.mjs 的小图标同一套
// 线性风格,只是尺寸与信息量更大 —— 那套是按钮里的 16px 记号,这两张是入口的"标"。
//
// 表意刻意区分两个功能的**本质差别**(见 app/home/main.mjs 文件头):
//   编辑事实 = 一份结构化的底稿在被维护 —— 字段行 + 笔;底下的叠层表示"这是底库,
//              是后面所有产出的来源",而不是某一份要投出去的简历。
//   生成简历 = 从那份底稿**派生**出一份成品 —— 左边淡出的源、右边成形的页,
//              中间箭头;右上角的地球表示"按求职地"(这正是本产品的差异化)。
//
// 线宽统一 1.6,圆角端点,不用填充色块 —— 简历产品的调性是专业克制,不是插画感。

const svg = (inner) =>
  `<svg viewBox="0 0 96 96" width="72" height="72" fill="none" xmlns="http://www.w3.org/2000/svg"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true" focusable="false">${inner}</svg>`;

/**
 * 编辑事实:结构化底稿 + 笔;底下两条渐隐的叠层线表示"这是底库,不是某一份成品"。
 * 笔尖落在最后一行的末端(而不是悬在纸外)——表达"正在维护",不是"新建一份"。
 */
export const MARK_EDIT = svg(`
  <rect x="14" y="12" width="46" height="58" rx="5"/>
  <path d="M23 27h28M23 37h28M23 47h20"/>
  <path d="M23 57h12" opacity=".5"/>
  <path d="M75 26.5 82 33.5 60.5 55 51 57.5 53.5 48z"/>
  <path d="M70.5 31 77.5 38" opacity=".65"/>
  <path d="M20 78h44" opacity=".42"/>
  <path d="M26 86h32" opacity=".22"/>
`);

/**
 * 生成简历:同一份事实(左,淡)**派生**出一份成品(右,实),中间是箭头。
 * 成品页内的定位针表示"这一份是冲着某个求职地做的" —— 那正是本产品的差异化
 * (同一份事实,按目的地产出不同的成品)。
 * 几何刻意留出间距:源 6–32、箭头 38–50、成品 56–90,三段互不重叠。
 */
export const MARK_GENERATE = svg(`
  <rect x="6" y="30" width="26" height="38" rx="4" opacity=".38"/>
  <path d="M12 41h14M12 49h14M12 57h9" opacity=".38"/>
  <path d="M38 49h11m0 0-4.5-4.5M49 49l-4.5 4.5"/>
  <rect x="56" y="22" width="34" height="52" rx="5"/>
  <path d="M73 32.5a5 5 0 0 1 5 5c0 3.7-5 9-5 9s-5-5.3-5-9a5 5 0 0 1 5-5z"/>
  <circle cx="73" cy="37.5" r="1.7"/>
  <path d="M63 56h20M63 64h13"/>
`);
