// 编辑事实(/edit):lock 门禁 + 纯 JSON Resume 数据 + 四个版块的一级导航 + 页内可折叠 Group。
// 架构从数据结构推出(见 CLAUDE.md §3):身份块 = 表单;轻记录 = 行内一行一条、失焦即存;
// 重记录 = 一行一条的列表,打开则整块换成那条记录的编辑器。**一条记录一次保存。**
import { h, clear } from '../lib/dom.mjs';
import { icon } from '../lib/icons.mjs';
import { tr, getLanguage, buildLocalizedPath, switchLanguage } from '../lib/i18n.mjs';
import {
  loadDefaultResumeConfig,
  normalizeResume,
  collectDroppedPaths,
  exportDataToLocal,
  stampMeta,
} from '../lib/schema.mjs';
import {
  fetchAuth,
  fetchResume,
  saveResume,
  createSnapshot,
  fetchSnapshotConfig,
  restoreSnapshot,
  isUnauthorized,
  redirectToUnlock,
} from '../lib/api.mjs';
import { SECTIONS, sectionModules, MODULES, getModuleFields, getModuleName, moduleIssues } from './modules.mjs';
import { confirmAction } from '../lib/confirm.mjs';
import { adoptThemeToggle } from '../lib/theme.mjs';
import { createFormCreator } from './form-creator.mjs';
import { createRecordList, sortByDateDesc } from './record-list.mjs';
import { createInlineRows } from './inline-rows.mjs';
import { openManageDrawer } from './manage.mjs';
import { saveStatusView } from './save-status.mjs';
import { renderSnapshotView } from './snapshot-view.mjs';
import { toLerRs, collectOmitted as lerrsOmitted } from '../lib/lerrs.mjs';
import { toEuropass, collectOmitted as europassOmitted } from '../lib/europass.mjs';

const lang = getLanguage();
document.title = tr('app.editorTitle');

const SAVE_DEBOUNCE_MS = 600;

const state = {
  config: null,
};

let saveTimer = null;
let retryDelay = 0;

/**
 * 保存状态。`dirty` 是"有改动还没落到服务端",**保存失败后它必须继续为真** ——
 * 原来只看 `saveTimer !== null`,而定时器一触发就置空:保存失败之后离开页面
 * **不会有任何拦截**,改的东西静默消失。
 */
const saveState = { dirty: false, saving: false, error: '' };

// 顶栏的保存状态字样(buildHeader 造,页面只建一次)。此前这份状态只在两处露头:
// 失败的 Toast 和 beforeunload 拦截 —— 失焦即存平时是静默的,「存了没有」看不见。
let saveStatusEl = null;

const renderSaveStatus = () => {
  if (!saveStatusEl) return;
  const { key, err } = saveStatusView(saveState);
  saveStatusEl.textContent = tr(key);
  saveStatusEl.classList.toggle('is-err', err);
  // 失败档把具体原因挂在 title 上(Toast 一闪就过,这里常驻)
  if (err) saveStatusEl.title = saveState.error;
  else saveStatusEl.removeAttribute('title');
};

const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 30000;

const flushSave = async () => {
  saveTimer = null;
  saveState.saving = true;
  renderSaveStatus();
  try {
    // 标准的 meta.lastModified / meta.version / $schema 由这里盖章 —— 它们是
    // JSON Resume 要求有、但不该让用户手填的三样(见 schema.mjs stampMeta)。
    //
    // **只作用在发出去的那一份,不回写 state.config**:stampMeta 会剔掉空值
    //(标准给 email/url 标了 format,空串过不了官方校验器),而正在编辑的对象
    // 需要保留骨架 —— 把 `profiles: []`、`location: {}` 这类剔掉,界面下一次渲染就炸。
    await saveResume(stampMeta(state.config));
    saveState.dirty = false;
    saveState.error = '';
    retryDelay = 0;
  } catch (err) {
    if (isUnauthorized(err)) {
      redirectToUnlock();
      return;
    }
    // **失败后 dirty 保持为真**:离开页面要拦、指示器要显示未保存。
    if (err && err.code === 'TOO_LARGE') {
      // 超上限重试多少次都没用,别空转;告诉用户到底多大、上限多少。
      const detail = err.bytes && err.limit ? ` (${Math.round(err.bytes / 1024)}KB / ${Math.round(err.limit / 1024)}KB)` : '';
      saveState.error = tr('editor.tooLarge') + detail;
      window.Toast && window.Toast.err(saveState.error);
    } else {
      // 其余(断网、5xx)是暂时的 —— 退避重试,别让用户白敲。
      saveState.error = tr('editor.saveFailed');
      retryDelay = Math.min(retryDelay ? retryDelay * 2 : RETRY_BASE_MS, RETRY_MAX_MS);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSave, retryDelay);
      window.Toast && window.Toast.err(`${saveState.error}:${String(err.message || err)}`);
    }
  } finally {
    saveState.saving = false;
    renderSaveStatus();
  }
};

