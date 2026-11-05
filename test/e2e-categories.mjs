import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2];
const url = 'file://' + process.cwd() + '/dist/paisa.html';
const browser = await chromium.launch();
const problems = [];
let passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else problems.push('FAIL: ' + msg); };

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
const go = async (r) => { await page.goto(url + '#/' + r); await page.waitForSelector(`.page[data-page="${r}"]`); await page.waitForTimeout(700); };
const text = () => page.locator('main').innerText();
const dlg = () => page.getByRole('dialog').last();
const checked = async (name) => (await page.getByRole('radio', { name, exact: false }).first().getAttribute('aria-checked')) === 'true';
const txCount = async () => +((await page.locator('.result-sum').innerText()).match(/(\d+) transaction/)?.[1] ?? -1);

await page.goto(url);
await page.waitForSelector('.page');

/* ---- sample data shows subcategories + tags ---- */
await go('transactions');
let t = await text();
ok(t.includes('Food › Dining out') && t.includes('Food › Groceries'), 'rows show "Parent › Sub" labels');
ok(t.includes('#family') || t.includes('#subscription') || t.includes('#work'), 'rows show tags');
await page.screenshot({ path: `${OUT}/cat-transactions.png` });

/* ---- add income under a NEW subcategory created inline ---- */
await page.locator('.page-head').getByRole('button', { name: 'Add transaction' }).click();
await page.getByRole('radio', { name: 'Income' }).click();
await page.getByRole('radio', { name: /Freelance/ }).click();
ok((await page.getByRole('radio', { name: 'Web projects' }).count()) === 1 && (await page.getByRole('radio', { name: 'Design gigs' }).count()) === 1, 'subcategory chips shown under Freelance');
await page.getByRole('button', { name: 'New subcategory under Freelance' }).click();
ok((await dlg().innerText()).includes('Under') && (await dlg().innerText()).includes('Freelance'), 'inline sub dialog shows its parent');
ok((await dlg().locator('#k-parent').count()) === 0, 'parent is locked in the inline dialog');
await dlg().getByRole('button', { name: 'Add subcategory' }).click();
ok((await page.locator('.field-error:visible', { hasText: 'Enter a name' }).count()) === 1, 'sub name validation');
await page.fill('#k-name', 'Mobile apps');
await dlg().getByRole('button', { name: 'Add subcategory' }).click();
await page.waitForTimeout(300);
ok(await checked('Mobile apps'), 'new subcategory is auto-selected in the form');
await page.fill('#tx-amount', '20000');
await page.fill('#tx-tags', 'Client X');
await page.keyboard.press('Enter');
await page.fill('#tx-tags', 'urgent,');
ok((await page.locator('.tag-chip').count()) === 2, 'tags committed with Enter and with comma');
ok((await page.locator('.tag-chip').first().innerText()).includes('#client-x'), 'tag normalised to client-x');
await page.screenshot({ path: `${OUT}/cat-form-desktop.png` });
await page.fill('#tx-tags', 'draft'); // typed but never confirmed: must still be saved
await dlg().getByRole('button', { name: 'Add transaction' }).click();
await page.waitForSelector('.toast:has-text("Transaction added")', { timeout: 3000 });
await page.waitForTimeout(300);
t = await text();
ok(t.includes('Freelance › Mobile apps') && t.includes('#client-x') && t.includes('#urgent') && t.includes('#draft'), 'saved with sub label and all three tags (incl. unconfirmed draft)');

/* ---- subcategory under "Others", and a brand-new top-level category inline ---- */
await page.locator('.page-head').getByRole('button', { name: 'Add transaction' }).click();
await page.getByRole('radio', { name: /Others/ }).click();
await page.getByRole('button', { name: 'New subcategory under Others' }).click();
await page.fill('#k-name', 'Charity');
await dlg().getByRole('button', { name: 'Add subcategory' }).click();
await page.waitForTimeout(300);
ok(await checked('Charity'), 'subcategory created under Others and selected');
await page.getByRole('button', { name: 'New expense category' }).click();
ok((await dlg().locator('.seg').count()) === 0, 'inline category dialog has no type switch (type already chosen)');
await page.fill('#k-name', 'Pets');
await dlg().getByRole('button', { name: 'Add category' }).click();
await page.waitForTimeout(300);
ok(await checked('Pets'), 'new top-level category auto-selected');
await page.getByRole('button', { name: 'New subcategory under Pets' }).click();
await page.fill('#k-name', 'Vet');
await dlg().getByRole('button', { name: 'Add subcategory' }).click();
await page.waitForTimeout(300);
await page.fill('#tx-amount', '1500');
await dlg().getByRole('button', { name: 'Add transaction' }).click();
await page.waitForTimeout(500);
ok((await text()).includes('Pets › Vet'), 'Pets › Vet saved');

