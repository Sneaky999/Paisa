import { h, icon, clear } from './utils/dom.js';
import * as store from './store.js';
import { skeletonView } from './ui/components.js';
import { destroyCharts, flushMounts } from './ui/charts.js';
import { openTransactionForm } from './ui/txForm.js';
import { toast } from './ui/overlay.js';
import * as dashboard from './views/dashboard.js';
import * as transactions from './views/transactions.js';
import * as budgets from './views/budgets.js';
import * as goals from './views/goals.js';
import * as reports from './views/reports.js';
import * as settingsView from './views/settings.js';

const ROUTES = {
  dashboard: { label: 'Dashboard', icon: 'home', view: dashboard },
  transactions: { label: 'Transactions', icon: 'list', view: transactions },
  budgets: { label: 'Budgets', icon: 'budget', view: budgets },
  goals: { label: 'Goals', icon: 'target', view: goals },
  reports: { label: 'Reports', icon: 'chart', view: reports },
  settings: { label: 'Settings', icon: 'settings', view: settingsView },
};
const ORDER = Object.keys(ROUTES);

let main, sidebarNav, bottomNav;
let current = null;

const routeFromHash = () => {
  const k = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return ROUTES[k] ? k : 'dashboard';
};

/* ---------- Theme ---------- */

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
export function applyTheme() {
  const t = store.settings.theme;
  const dark = t === 'dark' || (t === 'system' && mq?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f1715' : '#f5f7f6');
}

/* ---------- Shell ---------- */

const SHORT = { dashboard: 'Home', transactions: 'Activity', budgets: 'Budgets', goals: 'Goals', reports: 'Reports', settings: 'Settings' };

function navLink(key, cls) {
  const r = ROUTES[key];
  // Bottom-nav labels are shortened so five tabs fit on a 360px phone; the full name stays in aria-label.
  const short = cls === 'bn-link';
  return h('a', { class: cls, href: `#/${key}`, 'data-route': key, 'aria-label': short ? r.label : undefined }, icon(r.icon, 20), h('span', null, short ? SHORT[key] : r.label));
}

function buildShell(root) {
  sidebarNav = h('nav', { class: 'side-nav', 'aria-label': 'Main' }, ORDER.map((k) => navLink(k, 'nav-link')));
  bottomNav = h('nav', { class: 'bottom-nav', 'aria-label': 'Main' },
    ORDER.slice(0, 2).map((k) => navLink(k, 'bn-link')),
    h('span', { class: 'bn-gap', 'aria-hidden': 'true' }),
    ORDER.slice(2, 5).map((k) => navLink(k, 'bn-link')));
  main = h('main', { id: 'main', class: 'main', tabindex: '-1' });
  main.addEventListener('paisa:rerender', () => draw({ keepScroll: true }));
  root.replaceChildren(
    h('a', { class: 'skip', href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, 'Skip to content'),
    h('div', { class: 'shell' },
      h('aside', { class: 'sidebar' },
        h('div', { class: 'brand' }, h('span', { class: 'logo', 'aria-hidden': 'true' }, 'P'), h('span', { class: 'brand-name' }, 'Paisa')),
        sidebarNav,
        h('button', { class: 'btn btn-primary side-add', type: 'button', onclick: () => openTransactionForm() }, icon('plus', 18), 'Add transaction'),
        h('a', { class: 'nav-link side-settings', href: '#/settings', 'data-route': 'settings' }, icon('settings', 20), h('span', null, 'Settings'))),
      main),
    bottomNav,
    h('button', { class: 'fab', type: 'button', 'aria-label': 'Add transaction', onclick: () => openTransactionForm() }, icon('plus', 26)));
  // The settings link in the sidebar nav would be duplicated; keep it only at the bottom of the sidebar.
  sidebarNav.querySelector('[data-route="settings"]')?.remove();
  // On mobile the 5th slot is reachable via the "More" route: settings lives in the top bar instead.
  main.before(h('a', { class: 'top-settings', href: '#/settings', 'aria-label': 'Settings' }, icon('settings', 22)));
}

function markActive(key) {
  document.querySelectorAll('[data-route]').forEach((a) => {
    const on = a.dataset.route === key;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

export function draw({ keepScroll = false } = {}) {
  const key = routeFromHash();
  const y = window.scrollY;
  const sameRoute = key === current;
  current = key;
  destroyCharts();
  clear(main);
  markActive(key);
  document.title = `${ROUTES[key].label} · Paisa`;
  const page = h('div', { class: 'page', dataset: { page: key } });
  main.append(page);
  try {
    ROUTES[key].view.render(page);
  } catch (e) {
    console.error(e);
    clear(page).append(h('div', { class: 'card error-card', role: 'alert' }, h('h2', null, 'Something went wrong'), h('p', { class: 'muted' }, 'This page could not be displayed. Your data is safe.'), h('button', { class: 'btn', type: 'button', onclick: () => draw() }, 'Try again')));
  }
  flushMounts();
  if (keepScroll && sameRoute) window.scrollTo(0, y);
  else if (!sameRoute) { window.scrollTo(0, 0); }
}

/* ---------- Backup reminder ---------- */

const BACKUP_KEY = 'paisa.lastBackupNudge';
function maybeRemindBackup() {
  try {
    if (store.state.transactions.length < 30 || store.hasDemo()) return;
    const last = +localStorage.getItem(BACKUP_KEY) || 0;
    if (!last) { localStorage.setItem(BACKUP_KEY, String(Date.now())); return; }
    if (Date.now() - last < 30 * 86400000) return;
    localStorage.setItem(BACKUP_KEY, String(Date.now()));
    toast('It’s been a while. Download a backup from Settings to keep your data safe.', { type: 'info', action: { label: 'Open Settings', onClick: () => { location.hash = '#/settings'; } }, duration: 9000 });
  } catch { /* storage blocked: skip reminder */ }
}

/* ---------- Boot ---------- */

export async function start(root) {
  applyTheme();
  mq?.addEventListener?.('change', () => store.settings.theme === 'system' && applyTheme());
  root.replaceChildren(skeletonView());
  let posted = 0;
  try {
    ({ posted } = await store.init());
  } catch (e) {
    console.error(e);
    root.replaceChildren(h('div', { class: 'boot-error card', role: 'alert' }, h('h1', null, 'Paisa could not start'), h('p', { class: 'muted' }, `Something went wrong while opening your data (${e.message}). Reloading usually fixes it.`), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'Reload')));
    return;
  }
  buildShell(root);
  store.subscribe(() => { applyTheme(); draw({ keepScroll: true }); });
  window.addEventListener('hashchange', () => draw());
  if (!location.hash) history.replaceState(null, '', '#/dashboard');
  draw();
  if (!store.status.persistent) toast('Your browser is blocking storage, so data will not be saved after you close this tab.', { type: 'error' });
  if (posted) toast(`${posted} recurring transaction${posted === 1 ? '' : 's'} added`, { type: 'info' });
  maybeRemindBackup();
  // Midnight rollover / returning to a stale tab: post anything newly due and refresh.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const n = await store.processRecurring();
    if (n) toast(`${n} recurring transaction${n === 1 ? '' : 's'} added`, { type: 'info' });
  });
}
