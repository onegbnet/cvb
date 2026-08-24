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
//   ② 「编辑事实」卡 = 入口 + 事实库一览(2026-08-21 用户裁定合并 —— 芯片本来就
//      逐格深链进编辑器,单独的入口卡只剩一个链接和一个总数,冗余):卡头即 /edit
//      入口,卡体是每分节一枚计数芯片。有内容的实心,空的淡 —— 空不等于缺,不做评判。
//   ③ 入口:「生成简历」(将来还有「查看历史」)。未接入的部分做成安静的一行小字。
//
// **显示哪份事实由语言定**(全站一个语言轴,见 CLAUDE.md §5):界面语言对应的
// 语种有事实库就显示那一份;页眉选择器列的是已有事实的语种,切了 = 换看哪份
// 事实 + 界面跟着走。点「编辑事实」进去的就是眼前这份,界面不翻转。
//
// **没有完成度百分比**(§8 卖点③):英美简历刻意不填照片与生日,
// 「填满」从来不是目标,一个百分比会诱导用户去填不该填的字段。计数只给事实。
//
// 入口本身是语义的一部分(§8 队列 2 ⑥):从「生成简历」进去就是新建一条投递,
// 从「查看历史」里继续才是追加版本 —— 所以这几个口子必须在入口就分开,不是装饰。
// 「查看历史」等发布(队列 2 D 段)落地后再说,不提前画一个点不动的按钮。
import { h, clear } from '../lib/dom.mjs';
import { tr, getLanguage, setLanguagePref, SUPPORTED_LANGS } from '../lib/i18n.mjs';
import { factsLangOfUi, uiLangForFacts } from '../lib/lang-names.mjs';
import { factsLangName } from '../editor/facts-bar.mjs';
import { adoptThemeToggle } from '../lib/theme.mjs';
import { fetchResume, listFactsLangs, isUnauthorized, redirectToUnlock } from '../lib/api.mjs';
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
  return d.toLocaleDateString(lang, {
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
 * 「编辑事实」卡 = 入口 + 事实库一览(2026-08-21 用户裁定合并:芯片本来就
 * 逐格深链进编辑器,单独一张「编辑事实」卡只剩一个链接和一个总数,是冗余)。
 * 卡头(记号 + 标题)整行是进 /edit 的链接;
 * 芯片照旧:每个分节一枚计数芯片,点了**直接跳进编辑器对应分节**(锚点 #m-<key>)——
 * 比"先进编辑器再找分节"少一步。有内容的实心,空的淡:**空不等于缺**,不做评判。
 */
const buildEditCard = (config) => {
  // 卡头不带总数:12 个集合的条目加成一个数没有语义,各分节的真实计数
  // 就在下面的芯片上(2026-08-21 用户看到「21 条记录」问"是什么",当天删)
  const head = h(
    'a',
    { class: 'hm-facts-head', href: '/edit' },
    h('span', { class: 'hm-entry-mark' }),
    h('h2', { class: 'hm-h' }, tr('home.edit.title'))
  );
  // 内联 SVG 走 innerHTML:标是我们自己写死的常量,不含任何外部输入
  head.querySelector('.hm-entry-mark').innerHTML = MARK_EDIT;
  return h(
    'section',
    { class: 'hm-facts' },
    head,
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
};

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
function buildHeader(langsInfo, displayLang) {
  // 应用名左侧一枚图标,照 tinycfw 诸 app 的 .logo-icon:渐变圆角方块 + 白色线性字形。
  // 字形与 favicon 同一枚(页上一枚人像);装饰性节点,读屏跳过。
  const logo = h('span', { class: 'home-logo', 'aria-hidden': 'true' });
  logo.innerHTML =
    "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" +
    "<rect x='5' y='2.5' width='14' height='19' rx='2'/><circle cx='12' cy='9' r='2.5'/>" +
    "<path d='M8 17c.6-2 2.2-3 4-3s3.4 1 4 3'/></svg>";
  return h(
    'header',
    { class: 'app-header' },
    logo,
    h('span', { class: 'header-title' }, tr('app.name')),
    h(
      'span',
      { class: 'header-actions' },
      // **全站一个语言概念:事实语言**(2026-08-22 用户报出错配后统一到底)。
      // 这里列的是**已有事实的语种**(与 /edit 文档栏同一份清单),切了 =
      // 换看哪份事实 + 界面跟着走;想要新语言的界面,先去 /edit 添加那门语言的事实。
      h(
        'select',
        {
          class: 'lang-select',
          title: tr('editor.langSwitchHint'),
          'aria-label': tr('editor.langSwitchHint'),
          onChange: async (e) => {
            const ui = uiLangForFacts(e.target.value, lang, SUPPORTED_LANGS);
            if (ui && ui !== lang) await setLanguagePref(ui);
            window.location.reload();
          },
        },
        // 空库时当前语种虚拟在场(同 /edit 文档栏)—— 零选项的空选择器是错的
        (langsInfo.langs.length ? langsInfo.langs : [{ lang: displayLang }]).map(({ lang: code }) =>
          h('option', { value: code, selected: code === displayLang }, factsLangName(code))
        )
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

function render(config, langsInfo, displayLang) {
  const root = document.getElementById('app');
  clear(root);

  root.append(
    buildHeader(langsInfo, displayLang),
    h(
      'main',
      { class: 'hm' },
      buildWho(config),
      // 「编辑事实」与「事实库」已合并成一张卡(卡头即入口,见 buildEditCard)
      buildEditCard(config),
      h(
        'nav',
        { class: 'hm-entries' },
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
  // 首页显示哪份事实 = 界面语言对应的语种(存在时),否则默认语种 ——
  // 不存在时把界面吸附回默认语种:「日语界面看着中文事实」那个错配态
  // 不再可能停留(2026-08-22 用户报出)。
  let langsInfo = { source: null, langs: [] };
  try {
    langsInfo = await listFactsLangs();
  } catch (err) {
    if (isUnauthorized(err)) {
      redirectToUnlock();
      return;
    }
  }
  const uiPrimary = factsLangOfUi(lang);
  // 空库沿用当前界面语言(默认语种由第一笔事实确立,没有"缺省中文")
  const displayLang = langsInfo.langs.some((l) => l.lang === uiPrimary)
    ? uiPrimary
    : langsInfo.source || uiPrimary;
  const uiWanted = uiLangForFacts(displayLang, lang, SUPPORTED_LANGS);
  if (uiWanted && uiWanted !== lang) {
    await setLanguagePref(uiWanted);
    window.location.reload();
    return;
  }

  let config;
  try {
    config = normalizeResume(await fetchResume(displayLang));
  } catch (err) {
    if (isUnauthorized(err)) {
      redirectToUnlock();
      return;
    }
    // 取不到就按空的画 —— 入口照样能用,不能因为读不到状态就把整页卡住
    config = normalizeResume(null);
  }
  render(config, langsInfo, displayLang);
}

main();
