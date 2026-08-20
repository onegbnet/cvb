// 极简 DOM 构建器 — h(tag, attrs, ...children)
// attrs: class / style(对象或字符串) / dataset / on* 事件 / 其余按 attribute 或 property 落。

const PROP_KEYS = new Set(['value', 'checked', 'selected', 'disabled', 'indeterminate']);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);

  for (const [key, val] of Object.entries(attrs || {})) {
    if (val === null || val === undefined || val === false) continue;
    if (key === 'class') {
      el.className = Array.isArray(val) ? val.filter(Boolean).join(' ') : val;
    } else if (key === 'style' && typeof val === 'object') {
      for (const [prop, v] of Object.entries(val)) {
        // **自定义属性必须走 setProperty** —— Object.assign 到 CSSStyleDeclaration 上
        // 对 `--x` 是静默无效的(2026-08-19 踩到:行内编辑的列数怎么设都不生效)。
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    } else if (key === 'dataset' && typeof val === 'object') {
      Object.assign(el.dataset, val);
    } else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (PROP_KEYS.has(key)) {
      el[key] = val;
    } else if (val === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(val));
    }
  }

  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of [].concat(children).flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// 图标是**线性**的(与 app/home/marks.mjs 同族):这里只定 fill/stroke 的取色,
// 线宽与端点交给 CSS 的 .icon svg —— 那是 token(--icon-stroke),不该烤死在 DOM 里。
export function svgIcon(pathMarkup, { size = '1em', viewBox = '0 0 24 24', className = '' } = {}) {
  const wrap = document.createElement('span');
  wrap.className = `icon ${className}`.trim();
  wrap.innerHTML = `<svg viewBox="${viewBox}" width="${size}" height="${size}" fill="none" stroke="currentColor" aria-hidden="true">${pathMarkup}</svg>`;
  return wrap;
}
