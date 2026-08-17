// 浏览器端 TeX 引擎客户端 —— 纯 PDF 形态的编译入口。
//
// 形态:懒加载 texlyre-busytex wrapper(jsDelivr /npm/)+ 我们的裁剪引擎资产
// (jsDelivr /gh/onegbnet/ccs@<ccs-pin sha>/tex-engine/,icu + core 两包全量 preload),
// 在客户端补一层 Cache API 资产缓存(**按资产版本键,不按 URL**——pin bump 会换址
// 但字节没变),对外只暴露 compileTex / preloadEngine / isEngineReady。
//
// 配置注入(本模块只消费不生产,由 worker 侧渲染进 HTML,见 src/tex-engine-config.mjs):
//   window.__TEX_ENGINE__ = { wrapperUrl, assetBase, assetVersion, useWorker?, workerUrl? }
// wrapperUrl/assetBase 由 ccs 的 mjs/runtime/tex-engine-cdn.mjs helper 生成;
// assetVersion 是**资产版本号**(wrapper npm 版本 + ccs 裁剪修订号,如 '1.3.1-r7'),
// 缓存键用它而非含 pin SHA 的 URL。
//
// 执行线程(重要):默认 **worker 模式**——编译几秒到几十秒,跑主线程会把页面卡死。
// wrapper 自己会 `new Worker(`${assetBase}/busytex_worker.js`)`,而 assetBase 跨域
// (jsDelivr)→ SecurityError;所以我们在初始化期间把 Worker 构造重定向到**同源 shim**
// (worker 侧路由 /tex-worker.js,它 importScripts 到 jsDelivr 上的真 worker)。
// 任何一步失败(shim 404、浏览器不支持 Worker、worker 内部初始化超时……)都自动降级到
// wrapper 的直连模式(主线程),并经 onProgress 透出 { phase:'fallback' } 供 UI 提示。
//
// 错误约定(同 app/lib/api.mjs:Error 带 code):
//   - 配置缺失 / wrapper 装载失败 / 引擎初始化失败 → throw Error(code=…),属基础设施故障;
//   - LaTeX 编译失败(用户数据导致,常态)→ **不抛**,返回 { ok:false, log },供 UI 回显。

import { TEX_CACHE_PREFIX, texCacheName, texCacheKey, isGzippedAsset } from './tex-cache-keys.mjs';

const CACHE_PREFIX = TEX_CACHE_PREFIX;
// 数据包清单。**分两包不是设计偏好,是被 jsDelivr 20MB/文件上限逼的**:
// 整包 28.92MB 过不了闸,而 icudt78l.dat 单件 16.02MB 是最大块,拆它出去即可。
// 两包都要 preload —— TeX 读文件是同步的(kpathsea 在 WASM 内直接 open/read),
// 中途没法 await 网络,所以编译前必须把可能用到的 texmf 内容全部挂好。
const DATA_PACKAGES = ['texlive-icu.js', 'texlive-core.js'];

/** 同源 worker shim 的默认路径(与 src/tex-engine-config.mjs 的路由一致)。 */
const TEX_WORKER_SHIM_PATH = '/tex-worker.js';

/** wrapper 内部拼出来的 worker 壳 URL(要被重定向到同源 shim 的那个)。 */
const BUSYTEX_WORKER_FILE = 'busytex_worker.js';

/* ---------------------------------------------------------------- 配置 */

const makeError = (code, message) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