const updateConfigTo = (nextConfig) => {
  state.config = nextConfig;
  saveState.dirty = true;
  saveState.error = '';
  retryDelay = 0; // 用户又动了,退避从头算
  renderSaveStatus();
  renderIndex();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
};

// ---- 导入 / 导出 ----
//
// 事实的备份与恢复本来就属于「编辑事实」这一页:此前导出藏在生成简历页、导入整个下线,
// 于是真相源既没法离线留底,也没法从留底恢复。
//
// **导入必须先看清楚再覆盖**(这正是当初把它下线的原因):导入是整份替换,
// 没有对比就点确认,等于闭着眼睛把现有事实抹掉。故先算一份差异摘要,确认后才写。

const countsOf = (config) => {
  const counts = {};
  for (const module of MODULES) {
    if (module.kind !== 'list') continue;
    try {
      counts[module.key] = module.get(config).length;
    } catch {
      counts[module.key] = 0;
    }
  }
  return counts;
};

/** 整份覆盖前的差异摘要:姓名变化 + 每个列表模块的条目数变化(只列有变化的)。 */
function buildOverwriteDiff(current, incoming) {
  const rows = [];
  const oldName = (current.basics && current.basics.name) || '';
  const newName = (incoming.basics && incoming.basics.name) || '';
  if (oldName !== newName) {
    rows.push({ label: tr('field.basics.name'), from: oldName || '—', to: newName || '—' });
  }
  const before = countsOf(current);
  const after = countsOf(incoming);
  for (const module of MODULES) {
    if (module.kind !== 'list') continue;
    if (before[module.key] === after[module.key]) continue;
    rows.push({
      label: getModuleName(module, incoming),
      from: `${before[module.key]}`,
      to: `${after[module.key]}`,
    });
  }
  return rows;
}

/**
 * 整份覆盖前的统一闸门 —— 「导入」与「恢复快照」共用同一道。
 *
 * ① **别处没保存的表单会被整页重建铲掉**,所以先问一句(其余局部动作只重建自己那一段);
 * ② **内存里还没落盘的改动先落盘** —— 那份「覆盖前自动留存」是**服务端按 D1 那一行**做的,
 *    不先 flush,留下的就不是用户即将失去的东西,等于安全网漏了一块。
 *    flushSave 自己吞异常并把 dirty 留成真,所以失败与否看 dirty,不看它抛不抛。
 * @returns {Promise<boolean>} 是否可以继续覆盖
 */
async function guardOverwrite() {
  if (hasPendingEdit() && !(await confirmAction(tr('editor.pendingEdit')))) return false;
  if (saveState.dirty) {
    clearTimeout(saveTimer);
    await flushSave();
    if (saveState.dirty) {
      window.Toast && window.Toast.err(saveState.error || tr('editor.saveFailed'));
      return false;
    }
  }
  return true;
}

/**
 * 整份覆盖当前事实的确认框 —— **导入与恢复快照是同一件事**:
 * 拿一份外来的 JSON 把现有事实整份替换掉。所以它们共用这一个框:
 * 同一句警告、同一张差异表、同一份"这些留不住"、同一组按钮。
 *
 * **三个选项,不是一个勾选框**(2026-08-19 用户裁定「勾选不如弹窗确认」):
 * 「覆盖前创建快照」/「直接覆盖」/「取消」。留不留还原点是个**决定**,
 * 而决定要摆成按钮 —— 勾选是最容易被略过的控件,把一件要紧事藏在一个方框里。
 *
 * @param {object} opts
 * @param {string} opts.title 框标题
 * @param {string} opts.note 顶部警告句
 * @param {object} opts.incoming 归一化后的来件(用来算差异)
 * @param {object} [opts.raw] 来件的原始对象;有它才能列出"这些留不住"
 * @param {(opts: {snapshot: boolean}) => Promise<void>} opts.apply 闸门过了之后真正执行覆盖
 * @returns {Promise<boolean>} 覆盖是否真的发生了(取消 / 闸门拦下 / 出错都是 false)
 */
