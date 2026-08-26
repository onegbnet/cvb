// 生成简历(/apply)。**2026-08-24 重做**(用户:「把现在的生成简历界面去掉,重新设计」):
// 这一页要按顺序回答三个问题 —— **投到哪里 → 用哪套版式 → 用哪份语种事实**,然后出 PDF。
//
// 「投到哪里」是**投递规格**(app/apply/specs.mjs):国别(将来可细到 国别-职种 /
// 国别-地域),背后对应一份 `culture/<id>.md` 语料。**规格的内容对用户不可见**
// (用户裁定):字体、页数、照片政策这些是机器该遵守的约束,不是摆给求职者读的功课;
// 它在背后决定可选哪几套版式、PDF 文件名怎么起,并将来作为 AI 定向裁剪的当地上下文。
// 换规格时版式跟着换 —— 拿中文模板投澳洲是文化不合规,不是个人偏好。
//
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
import { adoptThemeToggle } from '../lib/theme.mjs';
import { tr, getLanguage } from '../lib/i18n.mjs';
import {
  normalizeResume,
  loadDefaultResumeConfig,
  exportDataToLocal,
} from '../lib/schema.mjs';
import {
  fetchResume,
  saveResume,
  listFactsLangs,
  fetchJobPage,
  isUnauthorized,
  redirectToUnlock,
} from '../lib/api.mjs';
import {
  TEX_TEMPLATES,
  DEFAULT_TEMPLATE,
  resolveTemplate,
  texTemplateMacros,
  texTemplateFonts,
  templateSections,
} from '../tex/templates/index.mjs';
import { APPLY_SPECS, DEFAULT_SPEC, resolveSpec, specById, templateForSpec, pdfFileNameFor } from '../apply/specs.mjs';
import {
  looksLikeUrl,
  normalizeJob,
  hasJobContent,
  jobPlaceText,
  deriveSpec,
  JOB_ERROR_KEYS,
} from '../apply/job.mjs';
import {
  collectTailorFacts,
  normalizeTailorPlan,
  applyTailorPlan,
  tailorDiff,
  estimateTailorPayload,
  isNewText,
} from '../apply/tailor.mjs';
import { runTailor } from '../lib/tailor-client.mjs';
import { extractJobFromText } from '../lib/ai.mjs';
import { splitName } from '../lib/name-parts.mjs';
import { factsLangName } from '../editor/facts-bar.mjs';
import { texEngineAssets } from '../tex/writer.mjs';
import { compileTex, isEngineConfigured, fetchEngineAsset, templateBase } from '../lib/tex-engine.mjs';
import { createPdfView, ZOOM_LIMITS } from '../lib/pdf-view.mjs';

const lang = getLanguage();
document.title = tr('app.previewTitle');

const state = {
  rawConfig: null, // 服务端原始配置(PUT 时用)
  config: null, // 按语言解析后的渲染配置
  spec: DEFAULT_SPEC, // 投到哪里(决定可选版式与文件名惯例)
  template: DEFAULT_TEMPLATE,
  factsLang: '', // 用哪份语种事实(空 = 默认语种)
  langs: [], // 已有事实的语种清单
  jobText: '', // 贴进来的原始输入(职位描述正文 或 一条招聘页链接)
  job: null, // 读出来的结构化职位(normalizeJob 的形状),没读过是 null
  jobBusy: false,
  jobHint: '', // 读完之后如实说一句(推出来了 / 多解 / 没写清国家 / 出错了)

  // ---- 定向裁剪(B 段)----
  // 这几样与职位信息同生命周期:换一则职位、清除职位、换语种都清掉。
  // **一样都不落库**:裁剪结果是一次生成的产物,持久化归 C 段的「简历快照」。
  instructions: '', // 求职者对这个职位的额外指令(第三方输入)
  refs: [], // 参照的其他语种(只作措辞对照,不作事实来源)
  draft: null, // 裁剪后的简历(顶掉 renderTex 的入参;null = 还没裁过,编译原事实)
  plan: null, // 最近一轮的裁剪计划(归一后的)
  chat: [], // [{feedback, note, diff, dropped}] —— 每一轮的交代
  sessionId: '', // mma 会话;轮转时跟随 new_session_id
  tailorBusy: '', // '' | 'tailor' | 'revise'
  tailorChars: 0, // 已收到的字符数(进度)
  tailorHint: '',
};

