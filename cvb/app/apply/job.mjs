// 职位信息 —— 生成侧四步流程的第一步输入(用户 2026-08-24 成文:
// 「事实 + **职位信息**(推导文化模板,多解时让用户手动选)+ TeX 模板 → 生成初版简历」)。
//
// 这个文件是**纯函数**那一半:输入形态判定、模型回包归一、由职位推导规格。
// 网络与界面在别处(server/routes/job.js 代拉链接、server/routes/ai.js 抽结构、
// app/preview/main.mjs 摆控件)—— 判断进 jest,渲染留在页面上,同 delete-plan 那条。
//
// **一个框,给的是什么由机器认**(2026-08-25 用户裁定「粘贴文本或输入 URL」;
// 口径同 AI 导入的「不要做两个导入功能组」):贴进来的东西看着是链接就去拉,
// 否则就当职位描述正文。让人先选"我这是链接还是正文"是把实现分类摆到了用户面前。

import { APPLY_SPECS } from './specs.mjs';

/**
 * 这段输入是不是一个链接。判据故意收得很紧 —— **整段只有一个 http(s) 开头的词**。
 * 松了会误伤:招聘正文里带一条公司官网链接是常事,那时要读的是正文不是那条链接。
 */
export const looksLikeUrl = (raw) => {
  const s = String(raw || '').trim();
  if (/\s/.test(s)) return false;
  return /^https?:\/\/\S+$/i.test(s);
};

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const strList = (v, max = 60) =>
  Array.isArray(v)
    ? v.map((item) => str(item, 1000)).filter(Boolean).slice(0, max)
    : [];

/**
 * 模型回包 → 固定形状。**结构不靠模型自觉**(同 §6 翻译与导入那条):
 * 认不出的键一概不要,类型不对的一概剔掉 —— 界面读到的永远是这几样。
 */
export const normalizeJob = (raw) => {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const loc = src.location && typeof src.location === 'object' && !Array.isArray(src.location) ? src.location : {};
  const code = str(loc.countryCode, 8).toUpperCase();
  return {
    title: str(src.title, 200),
    org: str(src.org, 200),
    level: str(src.level, 80),
    remote: src.remote === true,
    location: {
      city: str(loc.city, 120),
      region: str(loc.region, 120),
      country: str(loc.country, 120),
      // 只认真正的 ISO 3166-1 alpha-2 形态,别的写法(全名 / 三码 / 小写乱码)当没给
      countryCode: /^[A-Z]{2}$/.test(code) ? code : '',
    },
    responsibilities: strList(src.responsibilities),
  };
};

/** 这个职位读出来有内容吗 —— 全空的职位(模型什么也没读出来)不该摆在界面上。 */
export const hasJobContent = (job) =>
  Boolean(
    job &&
      (job.title ||
        job.org ||
        job.level ||
        (job.location && (job.location.city || job.location.region || job.location.country)) ||
        (job.responsibilities && job.responsibilities.length))
  );

/** 「Sydney, NSW, Australia」——有什么写什么,不补也不猜。 */
export const jobPlaceText = (job) => {
  const loc = (job && job.location) || {};
  return [loc.city, loc.region, loc.country].map((s) => String(s || '').trim()).filter(Boolean).join(', ');
};

/**
 * 招聘机构在哪个国家 → 该用哪套投递规格(= 文化取向 → 可选哪几套版式)。
 *
 * **恰好一套才自动选**。用户成文的原话是「推导文化模板,**多解时让用户手动选**」——
 * 所以这里三种结局分得干干净净:
 *   `one`  唯一一套 → 调用方直接选中它;
 *   `many` 同一国家有多套规格(将来的 `cn-tech` / `au-nsw` 一出现就是这种)→ **不替他选**,
 *          把候选交回去让人挑;
 *   `none` 广告里没写清国家,或那个国家还没有规格 → 什么都不动,让人自己选。
 * 后两种一律不改当前选择:替用户猜一个投递地点,比让他自己点一下糟得多。
 */
export const deriveSpec = (job, specs = APPLY_SPECS) => {
  const code = ((job && job.location && job.location.countryCode) || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return { status: 'none', candidates: [] };
  const candidates = specs.filter((s) => s.country === code).map((s) => s.id);
  if (candidates.length === 1) return { status: 'one', spec: candidates[0], candidates };
  if (candidates.length > 1) return { status: 'many', candidates };
  return { status: 'none', candidates: [] };
};

/**
 * 服务端错误码 → 界面文案键。读取职位这条路会说人话地失败:
 * 链接不许拉、拉不到、拉回来不是网页、页上没有可读的字 —— 四种是四回事,
 * 混成一句「失败」等于让人自己去猜(同 AI 导入对扫描件如实说「没有文字层」那条)。
 */
export const JOB_ERROR_KEYS = {
  JOB_BAD_URL: 'apply.jobErrBadUrl',
  JOB_FETCH_FAILED: 'apply.jobErrFetch',
  JOB_NOT_TEXT: 'apply.jobErrNotText',
  JOB_TOO_LARGE: 'apply.jobErrTooLarge',
  JOB_EMPTY: 'apply.jobErrEmpty',
  AI_TEXT_TOO_LARGE: 'apply.jobErrTooLarge',
};

// ---- 投递语言(2026-08-30 用户裁定)----
//
// **招聘广告的语言与简历提交语言是同一件事**,所以职位上只有一个语言字段;
// 而**事实库里的事实可以是另一门语言 —— 中间过翻译**(用户原话)。
// 于是 `job.lang` 的语义是「这份简历用什么语言交出去」,**不是**「用哪份事实文档」:
// 后者由生成侧现算(有对应语种的文档就用它,没有就取默认语种那份译过去)。
//
// **这张表不是文化规范条目**,所以不进 specs.mjs(那里每一条都要逐项手抄自
// `culture/<id>.md` 并留出处,见 §4)。它只是「投这个国家通常用什么语言写简历」的
// **缺省值**,人可以改 —— 广告是英文的日本外企岗位就该选英文。
const SPEC_DEFAULT_LANG = { au: 'en', nz: 'en', cn: 'zh' };

/**
 * 某个投递目标的缺省简历语言。认不出的返回 '' —— **不猜**,让人自己选
 *(同 deriveSpec 那条:推不出来就什么都不动)。
 */
export const defaultLangForSpec = (specId) => SPEC_DEFAULT_LANG[String(specId || '')] || '';
