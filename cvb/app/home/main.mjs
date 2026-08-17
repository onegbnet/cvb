// 工作台首页 —— 产品的入口分发面。
//
// 为什么需要它(CLAUDE.md §8 队列 2 ⑥):这个产品有**三个数据访问与权限语义都不同的
// 独立功能** —— 编辑事实(维护母语真相源)/ 生成投递(有状态会话,写)/ 查看历史
// (只读归档,永不改记录)。把它们塞进一个页面必然互相污染,所以先在入口就分开。
//
// 而且 §8 队列 2 ⑥ 明确写了「entry 归属由入口决定,不靠从职位信息推断」——
// 从「生成简历」进去就是新建一条投递,从「查看历史」里继续才是追加版本。
// **入口本身就是语义的一部分**,不是装饰。
//
// 当前只放两张卡:编辑事实(已可用)与生成简历(工作台,尚无职位输入与 AI)。
// 「查看历史」等投递记录落地后再加,不提前画一个点不动的按钮。
import { h, clear } from '../lib/dom.mjs';
import { tr, getLanguage, switchLanguage } from '../lib/i18n.mjs';
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

/** 三个标语:两张大按钮**上方**,对应 §0 的三条卖点(用户 2026-08-17 成文)。 */
const buildSlogans = () =>
  h(
    'div',
    { class: 'home-slogans' },
    ['home.slogan1', 'home.slogan2', 'home.slogan3'].map((key) =>
      h('span', { class: 'home-slogan' }, tr(key))
    )
  );

/** 三步说明:放在两张大按钮下方,一行一步(用户 2026-08-17 定的形态与文案)。 */
const buildSteps = () =>
  h(
    'ol',
    { class: 'home-steps' },
    ['home.step1', 'home.step2', 'home.step3'].map((key) =>
      h('li', { class: 'home-step' }, ...withLatexLogo(key))
    )
  );
document.title = tr('app.homeTitle');

/** 一张入口卡:大标在上、文案在下。ready=false 只是加一枚「进行中」标记,
 *  **仍然可点** —— 不做点不动的按钮,点进去看到的是当前真有的能力。 */
const card = ({ href, mark, title, desc, note, ready = true }) => {
  const el = h(
    'a',
    { class: ['home-card', ready ? '' : 'is-wip'].filter(Boolean).join(' '), href },
    h('div', { class: 'home-card-mark' }),
    h('div', { class: 'home-card-title' }, title),
    h('div', { class: 'home-card-desc' }, desc),
    note ? h('div', { class: 'home-card-note' }, note) : null
  );
  // 内联 SVG 走 innerHTML:标是我们自己写死的常量,不含任何外部输入
  el.querySelector('.home-card-mark').innerHTML = mark;
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
      )
    )
  );
}

function render() {
  const root = document.getElementById('app');
  clear(root);
  root.append(
    buildHeader(),
    h(
      'main',
      { class: 'home' },
      buildSlogans(),
      h(
        'div',
        { class: 'home-cards' },
        card({
          href: '/edit',
          mark: MARK_EDIT,
          title: tr('home.edit.title'),
          desc: tr('home.edit.desc'),
        }),
        card({
          href: '/apply',
          mark: MARK_GENERATE,
          title: tr('home.apply.title'),
          desc: tr('home.apply.desc'),
          note: tr('home.apply.wip'),
          ready: false,
        })
      ),
      // 三步说明在两张大按钮**下方**,一行一步(用户 2026-08-17 定的位置)
      buildSteps()
    )
  );
}

render();
