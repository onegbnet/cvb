// cn-modern —— 中文简历(现代/技术岗审美)。**版式来自上游开源件** billryan/resume
// (MIT,⭐11.3k,见 tex/billryan-resume.cls 的许可头与 tex/billryan-resume.LICENSE);
// 我们只做数据映射与文化规范。
//
// 与 cn-classic(resumecls,学院派/正式)的分工:同为中文,一传统一现代,
// 让用户按投递对象选 —— 这正是"按文化圈挑本地生态的原生件"的意思。
//
// 上游宏 API(tex/billryan-resume.cls):
//   \name{}、\basicInfo{...}(内含 \email/\phone/\github/\homepage)
//   \section{标题}
//   \datedsubsection{左}{右}、\role{标签}{内容}、\datedline{左}{右}
//   正文列表用标准 itemize。
//
// 文化规范以 culture/cn.md 为准(**来源是高校就业指导中心,第二档**,
// 因为中国大陆没有政府就业服务级别的成体系写作规范 —— 那份文件开头解释了为什么):
//   · 一页 A4;
//   · **大标题用姓名**,不写"个人简历"(S1 原文);
//   · 求职意向应写、体现专注;
//   · 版面"寸土必争"、不用艺术字效果;
//   · 分节标题黑体、正文宋体(cjk-subset.sty 的 zhhei / zhsong);
//   · **照片:目前不放** —— 高校口径普遍要求贴一寸证件照,但抓到的三份原文里
//     都没有照片规定,按 culture/README.md 的规矩标"待查",不许我替它补。
import { getResumeViewModel } from '../../lib/schema.mjs';
// 姓名按**当地写法**拼(存储次序是「名 中间名 姓」,印出来由模板决定)——
// 这一支服务的求职地用 'cjk' 那一档,见 app/lib/name-parts.mjs
import { formatName } from '../../lib/name-parts.mjs';
import { escapeTex, texMonth, texDateRange, splitLines, joinNonEmpty } from '../writer.mjs';

const PRESENT = '至今';
const range = (a, b) => texDateRange(a, b, { style: 'dot', present: PRESENT, sep: ' -- ' });
const dot = (label) => texMonth(String(label || '').replace('.', '-'), 'dot');

const bullets = (lines) => {
  const items = lines.filter(Boolean);
  if (!items.length) return '';
  return ['\\begin{itemize}', ...items.map((l) => `  \\item ${l}`), '\\end{itemize}'].join('\n');
};

export function renderTex(config) {
  const vm = getResumeViewModel(config);
  const titles = vm.sectionTitles || {};
  const t = (key, fallback) => escapeTex(titles[key] || fallback);

  const body = [];
  const section = (title, rows) => {
    const content = rows.filter(Boolean);
    if (content.length) body.push(`\\section{${title}}`, ...content, '');
  };

  // ---- 头部:姓名作大标题(S1 原文"大标题为姓名")+ 联系信息行 ----
  if (vm.name) body.push(`\\name{${escapeTex(formatName(vm.nameParts, 'cjk'))}}`);
  const info = [
    vm.email ? `\\email{${escapeTex(vm.email)}}` : '',
    vm.phone ? `\\phone{${escapeTex(vm.phone)}}` : '',
    vm.github ? `\\github[${escapeTex(vm.github.replace(/^https?:\/\//, ''))}]{${escapeTex(vm.github)}}` : '',
    vm.url ? `\\homepage[${escapeTex(vm.url.replace(/^https?:\/\//, ''))}]{${escapeTex(vm.url)}}` : '',
  ].filter(Boolean);
  if (info.length) {
    body.push(`\\basicInfo{\n  ${info.join(' \\textperiodcentered\\ \n  ')}}`, '');
  }
  // 求职意向:culture/cn.md 明确要求写(S1「显示你的专注与目标」)
  if (vm.label) body.push(`\\datedline{\\textbf{求职意向}:${escapeTex(vm.label)}}{}`, '');

  if (vm.summaryLines.length) {
    section(t('summary', '自我评价'), [bullets(vm.summaryLines.map((l) => escapeTex(l)))]);
  }

  section(
    t('skills', '专业技能'),
    vm.skills.map((s) => `\\datedline{\\textbf{${escapeTex(s.name)}}:${escapeTex(s.keywords.join('、'))}}{}`)
  );

  section(
    t('work', '工作经历'),
    vm.work.flatMap((w) => [
      `\\datedsubsection{\\textbf{${escapeTex(w.name)}}${
        w.position ? `,${escapeTex(w.position)}` : ''
      }}{${range(w.startDate, w.endDate)}}`,
      w.description ? `\\role{公司}{${escapeTex(w.description)}}` : '',
      bullets(
        [...splitLines(w.summary), ...(w.highlights || [])].filter(Boolean).map((l) => escapeTex(l))
      ),
    ])
  );

  section(
    t('projects', '项目经历'),
    vm.projects.flatMap((p) => [
      `\\datedsubsection{\\textbf{${escapeTex(p.name)}}${
        p.entity ? `,${escapeTex(p.entity)}` : ''
      }}{${range(p.startDate, p.endDate)}}`,
      p.keywordsLabel ? `\\role{技术栈}{${escapeTex(p.keywordsLabel)}}` : '',
      bullets([p.description, ...(p.highlights || [])].filter(Boolean).map((l) => escapeTex(l))),
    ])
  );

  section(
    t('education', '教育经历'),
    vm.education.map(
      (e) =>
        `\\datedsubsection{\\textbf{${escapeTex(e.institution)}}${
          joinNonEmpty([e.studyType, e.area], '') ? `,${escapeTex(joinNonEmpty([e.studyType, e.area], ' '))}` : ''
        }}{${range(e.startDate, e.endDate)}}${e.score ? `\n\\role{成绩}{${escapeTex(e.score)}}` : ''}`
    )
  );

  section(
    t('certificates', '证书'),
    vm.certificates.map(
      (c) => `\\datedline{${escapeTex(joinNonEmpty([c.name, c.issuer], ' — '))}}{${dot(c.dateLabel)}}`
    )
  );

  section(
    t('awards', '奖项荣誉'),
    vm.awards.map((a) => `\\datedline{${escapeTex(joinNonEmpty([a.title, a.awarder], ' — '))}}{${dot(a.dateLabel)}}`)
  );

  section(
    t('languages', '语言能力'),
    vm.languages.map((l) => `\\datedline{${escapeTex(joinNonEmpty([l.language, l.fluency], ':'))}}{}`)
  );

  const content = body.join('\n');

  return [
    '\\documentclass{billryan-resume}',
    '\\usepackage{cjk-subset}',
    '\\begin{document}',
    '\\pagenumbering{gobble}',
    content || '\\mbox{}',
    '\\end{document}',
    '',
  ].join('\n');
}
