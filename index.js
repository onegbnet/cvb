var __create=Object.create;var __defProp=Object.defineProperty;var __getOwnPropDesc=Object.getOwnPropertyDescriptor;var __getOwnPropNames=Object.getOwnPropertyNames;var __getProtoOf=Object.getPrototypeOf,__hasOwnProp=Object.prototype.hasOwnProperty;var __commonJS=(cb,mod)=>function(){try{return mod||(0,cb[__getOwnPropNames(cb)[0]])((mod={exports:{}}).exports,mod),mod.exports}catch(e){throw mod=0,e}};var __copyProps=(to,from,except,desc)=>{if(from&&typeof from=="object"||typeof from=="function")for(let key of __getOwnPropNames(from))!__hasOwnProp.call(to,key)&&key!==except&&__defProp(to,key,{get:()=>from[key],enumerable:!(desc=__getOwnPropDesc(from,key))||desc.enumerable});return to};var __toESM=(mod,isNodeMode,target)=>(target=mod!=null?__create(__getProtoOf(mod)):{},__copyProps(isNodeMode||!mod||!mod.__esModule?__defProp(target,"default",{value:mod,enumerable:!0}):target,mod));var require_mma=__commonJS({"server/providers/mma.js"(exports,module){var stripTrailingSlash=value=>value.replace(/\/+$/,""),buildUpstreamError=async response=>{let detail=`mma request failed with status ${response.status}`;try{let payload=await response.json();payload?.detail&&(detail=`mma request failed: ${payload.detail}`)}catch{}let error=new Error(detail);return error.code="AI_UPSTREAM_REQUEST_FAILED",error},requestMMACompletion=async(config,prompt,fetchImpl=fetch)=>{let url=`${stripTrailingSlash(config.baseUrl)}/v1/chat`,body={message:prompt,stream:!1};config.model?body.model=config.model:body.strength=config.strength;let response=await fetchImpl(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${config.apiKey}`},body:JSON.stringify(body)});if(!response.ok)throw await buildUpstreamError(response);return(await response.json())?.reply||""};module.exports={requestMMACompletion}}});var require_providers=__commonJS({"server/providers/index.js"(exports,module){var{requestMMACompletion}=require_mma(),requestAICompletion=async(config,prompt,fetchImpl=fetch)=>{if(config.provider==="mma")return requestMMACompletion(config,prompt,fetchImpl);let error=new Error(`Unsupported AI provider: ${config.provider}`);throw error.code="AI_UNSUPPORTED_PROVIDER",error};module.exports={requestAICompletion}}});var require_ai_config=__commonJS({"server/utils/ai-config.js"(exports,module){var parseTimeout=value=>{let parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?parsed:3e4},buildConfigError=(message,code="AI_PROVIDER_NOT_CONFIGURED")=>{let error=new Error(message);return error.code=code,error},DEFAULT_MMA_BASE_URL="https://mma.11270115.xyz",MMA_STRENGTHS=["low","medium","high"],resolveMMAConfig=env=>{if(!env.MMA_API_KEY)throw buildConfigError("mma tenant key is missing");let strength=env.MMA_STRENGTH||"medium";if(!env.MMA_MODEL&&!MMA_STRENGTHS.includes(strength))throw buildConfigError("mma strength must be low/medium/high");return{provider:"mma",apiKey:env.MMA_API_KEY,baseUrl:env.MMA_BASE_URL||DEFAULT_MMA_BASE_URL,model:env.MMA_MODEL||void 0,strength,timeoutMs:parseTimeout(env.AI_TIMEOUT_MS)}},resolveAIConfig=(env={})=>{let provider=env.AI_PROVIDER;if(!provider)throw buildConfigError("AI provider is missing");if(provider==="mma")return resolveMMAConfig(env);throw buildConfigError("Unsupported AI provider","AI_UNSUPPORTED_PROVIDER")};module.exports={DEFAULT_TIMEOUT_MS:3e4,resolveAIConfig,resolveMMAConfig}}});var require_ai_payload=__commonJS({"server/utils/ai-payload.js"(exports,module){var AI_INVALID="AI_INVALID_RESPONSE",invalid=message=>{let error=new Error(message);return error.code=AI_INVALID,error},stripFence=content=>typeof content!="string"?"":content.trim().replace(/^```[a-zA-Z]*\s*/,"").replace(/\s*```$/,"").trim(),parseJsonPayload=content=>{let text=stripFence(content);if(!text)throw invalid("AI response content is empty");try{return JSON.parse(text)}catch{throw invalid("AI response is not valid JSON")}},parseCandidates=content=>{let parsed=parseJsonPayload(content);if(!Array.isArray(parsed?.candidates))throw invalid("AI response does not contain candidates");return parsed.candidates.filter(item=>typeof item=="string").map(item=>item.trim()).filter(Boolean)},toClientPayload=candidates=>({candidates:candidates.map((content,index)=>({id:`candidate-${index+1}`,content}))});module.exports={stripFence,parseJsonPayload,parseCandidates,toClientPayload}}});var require_ai=__commonJS({"server/routes/ai.js"(exports,module){var{requestAICompletion}=require_providers(),{resolveAIConfig}=require_ai_config(),{parseCandidates,toClientPayload}=require_ai_payload(),createErrorResponse=(statusCode,code,message)=>({statusCode,payload:{error:{code,message}}}),handleAIImproveRequest2=async(body,{env=process.env,fetchImpl}={})=>{if(!body||typeof body.prompt!="string"||!body.prompt.trim())return createErrorResponse(400,"AI_BAD_REQUEST","Prompt is required for AI improvement");let config;try{config=resolveAIConfig(env)}catch(error){return createErrorResponse(500,error.code||"AI_PROVIDER_NOT_CONFIGURED",error.message||"AI provider is not configured")}let requestFetch=fetchImpl||globalThis.fetch;if(!requestFetch)return createErrorResponse(500,"AI_PROXY_UNAVAILABLE","Fetch implementation is not available");try{let content=await requestAICompletion(config,body.prompt,requestFetch),candidates=parseCandidates(content);return{statusCode:200,payload:toClientPayload(candidates)}}catch(error){return error.code==="AI_INVALID_RESPONSE"?createErrorResponse(502,error.code,error.message):createErrorResponse(502,error.code||"AI_UPSTREAM_REQUEST_FAILED",error.message||"AI upstream request failed")}};module.exports={handleAIImproveRequest:handleAIImproveRequest2}}});function isValidLock(val){return typeof val=="string"&&/^[\x21-\x7e]{3,64}$/.test(val)}async function hashToken(prefix,pw){let data=new TextEncoder().encode(prefix+pw),hash=await crypto.subtle.digest("SHA-256",data);return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,"0")).join("")}async function safeEqual(a,b){let enc=new TextEncoder,key=await crypto.subtle.importKey("raw",enc.encode("_cmp_"),{name:"HMAC",hash:"SHA-256"},!1,["sign"]),[sa,sb]=await Promise.all([crypto.subtle.sign("HMAC",key,enc.encode(String(a||""))),crypto.subtle.sign("HMAC",key,enc.encode(String(b||"")))]),ua=new Uint8Array(sa),ub=new Uint8Array(sb),d=0;for(let i=0;i<ua.length;i++)d|=ua[i]^ub[i];return d===0}function makeLockModule({cookieName,hashPrefix,unlockPath,appName,errorCode="UNAUTHORIZED",apiBypass=()=>!1,slugBypass=()=>!1,lockPageHtml,cookieSecure=!0,openWhenUnset=!0}={}){for(let[k,v]of Object.entries({cookieName,hashPrefix,unlockPath,appName,lockPageHtml}))if(v==null||v==="")throw new Error(`makeLockModule: missing required option "${k}"`);if(cookieSecure!==!0&&cookieSecure!==!1&&cookieSecure!=="auto")throw new Error("makeLockModule: cookieSecure must be true, false or 'auto'");let cookieRe=new RegExp(`(?:^|;\\s*)${cookieName.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}=([^;]+)`);async function handleUnlock(request,env){let headers={"Content-Type":"application/json"};if(!isValidLock(env.LOCK)){if(openWhenUnset)return new Response(JSON.stringify({ok:!0}),{headers});if(env.LOCK==null||env.LOCK==="")return new Response(JSON.stringify({ok:!1,error:"LOCK_NOT_CONFIGURED"}),{status:403,headers})}let input;try{input=await request.json()}catch{return new Response(JSON.stringify({ok:!1,error:"INVALID_JSON"}),{status:400,headers})}if(!await safeEqual(input.password||"",env.LOCK))return new Response(JSON.stringify({ok:!1}),{status:403,headers});let token=await hashToken(hashPrefix,env.LOCK),maxAge=input.remember?2592e3:86400,secure=cookieSecure===!0||cookieSecure==="auto"&&new URL(request.url).protocol==="https:";return new Response(JSON.stringify({ok:!0}),{headers:{"Content-Type":"application/json","Set-Cookie":`${cookieName}=${token}; Path=/; HttpOnly;${secure?" Secure;":""} SameSite=Strict; Max-Age=${maxAge}`}})}async function isAuthorized(request,env){if(!isValidLock(env.LOCK)){if(openWhenUnset)return!0;if(env.LOCK==null||env.LOCK==="")return!1}if(apiBypass(request))return!0;let m=(request.headers.get("Cookie")||"").match(cookieRe);return m?await safeEqual(m[1],await hashToken(hashPrefix,env.LOCK)):!1}function renderLockPage(cdnHost2){return new Response(lockPageHtml.replace(/\{\{CDN_HOST\}\}/g,cdnHost2),{headers:{"Content-Type":"text/html;charset=UTF-8"}})}return{cookieName,hashPrefix,unlockPath,appName,errorCode,cookieSecure,openWhenUnset,isValidLock,hashToken:pw=>hashToken(hashPrefix,pw),safeEqual,handleUnlock,isAuthorized,renderLockPage,apiBypass,slugBypass}}var SUPPORTED_LANGS_DEFAULT=["en","eo","fr","de","es","it","nl","da","zh-cn","zh-tw","ja","ko","ms","vi","th","ta","my","uk","he","ar"];function detectLangFromAcceptLanguage(headerString,supported){if(supported=supported||SUPPORTED_LANGS_DEFAULT,!headerString)return"en";let candidates=headerString.split(",").map(s=>s.split(";")[0].trim().toLowerCase()).filter(Boolean);for(let l of candidates){if(supported.indexOf(l)!==-1)return l;if(/^zh-(hant|tw|hk|mo)/.test(l)&&supported.indexOf("zh-tw")!==-1)return"zh-tw";if(/^zh/.test(l)&&supported.indexOf("zh-cn")!==-1)return"zh-cn";let p=l.split("-")[0];if(supported.indexOf(p)!==-1)return p}return"en"}var HOST_DEFAULT="cdn.jsdelivr.net",HOST_CN="jsd.onmicrosoft.cn";function selectJsdelivrCdnHost(request){return request&&request.cf&&request.cf.country==="CN"?HOST_CN:HOST_DEFAULT}function makeJsdelivrUrl(host,pkg,version,file){return`https://${host}/npm/${pkg}@${version}/${file}`}function makeJsdelivrGhUrl(host,repo,sha,file){return`https://${host}/gh/${repo}@${sha}/${file}`}function buildSetCookie(name,value,opts={}){let parts=[`${name}=${encodeURIComponent(value)}`];return parts.push(`Path=${opts.path||"/"}`),opts.maxAge!=null&&parts.push(`Max-Age=${opts.maxAge}`),opts.domain&&parts.push(`Domain=${opts.domain}`),opts.secure!==!1&&parts.push("Secure"),opts.httpOnly&&parts.push("HttpOnly"),parts.push(`SameSite=${opts.sameSite||"Lax"}`),parts.join("; ")}var DEFAULT_VALID_THEMES=new Set(["light","dark"]),DEFAULT_VALID_LANGS=new Set(SUPPORTED_LANGS_DEFAULT),DEFAULT_COOKIE_NAMES={theme:"theme",lang:"lang"},DEFAULT_MAX_AGE=31536e3;function buildPrefCookies(prefs,options={}){let cookieNames={...DEFAULT_COOKIE_NAMES,...options.cookieNames||{}},validThemes=options.validThemes||DEFAULT_VALID_THEMES,validLangs=options.validLangs||DEFAULT_VALID_LANGS,cookieOpts={maxAge:options.maxAge||DEFAULT_MAX_AGE,sameSite:"Lax"},out=[];if(typeof prefs.theme=="string"){if(!validThemes.has(prefs.theme))throw new Error("Invalid theme");out.push(buildSetCookie(cookieNames.theme,prefs.theme,cookieOpts))}if(typeof prefs.lang=="string"){if(!validLangs.has(prefs.lang))throw new Error("Invalid lang");out.push(buildSetCookie(cookieNames.lang,prefs.lang,cookieOpts))}return out}async function handlePrefs(request,options){let body;try{body=await request.json()}catch{return jsonResponse({error:"Invalid JSON"},400)}let cookies;try{cookies=buildPrefCookies(body,options)}catch(e){return jsonResponse({error:e.message},400)}return cookies.length===0?jsonResponse({error:"No prefs to update"},400):new Response(JSON.stringify({ok:!0}),{status:200,headers:{"Content-Type":"application/json","Set-Cookie":cookies.join(", ")}})}function jsonResponse(body,status){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}})}var import_ai=__toESM(require_ai(),1);var utf8Bytes=text=>new TextEncoder().encode(String(text??"")).byteLength,checkConfigSize=serialized=>{let bytes=utf8Bytes(serialized);return bytes>1991808?{ok:!1,bytes,limit:1991808}:{ok:!0,bytes}};var TEXLYRE_BUSYTEX_VERSION="1.3.1",TEX_ENGINE_ASSET_REVISION=8,TEX_ENGINE_ASSET_VERSION=`${TEXLYRE_BUSYTEX_VERSION}-r${TEX_ENGINE_ASSET_REVISION}`,TEX_ENGINE_ASSETS_DIR="tex-engine";function makeTexEngineWrapperUrl(cdnHost2){return makeJsdelivrUrl(cdnHost2,"texlyre-busytex",TEXLYRE_BUSYTEX_VERSION,"dist/index.js")}function makeTexEngineAssetBase(cdnHost2,ccsSha){return makeJsdelivrGhUrl(cdnHost2,"onegbnet/ccs",ccsSha,TEX_ENGINE_ASSETS_DIR)}var TEX_CACHE_PREFIX="cvb-tex-engine-",TEX_CACHE_KEY_ORIGIN="https://tex-engine.cvb.internal",texCacheName=assetVersion=>`${TEX_CACHE_PREFIX}${assetVersion}`,texCacheKey=(assetVersion,relPath)=>`${TEX_CACHE_KEY_ORIGIN}/${encodeURIComponent(assetVersion)}/${relPath}`,TEX_GZIPPED_ASSETS=new Set(["busytex.wasm"]);var TEX_WORKER_SHIM_PATH="/tex-worker.js",BUSYTEX_WORKER_FILE="busytex_worker.js",TEX_ENGINE_PLACEHOLDER="{{TEX_ENGINE}}",TRUTHY=new Set(["1","true","yes","on"]);function isTexEngineEnabled(env){let raw=env&&env.TEX_ENGINE_ENABLED;return TRUTHY.has(String(raw??"").trim().toLowerCase())}var isSha=s=>typeof s=="string"&&/^[0-9a-f]{40}$/.test(s);function buildTexEngineConfig({request,env,ccsSha}={}){if(!isTexEngineEnabled(env)||!isSha(ccsSha))return null;let host=selectJsdelivrCdnHost(request),assetVersion=TEX_ENGINE_ASSET_VERSION;return{wrapperUrl:makeTexEngineWrapperUrl(host),assetBase:makeTexEngineAssetBase(host,ccsSha),assetVersion,templateBase:`https://${host}/gh/onegbnet/ccs@${ccsSha}/tex-templates`,useWorker:!0,workerUrl:`${TEX_WORKER_SHIM_PATH}?v=${encodeURIComponent(assetVersion)}-${ccsSha.slice(0,8)}`}}var jsonForHtml=value=>JSON.stringify(value).replace(/</g,"\\u003c").replace(/>/g,"\\u003e").replace(/&/g,"\\u0026");function renderTexEngineScript(cfg){return cfg?`<!-- TeX \u5F15\u64CE(worker \u6CE8\u5165):assetVersion \u5373\u7F13\u5B58\u4EE3\u53F7,\u8D44\u4EA7\u5B57\u8282\u53D8\u4E86\u5FC5\u987B +1 ccs \u7684 TEX_ENGINE_ASSET_REVISION -->
<script>window.__TEX_ENGINE__ = ${jsonForHtml(cfg)};<\/script>`:""}function renderTexWorkerShim({assetBase,assetVersion}){let base=JSON.stringify(`${String(assetBase).replace(/\/+$/,"")}/`),cacheName=JSON.stringify(texCacheName(assetVersion)),prefix=JSON.stringify(TEX_CACHE_PREFIX),keyBase=JSON.stringify(texCacheKey(assetVersion,"")),gzipped=JSON.stringify(Object.fromEntries([...TEX_GZIPPED_ASSETS].map(p=>[p,p.endsWith(".wasm")?"application/wasm":"application/octet-stream"]))),workerFile=JSON.stringify(BUSYTEX_WORKER_FILE);return`// cvb tex worker shim \u2014\u2014 \u670D\u52A1\u7AEF\u751F\u6210(src/tex-engine-config.mjs),\u52FF\u624B\u6539\u3002
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
`}function handleTexWorkerShimRequest({request,env,ccsSha}={}){let cfg=buildTexEngineConfig({request,env,ccsSha});return cfg?new Response(renderTexWorkerShim(cfg),{status:200,headers:{"Content-Type":"text/javascript; charset=utf-8","Cache-Control":"public, max-age=31536000, immutable","X-Content-Type-Options":"nosniff"}}):null}var RESUME_ID="default",MAX_AVATAR_BYTES=2*1024*1024,AVATAR_TYPES={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"},lock=makeLockModule({cookieName:"cvb_auth",hashPrefix:"cvb:",unlockPath:"/unlock",appName:"CV Builder",lockPageHtml:`<!DOCTYPE html>
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
<script>window.LOCK_CONFIG={"unlockPath":"/unlock","appNameI18n":{"en":"CV Builder","eo":"CV Builder","fr":"CV Builder","de":"CV Builder","es":"CV Builder","it":"CV Builder","nl":"CV Builder","da":"CV Builder","zh-cn":"\u7B80\u5386\u751F\u6210\u5668","zh-tw":"\u7C21\u6B77\u7522\u751F\u5668","ja":"CV Builder","ko":"CV Builder","ms":"CV Builder","vi":"CV Builder","th":"CV Builder","ta":"CV Builder","my":"CV Builder","uk":"CV Builder","he":"CV Builder","ar":"CV Builder"}};<\/script><script src="https://{{CDN_HOST}}/gh/onegbnet/ccs@8cabcad1dca072222e002538b4b041745cbbdd0f/lock/client.min.js"><\/script>
</body></html>
`,cookieSecure:"auto",openWhenUnset:!1}),summarizeConfig=serialized=>{try{let c=JSON.parse(serialized);return{name:String(c.basics&&c.basics.name||"").slice(0,60)}}catch{return{name:""}}},AI_ROUTES={"/api/ai/improve":import_ai.handleAIImproveRequest},json=(statusCode,payload,headers={})=>new Response(JSON.stringify(payload),{status:statusCode,headers:{"Content-Type":"application/json; charset=utf-8",...headers}}),unauthorized=()=>json(401,{error:{code:"UNAUTHORIZED",message:"Unlock required"}}),schemaReady=null,ensureSchema=env=>schemaReady??=env.DB.prepare(`CREATE TABLE IF NOT EXISTS resumes (
       id TEXT PRIMARY KEY,
       config TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`).run(),cdnHost=(env,request)=>env.CCS_CDN_BASE||selectJsdelivrCdnHost(request),CCS_PIN="8cabcad1dca072222e002538b4b041745cbbdd0f",SUPPORTED_LANGS=["zh-cn","en"],resolveTheme=request=>{let m=(request.headers.get("Cookie")||"").match(/(?:^|;\s*)theme=(light|dark)(?:;|$)/);return m?m[1]:"light"},resolveLang=request=>{let m=(request.headers.get("Cookie")||"").match(/(?:^|;\s*)lang=([^;]+)/);return m&&SUPPORTED_LANGS.includes(m[1])?m[1]:detectLangFromAcceptLanguage(request.headers.get("Accept-Language")||"",SUPPORTED_LANGS)},APP_LICENSE_URL="https://github.com/onegbnet/cvb/blob/main/LICENSE",appAssetUrl=(relativePath,request)=>`https://${selectJsdelivrCdnHost(request)}/gh/onegbnet/cvb@e18cd1f7b546288f14abb72cc689b0f87c9df44f/cvb/${relativePath}`,serveHtmlAsset=async(request,env,lang,theme)=>{let res=await env.ASSETS.fetch(request),contentType=res.headers.get("Content-Type")||"";if(!res.ok||!contentType.includes("text/html"))return res;let texEngine=renderTexEngineScript(buildTexEngineConfig({request,env,ccsSha:CCS_PIN})),html=(await res.text()).replaceAll("{{LANG}}",lang).replaceAll("{{THEME}}",theme).replaceAll("{{CCS_CDN}}",cdnHost(env,request)).replaceAll("{{CCS_PIN}}",CCS_PIN).replaceAll(TEX_ENGINE_PLACEHOLDER,texEngine).replace(/(\b(?:src|href)=['"])(app|static)\//g,(_,prefix,directory)=>`${prefix}${appAssetUrl(`${directory}/`,request)}`).replaceAll('href="/LICENSE"',`href="${APP_LICENSE_URL}"`),headers=new Headers(res.headers);return headers.delete("Content-Length"),new Response(html,{status:res.status,headers})},isPublicRoute=(method,pathname)=>method==="GET"&&pathname==="/health"||pathname==="/unlock"&&(method==="GET"||method==="POST"),PAGE_ASSETS={"/":"home.html","/edit":"index.html","/apply":"preview.html"},worker_default={async fetch(request,env){let url=new URL(request.url),{pathname}=url,method=request.method;if(!isPublicRoute(method,pathname)&&!await lock.isAuthorized(request,env))return method==="GET"&&PAGE_ASSETS[pathname]?lock.renderLockPage(cdnHost(env,request)):unauthorized();if(method==="GET"&&pathname==="/health")return json(200,{ok:!0});if(pathname==="/unlock")return method==="POST"?lock.handleUnlock(request,env):await lock.isAuthorized(request,env)?Response.redirect(new URL("/",url).toString(),302):lock.renderLockPage(cdnHost(env,request));if(method==="GET"&&pathname==="/api/auth")return json(200,{authed:await lock.isAuthorized(request,env)});if(method==="GET"&&pathname===TEX_WORKER_SHIM_PATH){let shim=handleTexWorkerShimRequest({request,env,ccsSha:CCS_PIN});return shim||json(404,{error:{code:"NOT_FOUND",message:"TeX engine disabled"}})}if(method==="POST"&&pathname==="/api/prefs")return handlePrefs(request);if(pathname==="/api/resume"){if(await ensureSchema(env),method==="GET"){let row=await env.DB.prepare("SELECT config, updated_at FROM resumes WHERE id = ?").bind(RESUME_ID).first();return row?json(200,{config:JSON.parse(row.config),updatedAt:row.updated_at}):json(404,{error:{code:"RESUME_NOT_FOUND",message:"No resume stored yet"}})}if(method==="PUT"){let config;try{config=await request.json()}catch{return json(400,{error:{code:"BAD_REQUEST",message:"Body must be valid JSON"}})}if(!config||typeof config!="object"||Array.isArray(config))return json(400,{error:{code:"BAD_REQUEST",message:"Config must be an object"}});let serialized=JSON.stringify(config),size=checkConfigSize(serialized);if(!size.ok)return json(413,{error:{code:"TOO_LARGE",message:`Config is ${size.bytes} bytes, limit is ${size.limit}`,bytes:size.bytes,limit:size.limit}});let now=Date.now();return await env.DB.prepare(`INSERT INTO resumes (id, config, created_at, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`).bind(RESUME_ID,serialized,now,now).run(),json(200,{ok:!0,updatedAt:now})}return json(405,{error:{code:"METHOD_NOT_ALLOWED",message:"Use GET or PUT"}})}if(method==="POST"&&pathname==="/api/avatar"){let contentType=(request.headers.get("Content-Type")||"").split(";")[0].trim(),ext=AVATAR_TYPES[contentType];if(!ext)return json(415,{error:{code:"UNSUPPORTED_TYPE",message:"png/jpeg/webp/gif only"}});let body=await request.arrayBuffer();if(body.byteLength===0||body.byteLength>MAX_AVATAR_BYTES)return json(413,{error:{code:"TOO_LARGE",message:"Avatar must be 1B-2MB"}});let key=`avatars/${Date.now()}.${ext}`;return await env.FS.put(key,body,{httpMetadata:{contentType}}),json(200,{ok:!0,url:`/files/${key}`})}let SNAPSHOT_PREFIX="exports/",SNAPSHOT_KINDS=["before-restore","before-import"],normalizeKind=v=>SNAPSHOT_KINDS.includes(String(v||""))?String(v):"",readKind=meta=>{let kind=normalizeKind(meta&&meta.kind);if(kind)return kind;let legacy=String(meta&&meta.note||"");return legacy.startsWith("auto:")?normalizeKind(legacy.slice(5)):""},keyCreatedAt=key=>{let m=/resume-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(key||"");return m?`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`:""};if(pathname==="/api/snapshots"){if(await ensureSchema(env),method==="GET"){let snapshots=(await env.FS.list({prefix:SNAPSHOT_PREFIX,include:["customMetadata"]})).objects.map(o=>({key:o.key,size:o.size,uploaded:keyCreatedAt(o.key)||o.uploaded,note:/^auto:/.test(o.customMetadata&&o.customMetadata.note||"")?"":o.customMetadata&&o.customMetadata.note||"",name:o.customMetadata&&o.customMetadata.name||"",kind:readKind(o.customMetadata)})).sort((a,b)=>new Date(b.uploaded)-new Date(a.uploaded));return json(200,{snapshots})}if(method==="POST"){let row=await env.DB.prepare("SELECT config FROM resumes WHERE id = ?").bind(RESUME_ID).first();if(!row)return json(404,{error:{code:"RESUME_NOT_FOUND",message:"Nothing to snapshot"}});let note="",kind="";try{let body=await request.json();note=String(body&&body.note||"").slice(0,120),kind=normalizeKind(body&&body.kind)}catch{}let key=`${SNAPSHOT_PREFIX}resume-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;return await env.FS.put(key,row.config,{httpMetadata:{contentType:"application/json; charset=utf-8"},customMetadata:{note,kind,...summarizeConfig(row.config)}}),json(200,{ok:!0,key})}if(method==="PATCH"){let key="",note="";try{let body=await request.json();key=String(body&&body.key||""),note=String(body&&body.note||"").slice(0,120)}catch{}if(!key.startsWith(SNAPSHOT_PREFIX)||key.includes(".."))return json(400,{error:{code:"INVALID_KEY",message:"Not a snapshot key"}});let object=await env.FS.get(key);if(!object)return json(404,{error:{code:"NOT_FOUND",message:"Snapshot not found"}});let text=await object.text();return await env.FS.put(key,text,{httpMetadata:{contentType:"application/json; charset=utf-8"},customMetadata:{...object.customMetadata||{},note,kind:readKind(object.customMetadata)}}),json(200,{ok:!0,note})}if(method==="DELETE"){let key="";try{let body=await request.json();key=String(body&&body.key||"")}catch{}return!key.startsWith(SNAPSHOT_PREFIX)||key.includes("..")?json(400,{error:{code:"INVALID_KEY",message:"Not a snapshot key"}}):(await env.FS.delete(key),json(200,{ok:!0}))}}if(method==="POST"&&pathname==="/api/snapshots/restore"){await ensureSchema(env);let key="",wantSafety=!0;try{let body=await request.json();key=String(body&&body.key||""),body&&body.snapshot===!1&&(wantSafety=!1)}catch{}if(!key.startsWith(SNAPSHOT_PREFIX)||key.includes(".."))return json(400,{error:{code:"INVALID_KEY",message:"Not a snapshot key"}});let object=await env.FS.get(key);if(!object)return json(404,{error:{code:"NOT_FOUND",message:"Snapshot not found"}});let text=await object.text();try{let parsed=JSON.parse(text);if(!parsed||typeof parsed!="object"||Array.isArray(parsed))throw new Error("not an object")}catch{return json(422,{error:{code:"SNAPSHOT_CORRUPT",message:"Snapshot is not valid JSON"}})}let size=checkConfigSize(text);if(!size.ok)return json(413,{error:{code:"CONFIG_TOO_LARGE",message:`${size.bytes} > ${size.limit}`}});let current=wantSafety?await env.DB.prepare("SELECT config FROM resumes WHERE id = ?").bind(RESUME_ID).first():null;if(current){let safety=`${SNAPSHOT_PREFIX}resume-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;await env.FS.put(safety,current.config,{httpMetadata:{contentType:"application/json; charset=utf-8"},customMetadata:{note:"",kind:"before-restore",...summarizeConfig(current.config)}})}let now=Math.floor(Date.now()/1e3);return await env.DB.prepare("INSERT INTO resumes (id, config, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at").bind(RESUME_ID,text,now,now).run(),json(200,{ok:!0,config:JSON.parse(text)})}if(method==="GET"&&pathname.startsWith("/files/")){let key=decodeURIComponent(pathname.slice(7));if(!key||key.includes(".."))return json(400,{error:{code:"INVALID_FILE_KEY",message:"Invalid file key"}});let object=await env.FS.get(key);if(!object)return json(404,{error:{code:"NOT_FOUND",message:"File not found"}});let headers=new Headers;return object.writeHttpMetadata(headers),headers.set("Cache-Control","private, no-store"),new Response(object.body,{headers})}let aiHandler=AI_ROUTES[pathname];if(aiHandler){if(method!=="POST")return json(405,{error:{code:"METHOD_NOT_ALLOWED",message:"Use POST"}});let body;try{body=await request.json()}catch{return json(400,{error:{code:"AI_BAD_REQUEST",message:"Request body must be valid JSON"}})}let result=await aiHandler(body,{env});return json(result.statusCode,result.payload)}if(method==="GET"&&["/index.html","/preview","/preview.html"].includes(pathname))return new Response("Not Found",{status:404});if(method==="GET"&&PAGE_ASSETS[pathname]){let assetUrl=new URL(`/pages/${PAGE_ASSETS[pathname]}`,url);return serveHtmlAsset(new Request(assetUrl,request),env,resolveLang(request),resolveTheme(request))}return env.ASSETS.fetch(request)}};export{worker_default as default};
