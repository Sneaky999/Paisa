// Add / edit transaction dialog (also handles transfers, repeat, subcategories and tags).

import { h, icon } from '../utils/dom.js';
import { state, settings, saveTransaction, createRecurring, deleteTransaction, restoreTransaction, defaultAccount, getCategory, childrenOf, topCategories, allTags } from '../store.js';
import { today } from '../utils/dates.js';
import { toInputString, CURRENCIES } from '../utils/money.js';
import { validateTransaction, NOTE_MAX, normalizeTag, MAX_TAGS, TAG_MAX } from '../utils/validate.js';
import { openModal, confirmDialog, toast } from './overlay.js';
import { field, showErrors, clearFieldError, seg, selectEl } from './components.js';
import { openCategoryDialog } from './categoryForm.js';

let lastAccountId = null;

export function openTransactionForm(existing = null, preset = {}) {
  const isEdit = !!existing;
  const s = {
    type: existing?.type || preset.type || 'expense',
    amount: existing ? toInputString(existing.amount) : '',
    date: existing?.date || today(),
    categoryId: existing?.categoryId || null,
    accountId: existing?.accountId || (state.accounts.some((a) => a.id === lastAccountId) ? lastAccountId : defaultAccount().id),
    toAccountId: existing?.toAccountId || '',
    note: existing?.note || '',
    tags: [...(existing?.tags || [])],
    tagDraft: '',
    repeat: 'none',
    endDate: '',
  };

  const root = h('form', { class: 'form', novalidate: true, autocomplete: 'off' });
  const accountOptions = state.accounts.map((a) => [a.id, a.name]);

  /* ---------- Category + subcategory ---------- */
  function categorySection() {
    const wrap = h('div', { class: 'field', dataset: { field: 'categoryId' } });
    const inner = h('div', { class: 'cat-inner' });
    wrap.append(inner, h('p', { class: 'field-error', role: 'alert' }));

    function draw() {
      const sel = state.categories.find((c) => c.id === s.categoryId && c.type === s.type) || null;
      if (!sel) s.categoryId = null;
      const top = sel ? getCategory(sel.parentId || sel.id) : null;

      const chip = (c, on, pick) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: `chip-grid-btn${on ? ' on' : ''}`, title: c.name, onclick: pick,
      }, h('span', { class: 'chip-emoji', style: { background: `${c.color}26` } }, c.icon), h('span', { class: 'chip-label' }, c.name));

      const grid = h('div', { class: 'chip-grid', role: 'radiogroup', 'aria-label': 'Category' },
        topCategories(s.type).map((c) => chip(c, top?.id === c.id, () => { s.categoryId = c.id; clearFieldError(root, 'categoryId'); draw(); })),
        h('button', {
          type: 'button', class: 'chip-grid-btn chip-add', 'aria-label': `New ${s.type} category`,
          onclick: () => openCategoryDialog({ type: s.type, lockType: true, onSaved: (rec) => { s.categoryId = rec.id; clearFieldError(root, 'categoryId'); draw(); } }),
        }, h('span', { class: 'chip-emoji' }, icon('plus', 16)), h('span', { class: 'chip-label' }, 'New')));

      const kids = [h('span', { class: 'label' }, 'Category'), grid];
      if (top) {
        const subs = childrenOf(top.id);
        const pill = (label, on, pick, extra = '') => h('button', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: `chip${on ? ' on' : ''} ${extra}`.trim(), onclick: pick }, label);
        kids.push(h('div', { class: 'sub-row' },
          h('span', { class: 'label small' }, `Subcategory of ${top.name}`, h('span', { class: 'optional' }, ' (optional)')),
          h('div', { class: 'chip-row', role: 'radiogroup', 'aria-label': 'Subcategory' },
            pill('No subcategory', s.categoryId === top.id, () => { s.categoryId = top.id; draw(); }),
            subs.map((c) => pill(c.name, s.categoryId === c.id, () => { s.categoryId = c.id; draw(); })),
            h('button', {
              type: 'button', class: 'chip chip-add-sm', 'aria-label': `New subcategory under ${top.name}`,
              onclick: () => openCategoryDialog({ parentId: top.id, lockParent: true, lockType: true, onSaved: (rec) => { s.categoryId = rec.id; draw(); } }),
            }, '+ New subcategory'))));
      }
      inner.replaceChildren(...kids);
    }
    draw();
    return wrap;
  }

  /* ---------- Tags ---------- */
  function tagSection() {
    const wrap = h('div', { class: 'field', dataset: { field: 'tags' } });
    const chips = h('div', { class: 'tag-chips' });
    const suggest = h('div', { class: 'tag-suggest' });
    const err = h('p', { class: 'field-error', role: 'alert' });

    function commit(raw) {
      for (const piece of String(raw).split(/[,;]/)) {
        const t = normalizeTag(piece);
        if (!t || s.tags.includes(t)) continue;
        if (s.tags.length >= MAX_TAGS) { err.textContent = `Use at most ${MAX_TAGS} tags`; wrap.classList.add('has-error'); break; }
        s.tags.push(t);
      }
      s.tagDraft = '';
      input.value = '';
      draw();
    }
    const input = h('input', {
      class: 'input', id: 'tx-tags', type: 'text', maxlength: TAG_MAX + 8, placeholder: s.tags.length >= MAX_TAGS ? 'Tag limit reached' : 'Type a tag, then Enter', 'aria-label': 'Add a tag',
      value: s.tagDraft, disabled: s.tags.length >= MAX_TAGS,
      oninput: (e) => { s.tagDraft = e.target.value; if (/[,;]/.test(e.target.value)) commit(e.target.value); else clearFieldError(root, 'tags'); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (e.target.value.trim()) commit(e.target.value); } else if (e.key === 'Backspace' && !e.target.value && s.tags.length) { s.tags.pop(); draw(); } },
      onblur: (e) => { if (e.target.value.trim()) commit(e.target.value); },
    });
    function draw() {
      chips.replaceChildren(...s.tags.map((t) => h('span', { class: 'tag-chip' }, `#${t}`,
        h('button', { type: 'button', class: 'tag-x', 'aria-label': `Remove tag ${t}`, onclick: () => { s.tags = s.tags.filter((x) => x !== t); clearFieldError(root, 'tags'); draw(); } }, icon('x', 12)))));
      const free = allTags().filter((t) => !s.tags.includes(t)).slice(0, 8);
      suggest.replaceChildren(...(s.tags.length < MAX_TAGS && free.length ? [h('span', { class: 'muted small' }, 'Recent:'), ...free.map((t) => h('button', { type: 'button', class: 'tag-pick', onclick: () => commit(t) }, `#${t}`))] : []));
      input.disabled = s.tags.length >= MAX_TAGS;
      input.placeholder = s.tags.length >= MAX_TAGS ? 'Tag limit reached' : 'Type a tag, then Enter';
    }
    wrap.append(h('label', { for: 'tx-tags' }, 'Tags', h('span', { class: 'optional' }, ` (optional, up to ${MAX_TAGS})`)), chips, input, suggest, err);
    draw();
    return wrap;
  }

  function render() {
    const isTransfer = s.type === 'transfer';
    if (isTransfer && !s.toAccountId) s.toAccountId = (state.accounts.find((a) => a.id !== s.accountId) || {}).id || '';

    const symbol = (CURRENCIES[settings.currency] || CURRENCIES.NPR).symbol;
    const amountInput = h('input', {
      class: 'input amount-input', id: 'tx-amount', type: 'text', inputmode: 'decimal', placeholder: '0.00', value: s.amount, autofocus: true,
      oninput: (e) => { s.amount = e.target.value; clearFieldError(root, 'amount'); },
    });
    const kids = [
      h('div', { class: 'field' }, seg({
        label: 'Transaction type', value: s.type,
        options: [['expense', 'Expense', 'expense'], ['income', 'Income', 'income'], ['transfer', 'Transfer', 'transfer']],
        onChange: (v) => { s.type = v; render(); },
      })),
      field({
        label: 'Amount', name: 'amount', input: amountInput,
        control: h('div', { class: 'amount-wrap' }, h('span', { class: 'amount-sym', 'aria-hidden': 'true' }, symbol), amountInput),
      }),
    ];
    if (!isTransfer) kids.push(categorySection());

    kids.push(h('div', { class: 'field-row' },
      field({ label: isTransfer ? 'From account' : 'Account', name: 'accountId', control: selectEl(accountOptions, s.accountId, { id: 'tx-account', onchange: (e) => { s.accountId = e.target.value; clearFieldError(root, 'accountId'); } }) }),
      isTransfer ? field({ label: 'To account', name: 'toAccountId', control: selectEl(accountOptions, s.toAccountId, { id: 'tx-to', onchange: (e) => { s.toAccountId = e.target.value; clearFieldError(root, 'toAccountId'); } }) }) : null));

    kids.push(field({ label: 'Date', name: 'date', control: h('input', { class: 'input', id: 'tx-date', type: 'date', value: s.date, min: '1970-01-01', max: '2100-12-31', oninput: (e) => { s.date = e.target.value; clearFieldError(root, 'date'); } }) }));
    kids.push(field({ label: 'Note', name: 'note', optional: true, control: h('input', { class: 'input', id: 'tx-note', type: 'text', maxlength: NOTE_MAX + 20, placeholder: isTransfer ? 'e.g. ATM withdrawal' : 'e.g. Lunch with friends', value: s.note, oninput: (e) => { s.note = e.target.value; clearFieldError(root, 'note'); } }) }));
    kids.push(tagSection());

    if (!isEdit) {
      const repeatSel = selectEl([['none', 'Does not repeat'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']], s.repeat, { id: 'tx-repeat', onchange: (e) => { s.repeat = e.target.value; render(); } });
      kids.push(field({ label: 'Repeat', name: 'repeat', control: repeatSel }));
      if (s.repeat !== 'none') {
        kids.push(field({ label: 'Repeat until', name: 'endDate', optional: true, hint: 'Leave empty to repeat until you stop it in Transactions → Recurring.', control: h('input', { class: 'input', id: 'tx-end', type: 'date', value: s.endDate, min: s.date, max: '2100-12-31', oninput: (e) => { s.endDate = e.target.value; clearFieldError(root, 'endDate'); } }) }));
      }
    } else if (existing.recurringId) {
      kids.push(h('p', { class: 'hint inline-hint' }, icon('repeat', 14), ' This entry came from a recurring rule. Editing it changes only this one.'));
    }
    root.replaceChildren(...kids);
  }

  async function submit() {
    if (s.tagDraft.trim()) { // a tag typed but not yet confirmed still counts
      const t = normalizeTag(s.tagDraft.split(/[,;]/)[0]);
      if (t && !s.tags.includes(t) && s.tags.length < MAX_TAGS) s.tags.push(t);
      s.tagDraft = '';
    }
    const v = validateTransaction(s, state);
    const errors = { ...v.errors };
    if (!isEdit && s.repeat !== 'none' && s.endDate && s.endDate < s.date) errors.endDate = 'End date must be after the start date';
    if (Object.keys(errors).length) { showErrors(root, errors); return; }
    saveBtn.disabled = true;
    try {
      const saved = await saveTransaction(v.value, existing?.id || null);
      lastAccountId = v.value.accountId;
      if (!isEdit && s.repeat !== 'none') await createRecurring(saved, s.repeat, s.endDate || null);
      modal.close();
      toast(isEdit ? 'Transaction updated' : s.repeat !== 'none' ? 'Transaction added and repeat scheduled' : 'Transaction added');
    } catch (e) {
      saveBtn.disabled = false;
      toast(`Could not save: ${e.message}`, { type: 'error' });
    }
  }

  async function remove() {
    const ok = await confirmDialog({ title: 'Delete this transaction?', message: 'This removes it from your balances, budgets and reports.', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      const gone = await deleteTransaction(existing.id);
      modal.close();
      toast('Transaction deleted', { action: { label: 'Undo', onClick: () => restoreTransaction(gone).then(() => toast('Restored')) } });
    } catch (e) { toast(`Could not delete: ${e.message}`, { type: 'error' }); }
  }

  root.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit', onclick: (e) => { e.preventDefault(); submit(); } }, isEdit ? 'Save changes' : 'Add transaction');
  const footer = [
    isEdit ? h('button', { class: 'btn btn-danger-ghost push-left', type: 'button', onclick: remove }, icon('trash', 16), 'Delete') : null,
    h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Cancel'),
    saveBtn,
  ];
  render();
  const modal = openModal({ title: isEdit ? 'Edit transaction' : 'New transaction', content: root, footer });
  return modal;
}
