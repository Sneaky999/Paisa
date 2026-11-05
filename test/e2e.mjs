import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2];
const url = 'file://' + process.cwd() + '/dist/paisa.html';
const browser = await chromium.launch();
const problems = [];
let passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else problems.push('FAIL: ' + msg); };

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

const go = async (r) => { await page.goto(url + '#/' + r); await page.waitForSelector(`.page[data-page="${r}"]`); await page.waitForTimeout(900); };
const text = () => page.locator('main').innerText();
const toastText = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');

/* ---- charts actually paint ---- */
await go('dashboard');
const painted = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
}));
ok(painted.length === 2 && painted.every((n) => n > 500), `dashboard charts painted pixels ${JSON.stringify(painted)}`);
await page.screenshot({ path: `${OUT}/e2e-dashboard.png` });
await go('reports');
const painted2 = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
}));
ok(painted2.length === 3 && painted2.every((n) => n > 500), `reports charts painted ${JSON.stringify(painted2)}`);
await page.screenshot({ path: `${OUT}/e2e-reports.png` });

/* ---- remove sample data, empty states ---- */
await go('dashboard');
await page.getByRole('button', { name: 'Remove sample data' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
await page.waitForTimeout(400);
ok((await text()).includes('Start tracking your money'), 'empty dashboard after removing sample data');
await page.screenshot({ path: `${OUT}/e2e-empty.png` });

/* ---- add transaction: validation first ---- */
await page.locator('.page-head').getByRole('button', { name: 'Add transaction' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Add transaction' }).click();
let dlg = await page.getByRole('dialog').innerText();
ok(dlg.includes('Enter an amount'), 'amount validation shown');
ok(dlg.includes('Choose a category'), 'category validation shown');
await page.screenshot({ path: `${OUT}/e2e-form-errors.png` });
await page.fill('#tx-amount', '-5');
await page.getByRole('radio', { name: /Food/ }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Add transaction' }).click();
ok((await page.getByRole('dialog').innerText()).includes('cannot be negative'), 'negative amount rejected');
await page.fill('#tx-amount', '1,250.75');
await page.fill('#tx-note', 'Momo <b>bold</b>');
await page.getByRole('dialog').getByRole('button', { name: 'Add transaction' }).click();
await page.waitForSelector('.toast:has-text("Transaction added")', { timeout: 3000 });
ok((await toastText()).includes('Transaction added'), 'success toast');
ok((await text()).includes('Rs 1,250.75') || (await text()).includes('1,250'), 'amount visible on dashboard');

/* income too */
await page.locator('.page-head').getByRole('button', { name: 'Add transaction' }).click();
await page.getByRole('radio', { name: 'Income' }).click();
await page.fill('#tx-amount', '50000');
await page.getByRole('radio', { name: /Salary/ }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Add transaction' }).click();
await page.waitForTimeout(300);
await go('dashboard');
const dash = await text();
ok(dash.includes('Rs 48,749.25'), 'balance = 50000 - 1250.75 = 48,749.25; got: ' + (dash.match(/Rs [\d,]+\.\d\d/g) || []).slice(0, 3));
ok(dash.includes('97.5%'), 'savings rate 97.5%');
await page.screenshot({ path: `${OUT}/e2e-dashboard-live.png` });

/* ---- note is rendered as text, never as HTML ---- */
await go('transactions');
ok(await page.locator('main b').count() === 0, 'note HTML not interpreted');
ok((await text()).includes('<b>bold</b>'), 'note shown literally');

/* ---- search / filter ---- */
await page.fill('input[type=search]', 'momo');
await page.waitForTimeout(150);
ok((await page.locator('.tx-row').count()) === 1, 'search narrows to 1 row');
await page.fill('input[type=search]', 'zzz');
ok((await text()).includes('Nothing matches'), 'no-match empty state');
await page.fill('input[type=search]', '');

/* ---- edit then delete + undo ---- */
await page.locator('.tx-row', { hasText: 'Momo' }).click();
await page.fill('#tx-amount', '1000');
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(300);
ok((await text()).includes('1,000.00'), 'edit saved');
await page.locator('.tx-row', { hasText: 'Momo' }).click();
await page.getByRole('button', { name: 'Delete' }).click();
await page.getByRole('dialog').filter({ hasText: 'Delete this transaction?' }).getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(300);
ok((await page.locator('.tx-row', { hasText: 'Momo' }).count()) === 0, 'deleted');
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(300);
ok((await page.locator('.tx-row', { hasText: 'Momo' }).count()) === 1, 'undo restored');

/* ---- recurring ---- */
await page.locator('.page-head').getByRole('button', { name: 'Add transaction' }).click();
await page.fill('#tx-amount', '18000');
await page.getByRole('radio', { name: /Housing/ }).click();
await page.selectOption('#tx-repeat', 'monthly');
await page.getByRole('dialog').getByRole('button', { name: 'Add transaction' }).click();
await page.waitForTimeout(300);
await page.getByRole('tab', { name: /Recurring/ }).click();
ok((await text()).includes('Every month'), 'recurring rule listed');

/* ---- budgets ---- */
await go('budgets');
ok((await text()).includes('Set your first budget'), 'budget empty state');
await page.getByRole('button', { name: 'Create a budget' }).click();
await page.selectOption('#b-cat', { label: '🍜 Food' });
await page.fill('#b-limit', '1100');
await page.getByRole('dialog').getByRole('button', { name: 'Create budget' }).click();
await page.waitForTimeout(400);
const b = await text();
ok(b.includes('91% used') && b.includes('Rs 100.00'), '1000 of 1100 => 91% used, 100 remaining; got: ' + b.replace(/\n+/g, ' | ').slice(0, 300));
ok(b.includes('is at 91% of its limit'), 'approaching-limit warning shown');
await page.screenshot({ path: `${OUT}/e2e-budgets.png` });
// push over the limit
await page.locator('.fab, .page-head').first().isVisible();
await page.evaluate(() => document.querySelector('.side-add').click());
await page.fill('#tx-amount', '300');
await page.getByRole('radio', { name: /Food/ }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Add transaction' }).click();
await page.waitForTimeout(400);
const b2 = await text();
ok(b2.includes('over budget by Rs 200.00'), 'over-budget warning: 1300 vs 1100 => over by 200; got: ' + b2.replace(/\n+/g, ' | ').slice(0, 300));
// duplicate budget rejected
await page.getByRole('button', { name: 'New budget' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Create budget' }).click();
ok((await page.getByRole('dialog').innerText()).includes('Enter an amount'), 'budget limit validation');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok((await page.locator('.overlay').count()) === 0, 'Escape closes modal');

/* ---- goals ---- */
await go('goals');
await page.getByRole('button', { name: 'Create a goal' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Create goal' }).click();
ok((await page.getByRole('dialog').innerText()).includes('Give your goal a name'), 'goal name validation');
await page.fill('#g-name', 'Laptop');
await page.fill('#g-target', '60000');
await page.fill('#g-init', '10000');
const future = new Date(); future.setMonth(future.getMonth() + 5);
await page.fill('#g-dead', future.toISOString().slice(0, 10));
await page.getByRole('dialog').getByRole('button', { name: 'Create goal' }).click();
await page.waitForTimeout(400);
let g = await text();
ok(g.includes('17%'), 'goal 10000/60000 = 17%');
ok(/Save Rs 10,000\.00 per month for 5 months/.test(g), 'monthly plan 50000/5; got: ' + (g.match(/Save[^\n]*/) || [''])[0]);
await page.getByRole('button', { name: 'Withdraw' }).click();
await page.fill('#c-amt', '99999');
await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
ok((await page.getByRole('dialog').innerText()).includes('cannot withdraw more'), 'over-withdraw rejected');
await page.getByRole('radio', { name: 'Add money' }).click();
await page.fill('#c-amt', '5000');
await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(400);
g = await text();
ok(g.includes('25%') && g.includes('Rs 15,000.00'), 'after +5000 => 15000 = 25%');
await page.screenshot({ path: `${OUT}/e2e-goals.png` });

/* ---- settings: currency, theme, month start ---- */
await go('settings');
await page.selectOption('select[aria-label="Currency"]', 'USD');
await page.waitForTimeout(200);
ok((await text()).includes('$'), 'currency switched to USD');
await page.getByRole('radio', { name: 'Dark' }).click();
await page.waitForTimeout(200);
ok((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark theme applied');
await page.screenshot({ path: `${OUT}/e2e-settings-dark.png`, fullPage: true });
await page.selectOption('select[aria-label="Financial month start day"]', '25');
await page.waitForTimeout(200);
await go('budgets');
ok(/\d+ \w+(?: \d{4})? – \d+ \w+ \d{4}/.test(await text()), 'custom financial month label; got: ' + (await text()).slice(0, 200).replace(/\n/g, ' '));
await page.screenshot({ path: `${OUT}/e2e-budgets-dark.png` });
await go('dashboard');
await page.screenshot({ path: `${OUT}/e2e-dashboard-dark.png` });
await go('settings');
await page.selectOption('select[aria-label="Financial month start day"]', '1');
await page.selectOption('select[aria-label="Currency"]', 'NPR');
await page.getByRole('radio', { name: 'Light' }).click();

/* ---- persistence across reload ---- */
await page.reload();
await page.waitForSelector('.page');
await go('transactions');
ok((await page.locator('.tx-row', { hasText: 'Momo' }).count()) === 1, 'transaction survived reload (IndexedDB)');
await go('goals');
ok((await text()).includes('Laptop'), 'goal survived reload');

/* ---- accounts & categories CRUD ---- */
await go('settings');
await page.getByRole('button', { name: 'Add account' }).click();
await page.fill('#a-name', 'Himalayan Bank');
await page.fill('#a-open', '5000');
await page.getByRole('dialog').getByRole('button', { name: 'Add account' }).click();
await page.waitForTimeout(300);
ok((await text()).includes('Himalayan Bank'), 'account added');
await page.getByRole('button', { name: 'Add expense category' }).click();
await page.fill('#k-name', 'Pets');
await page.getByRole('dialog').getByRole('button', { name: 'Add category' }).click();
await page.waitForTimeout(300);
ok((await text()).includes('Pets'), 'custom category added');
await page.getByRole('button', { name: 'Add expense category' }).click();
await page.fill('#k-name', 'pets');
await page.getByRole('dialog').getByRole('button', { name: 'Add category' }).click();
ok((await page.getByRole('dialog').innerText()).includes('already have a category'), 'duplicate category name rejected');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Delete Pets' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Delete category' }).click();
await page.waitForTimeout(300);
ok(!(await text()).includes('Pets'), 'custom category deleted');

/* ---- data: CSV export, backup, import, restore, clear ---- */
const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
const csvText = fs.readFileSync(await csv.path(), 'utf8');
ok(csvText.startsWith('Date,Type,Amount,Category,Subcategory,Account,To Account,Note,Tags,Recurring') && csvText.includes('1000.00') && csvText.includes('Momo <b>bold</b>'), 'CSV export content');
const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
const bkPath = await bk.path();
const bkJson = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
ok(bkJson.app === 'paisa' && bkJson.data.transactions.length >= 3 && bkJson.data.goals.length === 1, 'backup JSON content');

// import a CSV with good, bad and duplicate rows
fs.writeFileSync('/tmp/import-test.csv', 'Date,Type,Amount,Category,Account,Note\n2026-10-01,expense,250,Snacks,Cash,chips\n2026-10-02,expense,abc,Food,Cash,bad\n2026-10-03,income,9000,Consulting,Cash,client\n');
const chooser = page.waitForEvent('filechooser');
await page.getByRole('button', { name: 'Import CSV' }).click();
await (await chooser).setFiles('/tmp/import-test.csv');
await page.waitForSelector('[role=dialog]');
const imp = await page.getByRole('dialog').innerText();
ok(imp.includes('2 transactions ready') && imp.includes('Line 3') && imp.includes('Snacks'), 'import preview: 2 ready, bad line reported, new category named; got: ' + imp.replace(/\n+/g, ' | ').slice(0, 300));
await page.screenshot({ path: `${OUT}/e2e-import.png` });
await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
await page.waitForTimeout(400);
ok((await toastText()).includes('Imported 2'), 'import toast');

// clear everything (two-step with typed confirmation), then restore backup
await page.getByRole('button', { name: 'Delete all data' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Delete everything' }).click();
await page.waitForTimeout(300);
await go('transactions');
ok((await page.locator('.tx-row').count()) > 0, 'typing nothing does NOT delete data');
await go('settings');
await page.getByRole('button', { name: 'Delete all data' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
await page.getByPlaceholder('Type DELETE').fill('DELETE');
await page.getByRole('dialog').getByRole('button', { name: 'Delete everything' }).click();
await page.waitForTimeout(400);
await go('transactions');
ok((await page.locator('.tx-row').count()) === 0 && (await text()).includes('No transactions yet'), 'all data deleted after typed confirmation');
await go('settings');
const chooser2 = page.waitForEvent('filechooser');
await page.getByRole('button', { name: 'Restore backup' }).click();
await (await chooser2).setFiles(bkPath);
await page.getByRole('dialog').getByRole('button', { name: 'Replace my data' }).click();
await page.waitForTimeout(500);
await go('transactions');
ok((await page.locator('.tx-row', { hasText: 'Momo' }).count()) === 1, 'restore brought data back');
// hostile backup rejected
fs.writeFileSync('/tmp/bad.json', '{"app":"nope"}');
await go('settings');
const chooser3 = page.waitForEvent('filechooser');
await page.getByRole('button', { name: 'Restore backup' }).click();
await (await chooser3).setFiles('/tmp/bad.json');
await page.waitForTimeout(300);
ok((await toastText()).includes('not a Paisa backup'), 'invalid backup rejected with message');

await browser.close();
console.log(`passed ${passed}`);
console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS');
process.exit(problems.length ? 1 : 0);