/* ---- filters: parent includes subs, sub is exact, tag filter ---- */
await page.reload(); await page.waitForSelector('.page');
await go('transactions');
await page.getByRole('button', { name: 'Filters' }).click();
const catSel = page.locator('select').filter({ has: page.locator('option', { hasText: 'Freelance' }) }).first();
await catSel.selectOption({ label: '💻 Freelance (income)' });
await page.waitForTimeout(200);
const fam = await txCount();
ok(fam >= 2, 'parent filter includes sub transactions (more than the one exact sub): ' + fam);
const famText = await text();
ok(famText.includes('Freelance › Mobile apps') && /Freelance › (Web projects|Design gigs)/.test(famText), 'parent filter shows rows from different subcategories');
await catSel.selectOption({ label: '  ↳ Mobile apps' });
await page.waitForTimeout(200);
ok((await txCount()) === 1, 'subcategory filter is exact');
await catSel.selectOption({ label: 'All categories' });
const tagSel = page.locator('select').filter({ has: page.locator('option', { hasText: '#client-x' }) }).first();
await tagSel.selectOption('client-x');
await page.waitForTimeout(200);
ok((await txCount()) === 1, 'tag filter');
await page.fill('input[type=search]', '#urgent');
await tagSel.selectOption('all');
await page.waitForTimeout(200);
ok((await txCount()) === 1, 'search matches #tags');
await page.getByRole('button', { name: 'Reset filters' }).click();

/* ---- budgets include subcategories ---- */
await go('budgets');
await page.getByRole('button', { name: 'New budget' }).click();
const opts = await dlg().locator('#b-cat option').allInnerTexts();
ok(opts.some((o) => o.includes('Pets') && o.includes('with subcategories')) && opts.some((o) => o.includes('↳ Groceries')) && !opts.some((o) => /\bFood\b \(/.test(o)), 'budget picker lists subs, and skips Food because it already has a budget: ' + opts.slice(0, 8).join('|'));
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Previous month' }).click(); // early in the month there is little spending, so look at last month
await page.waitForTimeout(300);
const foodCard = page.locator('.budget-card', { hasText: 'Food' }).first();
ok((await foodCard.innerText()).includes('includes subcategories'), 'Food budget says it includes subcategories');
const spent = (await foodCard.innerText()).match(/Spent\s*\n?\s*Rs ([\d,]+\.\d\d)/)?.[1];
ok(spent && +spent.replace(/,/g, '') > 0, 'Food budget counts its subcategory spending: ' + spent);

/* ---- reports: roll up + drill down + tags ---- */
await go('reports');
await page.getByRole('button', { name: /Previous month/ }).click();
await page.waitForTimeout(700);
const toggle = page.getByRole('button', { name: /^Food, show \d+ subcategories/ });
ok((await toggle.count()) === 1, 'Food row is expandable in reports');
ok((await page.locator('.top-list .sub-list').count()) === 0, 'subs collapsed by default');
await toggle.click();
await page.waitForTimeout(700);
const rt = await text();
ok(rt.includes('Groceries') && rt.includes('Dining out'), 'drill-down shows Food subcategories');
ok((await page.locator('.top-list li:has(button.br-head[aria-expanded=true]) .sub-list li').count()) >= 2, 'sub list rows present');
ok(rt.includes('Spending by tag'), 'tag card present');
const px = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; }));
ok(px.every((n) => n > 500), 'charts still paint after rollup ' + JSON.stringify(px));
await page.screenshot({ path: `${OUT}/cat-reports.png`, fullPage: false });
const [sum] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export summary' }).click()]);
const sumText = fs.readFileSync(await sum.path(), 'utf8');
ok(sumText.includes('  > Groceries') && sumText.includes('Tag,Amount,Transactions'), 'summary export includes sub rows and tags');

/* ---- settings: tree, add sub, move, merge, delete ---- */
await go('settings');
t = await text();
ok(t.includes('Web projects') && t.includes('Design gigs') && t.includes('Mobile apps') && t.includes('Charity') && t.includes('Vet'), 'category tree lists subcategories');
await page.screenshot({ path: `${OUT}/cat-settings.png`, fullPage: true });
const before = await (async () => { await go('transactions'); return txCount(); })();
await go('settings');

