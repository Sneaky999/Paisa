import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2];
const url = 'file://' + process.cwd() + '/dist/paisa.html';
const browser = await chromium.launch();
const errors = [];
async function session(name, ctxOpts, fn) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${name}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(url);
  await page.waitForSelector('.page');
  await fn(page);
  await ctx.close();
}
const routes = ['dashboard', 'transactions', 'budgets', 'goals', 'reports', 'settings'];
await session('desktop', { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }, async (page) => {
  for (const r of routes) {
    await page.goto(url + '#/' + r);
    await page.waitForSelector(`.page[data-page="${r}"]`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/desktop-${r}.png`, fullPage: true });
  }
});
await session('mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, async (page) => {
  for (const r of routes) {
    await page.goto(url + '#/' + r);
    await page.waitForSelector(`.page[data-page="${r}"]`);
    await page.waitForTimeout(700);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) errors.push(`[mobile] horizontal overflow ${overflow}px on ${r}`);
    await page.screenshot({ path: `${OUT}/mobile-${r}.png`, fullPage: false });
  }
});
await browser.close();
console.log(errors.length ? errors.join('\n') : 'NO CONSOLE ERRORS, NO OVERFLOW');
