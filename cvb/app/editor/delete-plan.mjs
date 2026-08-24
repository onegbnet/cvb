// 删语种要问哪些问题 —— 纯函数,不碰 DOM(判断进 jest,渲染留在 main.mjs)。
//
// 原则(2026-08-24 用户成文):**有问题才问,没问题不问;一个问题都没有就别拦路。**
// 两个可能的问题各有自己的成立条件:
//
// - **新默认语种**:只有「删的是默认语种、且删后还剩不止一个」才需要人拍板
//   (剩一个自动继任、剩零个回空库,都不是决定 —— 见 §3 默认语种的不变量)。
// - **快照处置**:只有当**真有东西可留可删**时才是个问题。
//   有历史快照 → 三档各不相同;没有历史但文档有内容 → 「保留全部」与「只留删前」
//   等价,实际只有两档(留一份删前快照 / 不留);既没内容也没快照 → 三档全等价,
//   问了等于问一个没有内容的问题。
//
// 两个问题都不成立时 `ask` 为假:直接删,不弹框 —— 空文档删掉不丢任何东西,
// 而删除入口本身已经在抽屉里点过两次了,再拦一次纯属摩擦。

/**
 * @param {object} s
 * @param {boolean} s.isDefault 当前语种是不是默认语种
 * @param {number} s.remainingCount 删掉之后还剩几个语种
 * @param {boolean} s.hasContent 这份文档有没有事实内容
 * @param {number} s.snapshotCount 这个语种现存多少份快照
 * @returns {{ask: boolean, askDefault: boolean, snapOptions: string[]}}
 *   snapOptions 为空 = 不问快照;取值 'keepAll' | 'keepFinal' | 'wipe' | 'keepOne' | 'keepNone'
 */
export function planDeleteQuestions({ isDefault, remainingCount, hasContent, snapshotCount }) {
  const askDefault = !!isDefault && remainingCount >= 2;
  let snapOptions = [];
  if (snapshotCount > 0) {
    snapOptions = ['keepAll', 'keepFinal', 'wipe'];
  } else if (hasContent) {
    // 没有历史可保留,「留一份删前快照」与「不留」才是真正的两档
    snapOptions = ['keepOne', 'keepNone'];
  }
  return { ask: askDefault || snapOptions.length > 0, askDefault, snapOptions };
}

/** 选项 → 服务端契约的两个开关。 */
export function snapChoiceToFlags(choice) {
  switch (choice) {
    case 'keepAll':
      return { snapshot: true, purge: false };
    case 'keepFinal':
      return { snapshot: true, purge: true };
    case 'wipe':
      return { snapshot: false, purge: true };
    case 'keepOne':
      return { snapshot: true, purge: false };
    case 'keepNone':
    default:
      // 没什么可留也没什么可清 —— 别为一份空文档造一份快照
      return { snapshot: false, purge: false };
  }
}
