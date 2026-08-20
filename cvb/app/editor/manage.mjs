// 「管理」抽屉 —— 对**整份事实库**的操作:导入 / 导出 / 快照。
//
// 为什么单独一个面:编辑事实那个文档里 15 个分节全是**关于你的事实**;
// 这三样不是事实,是**对这份文档的操作**。把它们混进文档就是分类错误 ——
// 会让它们冒充一类事实,还挤进同一条锚点索引。
//
// 形态照 sibling:tinycfw 的 mixssl 顶栏一个 ⚙️,`Overlay.show({ variant: 'edge-right' })`
// 开一个右侧抽屉,把配置这类"不是主内容"的东西装进去。这里同一个做法。
import { h } from '../lib/dom.mjs';
import { tr } from '../lib/i18n.mjs';
import { createSnapshots } from './snapshots.mjs';

/**
 * @param {object} opts
 * @param {string} opts.lang
 * @param {() => Node} opts.importControl  导入(带隐藏 file input,原样搬进来)
 * @param {() => Node} opts.exportControl  导出
 * @param {(key: string) => Promise<boolean>} opts.onRestore 点了"恢复"——由上层确认并执行
 */
export function openManageDrawer({ lang, importControl, exportControl, onRestore }) {
  if (!window.Overlay || typeof window.Overlay.show !== 'function') return null;

  // **不配说明句**:「导入」「导出」「快照」这几个词自己说得清,
  // 底下再写一句"这是干什么用的"是在给一个已经懂了的人讲课(2026-08-19 用户判为不专业)。
  //
  // 但**每一块都要有标题**。中间走过一版没有标题的:当时按钮就叫「导入」「导出」,
  // 标题和按钮同一个词、上下重复,所以把标题去掉了;随后导入的按钮改成了
  // 「选择文件」/「粘贴」—— 于是那一整块**连"导入"两个字都没有了**(用户当场看出来)。
  // 现在是标题给"这块是干什么的",按钮给"点了会发生什么",两者不重词:
  // 导入 →「选择文件」「粘贴」,导出 →「下载」,快照 →「创建快照」。
  const group = (titleKey, ...body) =>
    h('section', { class: 'mng-group' }, h('h3', { class: 'mng-h' }, tr(titleKey)), ...body);

  const body = h(
    'div',
    { class: 'mng' },
    // 导入与导出**是两件事,分开放**:导入受格式约束(只吃 JSON Resume),
    // 导出是选一种格式产出。挤在一行里那条约束就没地方说。
    group(
      'action.import',
      h('div', { class: 'mng-row' }, importControl()),
      // **这不是"这是干什么用的"说明,是一条格式约束** —— 拿一份别的格式来是会被拒的,
      // 而拒之前先说清楚,并给出标准本身让人对照。
      h(
        'p',
        { class: 'mng-note' },
        tr('manage.importOnly'),
        ' · ',
        h(
          'a',
          { href: 'https://jsonresume.org/schema/', target: '_blank', rel: 'noopener' },
          tr('manage.importSpec')
        )
      )
    ),
    group('action.export', h('div', { class: 'mng-row' }, exportControl())),
    group(
      'snapshot.title',
      createSnapshots({
        lang,
        // 恢复成功了这个抽屉就该让路 —— 文档已经整份换过,再压着它没有意义
        onRestore: async (key) => {
          const ok = await onRestore(key);
          if (ok) handle && handle.close();
          return ok;
        },
      })
    )
  );

  const handle = window.Overlay.show({
    variant: 'edge-right',
    title: tr('manage.title'),
    body,
  });
  return handle;
}