/** 读取并校验页面注入的配置;缺失时抛出可读错误。 */
function readConfig() {
  const raw = typeof window !== 'undefined' ? window.__TEX_ENGINE__ : undefined;
  if (!raw || typeof raw !== 'object') {
    throw makeError(
      'TEX_ENGINE_CONFIG_MISSING',
      'TeX 引擎未配置:页面缺少 window.__TEX_ENGINE__ = { wrapperUrl, assetBase, assetVersion }'
    );
  }
  const missing = ['wrapperUrl', 'assetBase', 'assetVersion'].filter(
    (k) => typeof raw[k] !== 'string' || raw[k].trim() === ''
  );
  if (missing.length) {
    throw makeError(
      'TEX_ENGINE_CONFIG_MISSING',
      `TeX 引擎配置不完整:window.__TEX_ENGINE__ 缺少 ${missing.join(' / ')}`
    );
  }
  return {
    wrapperUrl: raw.wrapperUrl.trim(),
    assetBase: raw.assetBase.trim().replace(/\/+$/, ''),
    assetVersion: raw.assetVersion.trim(),
    // 默认 worker 模式(主线程编译会卡死页面);页面显式置 false 才走直连。
    useWorker: raw.useWorker !== false,
    // 同源 shim。跨域的 worker 壳一律不接受——那正是 SecurityError 的来源。
    workerUrl:
      typeof raw.workerUrl === 'string' && raw.workerUrl.trim() ? raw.workerUrl.trim() : TEX_WORKER_SHIM_PATH,
  };
}

/** 配置是否就绪(供 UI 决定要不要显示「导出 PDF」)。不抛。 */
/**
 * 上游简历件(.cls/.sty/字体)的基址 —— 住 ccs 的 tex-templates 模块、走 jsDelivr
 *(大陆自动走镜像),**不占自家资产**。配置缺失时返回 '/tex',退回旧的同源路径。
 */
export function templateBase() {
  try {
    return readConfig().templateBase || '/tex';
  } catch {
    return '/tex';
  }
}

export function isEngineConfigured() {
  try {
    readConfig();
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------- 进度回传 */

const progressListeners = new Set();

function emitProgress(event) {
  for (const cb of progressListeners) {
    try {
      cb(event);
    } catch {
      /* 监听方自己的错误不影响装载 */
    }
  }
}

/* ------------------------------------------------------- Cache API 缓存层 */
//
// 只缓存 assetBase 下的引擎资产。键 = 资产版本 + 文件相对路径(缓存名带版本,
// 键 URL 也带版本),与 pin SHA 无关。任何一步失败都 try/catch 降级、穿透到网络
// (Safari 隐私模式 / 存储配额耗尽 / 无 Cache API 环境)。

let cachePromise = null;
let staleCacheSwept = false;

async function sweepStaleCaches(currentName) {
  if (staleCacheSwept) return;
  staleCacheSwept = true;
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith(CACHE_PREFIX) && n !== currentName)
        .map((n) => caches.delete(n).catch(() => false))
    );
  } catch {
    /* 清理是尽力而为 */
  }
}

async function openAssetCache(assetVersion) {
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    try {
      if (typeof caches === 'undefined' || !caches || typeof caches.open !== 'function') return null;
      const name = texCacheName(assetVersion);
      const cache = await caches.open(name);
      await sweepStaleCaches(name);
      return cache && typeof cache.match === 'function' ? cache : null;
    } catch {
      return null;
    }
  })();
  return cachePromise;
}

const cacheKeyFor = texCacheKey; // 约定见 ./tex-cache-keys.mjs(worker shim 共用)

/** url 在 assetBase 下则返回相对路径(去掉 query/hash),否则 null。 */
function relativeAssetPath(url, assetBase) {
  const prefix = `${assetBase}/`;
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
  return url.slice(prefix.length).split(/[?#]/)[0] || null;
}

/** 读响应体并按 Content-Length 回传下载进度;无流式能力时整块读。 */
async function readBodyWithProgress(res, file) {
  const total = Number(res.headers && res.headers.get ? res.headers.get('Content-Length') : 0) || 0;
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    const buf = new Uint8Array(await res.arrayBuffer());
    emitProgress({ phase: 'download', file, loaded: buf.byteLength, total: total || buf.byteLength, percent: 100, cached: false });
    return buf;
  }
  const reader = body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    emitProgress({
      phase: 'download',
      file,
      loaded,
      total,
      percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : undefined,
      cached: false,
    });
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * gzip 字节 → 明文字节。用浏览器原生 DecompressionStream(无第三方依赖)。
 * 环境不支持时抛 TEX_ENGINE_ASSET_FAILED —— 与其静默把压缩字节喂给 WebAssembly
 * 让它报一句看不懂的话,不如在这里说清楚。
 */
async function gunzipBytes(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw makeError(
      'TEX_ENGINE_ASSET_FAILED',
      '当前环境不支持 DecompressionStream,无法解开压缩存放的引擎资产'
    );
  }
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const bytesResponse = (bytes, contentType) =>
  new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
    },
  });