function confirmOverwrite({ title, note, incoming, raw, apply }) {
  let settle = () => {};
  const done = new Promise((resolve) => { settle = resolve; });
  const rows = buildOverwriteDiff(state.config, incoming);
  // 被归一化丢掉的值(非标准字段 + 过不了格式校验的值)。最多列 8 条,其余给个总数。
  const dropped = raw ? collectDroppedPaths(raw, incoming) : [];
  const droppedShown = dropped.slice(0, 8);
  const body = h(
    'div',
    { class: 'ovw-confirm' },
    h('p', { class: 'ovw-note' }, note),
    rows.length
      ? h(
          'div',
          { class: 'ovw-diff' },
          rows.map((r) =>
            h(
              'div',
              { class: 'ovw-diff-row' },
              h('span', { class: 'ovw-diff-label' }, r.label),
              h('span', { class: 'ovw-diff-value' }, `${r.from} → ${r.to}`)
            )
          )
        )
      : h('div', { class: 'ovw-diff-empty' }, tr('editor.importNoChange')),
    dropped.length
      ? h(
          'div',
          { class: 'ovw-dropped' },
          h('p', { class: 'ovw-dropped-note' }, tr('editor.importDropped')),
          droppedShown.map((d) =>
            h(
              'div',
              { class: 'ovw-dropped-row' },
              h('code', { class: 'ovw-dropped-path' }, d.path),
              h('span', { class: 'ovw-dropped-value' }, d.value.slice(0, 40))
            )
          ),
          dropped.length > droppedShown.length
            ? h(
                'div',
                { class: 'ovw-dropped-more' },
                `${tr('editor.importDroppedMore')} ${dropped.length - droppedShown.length}`
              )
            : null
        )
      : null
  );

  // 差异表 + 「这些留不住」两栏并排,440px 装不下 —— 要一档宽的
  const handle = window.Overlay.show({ variant: 'box', title, body, width: 'wide' });

  const run = async (snapshot) => {
    handle.close();
    if (!(await guardOverwrite())) {
      settle(false);
      return;
    }
    try {
      await apply({ snapshot });
      settle(true);
    } catch (err) {
      settle(false);
      if (isUnauthorized(err)) {
        redirectToUnlock();
        return;
      }
      window.Toast && window.Toast.err(String(err.message || err));
    }
  };

  body.append(
    h(
      'div',
      { class: 'ovw-actions' },
      h(
        'button',
        { type: 'button', class: 'btn btn-small', onClick: () => { handle.close(); settle(false); } },
        tr('action.cancel')
      ),
      // 「直接覆盖」不加重点色:它是**能选但不该是默认**的那一档
      h('button', { type: 'button', class: 'btn btn-small', onClick: () => run(false) }, tr('action.overwriteDirect')),
      h(
        'button',
        { type: 'button', class: 'btn btn-small btn-accent', onClick: () => run(true) },
        tr('action.overwriteWithSnapshot')
      )
    )
  );
  return done;
}

/** 导入。选了留快照就**留不成不覆盖** —— 说了会留却没留,比没有安全网更糟。 */
function confirmImport(incoming, raw) {
  return confirmOverwrite({
    title: tr('action.import'),
    note: tr('editor.importWarning'),
    incoming,
    raw,
    apply: async ({ snapshot }) => {
      if (snapshot) {
        try {
          await createSnapshot('', 'before-import');
        } catch (err) {
          // 还没有任何事实(第一次导入):没有可留的东西,不是失败
          if (!(err && err.code === 'RESUME_NOT_FOUND')) {
            if (isUnauthorized(err)) throw err;
            window.Toast && window.Toast.err(`${tr('editor.overwriteSnapshotFailed')}:${String(err.message || err)}`);
            return;
          }
        }
      }
      updateConfigTo(incoming);
      renderDoc();
      window.Toast && window.Toast.ok(tr('editor.importApplied'));
    },
  });
}

/**
 * 恢复快照:走**同一个**确认框 —— 它和导入一样是整份覆盖,凭什么少一张差异表。
 * 快照正文从 `/files/<key>` 现取(门禁之后,同源带 cookie),用来算差异。
 * **覆盖前那一份由服务端留**,但留不留由这里的按钮决定 —— 选了「直接覆盖」
 * 就带 `snapshot: false` 过去,否则界面上那个选项是句空话(worker 照留不误)。
 * @returns {Promise<boolean>} 覆盖是否真的发生了 —— 抽屉据此决定要不要让路
 */
