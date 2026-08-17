// TeX 引擎资产缓存的**命名约定**——主线程(app/lib/tex-engine.mjs)与
// worker 线程(src/tex-engine-config.mjs 生成的同源 shim,见 renderTexWorkerShim)
// 共用这一份,两边写的是同一批 Cache API 条目:
//   - 用户先在兼容模式(主线程)编译过,再切到 worker 模式 → 直接命中,不重下 35MB;
//   - 反之亦然。
//
// 键的形态刻意**不含 URL**:assetBase 里的 pin SHA 会因为任何一次 ccs publish 而变
// (ccs-pin.json 是浏览器组件与引擎资产共用的同一个 pin),而引擎字节通常没变。
// 键按 assetVersion(= ccs TEXLYRE_BUSYTEX_VERSION)走,pin bump 不会让用户重下。
// **代价**:资产内容变了而版本号没 bump,用户会吃陈旧缓存 —— 改资产必须 bump 版本号。
//
// 两处消费方都只能读常量、不引入运行时依赖(worker shim 是拼字符串生成的经典脚本)。

/** Cache API 的 cache 名前缀;`${前缀}${assetVersion}` 是一代缓存,换代即清旧。 */
export const TEX_CACHE_PREFIX = 'cvb-tex-engine-';

/** 缓存键的伪 origin(Cache API 的键必须是 URL;这个域名不存在也不会被请求)。 */
export const TEX_CACHE_KEY_ORIGIN = 'https://tex-engine.cvb.internal';

/** 当代 cache 名。 */
export const texCacheName = (assetVersion) => `${TEX_CACHE_PREFIX}${assetVersion}`;

/** 缓存键 = 版本 + 资产相对路径(如 'texlive-core.data' / 'fonts/cjk-sc.otf')。 */
export const texCacheKey = (assetVersion, relPath) =>
  `${TEX_CACHE_KEY_ORIGIN}/${encodeURIComponent(assetVersion)}/${relPath}`;

/**
 * **以 .gz 形态存放**的资产(相对路径)。
 *
 * 只有一件:`busytex.wasm` 原始 31.00MB,而 jsDelivr `/gh/` 单文件上限 20MB,
 * 且 wasm 是单体二进制**不可拆**——拆包这条路对它无效,只能压(gzip 后 12.50MB)。
 * 其余资产一律明文:压缩要在客户端解开,解压与挂载都吃加载性能,
 * **不到物理上限逼迫不用**(2026-08-14 用户裁定)。
 *
 * 消费端对上游代码透明:请求 `busytex.wasm` → 拦截层改取 `.gz` → DecompressionStream
 * 解开 → 以原 Content-Type 返回。上游 busytex 代码完全无感。
 */
export const TEX_GZIPPED_ASSETS = new Set(['busytex.wasm']);

/** 该相对路径在线上是不是压缩存放的。 */
export const isGzippedAsset = (relPath) => TEX_GZIPPED_ASSETS.has(String(relPath || ''));