/** 缓存命中直接回;未命中回落网络,读完写缓存(尽力而为)后回。 */
async function fetchAssetCached(url, relPath, cfg, networkFetch) {
  const cache = await openAssetCache(cfg.assetVersion);
  const key = cacheKeyFor(cfg.assetVersion, relPath);
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        emitProgress({ phase: 'download', file: relPath, percent: 100, cached: true });
        return hit;
      }
    } catch {
      /* 读缓存失败 → 当未命中 */
    }
  }
  // 压缩存放的资产(只有 busytex.wasm,见 tex-cache-keys.mjs):改取 .gz 再解开。
  // 缓存里存的是**解开后**的字节——省得每次命中都重解一遍。
  const gz = isGzippedAsset(relPath);
  const res = await networkFetch(gz ? `${url}.gz` : url);
  if (!res || !res.ok) return res;
  const contentType = gz
    ? relPath.endsWith('.wasm')
      ? 'application/wasm'
      : 'application/octet-stream'
    : res.headers && res.headers.get
      ? res.headers.get('Content-Type')
      : null;
  const raw = await readBodyWithProgress(res, relPath);
  const bytes = gz ? await gunzipBytes(raw) : raw;
  if (cache) {
    try {
      await cache.put(key, bytesResponse(bytes, contentType));
    } catch {
      /* 配额不足等 → 本次穿透,不影响编译 */
    }
  }
  return bytesResponse(bytes, contentType);
}

/**
 * 把 assetBase 下的 fetch 接到缓存层(**主线程这一份**)。
 * 幂等、进程内只装一次;非本引擎的请求原样放行,拦截路径出任何错都回落原始 fetch。
 * (script 标签装载的 busytex*.js / texlive.js 走不到这里——那几个是小文件,
 *  由浏览器 HTTP 缓存兜底;大字节 texlive.data 与 busytex.wasm 走 fetch。)
 *
 * **worker 模式下这份补丁够不着大文件**:那时 texlive.data / busytex.wasm 的 fetch
 * 发生在 worker 线程。同一套缓存(同 cache 名、同键,见 ./tex-cache-keys.mjs)由同源
 * shim 在 worker 里自己装一份(src/tex-engine-config.mjs 的 renderTexWorkerShim)。
 * 这份仍然有用且必须保留:fetchEngineAsset(CJK 字体,主线程调)与降级后的直连模式都靠它。
 */
let fetchInterceptorInstalled = false;
let networkFetchRef = null; // 拦截前的原始 fetch(避免自拦截)

function installFetchInterceptor(cfg) {
  if (fetchInterceptorInstalled) return;
  if (typeof globalThis.fetch !== 'function') return;
  const networkFetch = globalThis.fetch.bind(globalThis);
  networkFetchRef = networkFetch;
  globalThis.fetch = function texEngineFetch(input, init) {
    const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
    const relPath = relativeAssetPath(url, cfg.assetBase);
    const plainGet = !init || !init.method || String(init.method).toUpperCase() === 'GET';
    if (!relPath || !plainGet) return networkFetch(input, init);
    return fetchAssetCached(url, relPath, cfg, networkFetch).catch(() => networkFetch(input, init));
  };
  fetchInterceptorInstalled = true;
}

/**
 * 取 assetBase 下的单个资产(走同一缓存层),返回字节。
 * 给需要把引擎侧文件喂进编译的调用方用——典型是 CJK 字体
 * (`fetchEngineAsset('fonts/cjk-sc.otf')` → compileTex 的 assets 项)。
 * 网络/缓存均失败时抛 Error(code=TEX_ENGINE_ASSET_FAILED)。
 */
