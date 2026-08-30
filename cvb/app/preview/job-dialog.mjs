// 「新建 / 编辑职位」那个框(2026-08-30 用户裁定职位要能管理:
// 「可以『新建职位』:选择国家、语种,输入职位和 JD」)。
//
// **四样都摆在框里,一次填完**:职位名称 / 投递目标(国家)/ 语种 / JD 正文或链接。
// 「读取并填写」是**便利**不是必经之路 —— 贴了 JD 点一下,AI 把职位名与国家填进来;
// 不点也存得下,只是裁剪时模型只知道你手填的那点信息(卡片上会如实说)。
// 这条同 §3.6「读取是主动动作」:贴进来不自动打 AI。
//
// **框里不放说明句**(同管理抽屉那条):四个标签各自说得清,底下再解释一遍
// 是在给一个已经懂了的人讲课。
import { h, clear } from '../lib/dom.mjs';
import { tr } from '../lib/i18n.mjs';
import { looksLikeUrl, normalizeJob, hasJobContent, deriveSpec, JOB_ERROR_KEYS } from '../apply/job.mjs';
import { APPLY_SPECS, specById } from '../apply/specs.mjs';
import { fetchJobPage, isUnauthorized, redirectToUnlock } from '../lib/api.mjs';
import { extractJobFromText } from '../lib/ai.mjs';
import { factsLangName } from '../editor/facts-bar.mjs';

/** 一排不预选的芯片(同 /edit 文档栏与这一页选择区的 `.facts-lang`,不发明第二种画法)。 */
function chipPicker(values, current, onPick) {
  const row = h('div', { class: 'apply-chips' });
  const paint = () => {
    clear(row);
    row.append(
      ...values.map(({ value, text }) =>
        h(
          'button',
          {
            type: 'button',
            class: ['facts-lang', value === current() && 'is-current'],
            'aria-pressed': value === current() ? 'true' : 'false',
            onClick: () => {
              onPick(value);
              paint();
            },
          },
          text
        )
      )
    );
  };
  paint();
  return { row, paint };
}

/**
 * 开一个框收职位。**返回 Promise<记录|null>** —— 取消是 null,不是抛错。
 *
 * @param {object} opts
 * @param {object|null} opts.job  编辑时传入已有记录(含 jd);新建传 null
 * @param {Array<{lang:string}>} opts.langs 事实库现有语种
 * @param {string} opts.defaultLang 新建时预选哪门语种
 * @param {string} opts.defaultSpec 新建时预选哪个投递目标
 */