/**
 * 编译哪一份。**裁剪产物顶掉入参,事实原样留着** —— 换一则职位、改一次设置都要能
 * 退回未裁剪的那份,而且 C 段打包时要的是"事实 + 计划",不是一份揉在一起的东西。
 */
const compileSource = () => state.draft || state.config;

/** 裁剪结果作废:换语种 / 换规格版式 / 换职位之后,计划里的下标就不指着同一份东西了。 */
function clearDraft(reason) {
  if (!state.draft && !state.plan && !state.chat.length) return;
  state.draft = null;
  state.plan = null;
  state.chat = [];
  state.sessionId = '';
  state.tailorHint = reason || '';
}

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

/**
 * 还没编译时的空态。**进页面不自动编译**(2026-08-24 用户裁定:
 * 「提供了足够信息、用户主动触发才做」)—— 编一次要先下几十兆引擎再算几秒,
 * 那是用户说要看才该付的代价,不是打开页面就先付。
 */
function mountPdfPlaceholder() {
  clear(shellEl);
  shellEl.classList.add('is-pdf');
  shellEl.append(h('div', { class: 'pdf-placeholder' }, h('p', {}, tr('preview.pdf.idle'))));
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
  // 模板没登记进注册表就**如实报错**。此前是静默 return:busy 条一直转、
  // 「生成预览」永久禁用、控制台一个字都没有 —— §9 早就写着「模板写完必须登记进
  // TEX_TEMPLATES,否则 PDF 路静默不生效」,那条静默正是从这里来的。
  if (!entry || typeof entry.renderTex !== 'function') {
    setPdfBusy(false);
    texState.status = 'error';
    showPdfError(tr('preview.pdf.failed'), tr('preview.pdf.noTemplate'), state.template);
    syncToolbarMode();
    return;
  }

  let texSource = '';
  let assets = [];
  try {
    const out = entry.renderTex(compileSource());
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
  syncGenerate();
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
  const raw = (state.config && state.config.basics && state.config.basics.name) || '';
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // 文件名也归规格管:nz 官方点名 `名-姓-CV.pdf`,别的规格用「姓名-日期」。
  // 规格不摆在界面上,但确实按当地规矩办事(见 app/apply/specs.mjs)。
  return pdfFileNameFor({ specId: state.spec, nameParts: splitName(raw), fallbackName: raw, date });
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
      header.app-header { display: none !important; }
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
  // 生成按钮的字样与禁用态跟着同一处走 —— 编成/编砸/取消都有出口经过这里
  syncGenerate();
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

/** 一排单选芯片(目标 / 版式 / 语种共用;选中态与 /edit 文档栏同一套语汇)。 */
function chipRow(labelKey, options, current, onPick) {
  const chips = options.map(({ value, text }) =>
    h(
      'button',
      {
        type: 'button',
        // 与 /edit 文档栏**同一个类**:选中态、hover、圆角、间距一次定义,
        // 别在这里复制一份(复制就是发明第二种「被选中」的画法)
        class: ['facts-lang', value === current && 'is-current'],
        'aria-pressed': value === current ? 'true' : 'false',
        onClick: () => value !== current && onPick(value),
      },
      text
    )
  );
  return h(
    'div',
    { class: 'apply-row' },
    h('span', { class: 'apply-row-label' }, tr(labelKey)),
    h('div', { class: 'apply-chips' }, chips)
  );
}

// 职位块推导出投递目标后要刷新芯片行 —— 由 buildSelectionBar 装上自己的重绘。
let rebuildSelection = () => {};

// 「已有 PDF,但设置改过了」—— 不自动重编,只把按钮改口成「重新生成」,
// 旧那份继续摆着(它仍是一份真产物,只是不对应当前设置了)。
let generateBtnEl = null;
let staleHintEl = null;
let stale = false;

const syncGenerate = () => {
  if (generateBtnEl) {
    // 三档:还没裁过且读了职位 →「生成初版简历」;裁过 / 没职位 → 生成或重新生成
    generateBtnEl.textContent = state.tailorBusy
      ? tr('apply.tailoring')
      : state.job && !state.draft
        ? tr('apply.generateTailored')
        : texState.pdfBytes
          ? tr('preview.pdf.regenerate')
          : tr('preview.pdf.generate');
    generateBtnEl.disabled = texState.status === 'pending' || Boolean(state.tailorBusy);
  }
  if (staleHintEl) staleHintEl.hidden = !(stale && texState.pdfBytes);
};

function markStale() {
  stale = true;
  syncGenerate();
}

/** 把当前选择写回 URL —— 刷新/分享链接回到同一套设置(模板此前就是这么做的)。 */
function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('spec', state.spec);
  url.searchParams.set('template', state.template);
  if (state.factsLang) url.searchParams.set('flang', state.factsLang);
  else url.searchParams.delete('flang');
  window.history.replaceState({}, '', url.toString());
}

/**
 * 选择区:**投到哪里 → 用哪套版式 → 用哪份语种事实**。
 * 三段各一行芯片,顺序即决定顺序 —— 规格换了版式跟着换(不合规的自动回落),
 * 所以规格在最上面。只有一套版式 / 一门语种时那一行不出现:没有选择就别摆控件。
 */
function buildSelectionBar() {
  // 装进与 /edit 同款的卡片(.blk):那一页 15 个分节都在卡片里,
  // 这一页的选择区没有理由是裸的
  const bar = h('div', { class: 'apply-bar' });
  const rebuild = () => {
    clear(bar);
    bar.append(
      chipRow(
        'apply.target',
        APPLY_SPECS.map((s) => ({ value: s.id, text: tr(s.labelKey) })),
        state.spec,
        (v) => {
          state.spec = v;
          state.template = templateForSpec(v, state.template); // 版式跟着规格走
          // 换了投递地就换了一整套当地规范,上一版是按别处的规矩裁的
          clearDraft(tr('apply.draftStale'));
          syncUrl();
          markStale();
          rebuild();
          rebuildTailor();
        }
      )
    );
    const templates = specById(state.spec).templates;
    if (templates.length > 1) {
      bar.append(
        chipRow(
          'apply.layout',
          templates.map((id) => ({ value: id, text: tr(`template.${id}`) })),
          state.template,
          (v) => {
            state.template = v;
            // 版式换了,模板消费的分节也可能换 —— 上一版裁的是另一套分节
            clearDraft(tr('apply.draftStale'));
            syncUrl();
            markStale();
            rebuild();
            rebuildTailor();
          }
        )
      );
    }
    if (state.langs.length > 1) {
      bar.append(
        chipRow(
          'apply.facts',
          state.langs.map(({ lang: code }) => ({ value: code, text: factsLangName(code) })),
          state.factsLang,
          async (v) => {
            state.factsLang = v;
            state.refs = state.refs.filter((code) => code !== v); // 参照不能是它自己
            // 换了语种,计划里的下标就不指着同一份文档了 —— 作废,如实说一句
            clearDraft(tr('apply.draftStale'));
            syncUrl();
            markStale();
            rebuild();
            rebuildTailor();
            await loadFacts();
          }
        )
      );

      // **参照语种**(用户成文的「默认参照同语种,可指定参照多语种」)。
      // 只在**读过职位**之后出现 —— 它的唯一消费方是裁剪;没有裁剪就是个空控件。
      // 只作**措辞对照**,不作事实来源:那是另一份文档,内容未必对得上。
      if (state.job) {
        const others = state.langs.filter(({ lang: code }) => code !== state.factsLang);
        if (others.length) {
          bar.append(
            h(
              'div',
              { class: 'apply-row' },
              h('span', { class: 'apply-row-label' }, tr('apply.refs')),
              h(
                'div',
                { class: 'apply-chips' },
                ...others.map(({ lang: code }) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      class: ['facts-lang', state.refs.includes(code) && 'is-current'],
                      'aria-pressed': state.refs.includes(code) ? 'true' : 'false',
                      onClick: async () => {
                        if (state.refs.includes(code)) state.refs = state.refs.filter((x) => x !== code);
                        else {
                          state.refs = [...state.refs, code];
                          await loadRefDoc(code);
                        }
                        rebuild();
                      },
                    },
                    factsLangName(code)
                  )
                )
              )
            )
          );
        }
      }
    }
    // **生成是主动动作**:按钮说点了会发生什么,旁边如实说明设置改过了。
    // 读过职位之后它变成「生成初版简历」——**一趟走完裁剪 + 编译**(用户 2026-08-26 裁定:
    // 主动触发讲的是"不点不发生",不是"每件事各点一次")。没读职位就还是纯编译。
    generateBtnEl = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-accent apply-generate',
        onClick: () => {
          if (state.job && !state.draft) {
            runTailorRound({ revise: false });
            return;
          }
          stale = false;
          renderResume();
          syncGenerate();
        },
      },
      tr('preview.pdf.generate')
    );
    staleHintEl = h('span', { class: 'apply-stale', hidden: true }, tr('preview.pdf.stale'));
    bar.append(h('div', { class: 'apply-row apply-actions' }, generateBtnEl, staleHintEl));
    syncGenerate();
  };
  rebuildSelection = rebuild;
  rebuild();
  return h('section', { class: 'blk' }, bar);
}