export async function fetchEngineAsset(relPath, { onProgress } = {}) {
  const cfg = readConfig();
  const clean = String(relPath || '').replace(/^\/+/, '');
  if (!clean) throw makeError('TEX_ENGINE_ASSET_FAILED', 'fetchEngineAsset:relPath 不能为空');
  installFetchInterceptor(cfg);
  if (typeof onProgress === 'function') progressListeners.add(onProgress);
  try {
    const networkFetch = networkFetchRef || globalThis.fetch.bind(globalThis);
    const res = await fetchAssetCached(`${cfg.assetBase}/${clean}`, clean, cfg, networkFetch);
    if (!res || !res.ok) {
      throw makeError(
        'TEX_ENGINE_ASSET_FAILED',
        `TeX 引擎资产获取失败(${clean}):HTTP ${res && res.status}`
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    if (typeof onProgress === 'function') progressListeners.delete(onProgress);
  }
}

/* ------------------------------------------------------------ 引擎懒加载 */

let enginePromise = null;
let engine = null; // { runner, latex, cfg, mode }

const causeMessage = (cause) => (cause && cause.message ? cause.message : String(cause));

/**
 * 页面 URL 为基址把 workerUrl 解析成绝对 URL(解析不了就原样用相对路径)。
 * 解析结果**必须同源**——跨域 shim 一定 SecurityError,与其等浏览器拒不如早报早降级。
 */
function resolveWorkerUrl(workerUrl) {
  const base =
    (typeof location !== 'undefined' && location && location.href) ||
    (typeof window !== 'undefined' && window.location && window.location.href) ||
    null;
  if (!base) return workerUrl;
  let resolved;
  try {
    resolved = new URL(workerUrl, base);
  } catch {
    return workerUrl;
  }
  if (resolved.origin !== new URL(base).origin) {
    throw new Error(`worker shim 必须同源(拿到 ${resolved.origin})`);
  }
  return resolved.href;
}

/**
 * 用 worker 模式初始化。
 *
 * wrapper 的 initializeWorker() 会 `new Worker(`${busytexBasePath}/busytex_worker.js`)`,
 * 而 busytexBasePath 必须保持 jsDelivr 绝对基址(busytex.js / busytex.wasm / 数据包全从它拼,
 * 换成同源就全错)。wrapper 又没给 worker 路径的覆盖点,所以只能在**初始化这一小段窗口内**
 * 把 Worker 构造重定向到同源 shim,finally 立刻还原(不留全局污染)。
 */
async function initializeViaShimWorker(runner, cfg) {
  const NativeWorker = typeof globalThis.Worker === 'function' ? globalThis.Worker : null;
  if (!NativeWorker) throw new Error('当前环境没有 Worker 构造器');
  const crossOriginWorker = `${cfg.assetBase}/${BUSYTEX_WORKER_FILE}`;
  const shimUrl = resolveWorkerUrl(cfg.workerUrl);

  function PatchedWorker(url, options) {
    const target = String(url) === crossOriginWorker ? shimUrl : url;
    return new NativeWorker(target, options);
  }
  PatchedWorker.prototype = NativeWorker.prototype;

  globalThis.Worker = PatchedWorker;
  try {
    await runner.initialize(true);
  } finally {
    globalThis.Worker = NativeWorker;
  }
}

/** 按配置初始化 runner;worker 模式失败则**自动降级**主线程直连,并透出降级信号。 */
async function initializeRunner(makeRunner, cfg) {
  if (cfg.useWorker) {
    // worker 这一趟不重试(wrapper 默认 2 次 + 1.5s/3s 退避,而单次卡死的上限是 120s
    // 超时——重试只会把「起不来」放大成分钟级白等)。重试留给降级后的直连那趟。
    const runner = makeRunner({ initRetries: 0 });
    try {
      await initializeViaShimWorker(runner, cfg);
      return { runner, mode: 'worker' };
    } catch (cause) {
      try {
        runner.terminate();
      } catch {
        /* ignore */
      }
      // 降级不是致命错:主线程仍能编译,只是会卡 UI。UI 据此提示「兼容模式,可能卡顿」。
      emitProgress({ phase: 'fallback', mode: 'direct', reason: causeMessage(cause) });
    }
  }

  const runner = makeRunner();
  try {
    await runner.initialize(false);
  } catch (cause) {
    try {
      runner.terminate();
    } catch {
      /* ignore */
    }
    throw makeError('TEX_ENGINE_INIT_FAILED', `TeX 引擎初始化失败:${causeMessage(cause)}`);
  }
  return { runner, mode: 'direct' };
}

async function loadEngine() {
  const cfg = readConfig();
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    installFetchInterceptor(cfg);

    emitProgress({ phase: 'wrapper' });
    let mod;
    try {
      mod = await import(/* @vite-ignore */ cfg.wrapperUrl);
    } catch (cause) {
      throw makeError(
        'TEX_ENGINE_WRAPPER_LOAD_FAILED',
        `TeX 引擎 wrapper 装载失败(${cfg.wrapperUrl}):${cause && cause.message ? cause.message : cause}`
      );
    }
    const { BusyTexRunner, XeLatex } = mod || {};
    if (typeof BusyTexRunner !== 'function' || typeof XeLatex !== 'function') {
      throw makeError(
        'TEX_ENGINE_WRAPPER_INVALID',
        `TeX 引擎 wrapper 未导出 BusyTexRunner / XeLatex(${cfg.wrapperUrl})`
      );
    }

    // 喂给 pipeline 的路径**一律绝对 URL**(jsDelivr 基址):busytexBasePath 决定
    // busytex.js / busytex.wasm 的地址,数据包在这里显式拼绝对。worker 里 location
    // 是同源 shim,任何相对路径都会落回本站 404。
    const dataPackages = DATA_PACKAGES.map((n) => `${cfg.assetBase}/${n}`);
    const makeRunner = (extra) =>
      new BusyTexRunner({
        busytexBasePath: cfg.assetBase,
        engineMode: 'combined',
        preloadDataPackages: dataPackages,
        catalogDataPackages: dataPackages,
        onDownloadProgress: (p) =>
          emitProgress({
            phase: 'download',
            file: DATA_PACKAGES.join(' + '),
            loaded: p && p.loaded,
            total: p && p.total,
            percent: p && p.percent,
            cached: false,
          }),
        ...extra,
      });

    emitProgress({ phase: 'engine', mode: cfg.useWorker ? 'worker' : 'direct' });
    const { runner, mode } = await initializeRunner(makeRunner, cfg);

    engine = { runner, latex: new XeLatex(runner), cfg, mode };
    emitProgress({ phase: 'ready', mode });
    return engine;
  })().catch((err) => {
    enginePromise = null;
    engine = null;
    throw err;
  });
  return enginePromise;
}

