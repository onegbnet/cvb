// 工作台首页 —— **站主自己的工作台**,不是产品介绍页。
//
// 这一页在 LOCK 后面:唯一会打开它的是站主本人,他早就知道自己的站是干什么的。
// 所以此前那套「标语 + 三步说明 + 两张卡各配一段产品描述 + 黄色告示条」
// **是写给一个不存在的读者看的** —— 那是给正在评估产品的陌生人准备的文案,
// 而陌生人到不了这一页(2026-08-19 重做)。
//
// 从零推:真实读者每次来是要干一件事,而他真正的问题往往不是"点哪个",
// 而是**"我的东西现在什么状况"**。这个信息一次 GET /api/resume 就有,
// 编辑器早就在算了。于是这一页 = 事实库一览 + 入口:
//
//   ① 一行:这是谁的站 + 上次改动是什么时候(名字没填时,那句提示本身就是引导)
//   ② 事实库:每个分节一枚计数芯片,点了**直接跳进编辑器对应分节**(锚点已存在),
//      比"先进编辑器再找分节"少一步。有内容的实心,空的淡 —— 空不等于缺,不做评判。
//   ③ 入口:两个(将来三个)。未接入的部分做成安静的一行小字,不是黄色告示条。
//
// **没有完成度百分比**(§8 卖点③):英美简历刻意不填照片与生日,
// 「填满」从来不是目标,一个百分比会诱导用户去填不该填的字段。计数只给事实。
//
// 入口本身是语义的一部分(§8 队列 2 ⑥):从「生成简历」进去就是新建一条投递,
// 从「查看历史」里继续才是追加版本 —— 所以这几个口子必须在入口就分开,不是装饰。
// 「查看历史」等投递记录落地后再加,不提前画一个点不动的按钮。
import { h, clear } from '../lib/dom.mjs';
import { tr, getLanguage, switchLanguage } from '../lib/i18n.mjs';
import { adoptThemeToggle } from '../lib/theme.mjs';
import { fetchResume, isUnauthorized, redirectToUnlock } from '../lib/api.mjs';
import { normalizeResume } from '../lib/schema.mjs';
import { SECTIONS, sectionModules, getModuleName } from '../editor/modules.mjs';
import { MARK_EDIT, MARK_GENERATE } from './marks.mjs';

const lang = getLanguage();

/**
 * LaTeX 字标:抬起的**大写 A**、下沉的**大写 E**,衬线字体。字标本身就是 L^A T_E X,不是小写 —— 
 * 权威定义见 LaTeX 内核 ltlogos.dtx,kern 值也照它抄(见 home.css),**不是斜体**。
 * 字体是**真的 Latin Modern**,从 ccs 的 fonts 模块走 jsDelivr(@font-face 在 home.html 头部,
 * 因为它要 {{CCS_PIN}} 与 {{CCS_CDN}})—— 招牌值得驮这一份,不用系统衬线糊弄。
 */
const latexLogo = () =>
  h(
    'span',
    { class: 'latex-logo' },
    'L',
    h('span', { class: 'latex-a' }, 'A'),
    'T',
    h('span', { class: 'latex-e' }, 'E'),
    'X'
  );

/** 文案按 {latex} 占位切开,中间插入标志。 */
const withLatexLogo = (key) =>
  tr(key)
    .split('{latex}')
    .flatMap((part, i) => (i === 0 ? [part] : [latexLogo(), part]));

document.title = tr('app.homeTitle');

