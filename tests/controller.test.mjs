import test from 'node:test';
import assert from 'node:assert/strict';
import { WallController } from '../dist/controller.js';
import { validateManifest } from '../dist/manifest.js';
const manifest = { version: 1, routes: [
  { id: 'home', title: 'Home', path: '/' },
  { id: 'shop', title: 'Shop', path: '/shop' },
  { id: 'filtered', title: 'Filtered', path: '/shop?sort=price', included: false },
] };
test('route identity survives repeated navigation and reveals excluded destinations', () => {
  const wall = new WallController(manifest);
  assert.deepEqual(wall.navigate('/shop'), { source: 'home', destination: 'shop', path: '/shop' });
  wall.navigate('/shop?sort=price');
  wall.navigate('/');
  assert.equal(wall.snapshot().focused, 'home');
  assert.deepEqual(wall.snapshot().routes.map(r => r.path), ['/', '/shop', '/shop?sort=price']);
  assert.deepEqual(wall.snapshot().visible, ['home', 'shop', 'filtered']);
  assert.deepEqual(manifest.routes[2].included, false);
});
test('unknown routes fail observably and never reassign a panel', () => {
  const wall = new WallController(manifest);
  assert.throws(() => wall.navigate('/missing'), /absent/);
  assert.equal(wall.snapshot().currentRoute, '/');
  assert.equal(wall.events().at(-1).type, 'unmapped-navigation');
});
test('visibility and viewport configuration retain focus invariants', () => {
  const wall = new WallController(manifest);
  wall.show('home', false);
  assert.equal(wall.snapshot().focused, 'shop');
  wall.show('shop', false);
  assert.equal(wall.snapshot().focused, null);
  wall.focus('filtered');
  wall.configure({ viewport: { width: 820, height: 1180 }, zoom: .3, pan: { x: -200, y: 50 }, layout: 'overview' });
  assert.equal(wall.snapshot().currentRoute, '/shop?sort=price');
  assert.throws(() => wall.configure({ viewport: { width: 0, height: 100 } }));
  assert.throws(() => wall.configure({ zoom: NaN }));
});
test('manifest rejects duplicate ownership, recursion, patterns and external URLs', () => {
  for (const path of ['/sitewall', '/sitewall/', '/watches/:model', '//evil.com/x', 'https://evil.com']) {
    assert.throws(() => validateManifest({ version: 1, routes: [{ id: 'bad', title: 'Bad', path }] }));
  }
  assert.throws(() => validateManifest({ version: 1, routes: [manifest.routes[0], { id: 'other', title: 'Other', path: '/' }] }));
});
