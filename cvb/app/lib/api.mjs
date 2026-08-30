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

// 多语种事实:`flang` 指定语种文档,不传 = 默认语种(worker 侧同一约定)
const withFlang = (path, flang) => (flang ? `${path}?flang=${encodeURIComponent(flang)}` : path);

/** 读简历。无数据返回 null。 */
export async function fetchResume(flang) {
  const res = await fetch(withFlang('/api/resume', flang));
  if (res.status === 404) return null;
  const payload = await jsonOrThrow(res);
  return payload.config;
}

/** 保存简历(需解锁)。 */
export async function saveResume(config, flang) {
  return jsonOrThrow(
    await fetch(withFlang('/api/resume', flang), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
  );
}

/** 事实语言清单:{ source, langs: [{lang, updatedAt}] }。 */
export async function listFactsLangs() {
  return jsonOrThrow(await fetch('/api/resume/langs'));
}

/** 新增语种。底稿三选:config = 客户端译好的完整文档(从所选语种翻译),
 *  seed:'empty' = 空白文档;都不带 = 克隆默认语种(遗留契约,空库建档也走它)。 */
export async function createFactsLang(lang, { seed, config } = {}) {
  const body = { lang };
  if (config) body.config = config;
  else if (seed) body.seed = seed;
  return jsonOrThrow(
    await fetch('/api/resume/langs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** 改判默认语种(不带 flang 的读取、含生成侧,改用这一份;只挪管线指针)。 */
export async function setFactsSource(lang) {
  return jsonOrThrow(
    await fetch('/api/resume/langs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: lang }),
    })
  );
}

/** 删除一个语种版本(任何语种都可删;删默认且剩不止一个时须带 newDefault)。快照处置两个开关:
 *  snapshot=true 删行前留一份「删除保护」(留不成不删);
 *  purge=true 连既有历史快照一并清掉(清不成不删)。 */
export async function deleteFactsLang(lang, { snapshot = true, purge = false, newDefault = '' } = {}) {
  return jsonOrThrow(
    await fetch('/api/resume/langs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang, snapshot, purge, newDefault }),
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
/** 快照 —— 服务端的还原点。「导出配置」是下载到本机,那是另一回事。 */
export async function listSnapshots(flang) {
  return jsonOrThrow(await fetch(withFlang('/api/snapshots', flang)));
}

/**
 * 建一个还原点。
 * @param {string} [note] 用户随手写的名字(可改;空着就由界面按时间算一个默认的)
 * @param {''|'before-restore'|'before-import'|'before-delete'} [kind] **不可改属性**:是不是自动留的、为什么留。
 *   它与 note 分开存 —— 早先塞在 note 里当哨兵,而 note 现在能改,一改名哨兵就没了。
 */
export async function createSnapshot(note = '', kind = '', flang) {
  return jsonOrThrow(
    await fetch(withFlang('/api/snapshots', flang), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, kind }),
    })
  );
}

/**
 * 读某个快照的正文。恢复前要拿它算差异 —— 恢复和导入一样是整份覆盖,
 * 不该少那张"看清楚再覆盖"的表。走 `/files/`(门禁之后,同源带 cookie)。
 */
export async function fetchSnapshotConfig(key) {
  const res = await fetch(`/files/${key}`);
  if (!res.ok) {
    const err = new Error(`HTTP_${res.status}`);
    err.code = res.status === 401 ? 'UNAUTHORIZED' : `HTTP_${res.status}`;
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * 用某个快照**整份覆盖**当前事实。
 * @param {string} key 快照的 R2 键
 * @param {boolean} [snapshot=true] 覆盖前要不要让服务端先留一份还原点。
 *   界面上「直接覆盖」这一档必须真的不留 —— 否则那个按钮是句空话。
 */
export async function restoreSnapshot(key, snapshot = true) {
  return jsonOrThrow(
    await fetch('/api/snapshots/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, snapshot }),
    })
  );
}

/**
 * 给快照改个名字(只换备注,正文一个字节不动)。
 * 服务端要把对象原样 put 回去 —— 所以列表的时间与排序看的是键里的时间戳,不是 `uploaded`。
 */
export async function renameSnapshot(key, note) {
  return jsonOrThrow(
    await fetch('/api/snapshots', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, note }),
    })
  );
}

export async function deleteSnapshot(key) {
  return jsonOrThrow(
    await fetch('/api/snapshots', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
  );
}

/**
 * 招聘页代拉(职位信息的链接入口)。**浏览器自己取不了** —— 跨域招聘页一律被 CORS
 * 挡下,所以由 worker 代拉;那条路由是个 SSRF 面,护栏在 server/utils/job-fetch.js。
 * 回 `{text, title, url}`。
 */
export async function fetchJobPage(url) {
  return jsonOrThrow(
    await fetch('/api/job/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
  );
}

// ---- 职位记录(/apply 的「新建职位/管理职位」,2026-08-30)----
// 列表不带 JD 正文(画芯片用不着);正文按 id 单取。

export async function listJobs() {
  return jsonOrThrow(await fetch('/api/jobs'));
}

export async function fetchJob(id) {
  return jsonOrThrow(await fetch(`/api/jobs/${encodeURIComponent(id)}`));
}

export async function createJob(record) {
  return jsonOrThrow(
    await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    })
  );
}

export async function updateJob(id, record) {
  return jsonOrThrow(
    await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    })
  );
}

export async function deleteJob(id) {
  return jsonOrThrow(await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export const isUnauthorized = (err) => err && (err.code === 'UNAUTHORIZED' || err.status === 401);

export function redirectToUnlock() {
  window.location.href = '/unlock';
}