async function confirmRestoreSnapshot(key) {
  let raw;
  try {
    raw = await fetchSnapshotConfig(key);
  } catch (err) {
    if (isUnauthorized(err)) {
      redirectToUnlock();
      return false;
    }
    window.Toast && window.Toast.err(String(err.message || err));
    return false;
  }
  const incoming = normalizeResume(raw);
  return confirmOverwrite({
    title: tr('snapshot.restore'),
    note: tr('snapshot.restoreWarning'),
    incoming,
    raw,
    apply: async ({ snapshot }) => {
      const res = await restoreSnapshot(key, snapshot);
      // 服务端已经写进 D1 了 —— 这里只是把界面对齐,**不能再标 dirty 触发一次回写**
      state.config = normalizeResume(res.config);
      renderIndex();
      renderDoc();
      window.Toast && window.Toast.ok(tr('snapshot.restored'));
    },
  });
}

/**
 * 一段 JSON 文本 → 导入确认框。**文件与粘贴走的是同一条路** ——
 * 入口多一个,数据路径一个字节都不该分叉。
 * @returns {boolean} 解析成功与否(失败已经 toast 过了)
 */
function importFromText(textValue) {
  let incoming;
  let raw;
  try {
    // **原始对象必须留着** —— normalizeResume 之后就没法知道它丢了什么了,
    // 而"丢了什么"正是导入前最该让用户看见的东西
    raw = JSON.parse(textValue);
    incoming = normalizeResume(raw);
    if (!incoming.basics) throw new Error('missing basics');
  } catch {
    window.Toast && window.Toast.err(tr('editor.importInvalid'));
    return false;
  }
  confirmImport(incoming, raw);
  return true;
}

/**
 * 导入的两个入口:**选文件** 与 **粘贴**。
 *
 * 只有文件这一个入口时,别人把 JSON 贴在聊天里发过来,你得先自己存成文件才能导 ——
 * 多这一步没有任何道理。粘贴是纯客户端的,一段文本而已。
 *
 * (**没有"从链接拉"** ——浏览器直接跨域取多半被 CORS 挡下,要稳就得让 worker 代拉,
 * 那是一条新的服务端路由,而且是个 SSRF 面。2026-08-19 权衡后只做粘贴。)
 *
 * 粘贴**开一个框**,不是就地展开:贴一大段 JSON 需要地方,而抽屉那一栏很窄;
 * 开框也和它后面紧接着的导入确认框形态一致。框要 `width: 'wide'` ——
 * **别改成给内容加 min-width**,那不会让框变宽,只会把它撑破。
 * 用 `Overlay.show({ variant: 'box' })` 自带按钮行,不走 `Overlay.confirm`
 * (那条路必须传 doAction,坑见 app/lib/confirm.mjs)。
 * 按钮行用**自己的 `.imp-paste-actions`**,别蹭 `.ovw-actions` —— 蹭了选择器会同时选中两个框。
 */
function buildImportButton() {
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: { display: 'none' },
    onChange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ''; // 选同一个文件两次也要能触发
      if (!file) return;
      importFromText(await file.text());
    },
  });

  const openPasteBox = () => {
    const paste = h('textarea', {
      class: 'fc-textarea imp-paste',
      rows: 12,
      placeholder: tr('editor.importPastePlaceholder'),
      'aria-label': tr('editor.importPastePlaceholder'),
    });
    const body = h('div', { class: 'imp-paste-box' }, paste);
    // **宽度是模态的事**,所以向 Overlay 要一档宽的,而不是从内容里顶出去
    // (顶的那一版:520px 内容塞进 438px 的框,按钮行整个被挤到框外)
    const handle = window.Overlay.show({ variant: 'box', title: tr('action.paste'), body, width: 'wide' });
    body.append(
      // **自己的类名,别蹭 `.ovw-actions`** —— 那是覆盖确认框的按钮行,
      // 蹭了之后选择器会同时选中两个框的按钮(写探针时当场撞到)
      h(
        'div',
        { class: 'imp-paste-actions' },
        h('button', { type: 'button', class: 'btn btn-small', onClick: () => handle.close() }, tr('action.cancel')),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-small btn-accent',
            onClick: () => {
              const v = paste.value.trim();
              if (!v) return;
              // **解析失败就留在框里**,别把人辛苦贴的东西连框一起关掉
              if (importFromText(v)) handle.close();
            },
          },
          tr('action.import')
        )
      )
    );
    paste.focus();
  };

  return h(
    'span',
    { class: 'imp' },
    h(
      'span',
      { class: 'mng-row' },
      h(
        'button',
        { type: 'button', class: 'btn btn-small', onClick: () => fileInput.click() },
        tr('action.importFile')
      ),
      h('button', { type: 'button', class: 'btn btn-small', onClick: openPasteBox }, tr('action.paste'))
    ),
    fileInput
  );
}