/** 上次改动:ISO 8601 → 本地可读。没有就返回空串。 */
const lastModified = (config) => {
  const iso = config && config.meta && config.meta.lastModified;
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(lang === 'en' ? 'en' : 'zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
};

/** 这个分节里有多少条事实。单例对象算"填了几个字段",集合算条目数。 */
const factCount = (module, config) => {
  const value = module.get(config);
  if (module.kind === 'list') return Array.isArray(value) ? value.length : 0;
  return Object.values(value || {}).filter((v) => {
    if (Array.isArray(v)) return v.length > 0;
    if (v && typeof v === 'object') return Object.values(v).some(Boolean);
    return String(v ?? '').trim() !== '';
  }).length;
};

/**
 * 事实库一览。每个分节一枚芯片,点了**直接跳进编辑器对应分节**(锚点 #m-<key>)——
 * 比"先进编辑器再找分节"少一步。有内容的实心,空的淡:**空不等于缺**,不做评判。
 */
const buildFacts = (config) =>
  h(
    'section',
    { class: 'hm-facts' },
    h('h2', { class: 'hm-h' }, tr('home.facts.title')),
    SECTIONS.map((section) =>
      h(
        'div',
        { class: 'hm-facts-row' },
        h('span', { class: 'hm-facts-label' }, tr(section.labelKey)),
        h(
          'span',
          { class: 'hm-chips' },
          sectionModules(section.id).map((module) => {
            const n = factCount(module, config);
            return h(
              'a',
              { class: ['hm-chip', n > 0 && 'has'], href: `/edit#m-${module.key}` },
              getModuleName(module),
              n > 0 ? h('span', { class: 'hm-chip-n num' }, String(n)) : null
            );
          })
        )
      )
    )
  );

/** 一个入口。状态行说的是**当前真实状况**,不是产品介绍。 */
const entry = ({ href, mark, title, state, note }) => {
  const el = h(
    'a',
    { class: 'hm-entry', href },
    h('span', { class: 'hm-entry-mark' }),
    h(
      'span',
      { class: 'hm-entry-text' },
      h('span', { class: 'hm-entry-title' }, title),
      state ? h('span', { class: 'hm-entry-state' }, state) : null,
      note ? h('span', { class: 'hm-entry-note' }, note) : null
    )
  );
  // 内联 SVG 走 innerHTML:标是我们自己写死的常量,不含任何外部输入
  el.querySelector('.hm-entry-mark').innerHTML = mark;
  return el;
};

/** 页眉:与 /edit、/apply 同一形态(.app-header)—— 首页此前没有,语言切换孤零零挂在页脚。 */
function buildHeader() {
  return h(
    'header',
    { class: 'app-header' },
    h('span', { class: 'header-title' }, tr('app.name')),
    h(
      'span',
      { class: 'header-actions' },
      h(
        'div',
        { class: 'language-switcher', title: tr('editor.langSwitchHint') },
        h('span', { class: ['lang', lang === 'zh-cn' && 'active'], onClick: () => switchLanguage('zh-cn') }, '中'),
        h('span', { class: 'divider' }, '/'),
        h('span', { class: ['lang', lang === 'en' && 'active'], onClick: () => switchLanguage('en') }, 'En')
      ),
      adoptThemeToggle()
    )
  );
}

/** 顶部一行:这是谁的站 + 上次改动。名字没填时那句提示本身就是引导。 */
const buildWho = (config) => {
  const name = String((config.basics && config.basics.name) || '').trim();
  const when = lastModified(config);
  return h(
    'div',
    { class: 'hm-who' },
    h('span', { class: 'hm-who-name' }, name || tr('home.who.unnamed')),
    when ? h('span', { class: 'hm-who-when' }, `${tr('home.who.lastModified')} ${when}`) : null
  );
};

function render(config) {
  const root = document.getElementById('app');
  clear(root);
  const totalRecords = SECTIONS.flatMap((sec) => sectionModules(sec.id))
    .filter((m) => m.kind === 'list')
    .reduce((sum, m) => sum + factCount(m, config), 0);

  root.append(
    buildHeader(),
    h(
      'main',
      { class: 'hm' },
      buildWho(config),
      buildFacts(config),
      h(
        'nav',
        { class: 'hm-entries' },
        entry({
          href: '/edit',
          mark: MARK_EDIT,
          title: tr('home.edit.title'),
          state: tr('home.edit.state').replace('{n}', String(totalRecords)),
        }),
        entry({
          href: '/apply',
          mark: MARK_GENERATE,
          title: tr('home.apply.title'),
          // 字标留着 —— 但它现在印在一句事实陈述里,不是标语。招牌值得驮那份 webfont。
          state: withLatexLogo('home.apply.state'),
          note: tr('home.apply.wip'),
        })
      )
    )
  );
}

async function main() {
  let config;
  try {
    config = normalizeResume(await fetchResume());
  } catch (err) {
    if (isUnauthorized(err)) {
      redirectToUnlock();
      return;
    }
    // 取不到就按空的画 —— 入口照样能用,不能因为读不到状态就把整页卡住
    config = normalizeResume(null);
  }
  render(config);
}

main();
