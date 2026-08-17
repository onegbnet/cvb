// localStorage 持久化 — key 与 v1 相同,老用户数据无缝继承。
const STORAGE_KEY = 'resume-config';

export function saveToStorage(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* Safari 隐私模式等场景下静默失败 */
  }
}

export function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function clearStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
