// 确认框 —— ccs Overlay.confirm 的**唯一正确调用方式**,全站共用一处。
//
// 两个坑,踩过两次才踩明白(2026-08-15):
//
// ① **它返回 Promise,不认 `onOk` 回调**(见 ccs/overlay/client.mjs 的 modalConfirm:
//    `return h.done`)。传 `{ onOk }` 会被静默忽略 —— 弹框照出、点确定照关,回调永不执行。
//
// ② **必须传 `doAction`,否则"确定"按钮是死的**。modalConfirm 把 OK 按钮建成
//    `Action.create({ asyncFn: opts.doAction, onSuccess: () => h.close(true) })`,
//    而 ccs/action/client.mjs 里:`asyncFn` 不是函数就走「同步 onClick 路径」——
//    modalConfirm 又没给 onClick,于是**点确定什么都不发生**,`h.done` 永不 settle。
//    换句话说 `Overlay.confirm(msg)` 单独调用是不работает的,必须 `{ doAction }`。
//
// 这两个坑合起来的症状完全一样:点确定没反应、不报错、控制台无输出。
// 「删除条目」因此从 2026-08-12 一直坏到 2026-08-15。
//
// 正确形态(tinycfw 也是这么用的):`Overlay.confirm(msg, { doAction })`,
// doAction 抛错 → 对话框留在原地显示错误;正常返回 → 关闭并 resolve。

/**
 * 问一句,确认了才做事。
 * @param {string} message 问句
 * @param {() => any} [action] 用户点"确定"后要做的事(可以是 async;抛错会显示在框里)
 * @returns {Promise<boolean>} 用户是否确认
 */
export const confirmAction = (message, action) => {
  if (!window.Overlay || typeof window.Overlay.confirm !== 'function') {
    // 组件没装上时按"允许"处理:确认框的作用是提醒,不该把人卡死在这一步
    if (typeof action === 'function') action();
    return Promise.resolve(true);
  }
  return Promise.resolve(
    window.Overlay.confirm(message, {
      // doAction 不能省(见上面第 ② 条)。没有动作要做时也得给一个空函数,
      // 否则按钮点了没反应。
      doAction: typeof action === 'function' ? action : () => {},
    })
  ).then(Boolean);
};
