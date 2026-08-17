// PDF 显示层 —— 用 PDF.js 把 PDF 字节画进 <canvas>(Overleaf 那类观感)。
//
// 为什么不是 <iframe src=blob:…>:iframe 交给浏览器内建阅读器,自带工具栏、
// 自带灰底、缩放/翻页不受控,观感是「网页里嵌了个 PDF 附件」。canvas 路把
// 像素画在我们自己的容器里:无外来工具栏、背景随站点主题、缩放翻页自控,
// 而内容仍与导出的 .pdf 逐像素同源(同一份字节)。
//
// 与引擎解耦:本模块只认 PDF 字节(Uint8Array),不认识 TeX / tex-engine。
//
// ── 依赖形态(同 ccs 的 jsDelivr /npm/ 惯例,不自托管)────────────────────
// npm 包 pdfjs-dist,版本钉在本文件 PDFJS_VERSION 一处;懒加载(只有真的要显示
// PDF 时才拉那 450KB),ESM 动态 import。页面可注入 window.__PDFJS__ 覆盖
// { cdnHost, moduleUrl, workerUrl } —— 给将来 worker 侧按 selectJsdelivrCdnHost
// 派发 CN 镜像用(同 tex-engine 的注入路数),平时不必设。
//
// ── worker 降级链(跨域是这里唯一的坑)──────────────────────────────────
// PDF.js 默认要起一个 pdf.worker,而 `new Worker('https://cdn.jsdelivr.net/…')`
// 会被浏览器以跨域拒绝。三档,从好到差:
//   ① blob-URL worker shim(默认):把 `await import("<CDN worker URL>")` 写进
//      一个 blob,workerSrc 指向该 blob。blob: 与页面同源 → new Worker 放行;
//      worker 内部再跨域 import CDN(jsDelivr 带 CORS 头,可行)。
//      注:pdfjs-dist v4+ 的 worker 是 **ES module**,所以用 `await import(...)`
//      而不是经典 worker 的 importScripts。
//   ② blob 造不出来(无 Blob/URL.createObjectURL、CSP 禁 blob:)→ workerSrc 直接
//      给 CDN URL。PDF.js 内部对跨域 workerSrc 也会做同款 blob 包装,等于退回 ①。
//   ③ 上面都不成 → PDF.js 自己回落 fake worker(主线程 import worker 模块跑解析)。
//      慢但能出图,不需要我们做什么。
//   ④ 连 pdfjs-dist 本体都 import 不到(离线 / CDN 被墙 / 浏览器太老)→ render()
//      抛错,由调用方(app/preview/main.mjs)回落到 iframe 方案。iframe 路因此
//      必须保留,别删。
//
// ── 清晰度 ──────────────────────────────────────────────────────────────
// canvas 的位图尺寸 = CSS 尺寸 × devicePixelRatio,CSS 尺寸只按 fit-width 算;
// 不乘 dpr 的话视网膜屏上文字发虚。超大页再按 MAX_CANVAS_PIXELS 压回去
// (Safari 对单个 canvas 的像素总数有硬上限,超了整块画不出来)。

/* ------------------------------------------------------------------ CDN */

/** pdfjs-dist 版本 —— 全项目唯一钉版处(同 ccs markdown-it-cdn 的做法)。 */
export const PDFJS_VERSION = '6.2.108';

const DEFAULT_CDN_HOST = 'cdn.jsdelivr.net';

const overrides = () =>
  (typeof window !== 'undefined' && window.__PDFJS__ && typeof window.__PDFJS__ === 'object'
    ? window.__PDFJS__
    : {});

const npmFile = (file) =>
  `https://${overrides().cdnHost || DEFAULT_CDN_HOST}/npm/pdfjs-dist@${PDFJS_VERSION}/${file}`;

const moduleUrl = () => overrides().moduleUrl || npmFile('build/pdf.min.mjs');
const workerUrl = () => overrides().workerUrl || npmFile('build/pdf.worker.min.mjs');

