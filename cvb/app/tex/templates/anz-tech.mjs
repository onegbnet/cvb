// anz-tech —— 澳新技术岗 CV。**版式来自上游开源件**(sb2nov/resume,MIT,见
// tex/sb2nov-resume.sty 的版权头),我们只做数据映射与文化规范。
//
// 文化规范逐条对应 culture/nz.md 与 culture/au.md 里抓下来的官方原文,**不是我的印象**:
//   · 纸张 A4;
//   · 字体 **Carlito 11**(Calibri 的 OFL 度量克隆)—— 新西兰官方 tahatu.govt.nz
//     "use a plain black font, like Calibri 11";澳洲 DEWR "Calibri or Arial in size 11";
//   · **不放任何图像**(NZ 官方 "don't use images")→ 永不渲染头像;
//   · 目标 **2 页以内**(两国口径一致);
//   · **Personal Statement** 开篇(NZ 官方明确要求;矩阵曾误标为英国特有);
//   · **Referees** 而非 References(澳新惯例);无实名推荐人时输出
//     "Referees available on request"(NZ 官方原话);
//   · 日期 "Jun 2019 – Present"(us 制式,澳新沿用)。
//
// **一套模板服务两国是刻意的,但不是因为两国一样**:culture/au.md 的对照表列了实证差异
// (照片政策、Personal Statement、交付格式三项 NZ 有明文而 AU 来源里没有)。这里取
// **两者的严格并集** —— 新西兰那套更严,且澳洲全部认可(Calibri 是 AU 官方选项之一、
// 无照片对 AU 也安全),所以一份产出两国都合规。将来若出现真正冲突的规则,就拆两套。
//
// 上游宏 API(sb2nov-resume.sty):\resumeSubheading{左1}{右1}{左2}{右2}、
// \resumeItem{标题}{正文}、\resumeSubItem、\resumeItemPlain、
// \resumeSubHeadingListStart/End、\resumeItemListStart/End。
import { getResumeViewModel } from '../../lib/schema.mjs';
import {
  escapeTex,
  texDateRange,
  texMonth,
  texUrl,
  splitLines,
  joinNonEmpty,
  latinFontPreamble,
  resolveCjkScript,
  cjkPreambleLines,
} from '../writer.mjs';

const PRESENT = 'Present';

/** vm 的 dateLabel 是 dot 风格(2022.05)→ us 风格。 */
const usLabel = (dotLabel) => texMonth(String(dotLabel || '').replace('.', '-'), 'us');
const range = (a, b) => texDateRange(a, b, { present: PRESENT });

/** 上游的四参条目头:左上/右上/左下/右下。参数须已转义。 */
const subheading = (l1, r1, l2, r2) =>
  `  \\resumeSubheading{${l1}}{${r1}}{${l2}}{${r2}}`;

/** bullet 列表;空则整块省略(避免上游 itemize 空环境报 warning)。 */
const itemList = (lines) => {
  const items = lines.filter(Boolean);
  if (!items.length) return '';
  return [
    '    \\resumeItemListStart',
    ...items.map((t) => `      \\resumeItemPlain{${t}}`),
    '    \\resumeItemListEnd',
  ].join('\n');
};

const section = (title, body) => {
  const content = (Array.isArray(body) ? body.filter(Boolean) : [body]).filter(Boolean);
  if (!content.length) return '';
  return [`\\section{${title}}`, '  \\resumeSubHeadingListStart', ...content, '  \\resumeSubHeadingListEnd'].join('\n');
};

