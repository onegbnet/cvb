// AI 客户端(mma 简历 Agent):字段润色 + 新增语种的整份翻译。
// system prompt(简历写手定位)在 mma 租户侧;这里只构建任务消息。
import { h, clear } from './dom.mjs';
import { tr, getLanguage } from './i18n.mjs';
import { isUnauthorized, redirectToUnlock } from './api.mjs';
import { collectTranslatables, applyTranslations } from './translate-map.mjs';

const AI_ERROR_KEYS = {
  AI_PROVIDER_NOT_CONFIGURED: 'ai.notConfigured',
  AI_PROXY_UNAVAILABLE: 'ai.unavailable',
  AI_INVALID_RESPONSE: 'ai.parseFailed',
  AI_UPSTREAM_REQUEST_FAILED: 'ai.failed',
  AI_BAD_REQUEST: 'ai.failed',
};

const post = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const code = (payload && payload.error && payload.error.code) || `HTTP_${res.status}`;
    const err = new Error(tr(AI_ERROR_KEYS[code] || 'ai.failed'));
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return payload;
};

/** 提示词用的精简简历上下文(去头像/主题等无关字段)。 */
export const buildResumeContext = (config) => ({
  basics: {
    name: config.basics.name,
    label: config.basics.label,
    summary: config.basics.summary,
    location: config.basics.location,
  },
  work: config.work,
  education: config.education,
  projects: config.projects.filter((p) => p.type !== 'portfolio'),
  skills: config.skills,
  certificates: config.certificates,
  languages: config.languages,
});

const buildImprovePrompt = ({ label, sourceText, context }) => {
  if (getLanguage() !== 'en') {
    return [
      `请优化简历中「${label}」的内容:提升表达专业度与量化程度,贴合目标岗位与工作地的语言习惯,保持事实,不编造经历。`,
      '严格输出 JSON 对象:{"candidates":["候选1完整文本","候选2完整文本","候选3完整文本"]},候选为可直接替换原文的完整文本,不要输出其它内容。',
      '当前内容:',
      sourceText,
      '简历上下文:',
      JSON.stringify(context),
    ].join('\n');
  }
  return [
    `Improve the "${label}" section of this resume: sharpen professionalism and quantification, match the language conventions of the target role and location, stay factual, invent nothing.`,
    'Return a strict JSON object: {"candidates":["full text 1","full text 2","full text 3"]} — each candidate must be a complete drop-in replacement. No other output.',
    'Current content:',
    sourceText,
    'Resume context:',
    JSON.stringify(context),
  ].join('\n');
};

/**
 * 整份翻译(新增语种「翻译真相源底稿」):收集散文槽位 → 一次翻译 → 按路径写回。
 * 结构不出客户端;纯语言中立的文档(零散文)不发请求,等同克隆。
 * 后端(DeepL 正文 + LLM 人名转写,或整包 LLM 回落)由服务端选,契约见 server/routes/ai.js。
 * 失败会抛(错误消息已本地化),调用方决定不建档。
 */
export async function translateResumeConfig({ config, sourceLang, targetLang, sourceLabel, targetLabel }) {
  const entries = collectTranslatables(config);
  if (!Object.keys(entries).length) return applyTranslations(config, {});
  const payload = await post('api/ai/translate', {
    entries,
    sourceLang,
    targetLang,
    sourceLabel,
    targetLabel,
  });
  const map = (payload && payload.translations) || {};
  // 合法却**空**的映射不是成功,是失败的另一张脸:照单全收会建出一份没翻译的
  // 纯克隆 —— 正是「不能是简单克隆」否掉的结果。一条都没对上就按失败处理(不建档);
  // 部分命中放行:没译到的槽保持源语言,进编辑器自己改。
  const hit = Object.keys(entries).some((k) => typeof map[k] === 'string' && map[k].trim());
  if (!hit) {
    const err = new Error(tr('ai.parseFailed'));
    err.code = 'AI_INVALID_RESPONSE';
    throw err;
  }
  return applyTranslations(config, map);
}

/**
 * 打开候选弹窗:调 /api/ai/improve,展示候选,应用则回调 onApply(text)。
 */
export async function openImproveDialog({ label, sourceText, config, onApply }) {
  if (!sourceText || !String(sourceText).trim()) {
    window.Toast.err(tr('ai.empty'));
    return;
  }

  const body = h(
    'div',
    { class: 'ai-dialog-body' },
    h('div', { class: 'ai-loading' }, h('div', { class: 'spinner' }), h('span', {}, tr('ai.loading')))
  );
  const handle = window.Overlay.show({ variant: 'box', title: tr('ai.suggestions'), body });

  try {
    const payload = await post('api/ai/improve', {
      prompt: buildImprovePrompt({ label, sourceText, context: buildResumeContext(config) }),
    });
    clear(body);
    const candidates = payload.candidates || [];
    if (!candidates.length) {
      body.append(h('div', { class: 'ai-error' }, tr('ai.empty')));
      return;
    }
    for (const candidate of candidates) {
      body.append(
        h(
          'div',
          { class: 'ai-candidate-card' },
          h('div', { class: 'ai-candidate-content' }, candidate.content),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small btn-accent',
              onClick: () => {
                onApply(candidate.content);
                handle.close();
              },
            },
            tr('ai.apply')
          )
        )
      );
    }
  } catch (err) {
    if (isUnauthorized(err)) {
      redirectToUnlock();
      return;
    }
    clear(body);
    body.append(h('div', { class: 'ai-error' }, String(err.message || err)));
  }
}