// ---- 职位信息 ----
//
// 生成侧四步流程的第一步输入(用户 2026-08-24 成文:「事实 + **职位信息**
// (推导文化模板,多解时让用户手动选)+ TeX 模板 → 生成初版简历」)。
//
// **一个框,给的是什么由机器认**(2026-08-25 用户裁定「粘贴文本或输入 URL」;
// 口径同 AI 导入的「不要做两个导入功能组」):看着是链接就让 worker 代拉,
// 否则当职位描述正文。让人先选"我这是链接还是正文"是把实现分类摆到了用户面前。
// 判定与推导都是纯函数,住 app/apply/job.mjs(进 jest);这里只摆控件。
//
// **读取是主动动作**,同「生成预览」那条:贴进来不自动打 AI ——
// 那要花时间也花钱,该由人说一声「读」才发生。
//
// 读出来之后它在这一页做的**唯一一件事是推导投递目标**(→ 决定可选版式与文件名惯例)。
// 恰好一套规格才自动选中;多解或广告里没写清国家就**什么都不动**,如实说一句让人自己选。
// 拿职位去定向裁剪简历是下一段的事(§8 队列 2 的 B 段),这一页还不做,
// 所以界面上也不暗示它做了。
function jobErrorText(err) {
  const key = JOB_ERROR_KEYS[err && err.code];
  return key ? tr(key) : (err && err.message) || tr('ai.failed');
}