export function renderTex(config) {
  const vm = getResumeViewModel(config);

  const body = [];

  // ---- 头部:姓名居中 + 联系行(**无照片**,澳新硬规范) ----
  if (vm.name) {
    body.push(
      '\\begin{center}',
      `  {\\Huge \\scshape ${escapeTex(vm.name)}} \\\\ \\vspace{2pt}`,
      `  ${joinNonEmpty(
        [escapeTex(vm.city), escapeTex(vm.phone), escapeTex(vm.email), texUrl(vm.github), texUrl(vm.url)],
        ' $|$ '
      )}`,
      '\\end{center}',
      ''
    );
  }

  // ---- Personal Statement(NZ 官方明确要求的开篇总结) ----
  const statement = vm.summaryLines.map((l) => escapeTex(l)).join(' ');
  if (statement) {
    body.push('\\section{Personal Statement}', `  ${statement}`, '');
  }

  // ---- Technical Skills(技术岗置顶,便于招聘方关键词扫描) ----
  if (vm.skills.length) {
    body.push(
      '\\section{Technical Skills}',
      '  \\resumeSubHeadingListStart',
      ...vm.skills.map(
        (s) =>
          `    \\resumeSubItem{${escapeTex(s.name)}}{${escapeTex(s.keywords.join(', '))}}`
      ),
      '  \\resumeSubHeadingListEnd',
      ''
    );
  }

  body.push(
    section(
      'Experience',
      vm.work.map((w) =>
        [
          // 上游是「左上=主体 / 左下=从属」两行。职位缺失时主体退位给公司,
          // 从属行就**不能再重复公司名**(否则同一行名字出现两遍)。
          subheading(
            escapeTex(w.position || w.name),
            range(w.startDate, w.endDate),
            escapeTex(
              w.position
                ? joinNonEmpty([w.name, w.description], ', ')
                : joinNonEmpty([w.description], ', ')
            ),
            escapeTex(w.location || '')
          ),
          // 概述段按行拆 + 要点(JSON Resume 的 work[].highlights)接在后面,与项目经历同构
          itemList(
            [...splitLines(w.summary), ...(w.highlights || [])].filter(Boolean).map((l) => escapeTex(l))
          ),
        ].join('\n')
      )
    )
  );

  body.push(
    section(
      'Projects',
      vm.projects.map((p) =>
        [
          subheading(
            escapeTex(p.name),
            range(p.startDate, p.endDate),
            escapeTex(joinNonEmpty([p.entity, p.rolesLabel], ' — ')),
            escapeTex(p.keywordsLabel || '')
          ),
          itemList(
            [p.description, ...(p.highlights || [])].filter(Boolean).map((l) => escapeTex(l))
          ),
        ].join('\n')
      )
    )
  );

  body.push(
    section(
      'Education',
      vm.education.map((e) =>
        subheading(
          escapeTex(e.institution),
          range(e.startDate, e.endDate),
          escapeTex(joinNonEmpty([e.studyType, e.area], ', ')),
          escapeTex(e.score || '')
        )
      )
    )
  );

  body.push(
    section(
      'Certifications',
      vm.certificates.map((c) =>
        `    \\resumeSubItem{${escapeTex(c.name)}}{${escapeTex(joinNonEmpty([c.issuer, usLabel(c.dateLabel)], ', '))}}`
      )
    )
  );

  body.push(
    section(
      'Awards',
      vm.awards.map((a) =>
        `    \\resumeSubItem{${escapeTex(a.title)}}{${escapeTex(joinNonEmpty([a.awarder, usLabel(a.dateLabel)], ', '))}}`
      )
    )
  );

  body.push(
    section(
      'Languages',
      vm.languages.map((l) =>
        `    \\resumeSubItem{${escapeTex(l.language)}}{${escapeTex(l.fluency || '')}}`
      )
    )
  );

  // ---- Referees(澳新特有;无实名推荐人时用官方那句话) ----
  if (vm.references.length) {
    body.push(
      section(
        'Referees',
        vm.references.map((r) =>
          `    \\resumeSubItem{${escapeTex(r.name)}}{${escapeTex(r.reference || '')}}`
        )
      )
    );
  } else {
    body.push('\\section{Referees}', '  Referees available on request.', '');
  }

  const content = body.filter(Boolean).join('\n');

  // 导言区:A4 + Carlito 11 + 上游宏层。cvb.cls 不参与 —— 版式全由上游件决定。
  // 刻意**不注入主题色**:澳新官方要求 "a plain black font",配色不是这里的自由度。

  // CJK 接线:本模板自己拼导言区(版式来自上游),**绕过了 buildDocument 的自动注入**,
  // 所以必须在这里显式补 —— 否则中文数据编译照样 PASS、页数照样对,而**正文全是缺字**
  // (实测 433 个 Missing character)。这是 CLAUDE.md §7「PASS 不等于对」的原样重演,
  // 凡是自拼导言区的模板都要记得这一步。
  const cjk = resolveCjkScript('auto', content);

  return [
    '\\documentclass[a4paper,11pt]{article}',
    '\\usepackage{sb2nov-resume}',
    ...latinFontPreamble('carlito'),
    ...cjkPreambleLines(cjk),
    '\\begin{document}',
    content || '\\mbox{}',
    '\\end{document}',
    '',
  ].join('\n');
}