function buildExportButton() {
  const formatEl = h(
    'select',
    { class: 'fc-input mng-format', 'aria-label': tr('editor.exportFormat') },
    h('option', { value: 'jsonresume' }, 'JSON Resume'),
    h('option', { value: 'lerrs' }, 'LER-RS'),
    h('option', { value: 'europass' }, 'Europass CV XML')
  );

  const exportJsonResume = () => {
    exportDataToLocal(JSON.stringify(stampMeta(state.config), null, 2), 'resume.json');
    window.Toast && window.Toast.ok(tr('editor.exportOk'));
  };

  /** 非 JSON Resume 的格式共用这一条路:先摆出带不走的,确认了才下载。 */
  const exportLossy = (omitted, warningKey, build, fileName) => {
    const done = () => {
      exportDataToLocal(build(), fileName);
      window.Toast && window.Toast.ok(tr('editor.exportOk'));
    };
    if (!omitted.length) {
      done();
      return;
    }
    confirmAction(`${tr(warningKey)}\n\n${omitted.map((o) => o.key).join('、')}`, done);
  };

  return h(
    'span',
    { class: 'mng-export' },
    formatEl,
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small',
        onClick: () => {
          if (!state.config) return;
          if (formatEl.value === 'lerrs') {
            exportLossy(lerrsOmitted(state.config), 'editor.exportLerrsWarning',
              () => JSON.stringify(toLerRs(state.config), null, 2), 'resume-ler-rs.json');
          } else if (formatEl.value === 'europass') {
            exportLossy(europassOmitted(state.config), 'editor.exportEuropassWarning',
              () => toEuropass(state.config, new Date().toISOString()), 'resume-europass.xml');
          } else exportJsonResume();
        },
      },
      // 按钮叫「下载」不叫「导出」:标题已经写着导出,而且这个动作**就是下载到本机**
      // (CLAUDE.md §3:「导出」= 下载到本机,仅此而已)
      tr('action.download')
    )
  );
}

// ---- 头部 ----

function buildHeader() {
  const langSwitcher = h(
    'div',
    { class: 'language-switcher', title: tr('editor.langSwitchHint') },
    h('span', { class: ['lang', lang === 'zh-cn' && 'active'], onClick: () => switchLanguage('zh-cn') }, '中'),
    h('span', { class: 'divider' }, '/'),
    h('span', { class: ['lang', lang === 'en' && 'active'], onClick: () => switchLanguage('en') }, 'En')
  );

  return h(
    'header',
    { class: 'app-header' },
    // 顶栏两个动作对应工作台的两个入口(见 app/home/main.mjs 文件头):
    // 回首页重新选,或带着刚编辑的事实去生成简历。**这里不该出现"预览"** ——
    // 编辑页管的是事实是否准确,"长什么样"是生成那一侧的事。
    h(
      'a',
      { class: 'back-link', href: '/' },
      icon('back'),
      tr('action.backToHome')
    ),
    h('span', { class: 'header-title' }, tr('editor.title')),
    h(
      'span',
      { class: 'header-actions' },
      // 保存状态:已保存 / 保存中… / 未保存(失焦即存是静默的,状态得有处看)。
      // 放动作区最前 —— 桌面在按钮左侧,窄屏跟着动作行,不用给窄屏网格加行
      (saveStatusEl = h('span', { class: 'save-status' })),
      // 导入 / 导出 / 快照都是**对整份事实库的操作**,不是主内容 —— 收进抽屉,
      // 顶栏只留一个入口(照 tinycfw 的 ⚙️ 抽屉)
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onClick: () =>
            openManageDrawer({
              lang,
              importControl: buildImportButton,
              exportControl: buildExportButton,
              // 恢复的确认与执行都在这一层(它握着 state / 未保存闸门),
              // 抽屉与快照列表只负责"点了哪一条"
              onRestore: confirmRestoreSnapshot,
            }),
        },
        icon('settings'),
        ` ${tr('manage.title')}`
      ),
      h(
        'a',
        { class: 'btn btn-accent', href: buildLocalizedPath('apply', {}) },
        icon('document'),
        ` ${tr('action.generate')}`
      ),
      langSwitcher,
      // ccs theme 模块的按钮**先住在静态 HTML 里**(那个 IIFE 在脚本解析时就找它,
      // 而页眉是 JS 渲染的)。这里把节点搬进来 —— 搬动不丢监听器。
      adoptThemeToggle()
    )
  );
}


