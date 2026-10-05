import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numericEdit, sourceRules } from '../dist/StylesPanel.js';
import { rebaseStylesheetURLs } from '../dist/style-context.js';
test('individual CSS rule ranges preserve comments, wrappers, and surrounding rules', () => {
  const source = '/* untouched */\n@media (min-width: 1px) { .a { color: red; &.active { color: blue; } } }\n.b, .c { padding: 2px; }';
  const rules = sourceRules(source);
  assert.equal(rules.length, 3);
  assert.equal(rules[1].text, '&.active { color: blue; }');
  assert.equal(rules[2].text, '.b, .c { padding: 2px; }');
  const replacement = '&.active { color: green; }';
  const edited = source.slice(0, rules[1].from) + replacement + source.slice(rules[1].to);
  assert.equal(edited, source.replace(rules[1].text, replacement));
  assert.equal(sourceRules(edited)[2].text, rules[2].text);
});
test('CSS numeric editing preserves units, supports fractions, and ignores selectors/comments', () => {
  assert.deepEqual(numericEdit('a { padding: 12px; }', 14, 1), { from: 13, to: 15, value: '13' });
  assert.deepEqual(numericEdit('h1 { padding: 12px; }', 14, 1), { from: 14, to: 16, value: '13' });
  assert.deepEqual(numericEdit('h1 { padding: 12px; }', 16, 1), { from: 14, to: 16, value: '13' });
  assert.equal(numericEdit('.item2 { color: red; }', 6, 1), null);
  assert.equal(numericEdit('a { /* width: 12px */ }', 15, 1), null);
  assert.equal(numericEdit('a { content: "12px"; }', 15, 1), null);
  assert.equal(numericEdit('a { background: url(12.png); }', 21, 1), null);
  assert.equal(numericEdit('a { color: #123456; }', 15, 1), null);
  assert.deepEqual(numericEdit('a { opacity: .5; }', 14, .1), { from: 13, to: 15, value: '0.6' });
});
test('stylesheet overlays retain source-relative URLs and import conditions', () => {
  const css = '@import "theme/base.css" layer(theme) supports(display: grid); .a { background: url(../assets/image.png); mask: url("icons/mask.svg"); color: #123; content: "url(fake.png)"; }';
  const result = rebaseStylesheetURLs(css, 'https://example.test/styles/nested/app.css');
  assert.equal(result, '@import "https://example.test/styles/nested/theme/base.css" layer(theme) supports(display: grid); .a { background: url("https://example.test/styles/assets/image.png"); mask: url("https://example.test/styles/nested/icons/mask.svg"); color: #123; content: "url(fake.png)"; }');
  assert.equal(rebaseStylesheetURLs('a{background:url(#mask);mask:url(data:image/svg+xml,test);border-image:url(/root.png)}', 'https://example.test/nested/app.css'), 'a{background:url(#mask);mask:url(data:image/svg+xml,test);border-image:url(/root.png)}');
});