/** 读一次职位:链接先代拉成正文 → AI 抽结构 → 归一 → 推导投递目标。 */
async function readJob(rebuild) {
  const raw = String(state.jobText || '').trim();
  if (!raw) {
    state.jobHint = tr('apply.jobEmpty');
    rebuild();
    return;
  }
  state.jobBusy = true;
  state.jobHint = '';
  rebuild();
  try {
    let text = raw;
    if (looksLikeUrl(raw)) {
      const page = await fetchJobPage(raw);
      text = String((page && page.text) || '');
    }
    const job = normalizeJob(await extractJobFromText(text));
    if (!hasJobContent(job)) {
      state.jobHint = tr('apply.jobErrEmpty');
      return;
    }
    state.job = job;
    // 推导投递目标 —— 三种结局各说各的,**只有唯一一套时才替他选**
    const derived = deriveSpec(job);
    if (derived.status === 'one' && derived.spec !== state.spec) {
      state.spec = derived.spec;
      state.template = templateForSpec(state.spec, state.template); // 版式跟着规格走
      syncUrl();
      markStale();
      rebuildSelection();
    }
    state.jobHint =
      derived.status === 'one'
        ? tr('apply.jobDerived')
        : derived.status === 'many'
          ? tr('apply.jobAmbiguous')
          : tr('apply.jobNoPlace');
  } catch (err) {
    if (isUnauthorized(err)) return redirectToUnlock();
    state.jobHint = jobErrorText(err);
  } finally {
    state.jobBusy = false;
    rebuild();
  }
}