// ---- 一级导航(版块)----
//
// 两层结构:左侧只有四个**版块**;版块页里把归属它的模块摊成若干 **Group**,
// 每个 Group 可折叠。这样一级导航短、一屏能看全,而字段仍然分门别类。

/**
 * 当前页上所有**会持有未保存内容**的编辑器实例。
 * 重记录编辑器与身份块表单都挂了 hasPendingEdit(),行内编辑恒为 false(失焦即存)。
 * 上层鸭子类型一视同仁 —— 切走之前问一句,别静默吞掉。
 */
let pendingEls = [];

const hasPendingEdit = () =>
  pendingEls.some((el) => el && typeof el.hasPendingEdit === 'function' && el.hasPendingEdit());

// ---- 页面:一页到底 ----
//
// **不换面。** 15 个分节全在一个可滚动文档里,左侧只有一条纯文字锚点索引 ——
// 点了是滚过去,不是切面板。理由:整体永远在场,而"切面板"的每一步都在向用户
// 隐藏其余部分,还给每个任务多加一次点击。
//
// 文档里**只放事实**。导入 / 导出 / 快照是对这份文档的操作,不是一类事实 ——
// 它们在顶栏「管理」后面的抽屉里(见 manage.mjs)。
//
// 三档:
//   身份块(object)      → 一张普通表单 + 一个保存
//   轻记录(inline)      → 行内一行一条,失焦即存
//   重记录(其余 list)   → 一行一条的列表;打开则整块换成那条记录的编辑器

const indexEl = h('nav', { class: 'doc-index' });
const docEl = h('main', { class: 'doc' });

/** 当前打开的重记录:{ moduleKey, index }(index = -1 表示新建);null = 在列表面。 */
let openRecord = null;

const moduleOf = (key) => MODULES.find((m) => m.key === key);

function renderIndex() {
  clear(indexEl);
  for (const section of SECTIONS) {
    indexEl.append(h('div', { class: 'doc-index-title' }, tr(section.labelKey)));
    for (const module of sectionModules(section.id)) {
      const issues = moduleIssues(module, state.config);
      indexEl.append(
        h(
          'a',
          {
            class: ['doc-index-item', issues > 0 && 'has-issue'],
            href: `#m-${module.key}`,
            title: issues > 0 ? tr('editor.missingRequired') : null,
            onClick: (e) => {
              e.preventDefault();
              // 从记录编辑器里点索引 = 先回到文档面,再滚过去
              if (openRecord) {
                leaveRecord(() => {
                  renderDoc();
                  scrollToModule(module.key);
                });
                return;
              }
              scrollToModule(module.key);
            },
          },
          getModuleName(module)
        )
      );
    }
  }
}

function scrollToModule(key) {
  const target = document.getElementById(`m-${key}`);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  history.replaceState({}, '', `#m-${key}`);
  // **光滚不移焦点等于没点** —— 读屏的阅读位置不会跟着视口走
  focusAfterSwap(target.querySelector('.blk-title') || target);
  markCurrent(key);
}

