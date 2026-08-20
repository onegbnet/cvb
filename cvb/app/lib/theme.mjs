// 主题开关的接线 —— 三个页面共用一处。
//
// ccs 的 theme 模块是个 IIFE:它在**脚本解析时**就去找 `#themeToggle` 并绑事件,
// 而我们的页眉是 JS 渲染的、那时还不存在。所以按钮先放在静态 HTML 里(hidden),
// 渲染完把这个**节点搬进**页眉 —— 搬动不会丢监听器(tinycfw 的抽屉也是这么做的)。
//
// 读取一侧归 worker:它按 `theme` cookie 服务端渲染 `<html data-theme>`,首屏就是对的、不闪。
// 持久化走已有的 `POST /api/prefs`(ccs handlePrefs 本来就同时收 theme 与 lang)。
import { tr } from './i18n.mjs';

/** 取回静态 HTML 里那颗按钮并显示;没有就返回 null(页面没放它,不报错)。 */
export function adoptThemeToggle() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return null;
  btn.hidden = false;
  btn.title = tr('action.toggleTheme', 'Toggle theme');
  return btn;
}