function buildJobBlock() {
  const box = h('div', { class: 'apply-bar' });
  const rebuild = () => {
    clear(box);
    box.append(h('h2', { class: 'blk-title' }, tr('apply.job')));

    if (state.job) {
      // 读出来了:摆事实(职位 · 机构 · 职阶 · 地点),不加标签词 ——
      // 一行里每一样都自说明,再各配一个标签只会把行撑满(同快照那一行的判断)
      const loc = jobPlaceText(state.job);
      const meta = [state.job.org, state.job.level, loc, state.job.remote && tr('apply.jobRemote')]
        .filter(Boolean)
        .join(' · ');
      const instr = h('textarea', {
        class: 'fc-input apply-job-input apply-instr',
        rows: 2,
        placeholder: tr('apply.instrPlaceholder'),
        'aria-label': tr('apply.instr'),
        onInput: (e) => { state.instructions = e.target.value; },
      });
      instr.value = state.instructions;
      box.append(
        h(
          'div',
          { class: 'apply-job-card' },
          h('div', { class: 'apply-job-title' }, state.job.title || tr('apply.job')),
          meta && h('div', { class: 'apply-job-meta' }, meta),
          state.job.responsibilities.length
            ? h(
                'div',
                { class: 'apply-job-meta' },
                tr('apply.jobDuties').replace('{n}', String(state.job.responsibilities.length))
              )
            : null
        )
      );
      // 第三方输入:求职者对这个职位的额外指令。**到这一段才摆出来** ——
      // 在裁剪落地之前它没有消费方,那时摆出来就是个不起作用的控件。
      box.append(h('div', { class: 'apply-instr-label' }, tr('apply.instr')), instr);
    } else {
      const input = h('textarea', {
        class: 'fc-input apply-job-input',
        rows: 4,
        placeholder: tr('apply.jobPlaceholder'),
        'aria-label': tr('apply.job'),
        disabled: state.jobBusy || undefined,
        onInput: (e) => {
          state.jobText = e.target.value;
        },
      });
      input.value = state.jobText;
      box.append(input);
    }

    const actions = h('div', { class: 'apply-row apply-actions' });
    if (state.job) {
      actions.append(
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small',
            onClick: () => {
              state.job = null;
              state.jobHint = '';
              clearDraft(tr('apply.draftStale'));
              rebuild();
              rebuildSelection();
              rebuildTailor();
            },
          },
          tr('apply.jobRedo')
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small',
            onClick: () => {
              state.job = null;
              state.jobText = '';
              state.jobHint = '';
              state.instructions = '';
              clearDraft(tr('apply.draftStale'));
              rebuild();
              rebuildSelection();
              rebuildTailor();
            },
          },
          tr('apply.jobClear')
        )
      );
    } else {
      actions.append(
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary',
            disabled: state.jobBusy || undefined,
            onClick: () => readJob(rebuild),
          },
          state.jobBusy ? tr('apply.jobReading') : tr('apply.jobRead')
        )
      );
    }
    if (state.jobHint) actions.append(h('span', { class: 'apply-stale' }, state.jobHint));
    box.append(actions);
  };
  rebuild();
  return h('section', { class: 'blk' }, box);
}

// ---- 定向裁剪与对话式改版(B 段)----
//
// **只有读过职位才有裁剪**:没有职位就没有裁剪的目标,那时这一页仍是
// 「选设置 → 生成预览」。控件要有消费方 —— 额外指令框、参照语种行、对话区
// 都跟着"上一步产生了消费方"渐进出现,而不是一进页面就全摆出来。
//
// **初版一趟走完**(用户 2026-08-26 裁定):点一次 = AI 裁剪 + 重新编译。
// 「PDF 主动触发」讲的是"不点不发生",不是"每件事各点一次";
// 而**改版只出计划**,PDF 由「重新生成」再点 —— 对话里连改三轮再看一次 PDF 是常态。

let rebuildTailor = () => {};

/** 进行中那句话:分「在想」与「在写」—— 大陆那条路的静默有 130 多秒,得说清是哪一段。 */
const busyText = () =>
  !state.tailorBusy
    ? ''
    : state.tailorPhase === 'thinking'
      ? tr('apply.thinking')
      : tr(state.tailorBusy === 'revise' ? 'apply.revising' : 'apply.tailoring');

/** 差异摘要一行:保留 N/M · 改写 K 处 · 落不进去 J 处。数字都是算出来的,不是估的。 */
function diffSummaryText(diff, dropped) {
  const parts = [];
  const recs = diff.filter((r) => r.section !== 'basics');
  const total = recs.reduce((n, r) => n + r.total, 0);
  const kept = recs.reduce((n, r) => n + r.kept, 0);
  if (total) parts.push(tr('apply.diffKept').replace('{n}', String(kept)).replace('{m}', String(total)));
  const rewritten = diff.reduce((n, r) => n + r.rewritten.length, 0);
  if (rewritten) parts.push(tr('apply.diffRewritten').replace('{n}', String(rewritten)));
  const innerDropped = diff.reduce((n, r) => n + r.innerDropped, 0);
  if (innerDropped) parts.push(tr('apply.diffBullets').replace('{n}', String(innerDropped)));
  // **落不进去的要如实说**:模型说改了 N 处、其中 J 处落不进任何地方,
  // 不说就成了"它说改了但没变"——而那正是最难查的一类。
  if (dropped && dropped.length) parts.push(tr('apply.diffIgnored').replace('{n}', String(dropped.length)));
  return parts.join(tr('punct.dot', ' · '));
}