// PDF.js 的按需资源:CJK 预定义 CMap、14 款标准字体、解码用 wasm、ICC 配置。
// XeLaTeX 产物基本自带嵌入字体,用不到这几样;但留着以免个别 PDF 掉字。
const resourceUrls = () => ({
  cMapUrl: npmFile('cmaps/'),
  cMapPacked: true,
  standardFontDataUrl: npmFile('standard_fonts/'),
  wasmUrl: npmFile('wasm/'),
  iccUrl: npmFile('iccs/'),
});

/* ---------------------------------------------------------------- 懒加载 */

// 按模块 URL 缓存(而非单例):URL 不变时进程内只 import 一次;
// 测试里换 URL 即天然隔离,不必给测试开后门。
const modulePromises = new Map();

/** 装载 pdfjs-dist 并配好 worker。失败抛错 → 调用方回落 iframe。 */
function loadPdfjs() {
  const url = moduleUrl();
  if (modulePromises.has(url)) return modulePromises.get(url);
  const p = (async () => {
    const mod = await import(/* @vite-ignore */ url);
    const lib = mod && mod.getDocument ? mod : mod && mod.default;
    if (!lib || typeof lib.getDocument !== 'function') {
      throw new Error(`pdfjs-dist 未导出 getDocument(${url})`);
    }
    setupWorker(lib);
    return lib;
  })().catch((err) => {
    modulePromises.delete(url); // 失败不粘住,下次(换网/重试)还能再来
    throw err;
  });
  modulePromises.set(url, p);
  return p;
}

/** 见文件头「worker 降级链」①②;③ 由 PDF.js 自己兜。 */
function setupWorker(lib) {
  const opts = lib.GlobalWorkerOptions;
  if (!opts) return;
  const url = workerUrl();
  try {
    const shim = `await import(${JSON.stringify(url)});`;
    // 不 revoke:PDF.js 每次建 worker 都要读这个 blob,得活到页面结束。
    opts.workerSrc = URL.createObjectURL(new Blob([shim], { type: 'text/javascript' }));
  } catch {
    opts.workerSrc = url;
  }
}

/* ------------------------------------------------------------------ 常量 */

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;

/** 缩放上下限(工具栏按钮据此置灰,别在两处各写一份)。 */
export const ZOOM_LIMITS = { min: ZOOM_MIN, max: ZOOM_MAX, step: ZOOM_STEP };

const PAGE_GUTTER = 24; // 容器左右留白(与 .pdf-doc padding 对应)
const FALLBACK_WIDTH = 794; // 容器量不出宽度时(未布局)按 A4@96dpi 兜底
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024; // Safari 单 canvas 像素上限
const RESIZE_DEBOUNCE_MS = 200; // 重渲很贵,resize 必防抖
const WIDTH_EPSILON = 2; // 宽度抖动小于此值不重渲

const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** 传给 PDF.js 的字节会被 transfer(detach),必须给副本,否则调用方手里的数组作废。 */
const cloneBytes = (bytes) => {
  if (bytes instanceof Uint8Array) return new Uint8Array(bytes);
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes.slice(0));
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer.slice(0));
  throw new Error('createPdfView.render:需要 Uint8Array/ArrayBuffer');
};

const isCancel = (err) =>
  Boolean(err && (err.name === 'RenderingCancelledException' || /cancel/i.test(String(err.message || ''))));

/* ------------------------------------------------------------------ 主体 */

/**
 * 在 container 内建一个 PDF 画布视图。
 *
 * container 同时是滚动容器与宽度测量基准(fit-width 按它的内容宽算)。
 * 多页纵向连续排布:简历常 1–2 页,连续滚动比翻页器自然;页码仍作为状态
 * 暴露给工具栏(滚动时按视口中线判定当前页)。
 *
 * @param {HTMLElement} container
 * @param {{onStateChange?:(s:object)=>void}} [options]
 * @returns {{render:(bytes:Uint8Array)=>Promise<void>, destroy:()=>void,
 *            setZoom:(z:number|'fit')=>void, nextPage:()=>void, prevPage:()=>void,
 *            getState:()=>object}}
 */
