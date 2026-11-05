// One dialog for creating/editing a category OR a subcategory. Used by Settings and by the
// "+ New" buttons inside the transaction form (where `onSaved` selects the new category).

import { h } from '../utils/dom.js';
import * as store from '../store.js';
import { state } from '../store.js';
import { validateCategory, NAME_MAX } from '../utils/validate.js';
import { ICON_CHOICES, COLOR_CHOICES } from '../defaults.js';
import { field, showErrors, clearFieldError, seg, selectEl, catBadge } from './components.js';
import { openModal, toast } from './overlay.js';

/**
 * existing   – edit this category (omit to create)
 * type       – 'expense' | 'income' when creating a top-level category
 * parentId   – create a subcategory under this top-level category
 * lockParent – the parent cannot be changed in the dialog (inline "+ New subcategory")
 * lockType   – hide the Expense/Income switch (used inline, where the form already decided)
 */
export function openCategoryDialog({ existing = null, type = 'expense', parentId = null, lockParent = false, lockType = false, onSaved } = {}) {
  const parent0 = parentId ? state.categories.find((c) => c.id === parentId) : null;
  const s = {
    name: existing?.name || '',
    type: existing?.type || parent0?.type || type,
    icon: existing?.icon || ICON_CHOICES[0],
    color: existing?.color || COLOR_CHOICES[0],
    parentId: existing ? existing.parentId || '' : parentId || '',
  };
  const hasKids = !!existing && store.childrenOf(existing.id).length > 0;
  const canMove = !lockParent && !existing?.fallback && !hasKids;
  const root = h('form', { class: 'form', novalidate: true, autocomplete: 'off' });
  let first = true;

  const parentOptions = () => [['', 'None: a top-level category'], ...store.topCategories(s.type).filter((c) => c.id !== existing?.id).map((c) => [c.id, `${c.icon} ${c.name}`])];

  function draw() {
    const parent = s.parentId ? state.categories.find((c) => c.id === s.parentId) : null;
    const kids = [];
    if (!existing && !parent0 && !lockType) {
      kids.push(h('div', { class: 'field' }, seg({
        label: 'Category type', value: s.type,
        options: [['expense', 'Expense', 'expense'], ['income', 'Income', 'income']],
        onChange: (v) => { s.type = v; s.parentId = ''; draw(); },
      })));
    }
    kids.push(field({
      label: 'Name', name: 'name',
      control: h('input', { class: 'input', id: 'k-name', type: 'text', maxlength: NAME_MAX + 10, placeholder: parent ? 'e.g. Web projects' : 'e.g. Pets', value: s.name, autofocus: first, oninput: (e) => { s.name = e.target.value; clearFieldError(root, 'name'); } }),
    }));
    if (lockParent && parent) {
      kids.push(h('div', { class: 'field' }, h('span', { class: 'label' }, 'Under'), h('div', { class: 'preview' }, catBadge(parent, 'sm'), h('strong', null, parent.name))));
    } else if (canMove) {
      kids.push(field({
        label: existing ? 'Parent category' : 'Parent category', name: 'parentId', optional: true,
        hint: existing ? 'Choose a parent to turn this into a subcategory, or None to make it top-level.' : 'Leave as None for a main category, or pick one to create a subcategory under it.',
        control: selectEl(parentOptions(), s.parentId, { id: 'k-parent', onchange: (e) => { s.parentId = e.target.value; clearFieldError(root, 'parentId'); draw(); } }),
      }));
    } else if (existing) {
      kids.push(h('p', { class: 'hint' }, existing.fallback ? '“Others” always stays a top-level category.' : 'This category has subcategories, so it stays top-level. Move or merge them first if you want to change that.'));
    }
    kids.push(h('div', { class: 'field' }, h('span', { class: 'label' }, 'Icon'), h('div', { class: 'pick-grid', role: 'radiogroup', 'aria-label': 'Icon' },
      ICON_CHOICES.map((i) => h('button', { type: 'button', role: 'radio', 'aria-checked': i === s.icon ? 'true' : 'false', class: `pick${i === s.icon ? ' on' : ''}`, onclick: () => { s.icon = i; first = false; draw(); } }, i)))));
    if (parent) {
      kids.push(h('p', { class: 'hint' }, `Subcategories use the color of ${parent.name}.`));
    } else {
      kids.push(h('div', { class: 'field', dataset: { field: 'color' } }, h('span', { class: 'label' }, 'Color'),
        h('div', { class: 'pick-grid', role: 'radiogroup', 'aria-label': 'Color' }, COLOR_CHOICES.map((c) => h('button', { type: 'button', role: 'radio', 'aria-label': c, 'aria-checked': c === s.color ? 'true' : 'false', class: `pick swatch-pick${c === s.color ? ' on' : ''}`, style: { background: c }, onclick: () => { s.color = c; first = false; draw(); } }))),
        h('p', { class: 'field-error', role: 'alert' })));
    }
    kids.push(h('div', { class: 'preview' }, catBadge({ icon: s.icon, color: parent ? parent.color : s.color }),
      h('strong', null, `${parent ? parent.name + ' › ' : ''}${s.name.trim() || 'Preview'}`)));
    root.replaceChildren(...kids);
    first = false;
  }

  async function submit() {
    const v = validateCategory(s, { categories: state.categories, editingId: existing?.id });
    if (!v.ok) { showErrors(root, v.errors); return; }
    try {
      const rec = await store.saveCategory(v.value, existing?.id || null);
      m.close();
      toast(existing ? 'Category updated' : rec.parentId ? 'Subcategory added' : 'Category added');
      onSaved?.(rec);
    } catch (e) { toast(`Could not save: ${e.message}`, { type: 'error' }); }
  }
  root.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  draw();
  const word = (existing ? existing.parentId : s.parentId) ? 'subcategory' : 'category';
  const m = openModal({
    title: existing ? `Edit ${word}` : s.parentId && lockParent ? 'New subcategory' : 'New category',
    content: root,
    footer: [
      h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, existing ? 'Save' : s.parentId && lockParent ? 'Add subcategory' : 'Add category'),
    ],
  });
  return m;
}
