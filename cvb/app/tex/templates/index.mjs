// 模板注册表 —— **唯一一份**。HTML 模板层已于 2026-08-14 整体退役
// (73 套 `app/preview/templates/*` + `app/styles/<id>.css` + preview.html 的 link 群),
// 预览与导出一律是编译出来的 PDF,不再有第二条渲染路。
//
// 每项字段:
//   renderTex(config) → .tex 字符串
//   fonts             → 该模板需要的**引擎侧**字体(相对 tex-engine 的 fonts/)。
//                       通常 .tex 自己会写出字体名、由 texEngineAssets() 扫出来;
//                       但**上游件常把字体声明藏在 vendor 的 .sty 里**(如 cjk-subset.sty),
//                       那时 .tex 扫不到 → 必须在这里显式声明,否则编译期缺字体硬失败。
//   macros            → 随编译喂进 CWD 的宏文件名。文件住 **ccs 的 tex-templates 模块**、
//                       走 jsDelivr(2026-08-17 搬走,不占自家资产);基址由 worker 注入为
//                       templateBase,消费端见 app/lib/tex-engine.mjs 的 templateBase()。
//   group             → 文化圈 id(仅用于下拉分组与 `group.*` 文案 key)
//
// **登记前置**:必须过 CLAUDE.md §7 的编译冒烟(满/空/特殊字符三场景,驱动是**裁剪单包**
// ——官方三层全量包比线上包全,验不出线上缺件)。三个只有真机才暴露的坑,别重蹈:
//   ① 忘了登记 → hasTexTemplate 假,该模板直接不出现(us-tech/uk-tech 悬空过一轮);
//   ② macros 漏登,或**发布了 tex-templates 却忘了 bump ccs-pin** → 浏览器里
//      `\documentclass{…}` 找不到文件(注入的基址指向还没有这个模块的 SHA),
//      而 Node 冒烟因为显式传了 .cls,**结构上抓不到这一类**;
//   ③ 字体缺面是静默的 —— fontspec 只 warning、拿 regular 顶上,页数照对而加粗全没。
import { renderTex as renderAnzTech } from './anz-tech.mjs';
import { renderTex as renderCnClassic } from './cn-classic.mjs';
import { renderTex as renderCnModern } from './cn-modern.mjs';


export const TEX_TEMPLATES = {
  'anz-tech': { renderTex: renderAnzTech, macros: ['sb2nov-resume.sty'], group: 'anz' },
  'cn-classic': {
    renderTex: renderCnClassic,
    macros: ['resumecls.cls', 'cjk-subset.sty'],
    // 字体名写在 cjk-subset.sty 里,.tex 扫不到 → 显式声明
    fonts: ['cjk-sc-serif.otf', 'cjk-sc.otf', 'cjk-sc-bold.otf'],
    group: 'cn',
  },
  'cn-modern': {
    renderTex: renderCnModern,
    // 上游自带 FA4(官方三层包里没有)与 Fontin-SmallCaps;nth/xltxtra 是 CTAN 补件
    macros: [
      'billryan-resume.cls',
      'cjk-subset.sty',
      'fontawesome.sty',
      'fontawesomesymbols-generic.tex',
      'fontawesomesymbols-pdftex.tex',
      'fontawesomesymbols-xeluatex.tex',
      'nth.sty',
      'xltxtra.sty',
      'FontAwesome.otf',
      'Fontin-SmallCaps.otf',
    ],
    fonts: ['cjk-sc-serif.otf', 'cjk-sc.otf', 'cjk-sc-bold.otf'],
    group: 'cn',
  },
};

/** 首选模板:数据里的模板 id 失效时回落到它。 */
export const DEFAULT_TEMPLATE = 'anz-tech';

/**
 * 文化圈分组(下拉用)。**按注册表现算**,不再维护一张写死 73 项的表——
 * 写死的那张表正是"界面上还挂着 70 个不存在的模板"的来源。
 * 圈的顺序沿用既有 id 空间,只列出当前真有模板的圈。
 */
const GROUP_ORDER = ['anz', 'na', 'uk', 'au', 'nz', 'de', 'fr', 'es', 'nordic', 'jp', 'kr', 'cn', 'in', 'gulf', 'sea'];

export function templateGroups() {
  const byGroup = new Map();
  for (const [id, t] of Object.entries(TEX_TEMPLATES)) {
    const g = t.group || 'na';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(id);
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ id: g, templates: byGroup.get(g) }));
}

/** 该模板是否可用(= 是否已 TeX 化并登记)。 */
export function hasTexTemplate(id) {
  return Boolean(TEX_TEMPLATES[id]);
}

/** 归一模板 id:未登记(含 73 套 HTML 时期的旧 id)一律回落 DEFAULT_TEMPLATE。 */
export function resolveTemplate(id) {
  return hasTexTemplate(id) ? id : DEFAULT_TEMPLATE;
}

/** 该模板要喂的宏文件名(取自 ccs 的 tex-templates,基址见 templateBase());未登记返回 []。 */
export function texTemplateMacros(id) {
  const entry = TEX_TEMPLATES[id];
  return (entry && Array.isArray(entry.macros) ? entry.macros : []).slice();
}

/** 该模板显式声明的引擎侧字体(相对 fonts/);与 .tex 自报的那份取并集使用。 */
export function texTemplateFonts(id) {
  const entry = TEX_TEMPLATES[id];
  return (entry && Array.isArray(entry.fonts) ? entry.fonts : []).slice();
}
