// 定向裁剪 / 对话式改版的客户端(SSE)。
//
// **为什么是 SSE 而不是 JSON**:满编简历一次裁剪实测 85~142s(见 server/routes/tailor.js
// 文件头的实测数字),而 Cloudflare 边缘 100s 就 524。流式下连接一直有字节流动,
// 所以不会被掐;顺带还能把进度报给人看 —— 那本来就是一段该给交代的等待。
//
// 这一层**只搬运**:回来的 plan 交给调用方,由 app/apply/tailor.mjs 对着
// 客户端手里的那份事实归一与套用。结构从不离开客户端。
import { tr } from './i18n.mjs';

const ERROR_KEYS = {
  AI_PROVIDER_NOT_CONFIGURED: 'ai.notConfigured',
  AI_PROXY_UNAVAILABLE: 'ai.unavailable',
  AI_INVALID_RESPONSE: 'ai.parseFailed',
  AI_UPSTREAM_REQUEST_FAILED: 'ai.failed',
  AI_BAD_REQUEST: 'ai.failed',
  AI_TEXT_TOO_LARGE: 'apply.tailorTooLarge',
};

const fail = (code, message) => {
  const err = new Error(tr(ERROR_KEYS[code] || 'ai.failed', message || code));
  err.code = code;
  return err;
};

/**
 * 跑一轮。`onProgress(chars)` 在每个 delta 上回调(字符数,给进度用 ——
 * 上游首个内容 delta 实测要到几秒甚至几十秒才出现,那之前只有 meta)。
 * 回 `{ plan, sessionId, rotated, compacted, usage, model }`。
 */
export async function runTailor(path, body, { onProgress } = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // 出错在开流之前(400/413/500)时回的是 JSON,不是 SSE
  const type = String(res.headers.get('content-type') || '');
  if (!type.includes('text/event-stream')) {
    let payload = null;
    try { payload = await res.json(); } catch { /* 非 JSON */ }
    const code = (payload && payload.error && payload.error.code) || `HTTP_${res.status}`;
    throw fail(code, payload && payload.error && payload.error.message);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let event = null;
  let chars = 0;
  let done = null;
  let error = null;

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) continue;
      let data;
      try { data = JSON.parse(line.slice(5)); } catch { continue; }
      if (event === 'delta') {
        chars += String(data.text || '').length;
        if (onProgress) onProgress(chars);
      } else if (event === 'done') done = data;
      else if (event === 'error') error = data;
    }
  }

  if (error) throw fail(error.code, error.message);
  if (!done || !done.plan) throw fail('AI_INVALID_RESPONSE');
  return done;
}
