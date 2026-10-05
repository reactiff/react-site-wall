import test from 'node:test';
import assert from 'node:assert/strict';
import { WallRuntime } from '../dist/runtime.js';
import { WallController } from '../dist/controller.js';

function runtime() {
  const controller = new WallController({ version: 1, routes: [
    { id: 'a', title: 'A', path: '/a' },
    { id: 'b', title: 'B', path: '/b' },
    { id: 'hidden', title: 'Hidden', path: '/hidden', included: false },
  ] });
  return new WallRuntime(controller, { list: async () => [] });
}

test('captureAllPages uses stitched captures only for checked panels, sequentially', async () => {
  const wall = runtime();
  const calls = [];
  let active = false;
  wall.queueCapture = async (id, full) => {
    assert.equal(active, false);
    active = true;
    calls.push([id, full]);
    await new Promise(resolve => setTimeout(resolve, 5));
    active = false;
    return `png:${id}`;
  };
  assert.deepEqual(await wall.api.captureAllPages(), [
    { id: 'a', route: '/a', image: 'png:a' },
    { id: 'b', route: '/b', image: 'png:b' },
  ]);
  assert.deepEqual(calls, [['a', true], ['b', true]]);
  assert.deepEqual(wall.api.getState().visible, ['a', 'b']);
});

test('captureAllPages skips panels unchecked during capture and returns empty for none', async () => {
  const wall = runtime();
  const calls = [];
  wall.queueCapture = async id => { calls.push(id); wall.api.show('b', false); return 'png'; };
  assert.deepEqual(await wall.api.captureAllPages(), [{ id: 'a', route: '/a', image: 'png' }]);
  assert.deepEqual(calls, ['a']);
  wall.api.show('a', false);
  assert.deepEqual(await wall.api.captureAllPages(), []);
});

test('captureAllPages reports incomplete captures as failures', async () => {
  const wall = runtime();
  wall.queueCapture = async () => { throw new Error('Page not ready'); };
  await assert.rejects(wall.api.captureAllPages(), /Page not ready/);
});
