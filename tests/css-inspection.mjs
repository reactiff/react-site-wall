import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

// Real Chromium CSSOM/rendering, including a separate origin whose cssRules throw.
const bundle = await build({ entryPoints: ['src/style-context.ts'], bundle: true, format: 'esm', write: false });
const serve = handler => new Promise(resolve => { const server = createServer(handler); server.listen(0, '127.0.0.1', () => resolve(server)); });
const foreign = await serve((_req, res) => { res.setHeader('Content-Type', 'text/css'); res.end('.opaque { color: rgb(31, 41, 59); padding-left: 23px; }'); });
const origin = await serve((req, res) => { if (req.url === '/inspector.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); } else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body></body></html>'); } });
let browser;
let checks = 0;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.SITEWALL_BROWSER_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined) });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${origin.address().port}`);
  await page.evaluate(async () => { window.inspectStyleContext = (await import('/inspector.js')).inspectStyleContext; });
  const fixture = async (css, html) => page.evaluate(([css, html]) => { document.body.innerHTML = html; document.head.innerHTML = `<style>${css}</style>`; }, [css, html]);
  const inspect = selector => page.evaluate(selector => {
    const snapshot = () => ({ dom: document.documentElement.outerHTML, rules: [...document.styleSheets].map(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return null; } }), rect: JSON.stringify(document.querySelector(selector).getBoundingClientRect()) });
    const before = JSON.stringify(snapshot());
    const context = window.inspectStyleContext(window, selector);
    if (before !== JSON.stringify(snapshot())) throw new Error('Inspection changed live DOM, source CSSOM, or rendered geometry');
    return context;
  }, selector);
  const row = (context, property) => { const found = context.cascade.find(item => item.property === property); assert.ok(found, `Missing ${property}`); return found; };
  const winner = (context, property, value) => { const found = row(context, property); assert.equal(found.computed.trim(), value); assert.equal(found.declarations[0].value.trim(), value); checks++; };

  await fixture(`.subject { color: rgb(1, 2, 3); }
    @scope (.outer) to (.limit) { .subject { color: rgb(4, 5, 6); } }
    @scope (.inner) { .subject { color: rgb(7, 8, 9); } }
    @scope (.outer) { .subject { color: rgb(10, 11, 12); } }`,
    '<div class="outer"><div class="inner"><span id="scoped" class="subject"></span></div><div class="limit"><span id="limited" class="subject"></span></div></div>');
  winner(await inspect('#scoped'), 'color', 'rgb(7, 8, 9)');
  assert.ok(!row(await inspect('#limited'), 'color').declarations.some(d => d.value === 'rgb(4, 5, 6)')); checks++;

  await fixture(`@scope (.inner) { .subject { color: rgb(7, 8, 9); } }
    @scope (.outer) { #specific { color: rgb(10, 11, 12); } .subject { margin-left: 13px !important; } }
    @scope (.inner) { .subject { margin-left: 2px; } }`,
    '<div class="outer"><div class="inner"><span id="specific" class="subject"></span></div></div>');
  winner(await inspect('#specific'), 'color', 'rgb(10, 11, 12)');
  winner(await inspect('#specific'), 'margin-left', '13px');

  await fixture(`@scope (.outer) { @scope (.inner) { :scope > .subject { color: rgb(20, 21, 22); } } }
    @scope (.other) { .subject { color: rgb(90, 91, 92); } }`,
    '<div class="outer"><div class="inner"><span id="nested" class="subject"></span></div></div>');
  winner(await inspect('#nested'), 'color', 'rgb(20, 21, 22)');
  await fixture('', '<div><style>@scope { :scope > .subject { color: rgb(32, 33, 34); } }</style><span id="implicit" class="subject"></span></div>');
  winner(await inspect('#implicit'), 'color', 'rgb(32, 33, 34)');

  await fixture(`@layer early, late;
    .outer { container-type: inline-size; width: 500px; }
    @layer early { @container (width > 300px) { @scope (.outer) { .subject { color: rgb(61, 62, 63) !important; } } } }
    @layer late { @scope (.inner) { .subject { color: rgb(71, 72, 73) !important; } } }`,
    '<div class="outer"><div class="inner"><span id="layered" class="subject"></span></div></div>');
  winner(await inspect('#layered'), 'color', 'rgb(61, 62, 63)');

  await fixture(`.subject { color: rgb(1, 2, 3); }
    @media (min-width: 900px) { @scope (.root) { :scope > .subject { color: rgb(81, 82, 83); } } }`,
    '<div class="root"><span id="media-scoped" class="subject"></span></div>');
  await page.setViewportSize({ width: 1100, height: 800 });
  winner(await inspect('#media-scoped'), 'color', 'rgb(81, 82, 83)');
  await page.setViewportSize({ width: 800, height: 800 });
  winner(await inspect('#media-scoped'), 'color', 'rgb(1, 2, 3)');

  await fixture(`.container { container-type: inline-size; width: 420px; }
    .subject { color: rgb(1, 2, 3); }
    @container (width > 300px) { .subject { color: rgb(4, 5, 6); } }
    @container (width < 300px) { .subject { color: rgb(7, 8, 9); } }`,
    '<div id="container" class="container"><span id="sized" class="subject"></span></div>');
  winner(await inspect('#sized'), 'color', 'rgb(4, 5, 6)');
  assert.ok(!row(await inspect('#sized'), 'color').declarations.some(d => d.value === 'rgb(7, 8, 9)')); checks++;
  await page.evaluate(() => { document.querySelector('#container').style.width = '200px'; });
  winner(await inspect('#sized'), 'color', 'rgb(7, 8, 9)');
  assert.ok(!row(await inspect('#sized'), 'color').declarations.some(d => d.value === 'rgb(4, 5, 6)')); checks++;

  await fixture(`.outer { container: shell / inline-size; width: 500px; --theme: quiet; }
    .inner { container: local / inline-size; width: 150px; }
    .subject { color: rgb(1, 2, 3); }
    @media (min-width: 1px) { @container shell (width > 400px) { @container style(--theme: quiet) { .subject { color: rgb(44, 45, 46); } } } }
    @container local (width > 400px) { .subject { color: rgb(55, 56, 57); } }`,
    '<div id="named" class="outer"><div class="inner"><span id="styled" class="subject"></span></div></div>');
  winner(await inspect('#styled'), 'color', 'rgb(44, 45, 46)');
  assert.ok(!row(await inspect('#styled'), 'color').declarations.some(d => d.value === 'rgb(55, 56, 57)')); checks++;
  await page.evaluate(() => { document.querySelector('#named').style.setProperty('--theme', 'loud'); });
  winner(await inspect('#styled'), 'color', 'rgb(1, 2, 3)');

  await fixture('', '<div class="adopted-root"><span id="adopted" class="subject"></span></div>');
  await page.evaluate(() => { const sheet = new CSSStyleSheet(); sheet.replaceSync('@scope (.adopted-root) { .subject { color: rgb(91, 92, 93); } }'); document.adoptedStyleSheets = [sheet]; });
  winner(await inspect('#adopted'), 'color', 'rgb(91, 92, 93)');
  await page.evaluate(() => { document.adoptedStyleSheets = []; });

  await fixture('.opaque { color: rgb(10, 20, 30); }', '<div id="opaque" class="opaque">Cross origin</div>');
  await page.evaluate(url => new Promise((resolve, reject) => { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = url; link.onload = resolve; link.onerror = reject; document.head.append(link); }), `http://127.0.0.1:${foreign.address().port}/foreign.css`);
  assert.equal(await page.evaluate(() => { try { document.styleSheets[1].cssRules; return false; } catch { return true; } }), true);
  let context = await inspect('#opaque');
  assert.equal(row(context, 'color').computed, 'rgb(31, 41, 59)');
  assert.equal(row(context, 'padding-left').computed, '23px');
  assert.equal(row(context, 'color').source.kind, 'opaque-cross-origin');
  assert.ok(!context.unresolved.some(message => /cross.origin|cannot inspect/i.test(message))); checks++;
  // Equal readable/computed values cannot establish which opaque declaration won.
  await page.evaluate(() => { document.styleSheets[0].cssRules[0].style.color = 'rgb(31, 41, 59)'; });
  context = await inspect('#opaque');
  assert.equal(row(context, 'color').source.kind, 'opaque-cross-origin'); checks++;
  await page.evaluate(() => { document.styleSheets[0].cssRules[0].style.color = 'rgb(10, 20, 30)'; });
  await page.evaluate(() => { document.querySelector('#opaque').style.setProperty('color', 'rgb(80, 81, 82)', 'important'); });
  context = await inspect('#opaque');
  assert.equal(row(context, 'color').computed, 'rgb(80, 81, 82)');
  assert.equal(row(context, 'color').source.kind, 'known-declaration'); checks++;
  await page.evaluate(() => { document.querySelector('#opaque').style.removeProperty('color'); document.styleSheets[1].disabled = true; });
  context = await inspect('#opaque');
  winner(context, 'color', 'rgb(10, 20, 30)');
  assert.equal(row(context, 'color').source.kind, 'known-declaration');
  assert.ok(context.opaqueSources.every(source => !source.active)); checks++;
  await page.evaluate(() => { document.styleSheets[1].disabled = false; document.querySelector('link').media = '(min-width: 99999px)'; });
  context = await inspect('#opaque');
  assert.equal(row(context, 'color').source.kind, 'known-declaration');
  assert.ok(context.opaqueSources.every(source => !source.active)); checks++;
  console.log(`CSS inspection browser checks passed: ${checks}`);
} finally {
  await browser?.close();
  await Promise.all([new Promise(resolve => origin.close(resolve)), new Promise(resolve => foreign.close(resolve))]);
}
