// 快照 —— 事实库的还原点。
//
// 为什么需要它:这一页此前**做错任何一步都回不了头** —— 误删一条经历、改掉一段自我评价、
// 导入一份 JSON 整份覆盖,全都没有撤销。而机器其实早有一半:服务端一直在往 R2 写快照,
// 只是界面上看不见、也恢复不了(它还被捆在「导出配置」那个按钮上顺手做掉)。
//
// 现在是显式功能:能建、能看、能恢复、能删,住在顶栏「管理」抽屉里(见 manage.mjs)——
// 它是**对文档的操作**,不是一类事实,所以不进文档本身。
// **恢复是整份覆盖** —— 所以服务端在覆盖前会自己先留一份
// (否则"恢复"本身就成了不可撤销的破坏性操作)。
//
// **恢复的确认框不在这里**:它和「导入」是同一件事(拿一份外来 JSON 整份替换事实),
// 所以共用 main.mjs 的 `confirmOverwrite`(差异表 + 那句"会自动留一份" + 未保存闸门)。
// 算差异要拿现有 state 比,而 state 在那一层 —— 这里只负责"点了哪一条"。
import { h, clear } from '../lib/dom.mjs';
import { icon } from '../lib/icons.mjs';
import { tr } from '../lib/i18n.mjs';
import { confirmAction } from '../lib/confirm.mjs';
import { listSnapshots, createSnapshot, renameSnapshot, deleteSnapshot } from '../lib/api.mjs';

