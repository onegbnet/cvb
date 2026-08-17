// 生成简历(/apply):工具栏(返回/模板切换/导出/下载 PDF) + PDF 渲染。
// **主题面板已删**(2026-08-15):meta.cvb.theme 属于生成侧参数,而三套模板一个都不读它。
//
// **纯 PDF 形态**:HTML 模板层已于 2026-08-14 整体退役,预览只有一条路 ——
// 浏览器端编译 .tex 得到 PDF,交给显示层。引擎闸门关着时如实报错,不再有 HTML 回落。
// 编译约 5s,切模板/调主题都会重编,因此统一走防抖 + 版本号(seq)丢弃过期结果。
//
// PDF 显示层两档(见 app/lib/pdf-view.mjs 文件头的完整降级链):
//   ① PDF.js 画 canvas(默认):无浏览器 PDF 工具栏、背景随站点主题、缩放翻页由
//      我们的工具栏控制 —— Overleaf 那类观感;
//   ② PDF.js 装不上 / 渲染抛错 → 回落 <iframe src=blob:>(浏览器内建阅读器)。
//      回落是一次性的:失败后本次会话直接走 iframe,不每编译一次重试一次。
import { h, clear } from '../lib/dom.mjs';
import { icon } from '../lib/icons.mjs';
import { tr, getLanguage } from '../lib/i18n.mjs';
import {
  normalizeResume,
  loadDefaultResumeConfig,
  exportDataToLocal,
} from '../lib/schema.mjs';
import {
  fetchResume,
  saveResume,
  exportSnapshot,
  isUnauthorized,
  redirectToUnlock,
} from '../lib/api.mjs';
import {
  TEX_TEMPLATES,
  templateGroups,
  resolveTemplate,
  texTemplateMacros,
  texTemplateFonts,
} from '../tex/templates/index.mjs';
import { texEngineAssets } from '../tex/writer.mjs';
import { compileTex, isEngineConfigured, fetchEngineAsset, templateBase } from '../lib/tex-engine.mjs';
import { createPdfView, ZOOM_LIMITS } from '../lib/pdf-view.mjs';

const lang = getLanguage();
document.title = tr('app.previewTitle');

const state = {
  rawConfig: null, // 服务端原始配置(PUT 时用)
  config: null, // 按语言解析后的渲染配置
  template: 'us-ats',
};

// ---- 简历渲染(PDF 单一路) ----

const shellEl = h('div', { class: 'print-resume-shell' });

/** PDF 舞台:canvas 视图 / iframe / 骨架 / 错误块四选一;busy 条覆盖其上,重编时不清空旧 PDF。 */
const pdfStageEl = h('div', { class: 'pdf-stage' });
const pdfBusyTextEl = h('span', { class: 'pdf-busy-text' });
const pdfBusyDetailEl = h('span', { class: 'pdf-busy-detail' });
const pdfBusyEl = h(
  'div',
  { class: 'pdf-busy', hidden: true },
  h('span', { class: 'pdf-busy-spinner' }),
  pdfBusyTextEl,
  pdfBusyDetailEl
);

// 编译约 5s:连点模板下拉 / 拖调色板都会连发,先防抖收敛成一次。
const TEX_RENDER_DEBOUNCE_MS = 400;

const texState = {
  seq: 0, // 请求版本号:过期结果一律丢弃
  timer: null,
  inFlight: null, // 串行化(引擎单实例),避免并发编译
  status: 'idle', // idle | pending | ok | error
  pdfBytes: null,
  pdfUrl: '', // 仅 iframe 路需要(blob URL);canvas 路直接吃字节
  lastLog: '',
  pdfView: null, // createPdfView 实例(canvas 路)
  pdfViewState: null, // 视图回传的 { page, pageCount, zoom, … }
  pdfMode: null, // 'canvas' | 'iframe' | null
  pdfViewFailed: false, // PDF.js 不可用 → 本会话后续直接走 iframe
};

/** 预览一律是 PDF(HTML 层已退役);唯一的前提是引擎配置已注入。 */
const usesTexPath = () => isEngineConfigured();

const createObjectUrl = (blob) => {
  try {
    return URL.createObjectURL(blob);
  } catch {
    return '';
  }
};

