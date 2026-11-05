// Realistic (Nepal-flavoured) sample data. Everything is flagged `demo: true` so it can be removed in one click.
// Deterministic: same output for the same `todayISO`, which keeps tests stable.

import { addDays, addMonths, parseISO, periodOf } from './utils/dates.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = (n) => Math.round(n * 100); // rupees -> minor units

export const DEMO_BANK = 'acc-demo-bank';
export const DEMO_WALLET = 'acc-demo-wallet';
const CASH = 'acc-cash';

export function buildDemo(todayISO) {
  const rand = rng(20261103);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const between = (lo, hi) => Math.round(lo + rand() * (hi - lo));
  const step = (n, lo, hi) => Math.round(between(lo, hi) / n) * n; // "nice" amounts

  const accounts = [
    { id: DEMO_BANK, name: 'Nabil Bank', type: 'bank', opening: R(40000), demo: true },
    { id: DEMO_WALLET, name: 'eSewa', type: 'wallet', opening: R(3000), demo: true },
  ];

  // Sample subcategories (one level) so the feature is visible from the first launch.
  const categories = [
    { id: 'cat-sub-groceries', parentId: 'cat-exp-food', name: 'Groceries', type: 'expense', icon: '🛒', color: '#c2410c', demo: true },
    { id: 'cat-sub-dining', parentId: 'cat-exp-food', name: 'Dining out', type: 'expense', icon: '🍽️', color: '#c2410c', demo: true },
    { id: 'cat-sub-rides', parentId: 'cat-exp-transport', name: 'Ride apps', type: 'expense', icon: '🚕', color: '#2563eb', demo: true },
    { id: 'cat-sub-web', parentId: 'cat-inc-freelance', name: 'Web projects', type: 'income', icon: '🌐', color: '#2563eb', demo: true },
    { id: 'cat-sub-design', parentId: 'cat-inc-freelance', name: 'Design gigs', type: 'income', icon: '🎨', color: '#2563eb', demo: true },
  ];
  const FOOD_SUB = { Momo: 'cat-sub-dining', 'Dal bhat': 'cat-sub-dining', 'Tea & snacks': 'cat-sub-dining', Vegetables: 'cat-sub-groceries', Groceries: 'cat-sub-groceries', 'Lunch with friends': 'cat-sub-dining', Bakery: 'cat-sub-dining', Fruits: 'cat-sub-groceries' };

  const txns = [];
  let n = 0;
  const add = (date, type, rupees, categoryId, accountId, note, extra = {}) => {
    if (date > todayISO) return;
    txns.push({ id: `demo-t${String(++n).padStart(4, '0')}`, type, amount: R(rupees), date, categoryId, accountId, toAccountId: null, note, demo: true, ...extra });
  };

  const monthStart = periodOf(todayISO, 1).start; // first of the current calendar month
  for (let back = 5; back >= 0; back--) {
    const first = addMonths(monthStart, -back);
    const day = (d) => addDays(first, d - 1);

    add(day(1), 'income', 65000, 'cat-inc-salary', DEMO_BANK, 'Monthly salary');
    add(day(3), 'expense', 18000, 'cat-exp-housing', DEMO_BANK, 'Room rent');
    add(day(8), 'expense', 1500, 'cat-exp-bills', DEMO_BANK, 'Internet bill');
    add(day(12), 'expense', step(50, 1400, 2200), 'cat-exp-bills', DEMO_BANK, 'Electricity bill');
    add(day(15), 'expense', 599, 'cat-exp-bills', DEMO_WALLET, 'Mobile data pack');
    add(day(2), 'transfer', 10000, null, DEMO_BANK, 'Top up eSewa', { toAccountId: DEMO_WALLET });
    add(day(4), 'transfer', 12000, null, DEMO_BANK, 'ATM withdrawal', { toAccountId: CASH });

    // Same random-number order as before; the subcategory is derived from the note.
    for (let i = 0; i < 12; i++) {
      const cash = rand() < 0.5;
      const when = day(between(1, 28));
      const amt = step(10, 120, cash ? 600 : 1300);
      const acct = cash ? CASH : pick([DEMO_BANK, DEMO_WALLET]);
      const note = pick(['Momo', 'Dal bhat', 'Tea & snacks', 'Vegetables', 'Groceries', 'Lunch with friends', 'Bakery', 'Fruits']);
      add(when, 'expense', amt, FOOD_SUB[note], acct, note);
    }
    for (let i = 0; i < 8; i++) {
      const when = day(between(1, 28));
      const amt = step(10, 40, 250);
      const acct = rand() < 0.7 ? CASH : DEMO_WALLET;
      const note = pick(['Micro fare', 'Pathao ride', 'Bus fare', 'Tempo']);
      add(when, 'expense', amt, note === 'Pathao ride' ? 'cat-sub-rides' : 'cat-exp-transport', acct, note, note === 'Pathao ride' ? { tags: ['commute'] } : {});
    }
    add(day(between(14, 26)), 'expense', step(100, 1500, 5000), 'cat-exp-shopping', pick([DEMO_BANK, DEMO_WALLET]), pick(['Clothes', 'Daraz order', 'Shoes']));
    if (rand() < 0.5) add(day(between(5, 27)), 'expense', step(100, 1200, 4500), 'cat-exp-shopping', DEMO_BANK, 'Gift for family', { tags: ['family'] });
    if (rand() < 0.6) add(day(between(3, 27)), 'expense', step(50, 400, 2500), 'cat-exp-health', DEMO_WALLET, 'Pharmacy');
    if (rand() < 0.5) add(day(between(5, 20)), 'expense', 2000, 'cat-exp-education', DEMO_BANK, 'Online course', { tags: ['learning'] });
    add(day(10), 'expense', 600, 'cat-exp-fun', DEMO_WALLET, 'Netflix', { tags: ['subscription'] });
    add(day(between(16, 28)), 'expense', step(50, 400, 1500), 'cat-exp-fun', DEMO_WALLET, pick(['Movie night', 'Cafe hangout', 'Games']));
    if (rand() < 0.5) add(day(between(16, 28)), 'income', step(500, 8000, 24000), back % 2 ? 'cat-sub-web' : 'cat-sub-design', DEMO_WALLET, back % 2 ? 'Freelance web project' : 'Logo design gig', { tags: ['work'] });
    if (back % 3 === 0) add(day(20), 'income', 3500, 'cat-inc-invest', DEMO_BANK, 'Dividend');
  }

  // Next occurrence of a day-of-month strictly after today.
  const nextDay = (d) => {
    const t = parseISO(todayISO);
    const thisMonth = addMonths(`${t.y}-${String(t.m).padStart(2, '0')}-01`, 0, d);
    return thisMonth > todayISO ? thisMonth : addMonths(thisMonth, 1, d);
  };
  const rule = (id, type, rupees, categoryId, accountId, note, day) => ({
    id, type, amount: R(rupees), categoryId, accountId, toAccountId: null, note,
    frequency: 'monthly', anchorDay: day, nextDate: nextDay(day), endDate: null, active: true, demo: true,
  });
  const recurring = [
    rule('demo-r1', 'income', 65000, 'cat-inc-salary', DEMO_BANK, 'Monthly salary', 1),
    rule('demo-r2', 'expense', 18000, 'cat-exp-housing', DEMO_BANK, 'Room rent', 3),
    rule('demo-r3', 'expense', 1500, 'cat-exp-bills', DEMO_BANK, 'Internet bill', 8),
  ];

  const budgets = [
    { id: 'demo-b0', categoryId: null, limit: R(55000), demo: true },
    { id: 'demo-b1', categoryId: 'cat-exp-food', limit: R(15000), demo: true },
    { id: 'demo-b2', categoryId: 'cat-exp-transport', limit: R(4000), demo: true },
    { id: 'demo-b3', categoryId: 'cat-exp-shopping', limit: R(6000), demo: true },
    { id: 'demo-b4', categoryId: 'cat-exp-fun', limit: R(3000), demo: true },
  ];

  const entry = (i, monthsAgo, rupees, note) => ({ id: `demo-e${i}`, amount: R(rupees), date: addDays(addMonths(monthStart, -monthsAgo), 4), note });
  const goals = [
    { id: 'demo-g1', name: 'Emergency fund', target: R(150000), initial: R(40000), deadline: addMonths(monthStart, 10, 28), demo: true,
      entries: [entry(1, 4, 10000, 'Monthly saving'), entry(2, 3, 10000, 'Monthly saving'), entry(3, 2, 12000, 'Monthly saving'), entry(4, 1, 10000, 'Monthly saving')].filter((e) => e.date <= todayISO) },
    { id: 'demo-g2', name: 'New laptop', target: R(120000), initial: R(15000), deadline: addMonths(monthStart, 6, 15), demo: true,
      entries: [entry(5, 3, 8000, 'Freelance money'), entry(6, 1, 15000, 'Freelance money')].filter((e) => e.date <= todayISO) },
    { id: 'demo-g3', name: 'Pokhara trip', target: R(35000), initial: R(12000), deadline: addMonths(monthStart, 3, 20), demo: true,
      entries: [entry(7, 2, 5000, 'Trip fund')].filter((e) => e.date <= todayISO) },
  ];

  return { categories, accounts, transactions: txns, recurring, budgets, goals };
}