/** 引擎是否已装载可用(同步)。 */
export function isEngineReady() {
  return Boolean(engine && engine.runner && engine.runner.isInitialized && engine.runner.isInitialized());
}

/** 已装载引擎的执行模式:'worker' | 'direct'(降级) | null(未装载)。 */
export function getEngineMode() {
  return engine ? engine.mode : null;
}

/**
 * 预热引擎(页面空闲时调用,避免首次导出干等几十秒)。
 * 装载失败会抛(基础设施故障),调用方自行 catch 决定是否提示。
 */
export async function preloadEngine({ onProgress } = {}) {
  if (typeof onProgress === 'function') progressListeners.add(onProgress);
  try {
    await loadEngine();
    return true;
  } finally {
    if (typeof onProgress === 'function') progressListeners.delete(onProgress);
  }
}

/* ---------------------------------------------------------------- 编译 */

/** assets → wrapper 的 additionalFiles({path, content});非法项静默丢弃。 */
function normalizeAssets(assets) {
  if (!Array.isArray(assets)) return [];
  const out = [];
  for (const a of assets) {
    if (!a || typeof a !== 'object') continue;
    const path = typeof a.path === 'string' ? a.path : typeof a.name === 'string' ? a.name : null;
    const raw = a.content !== undefined ? a.content : a.data;
    if (!path || raw === undefined || raw === null) continue;
    let content;
    if (typeof raw === 'string' || raw instanceof Uint8Array) content = raw;
    else if (raw instanceof ArrayBuffer) content = new Uint8Array(raw);
    else if (ArrayBuffer.isView(raw)) content = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    else continue;
    out.push({ path, content });
  }
  return out;
}