const revokeObjectUrl = (url) => {
  try {
    if (url) URL.revokeObjectURL(url);
  } catch {
    /* 忽略:仅内存回收 */
  }
};

function releasePdf() {
  revokeObjectUrl(texState.pdfUrl);
  texState.pdfUrl = '';
  texState.pdfBytes = null;
}

function mountPdfShell() {
  if (shellEl.classList.contains('is-pdf') && shellEl.contains(pdfStageEl)) return;
  clear(shellEl);
  shellEl.classList.add('is-pdf');
  shellEl.append(pdfStageEl, pdfBusyEl);
}

function setPdfBusy(on, { text, detail } = {}) {
  pdfBusyEl.hidden = !on;
  if (text !== undefined) pdfBusyTextEl.textContent = text;
  pdfBusyDetailEl.textContent = detail || '';
}

function destroyPdfView() {
  if (texState.pdfView) {
    try {
      texState.pdfView.destroy();
    } catch {
      /* 仅释放资源 */
    }
  }
  texState.pdfView = null;
  texState.pdfViewState = null;
  texState.pdfMode = null;
}

function showPdfSkeleton() {
  destroyPdfView();
  clear(pdfStageEl);
  pdfStageEl.append(h('div', { class: 'pdf-skeleton' }));
}

/** canvas 视图的宿主(同时是滚动容器);已在场则复用,保住滚动位置不闪。 */
function ensurePdfViewHost() {
  const existing = pdfStageEl.querySelector('.pdf-canvas-host');
  if (existing && texState.pdfView) return existing;
  destroyPdfView();
  clear(pdfStageEl);
  const host = h('div', { class: 'pdf-canvas-host' });
  pdfStageEl.append(host);
  texState.pdfView = createPdfView(host, {
    onStateChange: (s) => {
      texState.pdfViewState = s;
      syncPdfViewControls();
    },
  });
  return host;
}

/** 回落路:浏览器内建阅读器(PDF.js 不可用时才走)。 */
function showPdfIframe(bytes) {
  destroyPdfView();
  revokeObjectUrl(texState.pdfUrl);
  texState.pdfUrl = createObjectUrl(new Blob([bytes], { type: 'application/pdf' }));
  clear(pdfStageEl);
  pdfStageEl.append(
    h('iframe', { class: 'pdf-frame', src: texState.pdfUrl, title: tr('preview.pdf.frameTitle') })
  );
  texState.pdfMode = 'iframe';
}

async function showPdf(bytes, token) {
  revokeObjectUrl(texState.pdfUrl);
  texState.pdfUrl = '';
  texState.pdfBytes = bytes;
  texState.status = 'ok';
  texState.lastLog = '';

  if (!texState.pdfViewFailed) {
    try {
      ensurePdfViewHost();
      setPdfBusy(true, { text: tr('preview.pdf.rendering'), detail: texCompatNote });
      await texState.pdfView.render(bytes);
      if (token !== texState.seq) return; // 期间又重编 → 交给新一轮
      texState.pdfMode = 'canvas';
      setPdfBusy(false);
      syncToolbarMode();
      return;
    } catch (err) {
      if (token !== texState.seq) return;
      // 装载/渲染失败不该白屏也不该报错块:PDF 本身是好的,只是画不出来。
      console.warn('[cvb] PDF.js 显示层不可用,回落 iframe:', err);
      texState.pdfViewFailed = true;
      destroyPdfView();
    }
  }

  if (token !== texState.seq) return;
  showPdfIframe(bytes);
  setPdfBusy(false);
  syncToolbarMode();
}

/** 从 LaTeX 日志里挑人能读的几行(优先 `!` 报错行,否则末尾几行)。 */
function summarizeTexLog(log) {
  const lines = String(log || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const errors = lines.filter((l) => l.startsWith('!') || /^l\.\d+/.test(l));
  const picked = (errors.length ? errors : lines.slice(-4)).slice(0, 4);
  return picked.join(' / ');
}

function showPdfError(title, message, log) {
  texState.status = 'error';
  texState.lastLog = String(log || message || '');
  destroyPdfView();
  releasePdf();
  clear(pdfStageEl);

  const logEl = h('pre', { class: 'pdf-error-log', hidden: true }, texState.lastLog);
  const logBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-small',
      onClick: () => {
        logEl.hidden = !logEl.hidden;
        logBtn.textContent = logEl.hidden ? tr('preview.pdf.viewLog') : tr('preview.pdf.hideLog');
      },
    },
    tr('preview.pdf.viewLog')
  );

  pdfStageEl.append(
    h(
      'div',
      { class: 'pdf-error' },
      h('div', { class: 'pdf-error-title' }, title),
      h('div', { class: 'pdf-error-message' }, message || ''),
      h(
        'div',
        { class: 'pdf-error-actions' },
        logBtn,
        h(
          'button',
          { type: 'button', class: 'btn btn-small', onClick: () => scheduleTexRender() },
          tr('preview.pdf.retry')
        )
      ),
      logEl
    )
  );
  setPdfBusy(false);
  syncToolbarMode();
}