// add a subcategory from the tree
await page.getByRole('button', { name: 'Add subcategory to Pets' }).click();
await page.fill('#k-name', 'Food & toys');
await dlg().getByRole('button', { name: 'Add subcategory' }).click();
await page.waitForTimeout(300);
ok((await text()).includes('Food & toys'), 'subcategory added from Settings');
// duplicate name under same parent is rejected
await page.getByRole('button', { name: 'Add subcategory to Pets' }).click();
await page.fill('#k-name', 'vet');
await dlg().getByRole('button', { name: 'Add subcategory' }).click();
ok((await dlg().innerText()).includes('already has a subcategory'), 'duplicate sub name rejected');
await page.keyboard.press('Escape');
// move Vet under Food via Edit → Parent
await page.getByRole('button', { name: 'Edit Vet' }).click();
await dlg().locator('#k-parent').selectOption({ label: '🍜 Food' });
await dlg().getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(300);
await go('transactions');
ok((await text()).includes('Food › Vet'), 'moved subcategory shows its new parent on transactions');
await go('settings');
// a parent with subcategories cannot be turned into a sub
await page.getByRole('button', { name: 'Edit Food', exact: true }).click();
ok((await dlg().locator('#k-parent').count()) === 0 && (await dlg().innerText()).includes('has subcategories'), 'parent with subs cannot be nested');
await page.keyboard.press('Escape');
// merge Pets into Others
await page.getByRole('button', { name: 'Merge Pets into another category' }).click();
await dlg().locator('select').selectOption({ label: '📦 Others' });
await dlg().getByRole('button', { name: 'Merge' }).click();
await page.waitForTimeout(400);
ok(!(await page.getByRole('button', { name: 'Edit Pets' }).count()), 'merged category is gone');
ok((await text()).includes('Food & toys'), 'its subcategory moved with it');
await page.getByRole('button', { name: 'Edit Food & toys' }).click();
ok((await dlg().locator('#k-parent').inputValue()) === 'cat-exp-other', 'the merged category\'s subcategory now lives under Others');
await page.keyboard.press('Escape');
// delete Food (has subs): everything moves, nothing is lost
await go('settings');
await page.getByRole('button', { name: 'Delete Food', exact: true }).click();
const dtext = await dlg().innerText();
ok(/also deletes its \d+ subcategor/.test(dtext), 'delete dialog warns about subcategories: ' + dtext.slice(0, 120).replace(/\n/g, ' '));
await dlg().getByRole('button', { name: 'Delete category' }).click();
await page.waitForTimeout(500);
ok(!(await page.getByRole('button', { name: 'Edit Groceries' }).count()), 'sub deleted with its parent');
await page.reload(); await page.waitForSelector('.page');
await go('transactions');
ok((await txCount()) === before, `no transactions lost: ${before} -> ${await txCount()}`);
ok(!(await text()).includes('Uncategorized'), 'no transaction left uncategorised');

/* ---- backup round-trip keeps subcategories + tags ---- */
await go('settings');
const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
const bkPath = await bk.path();
const json = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
ok(json.data.categories.some((c) => c.parentId) && json.data.transactions.some((x) => x.tags?.length), 'backup holds parentId and tags');
await page.getByRole('button', { name: 'Delete all data' }).click();
await dlg().getByRole('button', { name: 'Continue' }).click();
await page.getByPlaceholder('Type DELETE').fill('DELETE');
await dlg().getByRole('button', { name: 'Delete everything' }).click();
await page.waitForTimeout(400);
ok(!(await text()).includes('Web projects'), 'cleared: no subcategories left');
const ch = page.waitForEvent('filechooser');
await page.getByRole('button', { name: 'Restore backup' }).click();
await (await ch).setFiles(bkPath);
await dlg().getByRole('button', { name: 'Replace my data' }).click();
await page.waitForTimeout(500);
ok((await text()).includes('Web projects') && (await text()).includes('Mobile apps'), 'restore brings the tree back');
await go('transactions');
ok((await text()).includes('Freelance › Mobile apps') && (await text()).includes('#client-x'), 'restore keeps labels and tags');

/* ---- CSV import with Parent > Sub + tags ---- */
fs.writeFileSync('/tmp/cat-import.csv', 'Date,Type,Amount,Category,Note,Tags\n2026-10-05,expense,400,Garden > Seeds,tulips,"spring, home"\n2026-10-06,income,900,Freelance > Logo,logo work,work\n');
await go('settings');
const ch2 = page.waitForEvent('filechooser');
await page.getByRole('button', { name: 'Import CSV' }).click();
await (await ch2).setFiles('/tmp/cat-import.csv');
await page.waitForSelector('[role=dialog]');
const imp = await dlg().innerText();
ok(imp.includes('2 transactions ready') && imp.includes('Garden') && imp.includes('Seeds') && imp.includes('Logo'), 'import preview lists new parent and subcategories: ' + imp.replace(/\n+/g, ' | ').slice(0, 260));
await dlg().getByRole('button', { name: 'Import' }).click();
await page.waitForTimeout(500);
await go('transactions');
ok((await text()).includes('Garden › Seeds') && (await text()).includes('Freelance › Logo') && (await text()).includes('#spring'), 'imported subcategories and tags appear');
fs.rmSync('/tmp/cat-import.csv', { force: true });

/* ---- phone layout of the form ---- */
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await mctx.newPage();
mp.on('pageerror', (e) => problems.push('mobile pageerror: ' + e.message));
await mp.goto(url); await mp.waitForSelector('.page');
await mp.locator('.fab').click();
await mp.getByRole('radio', { name: 'Income' }).click();
await mp.getByRole('radio', { name: /Freelance/ }).click();
await mp.getByRole('radio', { name: 'Web projects' }).click();
await mp.fill('#tx-amount', '15000');
await mp.fill('#tx-tags', 'client-x,');
await mp.waitForTimeout(300);
const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(over <= 0, 'no horizontal overflow with form open on phone: ' + over);
await mp.screenshot({ path: `${OUT}/cat-form-mobile.png` });
await mp.locator('.modal-body').evaluate((el) => { el.scrollTop = 200; });
await mp.waitForTimeout(200);
await mp.screenshot({ path: `${OUT}/cat-form-mobile-2.png` });
await mctx.close();

await browser.close();
console.log(`passed ${passed}`);
console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS');
process.exit(problems.length ? 1 : 0);
