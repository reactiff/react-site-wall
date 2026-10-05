import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';

const server = spawn(process.execPath, ['examples/server.mjs'], {
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  env: { ...process.env, SITEWALL_DEMO_PORT: '4176' },
});
let logs = '', browser;
const outputDir = await mkdtemp(join(tmpdir(), 'sitewall-save-browser-'));
server.stdout.on('data', data => { logs += data; });
server.stderr.on('data', data => { logs += data; });
try {
  for (let i = 0; i < 100 && !logs.includes('SiteWall example:'); i++) {
    if (server.exitCode !== null) throw new Error(logs);
    await delay(100);
  }
  if (!logs.includes('SiteWall example:')) throw new Error('Server timeout: ' + logs);
  browser = await chromium.launch({ headless: true, channel: process.env.SITEWALL_BROWSER_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4176/sitewall');
  await page.waitForFunction(() => window.sitewall?.events().filter(e => e.type === 'ready').length >= 5);
  await page.evaluate(() => {
    window.sitewall.configure({ viewport: { width: 820, height: 900 } });
    for (const id of window.sitewall.getState().visible) if (!['home', 'shop'].includes(id)) window.sitewall.show(id, false);
  });
  expect(await page.evaluate(() => window.sitewall.inspect('home').then(page => page.viewport))).toEqual({ width: 820, height: 900 });
  expect(await page.locator('iframe[title="Home"]').evaluate(frame => ({
    iframe: frame.offsetWidth, body: frame.parentElement.clientWidth, panel: frame.closest('.sw-page').clientWidth,
  }))).toEqual({ iframe: 820, body: 820, panel: 820 });
  await page.route('**/capture-pending', async route => { await delay(900); await route.fulfill({ body: 'ready' }); });
  await page.locator('iframe[title="Home"]').evaluate(frame => {
    const win = frame.contentWindow;
    const block = win.document.createElement('div');
    block.style.cssText = 'height: 1800px; background: rgb(220, 30, 40)';
    win.document.body.appendChild(block);
    win.scrollTo(0, 125);
    win.fetch('/capture-pending').then(r => r.text()).then(() => { win.document.body.dataset.captureReady = 'yes'; });
  });
  const before = await page.locator('iframe[title="Home"]').evaluate(f => ({ scroll: f.contentWindow.scrollY, width: f.contentWindow.innerWidth, height: f.contentDocument.documentElement.scrollHeight }));
  const start = Date.now();
  const result = await page.evaluate(async () => {
    const images = await window.sitewall.captureAllPages();
    return Promise.all(images.map(async item => {
      const image = new Image(); image.src = item.image; await image.decode();
      return { id: item.id, route: item.route, width: image.naturalWidth, height: image.naturalHeight };
    }));
  });
  expect(Date.now() - start).toBeGreaterThanOrEqual(850);
  expect(result.map(item => item.id)).toEqual(['home', 'shop']);
  expect(result[0]).toEqual({ id: 'home', route: '/', width: before.width, height: before.height });
  expect(await page.locator('iframe[title="Home"]').evaluate(f => f.contentWindow.scrollY)).toBe(before.scroll);
  expect(await page.locator('iframe[title="Home"]').evaluate(f => f.contentDocument.body.dataset.captureReady)).toBe('yes');
  const saved = await page.evaluate(async outputDir => {
    const response = await fetch('/__sitewall/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SiteWall-Token': window.demoToken },
      body: JSON.stringify({ sessionId: sessionStorage.getItem('sitewall-session:/__sitewall/session'), method: 'saveAllPages', args: [outputDir] }),
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).result;
  }, join(outputDir, 'nested'));
  expect(saved.map(item => item.id)).toEqual(['home', 'shop']);
  expect(saved.every(item => isAbsolute(item.path))).toBe(true);
  expect(saved[0].path).toBe(join(outputDir, 'nested', 'home.png'));
  expect(saved[1].path).toBe(join(outputDir, 'nested', 'shop.png'));
  const bytes = await readFile(saved[0].path);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.readUInt32BE(16)).toBe(before.width);
  expect(bytes.readUInt32BE(20)).toBe(before.height);
  await page.evaluate(() => { for (const id of window.sitewall.getState().visible) window.sitewall.show(id, false); });
  const relay = await page.evaluate(async () => {
    const response = await fetch('/__sitewall/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SiteWall-Token': window.demoToken },
      body: JSON.stringify({ sessionId: sessionStorage.getItem('sitewall-session:/__sitewall/session'), method: 'captureAllPages', args: [] }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(relay).toEqual({ status: 200, body: { result: [] } });
  expect(errors).toEqual([]);
  console.log('PASS: visible-only stitched capture, pending network readiness, full dimensions, scroll restoration, empty wall, agent relay, saveAllPages PNG persistence');
} finally { await browser?.close(); server.kill(); await rm(outputDir, { recursive: true, force: true }); }
