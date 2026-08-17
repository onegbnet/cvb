var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server/providers/mma.js
var require_mma = __commonJS({
  "server/providers/mma.js"(exports, module) {
    var stripTrailingSlash = (value) => value.replace(/\/+$/, "");
    var buildUpstreamError = async (response) => {
      let detail = `mma request failed with status ${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.detail) {
          detail = `mma request failed: ${payload.detail}`;
        }
      } catch (_error) {
      }
      const error = new Error(detail);
      error.code = "AI_UPSTREAM_REQUEST_FAILED";
      return error;
    };
    var requestMMACompletion = async (config, prompt, fetchImpl = fetch) => {
      const url = `${stripTrailingSlash(config.baseUrl)}/v1/chat`;
      const body = { message: prompt, stream: false };
      if (config.model) body.model = config.model;
      else body.strength = config.strength;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw await buildUpstreamError(response);
      }
      const data = await response.json();
      return data?.reply || "";
    };
    module.exports = {
      requestMMACompletion
    };
  }
});

// server/providers/index.js
var require_providers = __commonJS({
  "server/providers/index.js"(exports, module) {
    var { requestMMACompletion } = require_mma();
    var requestAICompletion = async (config, prompt, fetchImpl = fetch) => {
      if (config.provider === "mma") {
        return requestMMACompletion(config, prompt, fetchImpl);
      }
      const error = new Error(`Unsupported AI provider: ${config.provider}`);
      error.code = "AI_UNSUPPORTED_PROVIDER";
      throw error;
    };
    module.exports = { requestAICompletion };
  }
});

// server/utils/ai-config.js
var require_ai_config = __commonJS({
  "server/utils/ai-config.js"(exports, module) {
    var DEFAULT_TIMEOUT_MS = 3e4;
    var parseTimeout = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
    };
    var buildConfigError = (message, code = "AI_PROVIDER_NOT_CONFIGURED") => {
      const error = new Error(message);
      error.code = code;
      return error;
    };
    var DEFAULT_MMA_BASE_URL = "https://mma.11270115.xyz";
    var MMA_STRENGTHS = ["low", "medium", "high"];
    var resolveMMAConfig = (env) => {
      if (!env.MMA_API_KEY) {
        throw buildConfigError("mma tenant key is missing");
      }
      const strength = env.MMA_STRENGTH || "medium";
      if (!env.MMA_MODEL && !MMA_STRENGTHS.includes(strength)) {
        throw buildConfigError("mma strength must be low/medium/high");
      }
      return {
        provider: "mma",
        apiKey: env.MMA_API_KEY,
        baseUrl: env.MMA_BASE_URL || DEFAULT_MMA_BASE_URL,
        model: env.MMA_MODEL || void 0,
        strength,
        timeoutMs: parseTimeout(env.AI_TIMEOUT_MS)
      };
    };
    var resolveAIConfig = (env = {}) => {
      const provider = env.AI_PROVIDER;
      if (!provider) {
        throw buildConfigError("AI provider is missing");
      }
      if (provider === "mma") {
        return resolveMMAConfig(env);
      }
      throw buildConfigError("Unsupported AI provider", "AI_UNSUPPORTED_PROVIDER");
    };
    module.exports = {
      DEFAULT_TIMEOUT_MS,
      resolveAIConfig,
      resolveMMAConfig
    };
  }
});

// server/utils/ai-payload.js
var require_ai_payload = __commonJS({
  "server/utils/ai-payload.js"(exports, module) {
    var AI_INVALID = "AI_INVALID_RESPONSE";
    var invalid = (message) => {
      const error = new Error(message);
      error.code = AI_INVALID;
      return error;
    };
    var stripFence = (content) => {
      if (typeof content !== "string") return "";
      return content.trim().replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
    };
    var parseJsonPayload = (content) => {
      const text = stripFence(content);
      if (!text) throw invalid("AI response content is empty");
      try {
        return JSON.parse(text);
      } catch {
        throw invalid("AI response is not valid JSON");
      }
    };
    var parseCandidates = (content) => {
      const parsed = parseJsonPayload(content);
      if (!Array.isArray(parsed?.candidates)) {
        throw invalid("AI response does not contain candidates");
      }
      return parsed.candidates.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
    };
    var toClientPayload = (candidates) => ({
      candidates: candidates.map((content, index) => ({
        id: `candidate-${index + 1}`,
        content
      }))
    });
    module.exports = { stripFence, parseJsonPayload, parseCandidates, toClientPayload };
  }
});

// server/routes/ai.js
var require_ai = __commonJS({
  "server/routes/ai.js"(exports, module) {
    var { requestAICompletion } = require_providers();
    var { resolveAIConfig } = require_ai_config();
    var { parseCandidates, toClientPayload } = require_ai_payload();
    var createErrorResponse = (statusCode, code, message) => ({
      statusCode,
      payload: {
        error: {
          code,
          message
        }
      }
    });
    var handleAIImproveRequest2 = async (body, { env = process.env, fetchImpl } = {}) => {
      if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
        return createErrorResponse(
          400,
          "AI_BAD_REQUEST",
          "Prompt is required for AI improvement"
        );
      }
      let config;
      try {
        config = resolveAIConfig(env);
      } catch (error) {
        return createErrorResponse(
          500,
          error.code || "AI_PROVIDER_NOT_CONFIGURED",
          error.message || "AI provider is not configured"
        );
      }
      const requestFetch = fetchImpl || globalThis.fetch;
      if (!requestFetch) {
        return createErrorResponse(
          500,
          "AI_PROXY_UNAVAILABLE",
          "Fetch implementation is not available"
        );
      }
      try {
        const content = await requestAICompletion(config, body.prompt, requestFetch);
        const candidates = parseCandidates(content);
        return {
          statusCode: 200,
          payload: toClientPayload(candidates)
        };
      } catch (error) {
        if (error.code === "AI_INVALID_RESPONSE") {
          return createErrorResponse(502, error.code, error.message);
        }
        return createErrorResponse(
          502,
          error.code || "AI_UPSTREAM_REQUEST_FAILED",
          error.message || "AI upstream request failed"
        );
      }
    };
    module.exports = {
      handleAIImproveRequest: handleAIImproveRequest2
    };
  }
});

// ../ccs/mjs/runtime/lock.mjs
function isValidLock(val) {
  return typeof val === "string" && /^[\x21-\x7e]{3,64}$/.test(val);
}
async function hashToken(prefix, pw) {
  const data = new TextEncoder().encode(prefix + pw);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("_cmp_"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const [sa, sb] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(String(a || ""))),
    crypto.subtle.sign("HMAC", key, enc.encode(String(b || "")))
  ]);
  const ua = new Uint8Array(sa), ub = new Uint8Array(sb);
  let d = 0;
  for (let i = 0; i < ua.length; i++) d |= ua[i] ^ ub[i];
  return d === 0;
}
function makeLockModule({
  cookieName,
  hashPrefix,
  unlockPath,
  appName,
  errorCode = "UNAUTHORIZED",
  apiBypass = () => false,
  slugBypass = () => false,
  lockPageHtml,
  cookieSecure = true,
  openWhenUnset = true
} = {}) {
  for (const [k, v] of Object.entries({ cookieName, hashPrefix, unlockPath, appName, lockPageHtml })) {
    if (v == null || v === "") throw new Error(`makeLockModule: missing required option "${k}"`);
  }
  if (cookieSecure !== true && cookieSecure !== false && cookieSecure !== "auto") {
    throw new Error(`makeLockModule: cookieSecure must be true, false or 'auto'`);
  }
  const cookieRe = new RegExp(`(?:^|;\\s*)${cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`);
  async function handleUnlock(request, env) {
    const headers = { "Content-Type": "application/json" };
    if (!isValidLock(env.LOCK)) {
      if (openWhenUnset) {
        return new Response(JSON.stringify({ ok: true }), { headers });
      }
      if (env.LOCK == null || env.LOCK === "") {
        return new Response(JSON.stringify({ ok: false, error: "LOCK_NOT_CONFIGURED" }), { status: 403, headers });
      }
    }
    let input;
    try {
      input = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "INVALID_JSON" }), { status: 400, headers });
    }
    if (!await safeEqual(input.password || "", env.LOCK)) {
      return new Response(JSON.stringify({ ok: false }), { status: 403, headers });
    }
    const token = await hashToken(hashPrefix, env.LOCK);
    const maxAge = input.remember ? 2592e3 : 86400;
    const secure = cookieSecure === true || cookieSecure === "auto" && new URL(request.url).protocol === "https:";
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `${cookieName}=${token}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Strict; Max-Age=${maxAge}`
      }
    });
  }
  async function isAuthorized(request, env) {
    if (!isValidLock(env.LOCK)) {
      if (openWhenUnset) return true;
      if (env.LOCK == null || env.LOCK === "") return false;
    }
    if (apiBypass(request)) return true;
    const cookie = request.headers.get("Cookie") || "";
    const m = cookie.match(cookieRe);
    if (!m) return false;
    return await safeEqual(m[1], await hashToken(hashPrefix, env.LOCK));
  }
  function renderLockPage(cdnHost2) {
    return new Response(
      lockPageHtml.replace(/\{\{CDN_HOST\}\}/g, cdnHost2),
      { headers: { "Content-Type": "text/html;charset=UTF-8" } }
    );
  }
  return {
    cookieName,
    hashPrefix,
    unlockPath,
    appName,
    errorCode,
    cookieSecure,
    openWhenUnset,
    isValidLock,
    hashToken: (pw) => hashToken(hashPrefix, pw),
    safeEqual,
    handleUnlock,
    isAuthorized,
    renderLockPage,
    apiBypass,
    slugBypass
  };
}

// ../ccs/mjs/runtime/i18n-engine.mjs
var SUPPORTED_LANGS_DEFAULT = [
  "en",
  "eo",
  "fr",
  "de",
  "es",
  "it",
  "nl",
  "da",
  "zh-cn",
  "zh-tw",
  "ja",
  "ko",
  "ms",
  "vi",
  "th",
  "ta",
  "my",
  "uk",
  "he",
  "ar"
];
function detectLangFromAcceptLanguage(headerString, supported) {
  supported = supported || SUPPORTED_LANGS_DEFAULT;
  if (!headerString) return "en";
  const candidates = headerString.split(",").map((s) => s.split(";")[0].trim().toLowerCase()).filter(Boolean);
  for (const l of candidates) {
    if (supported.indexOf(l) !== -1) return l;
    if (/^zh-(hant|tw|hk|mo)/.test(l) && supported.indexOf("zh-tw") !== -1) return "zh-tw";
    if (/^zh/.test(l) && supported.indexOf("zh-cn") !== -1) return "zh-cn";
    const p = l.split("-")[0];
    if (supported.indexOf(p) !== -1) return p;
  }
  return "en";
}

// ../ccs/mjs/runtime/jsdelivr.mjs
var HOST_DEFAULT = "cdn.jsdelivr.net";
var HOST_CN = "jsd.onmicrosoft.cn";
function selectJsdelivrCdnHost(request) {
  if (request && request.cf && request.cf.country === "CN") return HOST_CN;
  return HOST_DEFAULT;
}
function makeJsdelivrUrl(host, pkg, version, file) {
  return `https://${host}/npm/${pkg}@${version}/${file}`;
}
function makeJsdelivrGhUrl(host, repo, sha, file) {
  return `https://${host}/gh/${repo}@${sha}/${file}`;
}

// ../ccs/mjs/runtime/cookie.mjs
function buildSetCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.secure !== false) parts.push("Secure");
  if (opts.httpOnly) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite || "Lax"}`);
  return parts.join("; ");
}

// ../ccs/mjs/runtime/prefs.mjs
var DEFAULT_VALID_THEMES = /* @__PURE__ */ new Set(["light", "dark"]);
var DEFAULT_VALID_LANGS = new Set(SUPPORTED_LANGS_DEFAULT);
var DEFAULT_COOKIE_NAMES = { theme: "theme", lang: "lang" };
var DEFAULT_MAX_AGE = 31536e3;
function buildPrefCookies(prefs, options = {}) {
  const cookieNames = { ...DEFAULT_COOKIE_NAMES, ...options.cookieNames || {} };
  const validThemes = options.validThemes || DEFAULT_VALID_THEMES;
  const validLangs = options.validLangs || DEFAULT_VALID_LANGS;
  const maxAge = options.maxAge || DEFAULT_MAX_AGE;
  const cookieOpts = { maxAge, sameSite: "Lax" };
  const out = [];
  if (typeof prefs.theme === "string") {
    if (!validThemes.has(prefs.theme)) throw new Error("Invalid theme");
    out.push(buildSetCookie(cookieNames.theme, prefs.theme, cookieOpts));
  }
  if (typeof prefs.lang === "string") {
    if (!validLangs.has(prefs.lang)) throw new Error("Invalid lang");
    out.push(buildSetCookie(cookieNames.lang, prefs.lang, cookieOpts));
  }
  return out;
}
async function handlePrefs(request, options) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  let cookies;
  try {
    cookies = buildPrefCookies(body, options);
  } catch (e) {
    return jsonResponse({ error: e.message }, 400);
  }
  if (cookies.length === 0) {
    return jsonResponse({ error: "No prefs to update" }, 400);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookies.join(", ")
    }
  });
}
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// src/worker.mjs
var import_ai = __toESM(require_ai(), 1);

// src/limits.mjs
var D1_MAX_ROW_BYTES = 2e6;
var ROW_OVERHEAD_BYTES = 8 * 1024;
var MAX_CONFIG_BYTES = D1_MAX_ROW_BYTES - ROW_OVERHEAD_BYTES;
var utf8Bytes = (text) => new TextEncoder().encode(String(text ?? "")).byteLength;
var checkConfigSize = (serialized) => {
  const bytes = utf8Bytes(serialized);
  return bytes > MAX_CONFIG_BYTES ? { ok: false, bytes, limit: MAX_CONFIG_BYTES } : { ok: true, bytes };
};

// ../ccs/mjs/runtime/tex-engine-cdn.mjs
var TEXLYRE_BUSYTEX_VERSION = "1.3.1";
var TEX_ENGINE_ASSET_REVISION = 8;
var TEX_ENGINE_ASSET_VERSION = `${TEXLYRE_BUSYTEX_VERSION}-r${TEX_ENGINE_ASSET_REVISION}`;
var TEX_ENGINE_ASSETS_DIR = "tex-engine";
function makeTexEngineWrapperUrl(cdnHost2) {
  return makeJsdelivrUrl(cdnHost2, "texlyre-busytex", TEXLYRE_BUSYTEX_VERSION, "dist/index.js");
}
function makeTexEngineAssetBase(cdnHost2, ccsSha) {
  return makeJsdelivrGhUrl(cdnHost2, "onegbnet/ccs", ccsSha, TEX_ENGINE_ASSETS_DIR);
}

// app/lib/tex-cache-keys.mjs
var TEX_CACHE_PREFIX = "cvb-tex-engine-";
var TEX_CACHE_KEY_ORIGIN = "https://tex-engine.cvb.internal";
var texCacheName = (assetVersion) => `${TEX_CACHE_PREFIX}${assetVersion}`;
var texCacheKey = (assetVersion, relPath) => `${TEX_CACHE_KEY_ORIGIN}/${encodeURIComponent(assetVersion)}/${relPath}`;
var TEX_GZIPPED_ASSETS = /* @__PURE__ */ new Set(["busytex.wasm"]);

// src/tex-engine-config.mjs
var TEX_WORKER_SHIM_PATH = "/tex-worker.js";
var BUSYTEX_WORKER_FILE = "busytex_worker.js";
var TEX_ENGINE_PLACEHOLDER = "{{TEX_ENGINE}}";
var TRUTHY = /* @__PURE__ */ new Set(["1", "true", "yes", "on"]);
function isTexEngineEnabled(env) {
  const raw = env && env.TEX_ENGINE_ENABLED;
  return TRUTHY.has(String(raw == null ? "" : raw).trim().toLowerCase());
}
var isSha = (s) => typeof s === "string" && /^[0-9a-f]{40}$/.test(s);
function buildTexEngineConfig({ request, env, ccsSha } = {}) {
  if (!isTexEngineEnabled(env)) return null;
  if (!isSha(ccsSha)) return null;
  const host = selectJsdelivrCdnHost(request);
  const assetVersion = TEX_ENGINE_ASSET_VERSION;
  return {
    wrapperUrl: makeTexEngineWrapperUrl(host),
    assetBase: makeTexEngineAssetBase(host, ccsSha),
    // 资产版本 = wrapper npm 版本 + ccs 自家的裁剪修订号(TEX_ENGINE_ASSET_REVISION)。
    // 缓存键按它、不按 URL,所以 **改了引擎资产的字节就必须在 ccs 那边 +1 修订号**,
    // 否则老用户会一直吃 Cache API 里的陈旧副本(pin bump 不解决这个——那是刻意的:
    // 任何一次 ccs publish 都会换 pin,按 URL 缓存等于每次白重下几十 MB)。
    assetVersion,
    // 上游简历件(.cls/.sty/字体)的基址。它们**不在**自家资产里 ——
    // 与引擎资产同 pin、同主机策略(大陆走镜像),见 ccs 的 tex-templates 模块。
    templateBase: `https://${host}/gh/onegbnet/ccs@${ccsSha}/tex-templates`,
    useWorker: true,
    // 同源 shim 已就位;客户端初始化失败会自动降级主线程
    // ?v= 只是缓存 buster(shim 长缓存 immutable,内容随 pin/版本变):
    // 服务端**不读**这个参数,shim 里的 URL 全由 pin + ccs helper 算。
    workerUrl: `${TEX_WORKER_SHIM_PATH}?v=${encodeURIComponent(assetVersion)}-${ccsSha.slice(0, 8)}`
  };
}
var jsonForHtml = (value) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
function renderTexEngineScript(cfg) {
  if (!cfg) return "";
  return `<!-- TeX \u5F15\u64CE(worker \u6CE8\u5165):assetVersion \u5373\u7F13\u5B58\u4EE3\u53F7,\u8D44\u4EA7\u5B57\u8282\u53D8\u4E86\u5FC5\u987B +1 ccs \u7684 TEX_ENGINE_ASSET_REVISION -->
<script>window.__TEX_ENGINE__ = ${jsonForHtml(cfg)};<\/script>`;
}
function renderTexWorkerShim({ assetBase, assetVersion }) {
  const base = JSON.stringify(`${String(assetBase).replace(/\/+$/, "")}/`);
  const cacheName = JSON.stringify(texCacheName(assetVersion));
  const prefix = JSON.stringify(TEX_CACHE_PREFIX);
  const keyBase = JSON.stringify(texCacheKey(assetVersion, ""));
  const gzipped = JSON.stringify(
    Object.fromEntries([...TEX_GZIPPED_ASSETS].map((p) => [p, p.endsWith(".wasm") ? "application/wasm" : "application/octet-stream"]))
  );
  const workerFile = JSON.stringify(BUSYTEX_WORKER_FILE);
  return `// cvb tex worker shim \u2014\u2014 \u670D\u52A1\u7AEF\u751F\u6210(src/tex-engine-config.mjs),\u52FF\u624B\u6539\u3002
// \u5B58\u5728\u7684\u7406\u7531:\u5F15\u64CE\u8D44\u4EA7\u5728 jsDelivr(\u8DE8\u57DF),new Worker(\u8DE8\u57DF URL) \u4F1A SecurityError,
// \u4E8E\u662F\u5728\u540C\u6E90\u53D1\u8FD9\u4E00\u5C42\u58F3,\u628A\u771F worker importScripts \u8FDB\u6765\u3002
(function () {
  'use strict';
  var BASE = ${base};
  var CACHE_NAME = ${cacheName};
  var CACHE_PREFIX = ${prefix};
  var KEY_BASE = ${keyBase};
  var GZIPPED = ${gzipped};

  // ---- 1. \u8D44\u4EA7\u7F13\u5B58(Cache API;\u952E\u6309\u8D44\u4EA7\u7248\u672C,\u4E0E\u4E3B\u7EBF\u7A0B\u5171\u7528) ----
  var net = typeof self.fetch === 'function' ? self.fetch.bind(self) : null;
  var cachePromise = null;
  function openCache() {
    if (cachePromise) return cachePromise;
    cachePromise = (async function () {
      try {
        if (typeof caches === 'undefined' || !caches || typeof caches.open !== 'function') return null;
        var cache = await caches.open(CACHE_NAME);
        try {
          var names = await caches.keys();
          for (var i = 0; i < names.length; i++) {
            if (names[i].indexOf(CACHE_PREFIX) === 0 && names[i] !== CACHE_NAME) {
              caches.delete(names[i]).catch(function () {});
            }
          }
        } catch (e) { /* \u6E05\u65E7\u4EE3\u662F\u5C3D\u529B\u800C\u4E3A */ }
        return cache && typeof cache.match === 'function' ? cache : null;
      } catch (e) {
        return null; // \u9690\u79C1\u6A21\u5F0F / \u65E0 Cache API \u2192 \u7A7F\u900F\u5230\u7F51\u7EDC
      }
    })();
    return cachePromise;
  }
  function relPath(url) {
    if (typeof url !== 'string' || url.indexOf(BASE) !== 0) return null;
    return url.slice(BASE.length).split(/[?#]/)[0] || null;
  }
  if (net) {
    self.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      var rel = relPath(url);
      var plainGet = !init || !init.method || String(init.method).toUpperCase() === 'GET';
      if (!rel || !plainGet) return net(input, init);
      return (async function () {
        var cache = await openCache();
        var key = KEY_BASE + rel;
        if (cache) {
          try {
            var hit = await cache.match(key);
            if (hit) return hit; // \u539F\u6837\u56DE\u653E(\u542B Content-Type:compileStreaming \u8981 application/wasm)
          } catch (e) { /* \u8BFB\u7F13\u5B58\u5931\u8D25 \u2192 \u5F53\u672A\u547D\u4E2D */ }
        }
        // \u538B\u7F29\u5B58\u653E\u7684\u8D44\u4EA7(\u53EA\u6709 busytex.wasm:31MB \u8D85 jsDelivr 20MB \u4E0A\u9650\u3001\u5355\u4F53\u4E0D\u53EF\u62C6):
        // \u6539\u53D6 .gz,\u7528\u539F\u751F DecompressionStream \u89E3\u5F00,\u4EE5\u539F Content-Type \u4EA4\u8FD8 \u2014\u2014
        // \u4E0A\u6E38 busytex \u4EE3\u7801\u5B8C\u5168\u65E0\u611F\u3002\u7F13\u5B58\u91CC\u5B58**\u89E3\u5F00\u540E**\u7684\u5B57\u8282,\u91CD\u590D\u52A0\u8F7D\u4E0D\u518D\u89E3\u538B\u3002
        if (GZIPPED[rel]) {
          var gzRes = await net(url + '.gz', init);
          if (!gzRes || !gzRes.ok) return gzRes;
          var plain = await new Response(
            gzRes.body.pipeThrough(new DecompressionStream('gzip'))
          ).arrayBuffer();
          var out = new Response(plain, {
            status: 200,
            headers: { 'Content-Type': GZIPPED[rel], 'Content-Length': String(plain.byteLength) },
          });
          if (cache) { try { cache.put(key, out.clone()).catch(function () {}); } catch (e) {} }
          return out;
        }
        var res = await net(input, init);
        if (cache && res && res.ok) {
          // clone \u540E\u53F0\u5199\u5165:\u4E0D await,\u522B\u628A\u5341\u51E0 MB \u7684\u843D\u76D8\u6321\u5728\u7F16\u8BD1\u524D\u9762
          try { cache.put(key, res.clone()).catch(function () {}); } catch (e) {}
        }
        return res;
      })().catch(function () { return net(input, init); });
    };
  }

  // ---- 2. importScripts \u57FA\u5740\u8865\u4E01(worker \u7684 location \u662F\u540C\u6E90 shim,\u76F8\u5BF9\u8DEF\u5F84\u4F1A\u843D\u56DE\u672C\u7AD9) ----
  var nativeImport = self.importScripts.bind(self);
  self.importScripts = function () {
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
      try { args.push(new URL(arguments[i], BASE).href); } catch (e) { args.push(arguments[i]); }
    }
    return nativeImport.apply(null, args);
  };

  // ---- 3. \u771F worker ----
  self.importScripts(BASE + ${workerFile});
})();
`;
}
function handleTexWorkerShimRequest({ request, env, ccsSha } = {}) {
  const cfg = buildTexEngineConfig({ request, env, ccsSha });
  if (!cfg) return null;
  return new Response(renderTexWorkerShim(cfg), {
    status: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

// src/worker.mjs
var RESUME_ID = "default";
var MAX_AVATAR_BYTES = 2 * 1024 * 1024;
var AVATAR_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif"
};
var lock = makeLockModule({
  cookieName: "cvb_auth",
  hashPrefix: "cvb:",
  unlockPath: "/unlock",
  appName: "CV Builder",
  // 锁屏页上显示的名字(未解锁访问 / 时看到的就是它)
  lockPageHtml: `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CV Builder</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z'/%3E%3C/svg%3E">
<style>
/* dev/common/lock/view.css
 * Modern, minimal lock-screen styling. Uses CSS vars with neutral
 * fallbacks so the host theme can override colors if desired.
 */

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: linear-gradient(135deg, #f0f4f8 0%, #fafbfc 60%, #e8f0ff 100%);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: #1e293b;
}

@media (prefers-color-scheme: dark) {
  body {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0c1424 100%);
    color: #e2e8f0;
  }
}

.lock-card {
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .04), 0 12px 32px rgba(0, 0, 0, .08);
  padding: 40px 36px;
  width: 100%;
  max-width: 360px;
  text-align: center;
  animation: lc-in .25s ease;
}

@media (prefers-color-scheme: dark) {
  .lock-card {
    background: #1e293b;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .25), 0 12px 32px rgba(0, 0, 0, .35);
  }
}

@keyframes lc-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

.lock-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 18px;
  background: linear-gradient(135deg, #3b82f6, #06b6d4);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.lock-card h1 {
  font-size: 1.35rem;
  font-weight: 700;
  margin-bottom: 6px;
  letter-spacing: -.01em;
}

.lock-card p {
  font-size: .88rem;
  color: #64748b;
  margin-bottom: 22px;
}

@media (prefers-color-scheme: dark) {
  .lock-card p { color: #94a3b8; }
}

.lock-card input[type=password] {
  width: 100%;
  padding: 11px 14px;
  border: 1.5px solid #cbd5e1;
  border-radius: 10px;
  font-size: .96rem;
  outline: none;
  transition: border-color .18s, box-shadow .18s;
  font-family: inherit;
  background: #fff;
  color: inherit;
  margin-bottom: 12px;
}

.lock-card input[type=password]:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, .12);
}

@media (prefers-color-scheme: dark) {
  .lock-card input[type=password] {
    background: #0f172a;
    border-color: #334155;
  }
}

.remember {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: .82rem;
  color: #64748b;
  margin-bottom: 14px;
  user-select: none;
  cursor: pointer;
}

@media (prefers-color-scheme: dark) {
  .remember { color: #94a3b8; }
}

.remember input[type=checkbox] {
  cursor: pointer;
  accent-color: #3b82f6;
}

.lock-card button[type=submit] {
  width: 100%;
  padding: 11px;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: .94rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform .12s, box-shadow .18s, opacity .18s;
  font-family: inherit;
  box-shadow: 0 2px 8px rgba(37, 99, 235, .22);
}

.lock-card button[type=submit]:hover {
  box-shadow: 0 4px 14px rgba(37, 99, 235, .32);
  transform: translateY(-1px);
}

.lock-card button[type=submit]:active { transform: translateY(0); }

.lock-card button[type=submit]:disabled {
  opacity: .55;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.lock-err {
  color: #ef4444;
  font-size: .82rem;
  margin-top: 12px;
  min-height: 1em;
}

[dir="rtl"] body { direction: rtl; }

</style></head>
<body>
<div class="lock-card">
  <div class="lock-icon" aria-hidden="true">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="11" width="16" height="9" rx="2"/>
      <path d="M8 11V7a4 4 0 018 0v4"/>
    </svg>
  </div>
  <h1 id="lockTitle">CV Builder</h1>
  <p id="lockMsg">Enter password to continue</p>
  <form id="lockForm" autocomplete="off">
    <input type="password" id="lockPw" placeholder="Password" autofocus required>
    <label class="remember">
      <input type="checkbox" id="lockRemember">
      <span id="lockRemLabel">Remember for 30 days</span>
    </label>
    <button type="submit" id="lockBtn">Unlock</button>
    <div class="lock-err" id="lockErr"></div>
  </form>
</div>
<script>window.LOCK_CONFIG={"unlockPath":"/unlock","appNameI18n":{"en":"CV Builder","eo":"CV Builder","fr":"CV Builder","de":"CV Builder","es":"CV Builder","it":"CV Builder","nl":"CV Builder","da":"CV Builder","zh-cn":"\u7B80\u5386\u751F\u6210\u5668","zh-tw":"\u7C21\u6B77\u7522\u751F\u5668","ja":"CV Builder","ko":"CV Builder","ms":"CV Builder","vi":"CV Builder","th":"CV Builder","ta":"CV Builder","my":"CV Builder","uk":"CV Builder","he":"CV Builder","ar":"CV Builder"}};<\/script><script src="https://{{CDN_HOST}}/gh/onegbnet/ccs@098c5d6f129573a2def37d953be15caa470fb420/lock/client.min.js"><\/script>
</body></html>
`,
  cookieSecure: "auto",
  openWhenUnset: false
  // 未配置 LOCK 时编辑面关死,预览仍公开
});
var AI_ROUTES = {
  "/api/ai/improve": import_ai.handleAIImproveRequest
};
var json = (statusCode, payload, headers = {}) => new Response(JSON.stringify(payload), {
  status: statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
});
var unauthorized = () => json(401, { error: { code: "UNAUTHORIZED", message: "Unlock required" } });
var schemaReady = null;
var ensureSchema = (env) => schemaReady ??= env.DB.prepare(
  `CREATE TABLE IF NOT EXISTS resumes (
       id TEXT PRIMARY KEY,
       config TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`
).run();
var cdnHost = (env, request) => env.CCS_CDN_BASE || selectJsdelivrCdnHost(request);
var CCS_PIN = "098c5d6f129573a2def37d953be15caa470fb420";
var SUPPORTED_LANGS = ["zh-cn", "en"];
var resolveLang = (request) => {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)lang=([^;]+)/);
  if (m && SUPPORTED_LANGS.includes(m[1])) return m[1];
  return detectLangFromAcceptLanguage(request.headers.get("Accept-Language") || "", SUPPORTED_LANGS);
};
var appAssetUrl = (relativePath, request) => {
  if (false) return relativePath;
  const host = selectJsdelivrCdnHost(request);
  return `https://${host}/${"gh/onegbnet/cvb@4d3d07dacfce8156a1728f76ad1ee5c3fe3aeb7a	refs/heads/main/cvb"}/${relativePath}`;
};
var serveHtmlAsset = async (request, env, lang) => {
  const res = await env.ASSETS.fetch(request);
  const contentType = res.headers.get("Content-Type") || "";
  if (!res.ok || !contentType.includes("text/html")) return res;
  const texEngine = renderTexEngineScript(
    buildTexEngineConfig({ request, env, ccsSha: CCS_PIN })
  );
  const html = (await res.text()).replaceAll("{{LANG}}", lang).replaceAll("{{CCS_CDN}}", cdnHost(env, request)).replaceAll("{{CCS_PIN}}", CCS_PIN).replaceAll(TEX_ENGINE_PLACEHOLDER, texEngine).replace(
    /(\b(?:src|href)=['"])(app|static)\//g,
    (_, prefix, directory) => `${prefix}${appAssetUrl(`${directory}/`, request)}`
  );
  const headers = new Headers(res.headers);
  headers.delete("Content-Length");
  return new Response(html, { status: res.status, headers });
};
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    if (method === "GET" && pathname === "/health") {
      return json(200, { ok: true });
    }
    if (pathname === "/unlock") {
      if (method === "POST") return lock.handleUnlock(request, env);
      if (await lock.isAuthorized(request, env)) {
        return Response.redirect(new URL("/", url).toString(), 302);
      }
      return lock.renderLockPage(cdnHost(env, request));
    }
    if (method === "GET" && pathname === "/api/auth") {
      return json(200, { authed: await lock.isAuthorized(request, env) });
    }
    if (method === "GET" && pathname === TEX_WORKER_SHIM_PATH) {
      const shim = handleTexWorkerShimRequest({ request, env, ccsSha: CCS_PIN });
      if (shim) return shim;
      return json(404, { error: { code: "NOT_FOUND", message: "TeX engine disabled" } });
    }
    if (method === "POST" && pathname === "/api/prefs") {
      return handlePrefs(request);
    }
    if (pathname === "/api/resume") {
      await ensureSchema(env);
      if (method === "GET") {
        const row = await env.DB.prepare("SELECT config, updated_at FROM resumes WHERE id = ?").bind(RESUME_ID).first();
        if (!row) {
          return json(404, { error: { code: "RESUME_NOT_FOUND", message: "No resume stored yet" } });
        }
        return json(200, { config: JSON.parse(row.config), updatedAt: row.updated_at });
      }
      if (method === "PUT") {
        if (!await lock.isAuthorized(request, env)) return unauthorized();
        let config;
        try {
          config = await request.json();
        } catch {
          return json(400, { error: { code: "BAD_REQUEST", message: "Body must be valid JSON" } });
        }
        if (!config || typeof config !== "object" || Array.isArray(config)) {
          return json(400, { error: { code: "BAD_REQUEST", message: "Config must be an object" } });
        }
        const serialized = JSON.stringify(config);
        const size = checkConfigSize(serialized);
        if (!size.ok) {
          return json(413, {
            error: {
              code: "TOO_LARGE",
              message: `Config is ${size.bytes} bytes, limit is ${size.limit}`,
              bytes: size.bytes,
              limit: size.limit
            }
          });
        }
        const now = Date.now();
        await env.DB.prepare(
          `INSERT INTO resumes (id, config, created_at, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`
        ).bind(RESUME_ID, serialized, now, now).run();
        return json(200, { ok: true, updatedAt: now });
      }
      return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or PUT" } });
    }
    if (method === "POST" && pathname === "/api/avatar") {
      if (!await lock.isAuthorized(request, env)) return unauthorized();
      const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim();
      const ext = AVATAR_TYPES[contentType];
      if (!ext) {
        return json(415, { error: { code: "UNSUPPORTED_TYPE", message: "png/jpeg/webp/gif only" } });
      }
      const body = await request.arrayBuffer();
      if (body.byteLength === 0 || body.byteLength > MAX_AVATAR_BYTES) {
        return json(413, { error: { code: "TOO_LARGE", message: "Avatar must be 1B-2MB" } });
      }
      const key = `avatars/${Date.now()}.${ext}`;
      await env.FS.put(key, body, { httpMetadata: { contentType } });
      return json(200, { ok: true, url: `/files/${key}` });
    }
    if (method === "POST" && pathname === "/api/export") {
      if (!await lock.isAuthorized(request, env)) return unauthorized();
      await ensureSchema(env);
      const row = await env.DB.prepare("SELECT config FROM resumes WHERE id = ?").bind(RESUME_ID).first();
      if (!row) {
        return json(404, { error: { code: "RESUME_NOT_FOUND", message: "Nothing to export" } });
      }
      const key = `exports/resume-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.json`;
      await env.FS.put(key, row.config, {
        httpMetadata: { contentType: "application/json; charset=utf-8" }
      });
      return json(200, { ok: true, url: `/files/${key}` });
    }
    if (method === "GET" && pathname === "/api/exports") {
      if (!await lock.isAuthorized(request, env)) return unauthorized();
      const list = await env.FS.list({ prefix: "exports/" });
      return json(200, {
        exports: list.objects.map((o) => ({
          key: o.key,
          url: `/files/${o.key}`,
          size: o.size,
          uploaded: o.uploaded
        }))
      });
    }
    if (method === "GET" && pathname.startsWith("/files/")) {
      const key = decodeURIComponent(pathname.slice("/files/".length));
      const publiclyReadable = key.startsWith("avatars/") && !key.includes("..");
      if (!publiclyReadable && !await lock.isAuthorized(request, env)) return unauthorized();
      const object = await env.FS.get(key);
      if (!object) return json(404, { error: { code: "NOT_FOUND", message: "File not found" } });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(object.body, { headers });
    }
    const aiHandler = AI_ROUTES[pathname];
    if (aiHandler) {
      if (method !== "POST") {
        return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } });
      }
      if (!await lock.isAuthorized(request, env)) return unauthorized();
      let body;
      try {
        body = await request.json();
      } catch {
        return json(400, {
          error: { code: "AI_BAD_REQUEST", message: "Request body must be valid JSON" }
        });
      }
      const result = await aiHandler(body, { env });
      return json(result.statusCode, result.payload);
    }
    const PAGE_ASSETS = {
      "/": "home.html",
      "/edit": "index.html",
      "/apply": "preview.html",
      // 旧路径:老书签与外发链接不该 404
      "/index.html": "index.html",
      "/preview": "preview.html",
      "/preview.html": "preview.html"
    };
    if (method === "GET" && PAGE_ASSETS[pathname]) {
      const gated = pathname === "/" || pathname === "/edit" || pathname === "/index.html";
      if (gated && !await lock.isAuthorized(request, env)) {
        return lock.renderLockPage(cdnHost(env, request));
      }
      const assetUrl = new URL(`/${PAGE_ASSETS[pathname]}`, url);
      return serveHtmlAsset(new Request(assetUrl, request), env, resolveLang(request));
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  worker_default as default
};
