import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const origin = 'http://127.0.0.1:4182';
const server = spawn(process.execPath, ['examples/server.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, SITEWALL_DEMO_PORT: '4182' } });
let logs = '', browser, release;
server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
try {
  for (let i = 0; i < 100 && !logs.includes('SiteWall example:'); i++) { if (server.exitCode !== null) throw new Error(logs); await delay(100); }
  if (!logs.includes('SiteWall example:')) throw new Error('Example server did not start');
  browser = await chromium.launch({ headless: true, channel: process.env.SITEWALL_BROWSER_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined) });
  const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let body, executions = 0;
  await page.route('**/__sitewall/prompts', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    body = route.request().postDataJSON(); executions++;
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ json: { status: 'completed', exitCode: 0, output: 'Reference request received' } });
  });
  await page.goto(origin + '/sitewall');
  await page.waitForFunction(() => window.sitewall?.events().filter(event => event.type === 'ready').length >= 5);
  await page.getByRole('button', { name: 'Prompt Agent', exact: true }).click();
  await page.getByRole('button', { name: 'References', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Instruction for Agent' });
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 8; const context = canvas.getContext('2d'); context.fillStyle = '#ff0000'; context.fillRect(0, 0, 10, 8); return canvas.toDataURL('image/png'); });
  await page.getByLabel('Add reference files').setInputFiles([
    { name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep the existing typography.') },
  ]);
  await expect(page.getByRole('checkbox', { name: 'Use reference.png', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Use notes.txt', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Unselect notes.txt', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Use notes.txt', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Use notes.txt', exact: true }).check();
  await editor.evaluate((element, image) => {
    const bytes = Uint8Array.from(atob(image.split(',')[1]), c => c.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, png);
  await expect(page.getByRole('checkbox', { name: 'Use clipboard.png', exact: true })).toBeChecked();
  await page.getByLabel('References panel', { exact: true }).evaluate(element => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['Drop file contents'], 'dropped.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('checkbox', { name: 'Use dropped.txt', exact: true })).toBeChecked();
  await page.getByRole('separator', { name: 'Resize References panel' }).press('ArrowLeft');
  await expect(page.getByRole('separator', { name: 'Resize References panel' })).toHaveAttribute('aria-valuenow', '296');
  await page.evaluate(() => {
    window.sitewall.configure({ autoCenter: false, zoom: .5, columns: 3, pan: { x: 15, y: 15 } });
    for (const [title, color] of [['Home', '#ff0000'], ['Shop', '#0000ff'], ['Long story', '#ff00ff']]) {
      const win = document.querySelector(`iframe[title="${title}"]`).contentWindow;
      win.scrollTo(0, 0); const swatch = win.document.createElement('div');
      swatch.style.cssText = `position:fixed;left:30px;top:30px;width:80px;height:60px;background:${color};z-index:9999;`;
      win.document.body.append(swatch);
    }
    window.sitewall.setSelectionMode('region');
  });
  const capture = async id => {
    const bounds = await page.getByLabel(`Select context in ${id}`, { exact: true }).boundingBox();
    await page.mouse.move(bounds.x + 30 * .5, bounds.y + 30 * .5); await page.mouse.down();
    await page.mouse.move(bounds.x + 110 * .5, bounds.y + 90 * .5, { steps: 4 }); await page.mouse.up();
  };
  await capture('home'); await expect(page.getByRole('checkbox', { name: 'Use Area 1', exact: true })).toBeChecked();
  await capture('shop'); await expect(page.getByRole('checkbox', { name: 'Use Area 2', exact: true })).toBeChecked();
  const areas = await page.evaluate(async () => {
    const assets = window.sitewall.references.snapshot().assets.filter(asset => asset.kind === 'area');
    return Promise.all(assets.map(async asset => {
      const bitmap = await createImageBitmap(await (await fetch(asset.dataUrl)).blob());
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
      const pixel = [...context.getImageData(40, 30, 1, 1).data]; bitmap.close();
      return { id: asset.id, alias: asset.alias, route: asset.context.route, rectangle: asset.context.rectangle, viewport: asset.context.viewport, width: canvas.width, height: canvas.height, pixel };
    }));
  });
  expect(areas.map(area => area.alias)).toEqual(['Area1', 'Area2']);
  expect(areas.map(area => area.route)).toEqual(['/', '/shop']);
  expect(areas[0].id).not.toBe(areas[1].id);
  expect(areas.map(area => [area.width, area.height])).toEqual([[80, 60], [80, 60]]);
  expect(areas[0].pixel).toEqual([255, 0, 0, 255]); expect(areas[1].pixel).toEqual([0, 0, 255, 255]);
  await page.evaluate(async () => { window.sitewall.setSelectionMode('none'); await window.sitewall.selectElement('h1', 'home'); });
  await page.getByRole('button', { name: 'Creative', exact: true }).click();
  await page.screenshot({ path: '.demo/references-selected.png' });
  await editor.fill('Compare @Area1 and @Area2 with these references'); await editor.press('Enter');
  await expect.poll(() => executions).toBe(1);
  expect(body.instruction).toBe('.creative Compare @Area1 and @Area2 with these references'); expect(body.tags).toEqual(['creative']);
  expect(body.references).toHaveLength(6); expect(body.context.selection.kind).toBe('element');
  expect(body.references.filter(asset => asset.kind === 'area').map(asset => asset.context.route)).toEqual(['/', '/shop']);
  await expect(page.locator('.sw-agent-prompt .cm-placeholder')).toBeVisible();
  await expect(page.locator('.sw-agent-reference-chip')).toHaveCount(0);
  expect(await page.evaluate(() => window.sitewall.references.snapshot().assets.length)).toBe(6);
  expect(await page.evaluate(() => window.sitewall.references.snapshot().selected)).toEqual([]);
  expect(await page.evaluate(() => window.sitewall.inspectSelection().kind)).toBe('element');
  await page.getByRole('checkbox', { name: 'Use clipboard.png', exact: true }).check();
  const scrolledArea = await page.evaluate(async () => {
    const win = document.querySelector('iframe[title="Long story"]').contentWindow;
    win.scrollTo(0, 300);
    const asset = await window.sitewall.references.captureArea({ x: 30, y: win.scrollY + 30, width: 80, height: 60 }, 'story');
    const bitmap = await createImageBitmap(await (await fetch(asset.dataUrl)).blob());
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60;
    const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
    return { alias: asset.alias, rectangle: asset.context.rectangle, scroll: asset.context.scroll, pixel: [...context.getImageData(40, 30, 1, 1).data], afterScroll: win.scrollY };
  });
  expect(scrolledArea.alias).toBe('Area3'); expect(scrolledArea.rectangle.y).toBe(330); expect(scrolledArea.scroll.y).toBe(300);
  expect(scrolledArea.pixel).toEqual([255, 0, 255, 255]); expect(scrolledArea.afterScroll).toBe(300);
  await editor.fill('Keep @Area3 and this image in mind as well'); await editor.press('Enter');
  await expect(page.getByText('You · Queued', { exact: true })).toBeVisible();
  expect(executions).toBe(1);
  const queued = await page.evaluate(() => window.sitewall.agent.takeOwnerInput()[0]);
  expect(queued.references.map(asset => asset.name)).toEqual(['clipboard.png', 'Area 3']); expect(queued.tags).toEqual(['creative']);
  await page.getByRole('button', { name: 'Remove clipboard.png', exact: true }).click();
  expect(await page.evaluate(() => window.sitewall.agent.snapshot().inputs[0].references[0].name)).toBe('clipboard.png');
  await page.evaluate(id => window.sitewall.agent.acknowledge(id, 'Image incorporated'), queued.id);
  release(); await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Use Area 1', exact: true }).check();
  await page.getByRole('button', { name: 'New Session', exact: true }).click();
  expect(await page.evaluate(() => window.sitewall.references.snapshot().assets.length)).toBe(6);
  expect(await page.evaluate(() => window.sitewall.references.snapshot().selected)).toEqual([]);
  await expect(page.locator('.sw-agent-history')).toHaveText('');
  await page.getByRole('button', { name: 'Collapse References' }).click();
  expect(await page.evaluate(() => window.sitewall.references.list().length)).toBe(6);
  await page.getByRole('button', { name: 'References', exact: true }).click();
  await page.getByRole('button', { name: 'Clear References', exact: true }).click();
  expect(await page.evaluate(() => window.sitewall.references.list().length)).toBe(0);
  await page.getByLabel('Add reference files').setInputFiles({ name: 'reload.txt', mimeType: 'text/plain', buffer: Buffer.from('Session only') });
  await expect(page.getByRole('checkbox', { name: 'Use reload.txt', exact: true })).toBeChecked();
  await page.reload(); await page.waitForFunction(() => !!window.sitewall);
  expect(await page.evaluate(() => window.sitewall.references.snapshot())).toEqual({ assets: [], selected: [] });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/reference.png|reload.txt|data:image\/png;base64/);
  await page.getByRole('button', { name: 'References', exact: true }).click();
  await expect(page.getByRole('separator', { name: 'Resize References panel' })).toHaveAttribute('aria-valuenow', '296');
  expect(errors).toEqual([]);
  console.log('PASS: picker/paste/drop, multi-route area pixels and metadata, composer chips, initial/queued references, New Session retention, removal/clear, and ephemeral reload');
} finally { release?.(); await browser?.close(); server.kill(); }
