import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const server = spawn(process.execPath, ['examples/server.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, SITEWALL_DEMO_PORT: '4177' } });
let logs = '', browser;
server.stdout.on('data', data => { logs += data; });
server.stderr.on('data', data => { logs += data; });
try {
  for (let i = 0; i < 100 && !logs.includes('SiteWall example:'); i++) { if (server.exitCode !== null) throw new Error(logs); await delay(100); }
  if (!logs.includes('SiteWall example:')) throw new Error('Server timeout: ' + logs);
  browser = await chromium.launch({ headless: true, channel: process.env.SITEWALL_BROWSER_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await page.goto('http://127.0.0.1:4177/sitewall');
  await page.waitForFunction(() => window.sitewall?.events().filter(e => e.type === 'ready').length >= 5);
  await page.evaluate(() => window.sitewall.configure({ autoCenter: false, zoom: .65, columns: 3, pan: { x: 5, y: 5 } }));
  const story = page.locator('iframe[title="Long story"]');
  const scroll = () => story.evaluate(frame => frame.contentWindow.scrollY);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(async () => { await window.sitewall.focus('home'); const f = document.querySelector('iframe[title="Long story"]'); f.contentWindow.scrollTo(0, 0); });
    await page.getByRole('button', { name: 'Focus Long story', exact: true }).click({ position: { x: 100, y: 180 } });
    await expect.poll(() => page.evaluate(() => window.sitewall.getState().focused)).toBe('story');
    // Keep pointer at activation position: do not touch scrollbar or move it.
    await page.mouse.wheel(0, 300);
    await expect.poll(scroll).toBeGreaterThan(0);
  }
  // Header activation must also leave the page ready for wheel input.
  await page.evaluate(async () => { await window.sitewall.focus('home'); document.querySelector('iframe[title="Long story"]').contentWindow.scrollTo(0, 0); });
  await page.getByRole('button', { name: 'Long story', exact: true }).click();
  const bounds = await story.boundingBox();
  await page.mouse.move(bounds.x + 100, bounds.y + 180);
  await page.mouse.wheel(0, 300);
  await expect.poll(scroll).toBeGreaterThan(0);
  // Activation must not send that click through to the application.
  await page.evaluate(async () => { await window.sitewall.focus('home'); });
  const cartBefore = await page.frameLocator('iframe[title="Shop"]').getByTestId('cart').textContent();
  await page.getByRole('button', { name: 'Focus Shop', exact: true }).click();
  expect(await page.frameLocator('iframe[title="Shop"]').getByTestId('cart').textContent()).toBe(cartBefore);
  console.log('PASS: manual panel activation accepts immediate wheel scrolling without scrollbar interaction');
} finally { await browser?.close(); server.kill(); }