export function createPdfView(container, { onStateChange } = {}) {
  const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);

  const docEl = doc.createElement('div');
  docEl.className = 'pdf-doc';
  container.append(docEl);

  const state = {
    status: 'idle', // idle | loading | ready | error
    page: 1,
    pageCount: 0,
    zoom: 1, // 1 = 适应宽度
    fitWidth: true,
  };

  let pdfDoc = null;
  let loadingTask = null;
  let seq = 0; // 渲染版本号:过期结果一律丢弃(与编译层同一套路)
  let renderTasks = [];
  let pageEls = [];
  let lastWidth = 0;
  let resizeTimer = null;
  let destroyed = false;

  const emit = () => {
    if (typeof onStateChange === 'function') {
      try {
        onStateChange(getState());
      } catch {
        /* 监听方自己的错误不影响渲染 */
      }
    }
  };

  const getState = () => ({ ...state });

  /* -------------------------------------------------------- 尺寸与缩放 */

  const measureWidth = () => {
    const w =
      container.clientWidth ||
      (typeof container.getBoundingClientRect === 'function'
        ? Math.round(container.getBoundingClientRect().width)
        : 0);
    return w > 0 ? w : FALLBACK_WIDTH;
  };

  const dpr = () => {
    const r = win && typeof win.devicePixelRatio === 'number' ? win.devicePixelRatio : 1;
    return r > 0 ? Math.min(r, 4) : 1;
  };

  const cancelRenders = () => {
    for (const t of renderTasks) {
      try {
        t.cancel();
      } catch {
        /* 已结束 */
      }
    }
    renderTasks = [];
  };

  /* ------------------------------------------------------------ 绘制 */

  /** 画一页到新建的 canvas(离屏,画完再整体换上,避免重绘闪白)。 */
  async function paintPage(pageNum, availWidth, token) {
    const page = await pdfDoc.getPage(pageNum);
    if (token !== seq || destroyed) return null;

    const base = page.getViewport({ scale: 1 });
    const fitScale = Math.max(0.05, (availWidth - PAGE_GUTTER) / base.width);
    const cssScale = fitScale * state.zoom;
    const cssViewport = page.getViewport({ scale: cssScale });

    // 位图尺寸乘 dpr(高清);像素总数超上限时按比例回压。
    let ratio = dpr();
    const px = cssViewport.width * cssViewport.height * ratio * ratio;
    if (px > MAX_CANVAS_PIXELS) ratio *= Math.sqrt(MAX_CANVAS_PIXELS / px);
    const renderViewport = page.getViewport({ scale: cssScale * ratio });

    const canvas = doc.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.width = Math.max(1, Math.floor(renderViewport.width));
    canvas.height = Math.max(1, Math.floor(renderViewport.height));
    canvas.style.width = `${Math.floor(cssViewport.width)}px`;
    canvas.style.height = `${Math.floor(cssViewport.height)}px`;

    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) throw new Error('canvas 2d context 不可用');

    const task = page.render({ canvasContext: ctx, viewport: renderViewport });
    renderTasks.push(task);
    try {
      await task.promise;
    } catch (err) {
      if (!isCancel(err)) throw err;
      return null;
    }
    if (token !== seq || destroyed) return null;

    const wrap = doc.createElement('div');
    wrap.className = 'pdf-page';
    wrap.dataset.page = String(pageNum);
    wrap.append(canvas);
    return wrap;
  }

  /** 重画全部页面。失败抛出 → 调用方决定回落。 */
  async function paintAll(token) {
    const availWidth = measureWidth();
    lastWidth = availWidth;
    cancelRenders();

    const wraps = [];
    for (let i = 1; i <= state.pageCount; i++) {
      const wrap = await paintPage(i, availWidth, token);
      if (token !== seq || destroyed) return;
      if (wrap) wraps.push(wrap);
    }
    if (token !== seq || destroyed) return;

    while (docEl.firstChild) docEl.removeChild(docEl.firstChild);
    for (const w of wraps) docEl.append(w);
    pageEls = wraps;
  }

  /* ------------------------------------------------------ 页码 / 滚动 */

  const syncCurrentPage = () => {
    if (!pageEls.length) return;
    const mid = (container.scrollTop || 0) + (container.clientHeight || 0) / 2;
    let current = 1;
    for (let i = 0; i < pageEls.length; i++) {
      if ((pageEls[i].offsetTop || 0) <= mid) current = i + 1;
    }
    if (current !== state.page) {
      state.page = current;
      emit();
    }
  };

  const goToPage = (n) => {
    const target = Math.min(Math.max(1, n), Math.max(1, state.pageCount));
    state.page = target;
    const el = pageEls[target - 1];
    if (el && typeof container.scrollTo === 'function') {
      container.scrollTo({ top: el.offsetTop || 0, behavior: 'smooth' });
    } else if (el) {
      container.scrollTop = el.offsetTop || 0;
    }
    emit();
  };

  /* ----------------------------------------------------------- resize */

  const onResize = () => {
    if (destroyed || state.status !== 'ready') return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (destroyed || !pdfDoc || !state.fitWidth) return;
      if (Math.abs(measureWidth() - lastWidth) < WIDTH_EPSILON) return;
      const token = ++seq;
      paintAll(token).catch(() => {
        /* 重排失败:保留上一版画面,不降级整块视图 */
      });
    }, RESIZE_DEBOUNCE_MS);
  };

  let resizeObserver = null;
  if (win && typeof win.ResizeObserver === 'function') {
    resizeObserver = new win.ResizeObserver(onResize);
    resizeObserver.observe(container);
  } else if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('resize', onResize);
  }
  container.addEventListener('scroll', syncCurrentPage, { passive: true });

  /* -------------------------------------------------------------- API */

  async function render(pdfBytes) {
    const token = ++seq;
    state.status = 'loading';
    emit();

    const lib = await loadPdfjs(); // 抛 → 调用方回落 iframe
    if (token !== seq || destroyed) return;

    const prevTask = loadingTask;
    const nextTask = lib.getDocument({ data: cloneBytes(pdfBytes), ...resourceUrls() });
    loadingTask = nextTask;

    let nextDoc;
    try {
      nextDoc = await nextTask.promise;
    } catch (err) {
      if (token === seq) {
        state.status = 'error';
        emit();
      }
      throw err;
    }
    // 旧文档在新文档拿到后再销毁:失败时画面还留着上一版。
    if (prevTask) {
      try {
        prevTask.destroy();
      } catch {
        /* ignore */
      }
    }
    if (token !== seq || destroyed) {
      try {
        nextTask.destroy();
      } catch {
        /* ignore */
      }
      return;
    }

    pdfDoc = nextDoc;
    state.pageCount = nextDoc.numPages || 0;
    state.page = 1;

    try {
      await paintAll(token);
    } catch (err) {
      if (token === seq) {
        state.status = 'error';
        emit();
      }
      throw err;
    }
    if (token !== seq || destroyed) return;

    container.scrollTop = 0;
    state.status = 'ready';
    emit();
  }

  function setZoom(z) {
    if (z === 'fit') {
      state.fitWidth = true;
      state.zoom = 1;
    } else {
      const next = clampZoom(Number(z) || 1);
      if (next === state.zoom && !state.fitWidth) return;
      state.fitWidth = false;
      state.zoom = next;
    }
    emit();
    if (!pdfDoc || state.status === 'loading') return;
    const token = ++seq;
    paintAll(token).catch(() => {
      /* 缩放重绘失败:保留原画面 */
    });
  }

  function destroy() {
    destroyed = true;
    seq++;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = null;
    cancelRenders();
    if (resizeObserver) {
      try {
        resizeObserver.disconnect();
      } catch {
        /* ignore */
      }
    } else if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('resize', onResize);
    }
    container.removeEventListener('scroll', syncCurrentPage);
    if (loadingTask) {
      try {
        loadingTask.destroy();
      } catch {
        /* ignore */
      }
    }
    loadingTask = null;
    pdfDoc = null;
    pageEls = [];
    if (docEl.parentNode) docEl.parentNode.removeChild(docEl);
  }

  return {
    render,
    destroy,
    setZoom,
    zoomIn: () => setZoom(state.zoom * ZOOM_STEP),
    zoomOut: () => setZoom(state.zoom / ZOOM_STEP),
    nextPage: () => goToPage(state.page + 1),
    prevPage: () => goToPage(state.page - 1),
    getState,
  };
}
