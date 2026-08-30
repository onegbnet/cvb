// 「新建 / 编辑职位」那个框(2026-08-30 用户裁定职位要能管理:
// 「可以『新建职位』:选择国家、语种,输入职位和 JD」)。
//
// **四样都摆在框里,一次填完**:职位名称 / 投递目标(国家)/ 简历语言 / JD 正文或链接。
//
// **「简历语言」= 广告语言 = 交出去的那份简历用什么语言**(2026-08-30 用户裁定:
// 「招聘职位本身的语言,以及简历要用什么语言交 —— 这两者应该是同一的」)。
// 它**不是**「用哪份事实文档」—— 那是生成侧现算的:有对应语种的事实就用它,
// 没有就取默认语种那份**译过去**(用户:「事实语种和职位、提交语种完全可以不同
// —— 要经过翻译」)。所以这里列的是**语言**,不是你手上已有的那几份文档。
// **这四样只在这里选** —— 页面上没有第二处(2026-08-30 用户:「投递目标 —— 这里
// 选了,为什么下面还有?」)。同一件事两个地方都能改,就一定会出现「我改了但没生效」。
//
// **没有「读取招聘信息」那个按钮**(2026-08-30 用户裁定:「不需要『读取招聘信息』了,
// 都有鉴权」)。此前它是个主动动作,理由是"打 AI 要花时间也花钱";而这个站整个在
// 门禁后面、只有站主一个人用,那份顾虑不成立 —— 于是**保存时顺手读一遍**:
// 链接先代拉成正文,再抽出工作内容喂给后面的定向裁剪。
// **读不出来照样存**:职位记录是用户的数据,不该因为模型打嗝就丢掉(卡片如实标一句)。
//
// **框里不放说明句**(同管理抽屉那条):四个标签各自说得清,底下再解释一遍
// 是在给一个已经懂了的人讲课。
import { h, clear } from '../lib/dom.mjs';
import { tr } from '../lib/i18n.mjs';
import { looksLikeUrl, normalizeJob, hasJobContent, defaultLangForSpec, JOB_ERROR_KEYS } from '../apply/job.mjs';
import { APPLY_SPECS, specById } from '../apply/specs.mjs';
import { FACTS_LANGS, factsLangName } from '../editor/facts-bar.mjs';
import { fetchJobPage, isUnauthorized, redirectToUnlock } from '../lib/api.mjs';
import { extractJobFromText } from '../lib/ai.mjs';

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
    // 打开框时的**初值**:跟着投递目标走(nz/au→英文、cn→中文),推不出就沿用当前语言。
    // 这只是初值 —— 读了广告之后以**广告本身的语言**为准(见 readJobIntoDraft)。
    lang: (job && job.lang) || defaultLangForSpec(defaultSpec) || defaultLang || '',
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
    onInput: (e) => {
      draft.jd = e.target.value;
      // **JD 清空了,上一次读出来的东西也就没了依据** —— 留着的话卡片会继续
      // 显示一份已经不存在的招聘广告里的工作内容,还会喂给裁剪。
      if (!draft.jd.trim()) draft.extracted = null;
    },
  });
  jdInput.value = draft.jd;

  const specPicker = chipPicker(
    APPLY_SPECS.map((s) => ({ value: s.id, text: tr(s.labelKey) })),
    () => draft.spec,
    (v) => {
      draft.spec = v;
      // 换了国家,缺省的简历语言跟着换 —— 除非人已经自己点过语言
      if (!langTouched) {
        const guess = defaultLangForSpec(v);
        if (guess) {
          draft.lang = guess;
          langPicker.paint();
        }
      }
    }
  );
  // **人一旦自己点过语言,国家就不再替他改**(那是他刚做的决定)
  let langTouched = Boolean(job && job.lang);
  const langPicker = chipPicker(
    FACTS_LANGS.map((code) => ({ value: code, text: factsLangName(code) })),
    () => draft.lang,
    (v) => { draft.lang = v; langTouched = true; }
  );

  const hint = h('span', { class: 'apply-stale' });

  /**
   * 保存时顺手读一遍:链接先代拉成正文 → AI 抽出工作内容(喂给后面的定向裁剪)。
   * **读不出来不挡保存** —— 返回 false 只是说"没读到",记录照存。
   * **不覆盖人手填的东西**:职位名与投递目标是他刚做的决定,模型不许推翻。
   */
  async function readJobIntoDraft() {
    const raw = String(draft.jd || '').trim();
    if (!raw) return false;
    let text = raw;
    if (looksLikeUrl(raw)) {
      const page = await fetchJobPage(raw);
      text = String((page && page.text) || '');
      // 链接读回来的正文**存进记录**:下次编辑看到的是真正喂给模型的东西,
      // 而不是一条你还得再点一次才知道内容的链接。
      draft.jd = text;
      jdInput.value = text;
    }
    const extracted = normalizeJob(await extractJobFromText(text));
    if (!hasJobContent(extracted)) return false;
    draft.extracted = extracted;
    if (!draft.title) draft.title = extracted.title || '';
    // **广告是什么语言,简历就用什么语言**(用户 2026-08-30:「这两者应该是同一的」)。
    // 这个信号直接来自广告,比绕道猜国家可靠 —— 一则英文广告哪怕没写清国家,
    // 也该出英文简历。**只在人没自己点过语言时才动**。
    if (!langTouched && extracted.language) {
      draft.lang = extracted.language;
      langPicker.paint();
    }
    return true;
  }

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
        onClick: async () => {
          if (!draft.title.trim() && !draft.jd.trim()) {
            hint.textContent = tr('apply.jobEmpty');
            return;
          }
          // JD 变过(或还没读过)就顺手读一遍 —— 读的是**工作内容**,
          // 喂给后面的定向裁剪;职位名与国家仍以人填的为准。
          const needRead = draft.jd.trim() && (!draft.extracted || draft.jd !== (job && job.jd));
          if (needRead) {
            saveBtn.disabled = true;
            saveBtn.textContent = tr('apply.jobReading');
            hint.textContent = '';
            try {
              await readJobIntoDraft();
              titleInput.value = draft.title;
            } catch (err) {
              if (isUnauthorized(err)) return redirectToUnlock();
              // **读失败照样存**:记录是用户的数据,不该因为模型打嗝就丢掉
              const key = JOB_ERROR_KEYS[err && err.code];
              window.Toast && window.Toast.err(key ? tr(key) : (err && err.message) || tr('ai.failed'));
            } finally {
              saveBtn.disabled = false;
              saveBtn.textContent = tr('action.submit');
            }
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
      // **简历语言永远摆出来**:它是这条记录的字段,不是"有选择才出现"的控件。
      // 列的是**语言**(不是你已有的事实文档)—— 选一门你还没有事实的语言是合法的,
      // 生成时会从默认语种译过去。
      field('apply.jobLang', langPicker.row),
      field('apply.job', jdInput),
      h('div', { class: 'apply-row apply-dlg-read' }, hint),
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

/**
 * 芯片上的字样:职位 · 国家 · 语种。
 *
 * **认不出的东西不写上去**:那门语种可能已经被删掉了(事实库里没有了),
 * 那时页面实际用的是默认语种 —— 芯片再写着它就是在撒谎。规格同理。
 * @param {object} rec 职位记录
 * @param {string[]} knownLangs 事实库现有语种;不传则不校验
 */
export const jobChipText = (rec, knownLangs = null) => {
  const spec = specById(rec.spec);
  const langOk = rec.lang && (!knownLangs || knownLangs.includes(rec.lang));
  const parts = [
    rec.title || tr('apply.jobUntitled'),
    spec && tr(spec.labelKey),
    langOk && factsLangName(rec.lang),
  ].filter(Boolean);
  return parts.join(' · ');
};