/** 一轮的交代:模型的话 + 差异摘要 + 改写逐条(新增的标出来)。 */
function turnBlock(turn) {
  const rows = [];
  if (turn.feedback) rows.push(h('div', { class: 'tlr-said' }, turn.feedback));
  if (turn.note) rows.push(h('div', { class: 'tlr-note' }, turn.note));
  const summary = diffSummaryText(turn.diff, turn.dropped);
  if (summary) rows.push(h('div', { class: 'tlr-summary' }, summary));
  const rewrites = turn.diff.flatMap((r) => r.rewritten.map((w) => ({ ...w, isNew: turn.newPaths.includes(w.path) })));
  if (rewrites.length) {
    rows.push(
      h(
        'details',
        { class: 'tlr-details' },
        h('summary', {}, tr('apply.diffShow').replace('{n}', String(rewrites.length))),
        ...rewrites.map((w) =>
          h(
            'div',
            { class: 'tlr-rewrite' },
            // 空槽现写出来的那一段**标成「新增」**(用户 2026-08-26 裁定):
            // 那不是改写谁的话,是替他写了一段没有过的自陈,得让他看见。
            h('div', { class: 'tlr-rw-path' }, w.path, w.isNew ? h('span', { class: 'tlr-new' }, tr('apply.diffNew')) : null),
            w.before ? h('div', { class: 'tlr-rw-before' }, w.before) : null,
            h('div', { class: 'tlr-rw-after' }, w.after)
          )
        )
      )
    );
  }
  return h('div', { class: 'tlr-turn' }, ...rows);
}

/** 跑一轮裁剪 / 改版:AI → 归一 → 套用。初版跑完顺手编译一次。 */
async function runTailorRound({ revise = false, feedback = '' } = {}) {
  const source = revise ? compileSource() : state.config;
  const facts = collectTailorFacts(source, { sections: templateSections(state.template) });
  const refs = state.refs
    .map((lang) => state.refDocs && state.refDocs[lang])
    .filter(Boolean)
    .map((doc, i) => {
      const f = collectTailorFacts(doc, { sections: templateSections(state.template) });
      return { lang: state.refs[i], slots: f.slots, chars: f.chars };
    });
  const budget = estimateTailorPayload({
    facts, refs, jobText: state.jobText, job: state.job, instructions: state.instructions,
  });
  // 素材太多时说清是**哪一样**大。客户端先拦一道(不让请求白打到服务端),
  // 服务端的 413 是第二道 —— 但服务端不知道是哪一样,所以两条路都在这里组装。
  const tooLargeText = () =>
    tr('apply.tailorTooLarge').replace('{what}', tr(`apply.part.${budget.biggest}`, budget.biggest));
  if (budget.overBudget) {
    state.tailorHint = tooLargeText();
    rebuildTailor();
    return;
  }

  state.tailorBusy = revise ? 'revise' : 'tailor';
  state.tailorPhase = '';
  state.tailorChars = 0;
  state.tailorHint = '';
  rebuildTailor();
  // **进行中要把生成按钮锁上**:syncGenerate 认得 tailorBusy,但此前只在 finally 里
  // 被调到 —— 于是裁剪那几十秒里按钮照样可点,双击就是两轮并发
  //(2026-08-26 打生产时顺出来的)。
  syncGenerate();
  setPdfBusy(true, { text: tr(revise ? 'apply.revising' : 'apply.tailoring') });

  try {
    const out = await runTailor(revise ? '/api/ai/revise' : '/api/ai/tailor', {
      facts,
      refs,
      job: state.job,
      jobText: state.jobText,
      instructions: state.instructions,
      feedback,
      spec: state.spec,
      maxPages: (specById(state.spec) || {}).maxPages || 0,
      sessionId: state.sessionId,
    }, {
      // 模型还在想的时候如实说「正在思考」—— 大陆那条路首个正文 token 之前
      // 实测有 130 多秒静默,不说的话界面与"卡死"分不开(2026-08-26 实测)
      onThinking: () => {
        if (state.tailorPhase === 'thinking') return;
        state.tailorPhase = 'thinking';
        setPdfBusy(true, { text: tr('apply.thinking') });
        rebuildTailor();
      },
      onProgress: (chars) => {
        state.tailorChars = chars;
        if (state.tailorPhase !== 'writing') {
          state.tailorPhase = 'writing';
          rebuildTailor();
        }
        setPdfBusy(true, { text: tr(revise ? 'apply.revising' : 'apply.tailoring'), detail: `${chars}` });
      },
    });

    const { plan, dropped, empty } = normalizeTailorPlan(out.plan, source);
    if (empty) {
      // 一轮什么都没改**未必是出错** —— 模型可能就是认为不用改(「已经是两句了」)。
      // 那就把**它自己的解释**摆出来,而不是只印一句干巴巴的「什么都没改」:
      // 那句话回答不了"那我这条意见到底怎么样了"(2026-08-26 打生产时撞到)。
      state.tailorHint = plan.note || tr('apply.tailorNoop');
      return;
    }
    const before = source;
    const after = applyTailorPlan(before, plan);
    state.plan = plan;
    state.draft = after;
    // **轮转要跟随**:不跟的话后面每轮都在开新会话、历史恒为空,而界面上看不出来
    state.sessionId = out.sessionId || state.sessionId;
    const diff = tailorDiff(before, after, plan);
    state.chat.push({
      feedback,
      note: plan.note,
      diff,
      dropped,
      newPaths: Object.keys(plan.text).filter((path) => isNewText(before, path)),
    });
    stale = true; // 改版只出计划,PDF 由「重新生成」再点(用户裁定)
  } catch (err) {
    if (isUnauthorized(err)) return redirectToUnlock();
    state.tailorHint = err.code === 'AI_TEXT_TOO_LARGE' ? tooLargeText() : String(err.message || err);
  } finally {
    state.tailorBusy = '';
    state.tailorPhase = '';
    setPdfBusy(false);
    rebuildTailor();
    rebuildSelection();
  }

  // 初版一趟走完:裁剪完接着编译(用户 2026-08-26 裁定)
  if (!revise && state.draft) {
    stale = false;
    renderResume();
    syncGenerate();
  }
}