/** 从 CompileResult 里榨出人能读的日志(优先 result.log,回落逐步日志)。 */
function extractLog(result) {
  if (result && typeof result.log === 'string' && result.log.trim()) return result.log;
  const entries = (result && result.logs) || [];
  const parts = [];
  for (const e of entries) {
    if (!e) continue;
    const body = [e.log, e.stderr, e.stdout].find((x) => typeof x === 'string' && x.trim());
    parts.push(`==== ${e.cmd || '(cmd)'} (exit ${e.exit_code})\n${body || ''}`.trimEnd());
  }
  return parts.join('\n\n');
}

/**
 * 编译 LaTeX 源到 PDF。
 *
 * @param {string} texSource 主文档源码(挂到 mainTexPath,默认 main.tex)
 * @param {object} [options]
 * @param {Array<{path:string, content:string|Uint8Array|ArrayBuffer}>} [options.assets] 附加文件(头像图片、.bib 等)
 * @param {(e:{phase:string, file?:string, percent?:number, loaded?:number, total?:number, cached?:boolean})=>void} [options.onProgress]
 * @param {boolean} [options.bibtex=false]
 * @param {boolean} [options.rerun=false] 多趟编译(交叉引用/目录)
 * @param {boolean} [options.makeindex=false]
 * @param {'silent'|'info'|'debug'} [options.verbose='silent']
 * @param {string} [options.mainTexPath='main.tex']
 * @returns {Promise<{ok:boolean, pdf:Uint8Array|null, log:string, exitCode:number, logs:Array}>}
 *          LaTeX 报错不抛异常,返回 ok:false + log;引擎装载/初始化故障才抛。
 */
export async function compileTex(texSource, options = {}) {
  const {
    assets = [],
    onProgress,
    bibtex = false,
    rerun = false,
    makeindex = false,
    verbose = 'silent',
    mainTexPath = 'main.tex',
  } = options;

  if (typeof onProgress === 'function') progressListeners.add(onProgress);
  try {
    const { latex } = await loadEngine();
    emitProgress({ phase: 'compile' });
    let result;
    try {
      result = await latex.compile({
        input: String(texSource == null ? '' : texSource),
        mainTexPath,
        additionalFiles: normalizeAssets(assets),
        bibtex,
        makeindex,
        rerun,
        verbose,
      });
    } catch (cause) {
      // 编译期异常(超时、引擎内部 exception)同样按「失败但可回显」处理,不抛白屏。
      emitProgress({ phase: 'done', ok: false });
      return {
        ok: false,
        pdf: null,
        log: `编译中断:${cause && cause.message ? cause.message : cause}`,
        exitCode: -1,
        logs: [],
      };
    }
    let pdf = null;
    if (result && result.pdf) {
      pdf = result.pdf instanceof Uint8Array ? result.pdf : new Uint8Array(result.pdf);
      if (pdf.byteLength === 0) pdf = null;
    }
    const ok = Boolean(result && result.success && pdf);
    emitProgress({ phase: 'done', ok });
    return {
      ok,
      pdf: ok ? pdf : null,
      log: extractLog(result),
      exitCode: result && typeof result.exitCode === 'number' ? result.exitCode : ok ? 0 : 1,
      logs: (result && result.logs) || [],
    };
  } finally {
    if (typeof onProgress === 'function') progressListeners.delete(onProgress);
  }
}

/* ---------------------------------------------------------------- 维护 */

/** 释放引擎(worker/WASM 内存);下次 compileTex 会重新懒加载。 */
export function terminateEngine() {
  if (engine && engine.runner && typeof engine.runner.terminate === 'function') {
    try {
      engine.runner.terminate();
    } catch {
      /* ignore */
    }
  }
  engine = null;
  enginePromise = null;
}

/** 清掉本模块所有版本的资产缓存(排障用)。 */
export async function clearEngineAssetCache() {
  cachePromise = null;
  staleCacheSwept = false;
  try {
    if (typeof caches === 'undefined' || !caches || typeof caches.keys !== 'function') return false;
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => caches.delete(n).catch(() => false))
    );
    return true;
  } catch {
    return false;
  }
}
