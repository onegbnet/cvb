// cn-classic —— 中文简历(正式/学院派)。**版式来自上游开源件** resumecls
// (LPPL-1.3,huxuan,见 tex/resumecls.cls 的许可头);我们只做数据映射与文化规范。
//
// 为什么是它:CTAN 的 39 个 cv 包里**唯一语言特化**的那个,XeTeX 原生、中英双语,
// 且在裁剪包上实测 9.7s 出一页、产物与官方全量包字节一致(见 CLAUDE.md §4 的表)。
//
// 上游宏 API(tex/resumecls.cls):
//   \name / \organization / \address / \mobile / \mail / \homepage → \maketitle
//   \heading{分节标题}
//   \entry{左缩进}{tabularx 列格式}{行内容}   —— 列格式如 'Xlr'、'X'、'lXX'
// 正文必须整体裹在 table 环境里(上游样例即如此)。
//
// **字体**:类走 ctexart,而 ctex 的 fontset-* 全指系统字体,WASM 里一个都没有 →
// 必须 `fontset=none` 再由我们挂子集字体。宋体正文 + 黑体标题 + 真粗体三档,
// 对应 ccs 的 cjk-sc-serif / cjk-sc / cjk-sc-bold(按需下载,不进数据包)。
//
// **文化规范待查**:culture/ 下还没有 cn.md —— 中文简历的官方/权威规范尚未抓取。
// 因此这里只用**上游件自带的形态**,没有替中国大陆的规范做任何假设
// (照片政策、出生日期、籍贯等一律不加)。补上 culture/cn.md 之前别在这里加"我觉得"。
import { getResumeViewModel } from '../../lib/schema.mjs';
import { escapeTex, texMonth, texDateRange, splitLines, joinNonEmpty } from '../writer.mjs';

const PRESENT = '至今';

const range = (a, b) => texDateRange(a, b, { style: 'dot', present: PRESENT, sep: ' -- ' });
const dot = (label) => texMonth(String(label || '').replace('.', '-'), 'dot');

/** tabularx 单元格里的 & 必须已转义;这里统一走 escapeTex。 */
const cell = (s) => escapeTex(s || '');

/** 一个条目:主行(粗体主体 + 次要列 + 右对齐日期)+ 可选的缩进描述块。 */
const entry = (cols, cells) => `\\entry{0em}{${cols}}{${cells.join(' & ')}}`;
const detail = (lines) => {
  const items = lines.filter(Boolean);
  if (!items.length) return '';
  return `\\entry{2em}{X}{%\n${items.map((l) => `    ${l} \\\\`).join('\n')}\n}`;
};

export function renderTex(config) {
  const vm = getResumeViewModel(config);
  const titles = vm.sectionTitles || {};
  const t = (key, fallback) => escapeTex(titles[key] || fallback);

  const head = [
    vm.name ? `\\name{${escapeTex(vm.name)}}` : '',
    vm.label ? `\\organization{${escapeTex(vm.label)}}` : '',
    vm.city ? `\\address{${escapeTex(vm.city)}}` : '',
    vm.phone ? `\\mobile{${escapeTex(vm.phone)}}` : '',
    vm.email ? `\\mail{${escapeTex(vm.email)}}` : '',
    vm.url || vm.github ? `\\homepage{${escapeTex(vm.url || vm.github)}}` : '',
  ].filter(Boolean);

  const body = [];
  const section = (title, rows) => {
    const content = rows.filter(Boolean);
    if (content.length) body.push(`\\heading{${title}}`, ...content);
  };

  if (vm.summaryLines.length) {
    section(t('summary', '自我评价'), [detail(vm.summaryLines.map((l) => escapeTex(l)))]);
  }

  section(
    t('skills', '专业技能'),
    vm.skills.map((s) => entry('lX', [`{\\bfseries ${cell(s.name)}}`, cell(s.keywords.join('、'))]))
  );

  section(
    t('work', '工作经历'),
    vm.work.flatMap((w) => [
      entry('Xlr', [
        `{\\bfseries ${cell(w.name)}}`,
        cell(joinNonEmpty([w.position, w.description], ' · ')),
        range(w.startDate, w.endDate),
      ]),
      detail(
        [...splitLines(w.summary), ...(w.highlights || [])].filter(Boolean).map((l) => escapeTex(l))
      ),
    ])
  );

  section(
    t('projects', '项目经历'),
    vm.projects.flatMap((p) => [
      entry('Xlr', [
        `{\\bfseries ${cell(p.name)}}`,
        cell(joinNonEmpty([p.entity, p.rolesLabel], ' · ')),
        range(p.startDate, p.endDate),
      ]),
      detail(
        [p.description, ...(p.highlights || []), p.keywordsLabel ? `技术栈:${p.keywordsLabel}` : '']
          .filter(Boolean)
          .map((l) => escapeTex(l))
      ),
    ])
  );

  section(
    t('education', '教育经历'),
    vm.education.map((e) =>
      entry('Xlr', [
        `{\\bfseries ${cell(e.institution)}}`,
        cell(joinNonEmpty([e.studyType, e.area, e.score], ' · ')),
        range(e.startDate, e.endDate),
      ])
    )
  );

  section(
    t('certificates', '证书'),
    vm.certificates.map((c) => entry('Xlr', [`{\\bfseries ${cell(c.name)}}`, cell(c.issuer), dot(c.dateLabel)]))
  );

  section(
    t('awards', '奖项荣誉'),
    vm.awards.map((a) => entry('Xlr', [`{\\bfseries ${cell(a.title)}}`, cell(a.awarder), dot(a.dateLabel)]))
  );

  section(
    t('languages', '语言能力'),
    vm.languages.map((l) => entry('lX', [`{\\bfseries ${cell(l.language)}}`, cell(l.fluency)]))
  );

  const content = body.join('\n');

  return [
    // fontset=none:ctex 默认要系统字体,WASM 里没有 → 必须关掉再挂自己的子集。
    '\\documentclass[color,fontset=none]{resumecls}',
    '\\usepackage{cjk-subset}',
    ...head,
    '\\begin{document}',
    '\\begin{table}',
    '\\maketitle',
    content || '\\mbox{}',
    '\\end{table}',
    '\\end{document}',
    '',
  ].join('\n');
}
