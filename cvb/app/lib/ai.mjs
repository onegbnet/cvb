// AI 客户端(mma 简历 Agent):字段润色。
// system prompt(简历写手定位)在 mma 租户侧;这里只构建任务消息。
import { h, clear } from './dom.mjs';
import { tr, getLanguage } from './i18n.mjs';
import { isUnauthorized, redirectToUnlock } from './api.mjs';

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