/** 索引里标出当前分节。 */
function markCurrent(key) {
  for (const a of indexEl.querySelectorAll('.doc-index-item')) {
    const on = a.getAttribute('href') === `#m-${key}`;
    a.classList.toggle('is-current', on);
    if (on) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
}

/** 改到一半要离开时问一句(只有重记录编辑器会有未保存内容)。 */
function leaveRecord(go) {
  const from = openRecord && openRecord.moduleKey;
  const done = () => {
    openRecord = null;
    go();
    // 回到文档面时把焦点送回刚才那一段,别让键盘用户从页首重来
    if (from) focusAfterSwap(document.querySelector(`#m-${from} .blk-title`));
  };
  if (!hasPendingEdit()) {
    done();
    return;
  }
  confirmAction(tr('editor.pendingEdit'), done);
}

function buildObjectBlock(module) {
  // eslint-disable-next-line prefer-const -- onSubmit 里要回指自己
  let form;
  form = createFormCreator({
    fields: getModuleFields(module, state.config),
    value: module.get(state.config),
    aiContext: () => state.config,
    onSubmit: (values) => {
      updateConfigTo(module.set(state.config, values));
      // **不重建整页** —— 同一页上还有别的表单,renderDoc() 会把它们里面
      // 没保存的内容一起铲掉(2026-08-19 审计抓到)。就地把初值推进即可。
      form.markSaved(values);
      window.Toast && window.Toast.ok(tr('editor.savedOne'));
    },
  });
  pendingEls.push(form);
  return form;
}

function buildInlineBlock(module) {
  const rows = createInlineRows({
    fields: getModuleFields(module, state.config),
    items: module.get(state.config),
    // **只存,不重渲染** —— createInlineRows 自己管 DOM(原地追加/摘除行)。
    // 重渲染会把正要接收焦点的那个输入框一起铲掉,接着打的字全丢(审计抓到)。
    onChange: (items) => updateConfigTo(module.set(state.config, items)),
  });
  pendingEls.push(rows);
  return rows;
}

function buildRecordBlock(module) {
  const items = module.get(state.config);
  return createRecordList({
    module,
    items,
    fields: getModuleFields(module, state.config),
    onOpen: (index) => {
      openRecord = { moduleKey: module.key, index };
      renderDoc();
    },
    onAdd: () => {
      openRecord = { moduleKey: module.key, index: -1 };
      renderDoc();
    },
    onDelete: (index) => {
      updateConfigTo(module.set(state.config, items.filter((_, i) => i !== index)));
      rerenderBlock(module.key); // 只重建自己那一段,别动同页别的表单
    },
  });
}

/** 重记录的编辑器 —— 整块把文档换掉,面包屑回去。 */
function buildRecordEditor() {
  const module = moduleOf(openRecord.moduleKey);
  const items = module.get(state.config);
  const isNew = openRecord.index === -1;
  const value = isNew ? {} : items[openRecord.index] || {};
  const back = () => leaveRecord(renderDoc);

  const form = createFormCreator({
    fields: getModuleFields(module, state.config),
    value,
    aiContext: () => state.config,
    onSubmit: (values) => {
      const next = isNew ? [...items, values] : items.map((it, i) => (i === openRecord.index ? values : it));
      // 带日期的集合自动按日期倒序 —— 简历本来就是倒序的,顺序不该让用户手摆
      // 这个集合有没有「至今」的概念,看它的字段里有没有 presentKey
      const hasPresent = getModuleFields(module, state.config).some((f) => f.presentKey);
      updateConfigTo(module.set(state.config, sortByDateDesc(next, { hasPresent })));
      openRecord = null;
      renderDoc();
      window.Toast && window.Toast.ok(tr('editor.savedOne'));
    },
    onCancel: () => {
      openRecord = null;
      renderDoc();
    },
  });
  pendingEls.push(form);

  return h(
    'div',
    { class: 'rec-editor' },
    h(
      'div',
      { class: 'crumb' },
      h('button', { type: 'button', class: 'crumb-back', onClick: back }, icon('back'), tr('action.back')),
      h('span', { class: 'crumb-sep' }, '/'),
      h('span', { class: 'crumb-here' }, getModuleName(module))
    ),
    h('h1', { class: 'rec-editor-title' },
      isNew ? `${tr('action.add')} · ${getModuleName(module)}` : String(value[module.summaryField] || tr('editor.untitledItem'))),
    form
  );
}

/** module.key → 那一段的 body 宿主与重建函数。局部重建靠它。 */
const blockHosts = new Map();

/**
 * **只重建一段**。整页 renderDoc() 会把同页别的表单里没保存的内容一起铲掉 ——
 * 那是这次重做引入的丢数据路径(2026-08-19 审计抓到),所有局部动作都必须走这里。
 */
function rerenderBlock(key) {
  const entry = blockHosts.get(key);
  if (!entry) return;
  const { host, module } = entry;
  // 这一段自己的编辑器实例要从拦截名单里摘掉,免得留下已 detach 的僵尸
  pendingEls = pendingEls.filter((el) => !host.contains(el));
  clear(host);
  host.append(buildBlockBody(module));
  const count = module.kind === 'list' ? module.get(state.config).length : 0;
  const badge = entry.title.querySelector('.blk-count');
  if (badge) badge.textContent = count > 0 ? String(count) : '';
  renderIndex();
}

function buildBlockBody(module) {
  if (module.kind !== 'list') return buildObjectBlock(module);
  return module.inline ? buildInlineBlock(module) : buildRecordBlock(module);
}

/**
 * 整块 DOM 换掉之后**必须把焦点接住** —— 否则焦点掉回 body,
 * 键盘用户要从页首重新 Tab 二十来下才回到刚才那个位置(2026-08-19 审计抓到)。
 */
function focusAfterSwap(el) {
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  // 只借用一次:留着 tabindex 会让它永久出现在 Tab 序列里
  el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
}

function renderDoc() {
  clear(docEl);
  pendingEls = [];
  blockHosts.clear();

  if (openRecord) {
    const editor = buildRecordEditor();
    docEl.append(editor);
    renderIndex();
    focusAfterSwap(editor.querySelector('.rec-editor-title'));
    return;
  }

  for (const section of SECTIONS) {
    for (const module of sectionModules(section.id)) {
      const count = module.kind === 'list' ? module.get(state.config).length : 0;
      const title = h(
        'h2',
        { class: 'blk-title' },
        // 一页 15 块,标题前一个小记号是扫读锚点。也让 modules.mjs 里登记的图标名
        // 也让 modules.mjs 里登记的图标名真的有出口。
        h('span', { class: 'blk-icon' }, icon(module.icon)),
        getModuleName(module),
        h('span', { class: 'blk-count num' }, count > 0 ? String(count) : '')
      );
      const host = h('div', { class: 'blk-body' }, buildBlockBody(module));
      blockHosts.set(module.key, { host, title, module });
      docEl.append(h('section', { class: 'blk', id: `m-${module.key}` }, title, host));
    }
  }

  renderIndex();
}

// ---- 组装 ----

/**
 * 只读地看一份快照(`/edit?snapshot=<key>`,由快照列表的「查看」在新窗口打开)。
 *
 * **它在 main() 的最前面就 return** —— 后面那些(beforeunload 拦截、renderDoc、
 * 顶栏的管理入口)全是编辑那套机器,一件都不装。看的是快照,而这一页的每个写入口
 * 写的都是**当前事实**:装上去就等于给"看"配了一条改错东西的路。
 */
async function viewSnapshot(key, note = '') {
  const app = document.getElementById('app');
  clear(app);
  let raw;
  try {
    raw = await fetchSnapshotConfig(key);
  } catch (err) {
    if (isUnauthorized(err)) {
      redirectToUnlock();
      return;
    }
    app.append(h('p', { class: 'snapv-error' }, String(err.message || err)));
    return;
  }
  document.title = tr('snapshot.view.title');
  // 时间从键里取(键是创建时的 ISO 时间戳,见 worker 的 SNAPSHOT_PREFIX 那段)
  const stamp = (key.match(/resume-(\d{4}-\d{2}-\d{2}T[\d-]+Z)/) || [])[1];
  const when = stamp ? new Date(stamp.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z')) : null;
  app.append(
    renderSnapshotView(normalizeResume(raw), {
      when: when && !Number.isNaN(when.getTime())
        ? when.toLocaleString(lang === 'en' ? 'en' : 'zh-CN', {
            year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '',
      note: note.slice(0, 120),
    })
  );
}

async function main() {
  if (!(await fetchAuth())) {
    redirectToUnlock();
    return;
  }

  const params = new URLSearchParams(location.search);
  const viewKey = params.get('snapshot');
  if (viewKey) {
    await viewSnapshot(viewKey, params.get('note') || '');
    return;
  }

  let config = await fetchResume();
  config = normalizeResume(config || (await loadDefaultResumeConfig()));

  state.config = config;

  // 离开页面前拦一道:顶栏的「返回首页」「生成简历」都是普通链接,
  // 而此刻可能有①未提交的条目编辑,或②还在 600ms 防抖窗口里没落库的改动。
  window.addEventListener('beforeunload', (e) => {
    // **看 dirty 而不是看定时器**:保存失败后定时器已置空,而那正是最该拦的时刻
    if (!hasPendingEdit() && !saveState.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  const app = document.getElementById('app');
  clear(app);

  renderDoc();

  // **深链接要自己接住**:首页的事实库芯片指向 /edit#m-work 这类锚点,
  // 而浏览器解析 hash 的那一刻文档还没渲染出来(整页是 JS 画的)——
  // 不补这一下,点过去只是换了个 URL,人还停在页首(2026-08-19 真机抓到)。
  const deepLink = (location.hash || '').match(/^#m-([a-z]+)$/);
  if (deepLink && MODULES.some((m) => m.key === deepLink[1])) {
    requestAnimationFrame(() => scrollToModule(deepLink[1]));
  }

  app.append(
    buildHeader(),
    h(
      'div',
      { class: 'resume-editor' },
      h('div', { class: 'editor-content' }, indexEl, docEl)
    )
  );
  // 字样统一由 renderSaveStatus 写,这里落第一笔(元素在 buildHeader 里才造出来)
  renderSaveStatus();
}

main().catch((err) => {
  console.error(err);
  window.Toast && window.Toast.err(String(err));
});
