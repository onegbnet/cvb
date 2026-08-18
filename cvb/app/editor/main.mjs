// 编辑事实(/edit):lock 门禁 + 纯 JSON Resume 数据 + 四个版块的一级导航 + 页内可折叠 Group。
// 版块与 Group 的归属见 modules.mjs 的 SECTIONS;条目编辑是提交制,单条表单即改即存。
import { h, clear } from '../lib/dom.mjs';
import { icon } from '../lib/icons.mjs';
import { tr, getLanguage, buildLocalizedPath, switchLanguage } from '../lib/i18n.mjs';
import {
  loadDefaultResumeConfig,
  normalizeResume,
  exportDataToLocal,
  stampMeta,
} from '../lib/schema.mjs';
import {
  fetchAuth,
  fetchResume,
  saveResume,
  exportSnapshot,
  isUnauthorized,
  redirectToUnlock,
} from '../lib/api.mjs';
import { SECTIONS, sectionModules, MODULES, getModuleFields, getModuleName, moduleIssues } from './modules.mjs';
import { confirmAction } from '../lib/confirm.mjs';
import { createFormCreator } from './form-creator.mjs';
import { createListEditor } from './list-editor.mjs';

const lang = getLanguage();
document.title = tr('app.editorTitle');

const SAVE_DEBOUNCE_MS = 600;

const state = {
  config: null,
  selectedSection: SECTIONS[0].id,
  expandedGroup: null, // null=默认展开第一个 Group;''=全部折叠;否则是 Group 的 key
};

let saveTimer = null;
let retryDelay = 0;

/**
 * 保存状态。`dirty` 是"有改动还没落到服务端",**保存失败后它必须继续为真** ——
 * 原来只看 `saveTimer !== null`,而定时器一触发就置空:保存失败之后离开页面
 * **不会有任何拦截**,改的东西静默消失。
 */
const saveState = { dirty: false, saving: false, error: '' };

const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 30000;

const flushSave = async () => {
  saveTimer = null;
  saveState.saving = true;
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
  }
};

const updateConfigTo = (nextConfig) => {
  state.config = nextConfig;
  saveState.dirty = true;
  saveState.error = '';
  retryDelay = 0; // 用户又动了,退避从头算
  renderSectionNav();
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

/** 导入前的差异摘要:姓名变化 + 每个列表模块的条目数变化(只列有变化的)。 */
function buildImportDiff(current, incoming) {
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

function confirmImport(incoming) {
  const rows = buildImportDiff(state.config, incoming);
  const body = h(
    'div',
    { class: 'import-confirm' },
    h('p', { class: 'import-confirm-note' }, tr('editor.importWarning')),
    rows.length
      ? h(
          'div',
          { class: 'import-diff' },
          rows.map((r) =>
            h(
              'div',
              { class: 'import-diff-row' },
              h('span', { class: 'import-diff-label' }, r.label),
              h('span', { class: 'import-diff-value' }, `${r.from} → ${r.to}`)
            )
          )
        )
      : h('div', { class: 'import-diff-empty' }, tr('editor.importNoChange'))
  );

  const handle = window.Overlay.show({ variant: 'box', title: tr('action.import'), body });
  body.append(
    h(
      'div',
      { class: 'import-confirm-actions' },
      h('button', { type: 'button', class: 'btn btn-small', onClick: () => handle.close() }, tr('action.cancel')),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small btn-accent',
          onClick: () => {
            handle.close();
            updateConfigTo(incoming);
            renderSectionPage();
            window.Toast && window.Toast.ok(tr('editor.importApplied'));
          },
        },
        tr('editor.importConfirm')
      )
    )
  );
}

function buildImportButton() {
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: { display: 'none' },
    onChange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ''; // 选同一个文件两次也要能触发
      if (!file) return;
      let incoming;
      try {
        incoming = normalizeResume(JSON.parse(await file.text()));
        if (!incoming.basics) throw new Error('missing basics');
      } catch {
        window.Toast && window.Toast.err(tr('editor.importInvalid'));
        return;
      }
      confirmImport(incoming);
    },
  });
  return h(
    'span',
    {},
    h(
      'button',
      { type: 'button', class: 'btn btn-small', onClick: () => fileInput.click() },
      tr('action.import')
    ),
    fileInput
  );
}

function buildExportButton() {
  return h(
    'button',
    {
      type: 'button',
      class: 'btn btn-small',
      onClick: async () => {
        if (!state.config) return;
        // 导出的是**标准形态**:盖上 $schema/version/lastModified 并剔掉空值,
        // 这样别的 JSON Resume 工具(它们用 ajv 校验)能直接吃。
        exportDataToLocal(JSON.stringify(stampMeta(state.config), null, 2), 'resume.json');
        try {
          await exportSnapshot(); // 顺手在服务端留一份快照(R2)
          window.Toast && window.Toast.ok(tr('editor.exportOk'));
        } catch (err) {
          if (!isUnauthorized(err)) window.Toast && window.Toast.err(String(err.message || err));
        }
      },
    },
    tr('action.export')
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
      `← ${tr('action.backToHome')}`
    ),
    h('span', { class: 'header-title' }, tr('editor.title')),
    h(
      'span',
      { class: 'header-actions' },
      buildImportButton(),
      buildExportButton(),
      h(
        'a',
        { class: 'btn btn-accent', href: buildLocalizedPath('apply', {}) },
        icon('printer'),
        ` ${tr('action.generate')}`
      ),
      langSwitcher
    )
  );
}