const when = (iso, lang) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(lang === 'en' ? 'en' : 'zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

/**
 * @param {object} opts
 * @param {string} opts.lang
 * @param {(key: string) => Promise<boolean>} opts.onRestore 点了"恢复"——**确认与执行都在上层**
 *   (它握着 state 与未保存闸门);resolve true 表示覆盖真的发生了
 */
export function createSnapshots({ lang, onRestore }) {
  const root = h('div', { class: 'snap' });
  const listEl = h('div', { class: 'snap-list' });
  const noteEl = h('input', {
    type: 'text',
    class: 'fc-input snap-note',
    placeholder: tr('snapshot.notePlaceholder'),
    'aria-label': tr('snapshot.notePlaceholder'),
    maxlength: '120',
  });

  const toast = (ok, msg) => window.Toast && window.Toast[ok ? 'ok' : 'err'](msg);

  const refresh = async () => {
    clear(listEl);
    listEl.append(h('p', { class: 'snap-empty' }, tr('snapshot.loading')));
    let snapshots = [];
    try {
      ({ snapshots } = await listSnapshots());
    } catch (err) {
      clear(listEl);
      listEl.append(h('p', { class: 'snap-empty' }, String(err.message || err)));
      return;
    }
    clear(listEl);
    if (!snapshots.length) {
      listEl.append(h('p', { class: 'snap-empty' }, tr('snapshot.none')));
      return;
    }
    for (const s of snapshots) {
      const stamp = when(s.uploaded, lang);
      // **默认名字就是时间戳**(覆盖前自动留的那几份再缀一句「覆盖保护」)——
      // 此前是「时间」「副标题」两栏并排,而绝大多数快照的副标题是空的:
      // 两栏各占地方,一栏还常年没内容。合成一个可改的名字,行短一半。
      const kindLabel = s.kind ? tr('snapshot.autoKind') : '';
      const defaultLabel = kindLabel ? `${stamp}（${kindLabel}）` : stamp;
      const label = s.note || defaultLabel;

      // 四个动作一律用记号 —— 写成字(改备注 / 查看 / 恢复 / 删除)会把一行挤满,
      // 而内容才是要读的东西。记号一律配 aria-label + title:
      // 图标按钮没有可访问名就是给读屏的人一个空按钮。
      const iconBtn = (name, actLabel, onClick) =>
        h(
          'button',
          { type: 'button', class: 'snap-act', title: actLabel, 'aria-label': `${actLabel}：${label}`, onClick },
          icon(name)
        );

      // **改名改的是这个字样,改不掉它是哪一份**:创建时刻(存在键里)与「覆盖保护」
      // (存在 kind 里)都是不可改属性,改名一个字节都碰不到。所以即使名字被改成
      // 「投某某公司之前」,tooltip 里仍然说得出真正的时间与来历。
      // hover 里**一律**给出默认字样(时间 + 覆盖保护)—— 它是这份快照的**不可改属性**:
      // 创建时刻存在键里、来历存在 kind 里,改名一个字节都碰不到。
      // 没改过名时它和显示的字相同,那也照挂 —— 少一个"什么时候该挂"的特例。
      const labelEl = h('span', { class: 'snap-name', title: defaultLabel }, label);

      // 行内改(点笔 → 变输入框 → 回车/失焦即存,Esc 取消);
      // 不弹框,因为它是个小得不值一次打断的动作。
      const rename = () => {
        const input = h('input', {
          type: 'text',
          class: 'fc-input snap-rename',
          // 带出**当前看到的那个字样**(没改过就是默认的时间戳)—— 用户说的"直接改这个字样"
          value: label,
          placeholder: defaultLabel,
          'aria-label': tr('snapshot.rename'),
          maxlength: '120',
        });
        let settled = false;
        const commit = async (save) => {
          if (settled) return;
          settled = true;
          const next = input.value.trim();
          input.replaceWith(labelEl);
          // 改回默认字样 = 没起名字,存空的,免得默认值被当成用户写的固化下来
          const nextNote = next === defaultLabel ? '' : next;
          if (!save || nextNote === (s.note || '')) return;
          try {
            await renameSnapshot(s.key, nextNote);
            refresh();
          } catch (err) {
            toast(false, String(err.message || err));
          }
        };
        input.addEventListener('blur', () => commit(true));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commit(true);
          if (e.key === 'Escape') commit(false);
        });
        labelEl.replaceWith(input);
        input.focus();
        input.select();
      };

      listEl.append(
        h(
          'div',
          { class: 'snap-row' },
          labelEl,
          iconBtn('pencil', tr('snapshot.rename'), rename),
          // 「查看」——在新窗口只读地打开这份快照的全部信息。恢复是不可逆的整份覆盖,
          // 在此之前应该能**先看清楚里面是什么**;差异表只说"哪些数变了"。
          // 新窗口是因为这一页可能正编着东西。它是链接不是按钮,所以单独写。
          h(
            'a',
            {
              class: 'snap-act',
              title: tr('snapshot.view'),
              'aria-label': `${tr('snapshot.view')}：${label}`,
              // 名字随 URL 带过去 —— 它只在列表的元数据里,快照正文里没有,
              // 而横幅上"这是哪一份"正需要它
              href: `/edit?snapshot=${encodeURIComponent(s.key)}&note=${encodeURIComponent(label)}`,
              target: '_blank',
              rel: 'noopener',
            },
            icon('eye')
          ),
          // **恢复走的是和导入同一个确认框**(差异表 + 三个选项),不是这里一句 confirm ——
          // 恢复同样是整份覆盖,凭什么少那张表。框由上层弹,因为算差异要拿现有 state 比。
          iconBtn('history', tr('snapshot.restore'), () => onRestore(s.key).then((ok) => ok && refresh())),
          iconBtn('trash', tr('action.delete'), () =>
            confirmAction(tr('snapshot.confirmDelete'), async () => {
              await deleteSnapshot(s.key);
              refresh();
            })
          )
        )
      );
    }
  };

  root.append(
    h(
      'div',
      { class: 'snap-create' },
      noteEl,
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onClick: async () => {
            try {
              await createSnapshot(noteEl.value.trim());
              noteEl.value = '';
              toast(true, tr('snapshot.created'));
              refresh();
            } catch (err) {
              toast(false, String(err.message || err));
            }
          },
        },
        icon('plus'),
        ` ${tr('snapshot.create')}`
      )
    ),
    listEl
  );

  refresh();
  root.hasPendingEdit = () => false;
  return root;
}
