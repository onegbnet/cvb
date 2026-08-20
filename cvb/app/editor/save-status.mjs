// 保存状态 → 顶栏字样的映射。纯函数,不碰 DOM —— 判断进 jest,渲染留在 main.mjs。
//
// 三档,按险情从高到低判:
// - 失败(有 error):「未保存」—— 改动还在内存里,落不落得了盘未知。
//   TOO_LARGE 不会自动重试,断网/5xx 在退避重试;两种都如实标着,成功那一刻才翻绿。
// - 在途(dirty 或 saving):「保存中…」—— 600ms 防抖窗口与请求在途都算:
//   对用户而言"改了还没落盘"是同一件事,不按内部机器状态细分。
// - 干净:「已保存」—— 内存与服务端一致。页面刚载入时就是这一档。

/**
 * @param {{dirty: boolean, saving: boolean, error: string}} saveState
 * @returns {{key: string, err: boolean}} key 是 i18n 键;err 为真时上告警色
 */
export function saveStatusView({ dirty, saving, error }) {
  if (error) return { key: 'editor.saveStateFailed', err: true };
  if (dirty || saving) return { key: 'editor.saveStateSaving', err: false };
  return { key: 'editor.saveStateSaved', err: false };
}