// 引擎降级到主线程后的提示尾巴(编译期间页面会卡,得让用户知道为什么)。
let texCompatNote = '';

function reportTexProgress(e) {
  if (!e) return;
  if (e.phase === 'fallback') {
    // worker 起不来 → 主线程编译:能出 PDF,但几秒到几十秒页面无响应。
    texCompatNote = tr('preview.pdf.compatMode');
    setPdfBusy(true, { text: tr('preview.pdf.engineLoading'), detail: texCompatNote });
  } else if (e.phase === 'wrapper' || e.phase === 'engine') {
    setPdfBusy(true, { text: tr('preview.pdf.engineLoading'), detail: texCompatNote });
  } else if (e.phase === 'download') {
    const pct = typeof e.percent === 'number' ? ` ${e.percent}%` : '';
    setPdfBusy(true, {
      text: e.cached ? tr('preview.pdf.assetCached') : tr('preview.pdf.assetLoading'),
      detail: [`${e.file || ''}${e.cached ? '' : pct}`.trim(), texCompatNote].filter(Boolean).join(' · '),
    });
  } else if (e.phase === 'ready' || e.phase === 'compile') {
    setPdfBusy(true, { text: tr('preview.pdf.compiling'), detail: texCompatNote });
  }
}

async function compileCurrentTemplate(token) {
  const entry = TEX_TEMPLATES[state.template];
  if (!entry || typeof entry.renderTex !== 'function') return;

  let texSource = '';
  let assets = [];
  try {
    const out = entry.renderTex(state.config);
    // 兼容两种返回:纯 .tex 字符串,或 { tex, assets }(CJK 字体/头像等随模板带出)。
    if (out && typeof out === 'object' && typeof out.tex === 'string') {
      texSource = out.tex;
      assets = Array.isArray(out.assets) ? out.assets : [];
    } else {
      texSource = String(out == null ? '' : out);
    }
  } catch (err) {
    showPdfError(tr('preview.pdf.failed'), String((err && err.message) || err), String((err && err.stack) || ''));
    return;
  }

  // 模板宏层(.cls/.sty):住 ccs 的 tex-templates 模块、走 jsDelivr(大陆自动走镜像),
  // 随编译喂进 WASM 的 CWD。**不再占自家资产**(2026-08-17 按 house 原则搬走)。
  // 少了它浏览器里就是 \documentclass{...} 找不到文件 —— 而 Node 冒烟显式传了 .cls,
  // **结构上抓不到这一类**,只有真机才暴露(2026-08-14 实测)。
  try {
    for (const name of texTemplateMacros(state.template)) {
      const res = await fetch(`${templateBase()}/${name}`, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      assets = [...assets, { path: name, content: new Uint8Array(await res.arrayBuffer()) }];
    }
  } catch (err) {
    showPdfError(tr('preview.pdf.failed'), String((err && err.message) || err), '');
    return;
  }
  if (token !== texState.seq) return;
  // 引擎侧资产(CJK 子集字体):renderTex 是同步的、取字节是异步的,所以 .tex 只
  // "自报家门",在这里按名去引擎资产目录取(走同一层缓存,首次之后不再走网络)。
  // 取不到不算致命——照编,让 LaTeX 把缺字报出来,总比整页不出强。
  try {
    // 两个来源取并集:.tex 自报的(anz-tech 那种把字体名写在 .tex 里)+ 注册表显式声明的
    // (上游件把字体声明藏在 vendor 的 .sty 里时,.tex 扫不出来)。
    const needs = [
      ...texEngineAssets(texSource),
      ...texTemplateFonts(state.template).map((f) => ({ path: f, asset: `fonts/${f}` })),
    ].filter((n, i, a) => a.findIndex((x) => x.path === n.path) === i);
    for (const need of needs) {
      const content = await fetchEngineAsset(need.asset, {
        onProgress: (e) => {
          if (token === texState.seq) reportTexProgress(e);
        },
      });
      assets = [...assets, { path: need.path, content }];
    }
  } catch (err) {
    console.warn('[cvb] 引擎字体获取失败,按缺字继续编译', err);
  }
  if (token !== texState.seq) return; // 取字体期间又改了模板 → 丢弃

  try {
    const result = await compileTex(texSource, {
      assets,
      onProgress: (e) => {
        if (token === texState.seq) reportTexProgress(e);
      },
    });
    if (token !== texState.seq) return; // 期间又改了模板/主题 → 丢弃
    if (!result.ok) {
      showPdfError(tr('preview.pdf.failed'), summarizeTexLog(result.log), result.log);
      return;
    }
    await showPdf(result.pdf, token);
  } catch (err) {
    // 基础设施故障(配置缺失 / wrapper 装载 / 引擎初始化)才会抛到这里。
    if (token !== texState.seq) return;
    const code = err && err.code ? ` (${err.code})` : '';
    showPdfError(
      `${tr('preview.pdf.engineFailed')}${code}`,
      String((err && err.message) || err),
      String((err && err.stack) || '')
    );
  }
}

function runTexRender(token) {
  const prev = texState.inFlight;
  const run = (async () => {
    if (prev) {
      try {
        await prev;
      } catch {
        /* 上一次的失败已在 UI 上呈现 */
      }
    }
    if (token !== texState.seq) return; // 等待期间又来了新请求
    await compileCurrentTemplate(token);
  })();
  texState.inFlight = run;
  return run;
}

function scheduleTexRender() {
  mountPdfShell();
  if (!texState.pdfBytes) showPdfSkeleton(); // 已有 PDF 时保留旧页面,只覆盖 busy 条(避免闪白)
  texState.status = 'pending';
  setPdfBusy(true, { text: tr('preview.pdf.compiling') });
  texState.seq += 1;
  const token = texState.seq;
  if (texState.timer) clearTimeout(texState.timer);
  texState.timer = setTimeout(() => {
    texState.timer = null;
    runTexRender(token);
  }, TEX_RENDER_DEBOUNCE_MS);
  syncToolbarMode();
}

function cancelTexRender() {
  if (texState.timer) clearTimeout(texState.timer);
  texState.timer = null;
  texState.seq += 1; // 使在途结果作废
  texState.status = 'idle';
  texState.lastLog = '';
  setPdfBusy(false);
}

function renderResume() {
  if (isEngineConfigured()) {
    scheduleTexRender();
  } else {
    // 引擎闸门关着(TEX_ENGINE_ENABLED=false)。HTML 模板层已整体退役,没有第二条渲染路,
    // 所以这里如实说明,而不是白屏或假装还有回落。
    cancelTexRender();
    destroyPdfView();
    releasePdf();
    mountPdfShell();
    showPdfError(tr('preview.pdf.failed'), tr('preview.pdf.engineOff'), '');
  }
  syncToolbarMode();
}

// ---- PDF 下载 ----

function pdfFileName() {
  const raw = (state.config && state.config.basics && state.config.basics.name) || 'resume';
  const safe =
    String(raw)
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '') || 'resume';
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${safe}-${date}.pdf`;
}

function downloadPdf() {
  if (!texState.pdfBytes) {
    window.Toast && window.Toast.err(tr('preview.pdf.notReady'));
    return;
  }
  const url = texState.pdfUrl || createObjectUrl(new Blob([texState.pdfBytes], { type: 'application/pdf' }));
  const a = h('a', { href: url, download: pdfFileName() });
  a.click();
}

// 主题设置面板已移除:meta.cvb.theme 属于生成侧的呈现参数,且三套模板一个都不读它
//(anz-tech 明确 void 掉 —— 澳新官方要求纯黑字)。改颜色不会改变 PDF,留着就是骗人。

// ---- 打印(Safari 弹窗回退) ----

const shouldUsePrintPopupFallback = () => {
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR|CriOS/i.test(ua);
};

const buildPrintPopupHtml = ({ title, baseUri, styles, content }) => `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <base href="${baseUri}" />
    <title>${title}</title>
    ${styles}
    <style>
      html, body { margin: 0; padding: 0; background: #fff; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .preview-page { min-height: auto; background: #fff; }
      .preview-content { padding: 24px !important; display: flex !important; justify-content: center !important; }
      .print-resume-shell { width: 100%; max-width: 794px !important; margin: 0 auto !important; }
      .print-resume-shell .resume-content { width: 794px !important; max-width: 100% !important; margin: 0 auto !important; }
      .preview-header { display: none !important; }
    </style>
  </head>
  <body>
    <div class="preview-page is-printing">
      <div class="preview-content">
        <div class="print-resume-shell">${content}</div>
      </div>
    </div>
    <script>
      window.addEventListener('load', function () {
        setTimeout(function () { window.focus(); window.print(); }, 80);
      });
      window.addEventListener('afterprint', function () { window.close(); });
    <\/script>
  </body>
</html>`;

function handlePrint(pageEl) {

  if (shouldUsePrintPopupFallback()) {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
        .map((node) => node.outerHTML)
        .join('');
      printWindow.document.open();
      printWindow.document.write(
        buildPrintPopupHtml({
          title: document.title,
          baseUri: document.baseURI,
          styles,
          content: shellEl.innerHTML,
        })
      );
      printWindow.document.close();
      return;
    }
  }

  pageEl.classList.add('is-printing');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => window.print());
  });
}

// ---- 工具栏 ----

// PDF 路与 HTML 路的按钮互斥:PDF 路下「打印」语义与 PDF 阅读器自带打印重复,
// 直接换成「下载 PDF」(下载编译产物);HTML 路维持浏览器打印。
let printItemEl = null;
let pdfItemEl = null;
let pdfBtnEl = null;
// canvas 视图专属控件(iframe 回落路没有:那时缩放翻页归浏览器自带工具栏管)
let pdfViewItemEl = null;
let zoomInBtnEl = null;
let zoomOutBtnEl = null;
let zoomLabelEl = null;
let prevPageBtnEl = null;
let nextPageBtnEl = null;
let pageLabelEl = null;

const EPS = 0.001;

function syncPdfViewControls() {
  if (!pdfViewItemEl) return;
  const on = usesTexPath() && texState.pdfMode === 'canvas' && Boolean(texState.pdfView);
  pdfViewItemEl.hidden = !on;
  if (!on) return;
  const s = texState.pdfViewState || texState.pdfView.getState();
  const zoom = s.zoom || 1;
  const page = s.page || 1;
  const count = s.pageCount || 1;
  zoomLabelEl.textContent = `${Math.round(zoom * 100)}%`;
  zoomInBtnEl.disabled = zoom >= ZOOM_LIMITS.max - EPS;
  zoomOutBtnEl.disabled = zoom <= ZOOM_LIMITS.min + EPS;
  pageLabelEl.textContent = `${page} / ${count}`;
  prevPageBtnEl.disabled = page <= 1;
  nextPageBtnEl.disabled = page >= count;
}

function syncToolbarMode() {
  const tex = usesTexPath();
  if (printItemEl) printItemEl.hidden = tex;
  if (pdfItemEl) pdfItemEl.hidden = !tex;
  // 重编期间仍可下载上一份产物;失败 / 尚未编译出结果时禁用。
  if (pdfBtnEl) pdfBtnEl.disabled = !texState.pdfBytes;
  syncPdfViewControls();
}

function buildPdfViewControls() {
  const iconBtn = (name, key, onClick) =>
    h(
      'button',
      { type: 'button', class: 'btn btn-icon', title: tr(key), 'aria-label': tr(key), onClick },
      icon(name)
    );

  zoomOutBtnEl = iconBtn('zoomOut', 'preview.pdf.zoomOut', () => texState.pdfView.zoomOut());
  zoomInBtnEl = iconBtn('zoomIn', 'preview.pdf.zoomIn', () => texState.pdfView.zoomIn());
  zoomLabelEl = h('span', { class: 'pdf-zoom-label' }, '100%');
  const fitBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-small',
      title: tr('preview.pdf.fitWidth'),
      onClick: () => texState.pdfView.setZoom('fit'),
    },
    tr('preview.pdf.fitWidth')
  );

  prevPageBtnEl = iconBtn('chevronUp', 'preview.pdf.prevPage', () => texState.pdfView.prevPage());
  nextPageBtnEl = iconBtn('chevronDown', 'preview.pdf.nextPage', () => texState.pdfView.nextPage());
  pageLabelEl = h('span', { class: 'pdf-page-label', 'aria-label': tr('preview.pdf.page') }, '1 / 1');

  pdfViewItemEl = h(
    'div',
    { class: 'preview-action-item preview-pdf-view-item', hidden: true },
    h('div', { class: 'pdf-view-controls' }, zoomOutBtnEl, zoomLabelEl, zoomInBtnEl, fitBtn),
    h('div', { class: 'pdf-view-controls' }, prevPageBtnEl, pageLabelEl, nextPageBtnEl)
  );
  return pdfViewItemEl;
}

function buildToolbar(pageEl) {
  const select = h(
    'select',
    {
      class: 'preview-template-select',
      onChange: (e) => {
        state.template = resolveTemplate(e.target.value);
        const url = new URL(window.location.href);
        url.searchParams.set('template', state.template);
        window.history.replaceState({}, '', url.toString());
        renderResume();
      },
    },
    templateGroups().map((group) =>
      h(
        'optgroup',
        { label: tr(`group.${group.id}`) },
        group.templates.map((id) =>
          h('option', { value: id, selected: id === state.template }, tr(`template.${id}`))
        )
      )
    )
  );

  pdfBtnEl = h(
    'button',
    { type: 'button', class: 'btn btn-primary preview-pdf-btn', onClick: () => downloadPdf() },
    icon('download'),
    ` ${tr('preview.pdf.download')}`
  );
  pdfItemEl = h('div', { class: 'preview-action-item preview-pdf-item' }, pdfBtnEl);
  printItemEl = h(
    'div',
    { class: 'preview-action-item preview-print-item' },
    h(
      'button',
      { type: 'button', class: 'btn preview-print-btn', onClick: () => handlePrint(pageEl) },
      icon('printer'),
      ` ${tr('action.print')}`
    )
  );

  const header = h(
    'div',
    { class: 'preview-header' },
    h('a', { class: 'back-link', href: '/edit' }, `← ${tr('action.backToEdit')}`),
    h('span', { class: 'header-title' }, tr('home.apply.title')),
    h(
      'div',
      { class: 'preview-actions' },
      h('div', { class: 'preview-action-item' }, select),
      h(
        'div',
        { class: 'preview-action-item' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: async () => {
              if (!state.rawConfig) {
                window.Toast.err(tr('preview.noData'));
                return;
              }
              exportDataToLocal(JSON.stringify(state.rawConfig, null, 2), 'resume.json');
              try {
                await exportSnapshot();
                window.Toast.ok(tr('preview.snapshotSaved'));
              } catch (err) {
                if (!isUnauthorized(err)) window.Toast.err(String(err.message || err));
              }
            },
          },
          icon('download'),
          ` ${tr('action.export')}`
        )
      ),
      buildPdfViewControls(),
      printItemEl,
      pdfItemEl
    )
  );

  syncToolbarMode();
  return header;
}

// ---- 组装 ----

async function main() {
  state.rawConfig = normalizeResume((await fetchResume()) || (await loadDefaultResumeConfig()));
  state.config = state.rawConfig;

  const urlTemplate = new URLSearchParams(window.location.search).get('template');
  // 模板不再存进简历数据(那是生成侧的选择):URL 参数优先,否则用默认模板
  state.template = resolveTemplate(urlTemplate);

  const app = document.getElementById('app');
  clear(app);

  const pageEl = h('div', { class: 'preview-page' });

  window.addEventListener('beforeprint', () => {
      pageEl.classList.add('is-printing');
  });
  window.addEventListener('afterprint', () => {
    pageEl.classList.remove('is-printing');
  });

  renderResume();

  pageEl.append(buildToolbar(pageEl), h('div', { class: 'preview-content' }, shellEl));
  app.append(pageEl);
}

main().catch((err) => {
  console.error(err);
  window.Toast && window.Toast.err(String(err));
});