export function openJobDialog({ job = null, langs = [], defaultLang = '', defaultSpec = '' } = {}) {
  // 组件是从 CDN 取的,取不到时**如实说一句**而不是抛个 TypeError 让按钮静默失灵
  //(别处都先探一下,见 manage.mjs / facts-bar.mjs / confirm.mjs)。
  if (!window.Overlay || typeof window.Overlay.show !== 'function') {
    window.Toast && window.Toast.err(tr('ai.failed'));
    return Promise.resolve(null);
  }
  const draft = {
    title: (job && job.title) || '',
    spec: (job && job.spec) || defaultSpec || '',
    lang: (job && job.lang) || defaultLang || '',
    jd: (job && job.jd) || '',
    // 读出来的结构随记录走:编辑时不重读也不丢(重读要人点)
    extracted: (job && job.extracted) || null,
  };

  const titleInput = h('input', {
    type: 'text',
    class: 'fc-input',
    placeholder: tr('apply.jobNamePh'),
    onInput: (e) => { draft.title = e.target.value; },
  });
  titleInput.value = draft.title;

  const jdInput = h('textarea', {
    class: 'fc-input apply-job-input',
    rows: 7,
    placeholder: tr('apply.jobPlaceholder'),
    onInput: (e) => { draft.jd = e.target.value; },
  });
  jdInput.value = draft.jd;

  const specPicker = chipPicker(
    APPLY_SPECS.map((s) => ({ value: s.id, text: tr(s.labelKey) })),
    () => draft.spec,
    (v) => { draft.spec = v; }
  );
  const langPicker = chipPicker(
    langs.map(({ lang: code }) => ({ value: code, text: factsLangName(code) })),
    () => draft.lang,
    (v) => { draft.lang = v; }
  );

  const hint = h('span', { class: 'apply-stale' });
  const readBtn = h('button', { type: 'button', class: 'btn btn-small' }, tr('apply.jobRead'));

  // 「读取并填写」:链接先代拉成正文 → AI 抽结构 → 回填职位名与投递目标。
  // **只填空着的**:人手填过的不许被模型覆盖(那是把他刚做的决定推翻)。
  readBtn.onclick = async () => {
    const raw = String(draft.jd || '').trim();
    if (!raw) {
      hint.textContent = tr('apply.jobEmpty');
      return;
    }
    readBtn.disabled = true;
    readBtn.textContent = tr('apply.jobReading');
    hint.textContent = '';
    try {
      let text = raw;
      if (looksLikeUrl(raw)) {
        const page = await fetchJobPage(raw);
        text = String((page && page.text) || '');
        // 链接读回来的正文**存进 JD 框**:下次编辑看到的是真正喂给模型的东西,
        // 而不是一条你还得再点一次才知道内容的链接。
        draft.jd = text;
        jdInput.value = text;
      }
      const extracted = normalizeJob(await extractJobFromText(text));
      if (!hasJobContent(extracted)) {
        hint.textContent = tr('apply.jobErrEmpty');
        return;
      }
      draft.extracted = extracted;
      if (!draft.title && extracted.title) {
        draft.title = extracted.title;
        titleInput.value = extracted.title;
      }
      const derived = deriveSpec(extracted);
      if (derived.status === 'one') {
        draft.spec = derived.spec;
        specPicker.paint();
        hint.textContent = tr('apply.jobDerived');
      } else {
        hint.textContent = derived.status === 'many' ? tr('apply.jobAmbiguous') : tr('apply.jobNoPlace');
      }
    } catch (err) {
      if (isUnauthorized(err)) return redirectToUnlock();
      const key = JOB_ERROR_KEYS[err && err.code];
      hint.textContent = key ? tr(key) : (err && err.message) || tr('ai.failed');
    } finally {
      readBtn.disabled = false;
      readBtn.textContent = tr('apply.jobRead');
    }
  };

  const field = (labelKey, control) =>
    h('div', { class: 'apply-dlg-field' }, h('span', { class: 'apply-row-label' }, tr(labelKey)), control);

  // 按钮行**在 body 里**(ccs `Overlay.show` 的契约就是 `{variant,title,body,width}` +
  // 返回 handle,没有 actions 数组);而且用**自己的类** `.apply-dlg-actions` ——
  // 蹭别的框的类,选择器会同时选中两个框的按钮(§3 那条踩过)。
  return new Promise((resolve) => {
    let settled = false;
    let handle = null;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const cancelBtn = h(
      'button',
      { type: 'button', class: 'btn', onClick: () => { done(null); handle && handle.close(); } },
      tr('action.cancel')
    );
    const saveBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-accent',
        // **存不下就把框留着**:JD 贴了一大段,连框一起关掉是把人的活儿扔了
        //(同「坏 JSON 框不关内容还在」那条)。
        onClick: () => {
          if (!draft.title.trim() && !draft.jd.trim()) {
            hint.textContent = tr('apply.jobEmpty');
            return;
          }
          done({
            title: draft.title.trim(),
            spec: draft.spec,
            lang: draft.lang,
            jd: draft.jd,
            extracted: draft.extracted,
          });
          handle && handle.close();
        },
      },
      tr('action.submit')
    );

    const body = h(
      'div',
      { class: 'apply-dlg' },
      field('apply.jobName', titleInput),
      field('apply.target', specPicker.row),
      langs.length > 1 ? field('apply.facts', langPicker.row) : null,
      field('apply.job', jdInput),
      h('div', { class: 'apply-row apply-dlg-read' }, readBtn, hint),
      h('div', { class: 'apply-dlg-actions' }, cancelBtn, saveBtn)
    );

    // JD 是一大段文字,`wide` 才装得下(§3「模态里的内容不许比容器宽 —— 要宽就向 Overlay 要」)。
    handle = window.Overlay.show({
      variant: 'box',
      width: 'wide',
      title: job ? tr('action.edit') : tr('apply.jobNew'),
      body,
      // 框被 ✕ / Esc / 点幕布关掉也要 settle,否则调用方的 await 永远悬着。
      // `onClose` 是 ccs 的真契约(overlay/client.mjs `_open`),已核对过源码 ——
      // 别照印象写成 `handle.closed` 那种不存在的东西。
      onClose: () => done(null),
    });
  });
}

/** 芯片上的字样:职位 · 国家 · 语种。没起名字的用 JD 头一句顶上,别摆一枚空芯片。 */
export const jobChipText = (rec) => {
  const spec = specById(rec.spec);
  const parts = [
    rec.title || tr('apply.jobUntitled'),
    spec && tr(spec.labelKey),
    rec.lang && factsLangName(rec.lang),
  ].filter(Boolean);
  return parts.join(' · ');
};
