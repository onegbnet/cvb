// 列表型模块编辑器:手风琴条目 + HTML5 拖拽排序 + 编辑/删除 + 新增表单。
import { h, clear } from '../lib/dom.mjs';
import { icon } from '../lib/icons.mjs';
import { tr } from '../lib/i18n.mjs';
import { confirmAction } from '../lib/confirm.mjs';
import { createFormCreator } from './form-creator.mjs';

const arrayMove = (arr, from, to) => {
  const next = arr.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

const previewText = (value) => {
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '');
};

/**
 * @param {object} opts
 * @param {Array} opts.fields 字段定义(已解析)
 * @param {string} opts.summaryField 摘要字段名
 * @param {Array<object>} opts.items 当前条目
 * @param {(items: Array<object>) => void} opts.onChange
 */
export function createListEditor({ fields, summaryField, items = [], onChange, aiContext }) {
  const root = h('div', { class: 'list-module-editor' });

  const fieldsForIndex = (index) =>
    fields.map((field) => ({
      ...field,
      jsonPath: field.jsonPath ? field.jsonPath.replaceAll('[]', `[${index}]`) : field.jsonPath,
    }));

  let expandedKey = null;
  let editingKey = null; // -1 = 新增
  let dragIndex = null;
  let openFormEl = null; // 当前打开的那张表单(用于判断有没有真改动)

  const getItemSummary = (item, index) => {
    const text = previewText(item[summaryField]).trim();
    return text ? `${index + 1}. ${text}` : `${index + 1}`;
  };

  /** 该条目有必填项还空着(导入进来的、早年填一半的,不点开就看不出来)。 */
  const isIncomplete = (item) =>
    fields.some((f) => {
      if (!f.required) return false;
      const v = item[f.attributeId];
      const s = Array.isArray(v) ? v.join('') : String(v ?? '');
      return s.trim() === '';
    });

  const render = () => {
    clear(root);

    root.append(
      h('button', { type: 'button', class: 'btn add-btn', onClick: handleAdd }, icon('plus'), ` ${tr('action.add')}`)
    );

    items.forEach((item, index) => {
      const headerEl = h(
        'div',
        {
          class: 'list-panel-header',
          draggable: 'true',
          // 键盘可达:原来是纯 div + onClick,Tab 停不下、回车空格都没反应。
          // 不用 <button> 是因为里面还嵌着编辑/删除等按钮(嵌套 button 非法)。
          tabindex: '0',
          role: 'button',
          'aria-expanded': expandedKey === index ? 'true' : 'false',
          onKeydown: (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.currentTarget.click();
          },
          onClick: () => {
            expandedKey = expandedKey === index ? null : index;
            if (editingKey !== null && editingKey !== -1) editingKey = null;
            render();
          },
          onDragstart: (e) => {
            dragIndex = index;
            e.dataTransfer.effectAllowed = 'move';
          },
          onDragover: (e) => {
            e.preventDefault();
            if (dragIndex === null || dragIndex === index) return;
            headerEl.classList.toggle('drop-over-downward', dragIndex < index);
            headerEl.classList.toggle('drop-over-upward', dragIndex > index);
          },
          onDragleave: () => headerEl.classList.remove('drop-over-downward', 'drop-over-upward'),
          onDrop: (e) => {
            e.preventDefault();
            headerEl.classList.remove('drop-over-downward', 'drop-over-upward');
            if (dragIndex === null || dragIndex === index) return;
            onChange(arrayMove(items, dragIndex, index));
            dragIndex = null;
          },
        },
        h(
          'span',
          { class: 'list-panel-title' },
          getItemSummary(item, index),
          isIncomplete(item)
            ? h('span', { class: 'module-issue', title: tr('editor.missingRequired') }, '!')
            : null
        ),
        h(
          'span',
          { class: 'list-panel-actions', onClick: (e) => e.stopPropagation() },
          // 上/下移:HTML5 拖拽在触屏上根本不触发,手机端此前**无法调整顺序**。
          // 拖拽保留(桌面顺手),按钮是那条唯一可用的路。
          h(
            'button',
            {
              type: 'button',
              class: 'list-panel-action move',
              title: tr('action.moveUp'),
              disabled: index === 0,
              onClick: () => onChange(arrayMove(items, index, index - 1)),
            },
            icon('chevronUp')
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'list-panel-action move',
              title: tr('action.moveDown'),
              disabled: index === items.length - 1,
              onClick: () => onChange(arrayMove(items, index, index + 1)),
            },
            icon('chevronDown')
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'list-panel-action edit',
              title: tr('action.edit'),
              onClick: () => {
                editingKey = index;
                expandedKey = index;
                render();
              },
            },
            icon('edit')
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'list-panel-action delete',
              title: tr('action.delete'),
              onClick: () => {
                // ccs 的 Overlay.confirm 返回 **Promise**,不认 onOk 回调 ——
                // 原来传 { onOk } 是静默失效的:弹框照出,点"确定"什么也不会发生,
                // 也就是说**删除按钮从 2026-08-12 起就一直是坏的**(2026-08-15 用户报出)。
                confirmAction(tr('action.confirmDelete'), () =>
                  onChange(items.filter((_, i) => i !== index))
                );
              },
            },
            icon('trash')
          )
        )
      );

      const panel = h('div', { class: 'list-panel' }, headerEl);

      if (expandedKey === index) {
        const body = h('div', { class: 'list-panel-body' });
        if (editingKey === index) {
          openFormEl = createFormCreator({
              fields: fieldsForIndex(index),
              value: item,
              isList: true,
              aiContext,
              onSubmit: (valuesFromForm) => {
                const next = items.slice();
                next[index] = { ...next[index], ...valuesFromForm };
                editingKey = null;
                onChange(next);
              },
            });
          body.append(openFormEl);
        } else {
          const rows = fields
            .filter((f) => {
              const v = item[f.attributeId];
              return v !== undefined && v !== null && String(previewText(v)).trim() !== '';
            })
            .map((f) =>
              h(
                'div',
                { class: 'item-preview-row' },
                h('strong', {}, `${tr(f.labelKey)}: `),
                previewText(item[f.attributeId])
              )
            );
          body.append(
            h(
              'div',
              { class: 'item-preview' },
              rows,
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-small btn-accent',
                  style: { marginTop: '8px' },
                  onClick: () => {
                    editingKey = index;
                    render();
                  },
                },
                icon('edit'),
                ` ${tr('action.edit')}`
              )
            )
          );
        }
        panel.append(body);
      }

      root.append(panel);
    });

    if (editingKey === -1) {
      root.append(
        h(
          'div',
          { class: 'edit-form-container' },
          h(
            'div',
            { class: 'edit-form-header' },
            h('span', {}, tr('action.add')),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-small',
                onClick: () => {
                  editingKey = null;
                  render();
                },
              },
              tr('action.close')
            )
          ),
          (openFormEl = createFormCreator({
            fields: fieldsForIndex(items.length),
            value: {},
            isList: true,
            aiContext,
            onSubmit: (valuesFromForm) => {
              editingKey = null;
              onChange([...items, valuesFromForm]);
            },
          }))
        )
      );
    }

    if (items.length === 0 && editingKey !== -1) {
      root.append(h('div', { class: 'empty-placeholder' }, tr('editor.empty')));
    }
  };

  function handleAdd() {
    editingKey = -1;
    render();
  }

  render();

  /** 两个值在表单口径下是不是"一样"(空串/undefined/空数组都算空)。 */
  const sameValue = (a, b) => {
    const norm = (v) => (Array.isArray(v) ? v.join('\u0000') : String(v ?? '').trim());
    return norm(a) === norm(b);
  };

  // 条目编辑是"提交制"(表单里的改动只有点了提交才回写 config),切模块会整体重建表单,
  // 那一刻未提交的内容会消失 —— 所以要拦。
  //
  // **但判据必须是"有没有改动",不是"表单开着没开"**:点一下「添加」出来一张空表单、
  // 一个字没填就切版块,原来照样弹"会丢失刚才的修改" —— 用户根本没改过什么
  //(2026-08-16 用户报出)。现在拿表单当前值和它的初值逐字段比。
  root.hasPendingEdit = () => {
    if (editingKey === null) return false;
    if (!openFormEl || typeof openFormEl.getValues !== 'function') return true; // 判不了就宁可拦
    const values = openFormEl.getValues();
    const base = editingKey === -1 ? {} : items[editingKey] || {};
    return fields.some((f) => !sameValue(values[f.attributeId], base[f.attributeId]));
  };

  return root;
}