/** 对话区:出了初版才出现 —— 没有初版就没有"针对当前版的意见"。 */
function buildTailorBlock() {
  const box = h('div', { class: 'apply-bar' });
  const section = h('section', { class: 'blk apply-tailor', hidden: true });
  let draft = '';
  const rebuild = () => {
    clear(box);
    // **整块的显隐由这里切**:CSS 的 `:empty` 匹配不到(section 里还有 .apply-bar),
    // 不切的话页面上会留一张 30px 高的空白卡(2026-08-26 真机看到)。
    section.hidden = !state.chat.length && !state.tailorBusy && !state.tailorHint;
    // 还没裁过就整块不出现 —— **但有话要说时必须出现**:此前这里只看 chat 与 busy,
    // 于是裁剪失败/素材超预算/这一轮没改动的提示 state.tailorHint 无处可显,
    // 人点了按钮看到的是"什么都没发生"(2026-08-26 打生产时撞到,正是这条设计
    // 最该避免的失败形态:出错了却不说)。
    if (!state.chat.length && !state.tailorBusy && !state.tailorHint) return;
    box.append(h('h2', { class: 'blk-title' }, tr('apply.tailorTitle')));
    state.chat.forEach((turn) => box.append(turnBlock(turn)));
    // 一轮都没成过时,这一块就只是那句话 —— 输入框留着没有意义(没有"这一版"可评),
    // 所以下面的输入与按钮只在有过成功一轮之后才摆。
    if (!state.chat.length) {
      // 还没成过一轮:这一块只说一句话 —— 要么正在跑,要么是上一次为什么没成。
      // **进行中也要说** :此前这里只印标题、底下空着,人看到的是一个光秃秃的框
      // (2026-08-26 打生产时撞到)。输入框仍不摆:没有"这一版"可评。
      box.append(h('div', { class: 'apply-stale' }, busyText() || state.tailorHint || ''));
      return;
    }

    const input = h('textarea', {
      class: 'fc-input apply-job-input',
      rows: 2,
      placeholder: tr('apply.revisePlaceholder'),
      'aria-label': tr('apply.reviseLabel'),
      disabled: Boolean(state.tailorBusy) || undefined,
      onInput: (e) => { draft = e.target.value; },
    });
    input.value = draft;
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-primary',
        disabled: Boolean(state.tailorBusy) || undefined,
        onClick: () => {
          const said = String(draft || '').trim();
          if (!said) { state.tailorHint = tr('apply.reviseEmpty'); rebuild(); return; }
          draft = '';
          runTailorRound({ revise: true, feedback: said });
        },
      },
      state.tailorBusy === 'revise' ? busyText() : tr('apply.revise')
    );
    box.append(input, h('div', { class: 'apply-row apply-actions' }, btn,
      state.tailorHint ? h('span', { class: 'apply-stale' }, state.tailorHint) : null));
  };
  rebuildTailor = rebuild;
  rebuild();
  section.append(box);
  return section;
}