// ---- 一级导航(版块)----
//
// 两层结构:左侧只有四个**版块**;版块页里把归属它的模块摊成若干 **Group**,
// 每个 Group 可折叠。这样一级导航短、一屏能看全,而字段仍然分门别类。

const sectionNavEl = h('div', { class: 'section-nav' });

/** 当前页上所有列表 Group 的编辑器实例(用于查未提交的条目编辑)。 */
let listEditorEls = [];

const hasPendingEdit = () =>
  listEditorEls.some((el) => el && typeof el.hasPendingEdit === 'function' && el.hasPendingEdit());

/** 某版块下"必填还空着"的条目总数(汇到一级导航上,不用点进去找)。 */
const sectionIssues = (sectionId) =>
  sectionModules(sectionId).reduce((sum, m) => sum + moduleIssues(m, state.config), 0);

/** 切版块。条目编辑是提交制,未提交就切会丢 —— 先问一句,不静默吞掉。 */
function selectSection(id) {
  if (state.selectedSection === id) return;
  const go = () => {
    state.selectedSection = id;
    state.expandedGroup = null; // 进新版块默认展开第一个 Group
    renderSectionNav();
    renderSectionPage();
  };
  if (!hasPendingEdit()) {
    go();
    return;
  }
  confirmAction(tr('editor.pendingEdit'), go);
}

function renderSectionNav() {
  clear(sectionNavEl);
  for (const section of SECTIONS) {
    const issues = sectionIssues(section.id);
    sectionNavEl.append(
      h(
        'div',
        {
          class: ['section-item', state.selectedSection === section.id && 'selected'],
          onClick: () => selectSection(section.id),
        },
        h('span', { class: 'section-name' }, tr(section.labelKey)),
        issues > 0
          ? h('span', { class: 'module-issue', title: tr('editor.missingRequired') }, '!')
          : null
      )
    );
  }
}

// ---- 版块页(若干可折叠 Group)----

const sectionPageEl = h('div', { class: 'section-page' });

function buildGroup(module, expanded) {
  const fields = getModuleFields(module, state.config);
  const aiContext = () => state.config;
  const count = module.kind === 'list' ? module.get(state.config).length : 0;
  const issues = moduleIssues(module, state.config);

  const header = h(
    'button',
    {
      type: 'button',
      class: ['group-header', expanded && 'is-open'],
      'aria-expanded': expanded ? 'true' : 'false',
      onClick: () => {
        const go = () => {
          state.expandedGroup = expanded ? '' : module.key;
          renderSectionPage();
        };
        // 折叠掉正在编辑的条目同样会丢内容,一并拦住
        if (expanded && hasPendingEdit()) {
          confirmAction(tr('editor.pendingEdit'), go);
          return;
        }
        go();
      },
    },
    h('span', { class: 'group-icon' }, module.icon),
    h('span', { class: 'group-name' }, getModuleName(module)),
    count > 0 ? h('span', { class: 'module-count' }, String(count)) : null,
    issues > 0 ? h('span', { class: 'module-issue', title: tr('editor.missingRequired') }, '!') : null,
    h('span', { class: 'group-chevron' }, icon(expanded ? 'chevronUp' : 'chevronDown'))
  );

  const panel = h('div', { class: ['group-panel', expanded && 'is-open'] }, header);
  if (!expanded) return panel;

  const body = h('div', { class: 'group-body' });
  if (module.kind === 'list') {
    const editor = createListEditor({
      fields,
      summaryField: module.summaryField,
      items: module.get(state.config),
      aiContext,
      onChange: (newItems) => {
        updateConfigTo(module.set(state.config, newItems));
        renderSectionPage();
      },
    });
    listEditorEls.push(editor);
    body.append(editor);
  } else {
    body.append(
      createFormCreator({
        fields,
        value: module.get(state.config),
        isList: false,
        aiContext,
        onChange: (values) => {
          updateConfigTo(module.set(state.config, values));
        },
      })
    );
  }
  panel.append(body);
  return panel;
}

function renderSectionPage() {
  clear(sectionPageEl);
  listEditorEls = [];
  const modules = sectionModules(state.selectedSection);
  // 没手动选过就展开第一个 Group;手动折叠过(空串)则一个都不展开
  const expandedKey =
    state.expandedGroup === null ? (modules[0] && modules[0].key) || '' : state.expandedGroup;
  for (const module of modules) {
    sectionPageEl.append(buildGroup(module, module.key === expandedKey));
  }
}

// ---- 组装 ----

async function main() {
  if (!(await fetchAuth())) {
    redirectToUnlock();
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

  renderSectionNav();
  renderSectionPage();

  app.append(
    buildHeader(),
    h(
      'div',
      { class: 'resume-editor' },
      h(
        'div',
        { class: 'editor-content' },
        h('div', { class: 'module-list-card' }, sectionNavEl),
        h(
          'div',
          { class: 'module-form-card' },
          sectionPageEl
        )
      )
    )
  );
}

main().catch((err) => {
  console.error(err);
  window.Toast && window.Toast.err(String(err));
});
