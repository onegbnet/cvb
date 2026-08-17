// 服务端 API 客户端:简历数据(D1)、头像/导出(R2)、鉴权状态。
// 约定:401 抛 code='UNAUTHORIZED' 的 Error,调用方决定是否跳 /unlock。

const jsonOrThrow = async (res) => {
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    const code = (payload && payload.error && payload.error.code) || `HTTP_${res.status}`;
    const err = new Error((payload && payload.error && payload.error.message) || code);
    err.code = code;
    err.status = res.status;
    // 413 会带上实际字节数与上限(见 src/limits.mjs),透传给调用方做人话提示
    if (payload && payload.error) {
      if (payload.error.bytes) err.bytes = payload.error.bytes;
      if (payload.error.limit) err.limit = payload.error.limit;
    }
    throw err;
  }
  return payload;
};

export async function fetchAuth() {
  try {
    const payload = await jsonOrThrow(await fetch('/api/auth'));
    return Boolean(payload && payload.authed);
  } catch {
    return false;
  }
}

/** 读简历(公开)。无数据返回 null。 */
export async function fetchResume() {
  const res = await fetch('/api/resume');
  if (res.status === 404) return null;
  const payload = await jsonOrThrow(res);
  return payload.config;
}

/** 保存简历(需解锁)。 */
export async function saveResume(config) {
  return jsonOrThrow(
    await fetch('api/resume', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
  );
}

/** 上传头像到 R2(需解锁),返回站内 URL。 */
export async function uploadAvatar(file) {
  const payload = await jsonOrThrow(
    await fetch('/api/avatar', {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    })
  );
  return payload.url;
}

/** 把当前服务端简历存为 R2 快照(需解锁)。 */
export async function exportSnapshot() {
  return jsonOrThrow(await fetch('/api/export', { method: 'POST' }));
}

export const isUnauthorized = (err) => err && (err.code === 'UNAUTHORIZED' || err.status === 401);

export function redirectToUnlock() {
  window.location.href = '/unlock';
}