/** 两张卡:先「职位信息」(它推导下面的目标),再「投到哪里 → 版式 → 语种 → 生成」。 */
function buildApplyShell() {
  return h('div', { class: 'apply-shell' }, buildJobBlock(), buildSelectionBar(), buildTailorBlock());
}

/**
 * 取一份**参照语种**的文档并缓存。参照只作措辞对照(见提示词里那句),
 * 取不到就把这个语种从参照里摘掉 —— 静默留着会让人以为它参照了。
 */
async function loadRefDoc(lang) {
  state.refDocs = state.refDocs || {};
  if (state.refDocs[lang]) return;
  try {
    state.refDocs[lang] = normalizeResume(await fetchResume(lang));
  } catch (err) {
    if (isUnauthorized(err)) return redirectToUnlock();
    state.refs = state.refs.filter((x) => x !== lang);
    window.Toast && window.Toast.err(String(err.message || err));
  }
}

/** 取当前选中语种的那份事实。 */
async function loadFacts() {
  try {
    const cfg = await fetchResume(state.factsLang || undefined);
    state.rawConfig = normalizeResume(cfg || (await loadDefaultResumeConfig()));
  } catch (err) {
    if (isUnauthorized(err)) return redirectToUnlock();
    window.Toast && window.Toast.err(String(err.message || err));
    return;
  }
  state.config = state.rawConfig;
}

function buildToolbar(pageEl) {
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

  // 页眉与 /edit **同一套**(header.app-header + back-link + header-title +
  // header-actions)—— 此前这一页自带一套 .preview-header(56px、自己的圆角与
  // transition),两页看着像两个产品(2026-08-24 用户报出「界面又漂了」)。
  // §3.5 的规矩是照 sibling 抄、不发明,那么站内两页更不该各画各的。
  const header = h(
    'header',
    { class: 'app-header' },
    h('a', { class: 'back-link', href: '/edit' }, icon('back'), tr('action.backToEdit')),
    h('span', { class: 'header-title' }, tr('home.apply.title')),
    h(
      'span',
      { class: 'header-actions' },
      buildPdfViewControls(),
      printItemEl,
      pdfItemEl,
      adoptThemeToggle()
    )
  );

  syncToolbarMode();
  return header;
}

// ---- 组装 ----

async function main() {
  const params = new URLSearchParams(window.location.search);
  // 三样选择都不进简历数据(那是**生成侧的参数**,不是求职者的事实,见 §3):
  // URL 参数优先,否则用缺省 —— 刷新与分享链接因此回到同一套设置
  state.spec = resolveSpec(params.get('spec'));
  state.template = templateForSpec(state.spec, resolveTemplate(params.get('template')));

  try {
    const info = await listFactsLangs();
    state.langs = (info && info.langs) || [];
  } catch { /* 取不到就当只有一份:少一行芯片,不挡出 PDF */ }
  const wanted = params.get('flang');
  state.factsLang =
    wanted && state.langs.some((l) => l.lang === wanted)
      ? wanted
      : (state.langs.find((l) => l.lang === (state.langs[0] && state.langs[0].lang)) || {}).lang || '';
  await loadFacts();

  const app = document.getElementById('app');
  clear(app);

  const pageEl = h('div', { class: 'preview-page' });

  window.addEventListener('beforeprint', () => {
      pageEl.classList.add('is-printing');
  });
  window.addEventListener('afterprint', () => {
    pageEl.classList.remove('is-printing');
  });

  // **进页面不编译** —— 空态 + 一个「生成预览」按钮(见 mountPdfPlaceholder)
  mountPdfPlaceholder();

  pageEl.append(
    buildToolbar(pageEl),
    buildApplyShell(),
    h('div', { class: 'preview-content' }, shellEl)
  );
  app.append(pageEl);
}

main().catch((err) => {
  console.error(err);
  window.Toast && window.Toast.err(String(err));
});
