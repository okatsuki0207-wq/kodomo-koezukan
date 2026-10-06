import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../src/lib/cropGeometry.ts', import.meta.url), 'utf8');
const geometry = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const viewport = { width: 320, height: 360 };
const original = { x: 70, y: 90, width: 150, height: 160 };

test('rectangle corners/edges resize independently and keep opposite edges anchored', () => {
  const east = geometry.resizeCropFrame(original, 'e', { x: 50, y: 100 }, viewport, false);
  assert.deepEqual(east, { ...original, width: 200 });
  const north = geometry.resizeCropFrame(original, 'n', { x: 50, y: -40 }, viewport, false);
  assert.deepEqual(north, { ...original, y: 50, height: 200 });
  const nw = geometry.resizeCropFrame(original, 'nw', { x: -20, y: 30 }, viewport, false);
  assert.deepEqual(nw, { x: 50, y: 120, width: 170, height: 130 });
});

test('all eight handles clamp to stage and cannot invert the rectangle', () => {
  for (const handle of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    for (const delta of [{ x: -900, y: -900 }, { x: 900, y: 900 }]) {
      const frame = geometry.resizeCropFrame(original, handle, delta, viewport, false);
      assert.ok(frame.width >= 40 && frame.height >= 40);
      assert.ok(frame.x >= 0 && frame.y >= 0);
      assert.ok(frame.x + frame.width <= viewport.width && frame.y + frame.height <= viewport.height);
    }
  }
});

test('circle corners preserve equal axes and opposite anchor', () => {
  const frame = { x: 60, y: 60, width: 100, height: 100 };
  const resized = geometry.resizeCropFrame(frame, 'nw', { x: -40, y: -40 }, viewport, true);
  assert.deepEqual(resized, { x: 20, y: 20, width: 140, height: 140 });
  for (const handle of ['ne', 'nw', 'se', 'sw']) {
    const next = geometry.resizeCropFrame(frame, handle, { x: 900, y: -900 }, viewport, true);
    assert.equal(next.width, next.height);
    assert.ok(next.x >= 0 && next.y >= 0 && next.x + next.width <= 320 && next.y + next.height <= 360);
  }
});

test('frame movement and zoom-out never introduce source-less pixels', () => {
  const frame = geometry.moveCropFrame(original, { x: 1000, y: -1000 }, viewport);
  assert.equal(frame.x + frame.width, viewport.width);
  assert.equal(frame.y, 0);
  for (const image of [{ width: 1200, height: 400 }, { width: 400, height: 1200 }]) {
    const transform = geometry.clampTransform({ zoom: .001, pan: { x: 999, y: -999 } }, image, viewport, frame);
    const rect = geometry.sourceCropRect(image, viewport, transform, frame);
    assert.ok(rect.x > -1e-8 && rect.y > -1e-8);
    assert.ok(rect.x + rect.width <= image.width + 1e-8 && rect.y + rect.height <= image.height + 1e-8);
    assert.ok(Math.abs(rect.width / rect.height - frame.width / frame.height) < 1e-8);
  }
});

test('pinch doubles image scale around fingers and moves midpoint without jumps', () => {
  const image = { width: 1000, height: 1000 };
  const stage = { width: 400, height: 400 };
  const frame = { x: 100, y: 100, width: 200, height: 200 };
  const start = { zoom: 1, pan: { x: 0, y: 0 } };
  const next = geometry.pinchTransform(start, { x: 150, y: 200 }, { x: 250, y: 200 },
    { x: 100, y: 220 }, { x: 300, y: 220 }, image, stage, frame);
  assert.deepEqual(next, { zoom: 2, pan: { x: 0, y: 20 } });
  const rect = geometry.sourceCropRect(image, stage, next, frame);
  assert.deepEqual(rect, { x: 375, y: 350, width: 250, height: 250 });
});

test('frame-only dragging at minimum zoom stops at image bounds without panning the source', () => {
  const image = { width: 1200, height: 400 };
  const transform = geometry.clampTransform({ zoom: .001, pan: { x: 0, y: 0 } }, image, viewport, original);
  const moved = geometry.moveCropFrameWithinImage(original, { x: 8, y: 5 }, image, viewport, transform);
  assert.equal(moved.x, original.x + 8);
  assert.ok(Math.abs(moved.y - original.y) < 1e-8);
  assert.deepEqual(geometry.clampTransform(transform, image, viewport, moved), transform);
  const before = geometry.sourceCropRect(image, viewport, transform, original);
  const after = geometry.sourceCropRect(image, viewport, transform, moved);
  assert.equal(before.y, after.y);
});

test('closed freehand has periodic quadratic curves, not a straight closing edge', () => {
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  assert.equal(geometry.smoothTracePath(points, true), 'M 0 50 Q 0 0 50 0 Q 100 0 100 50 Q 100 100 50 100 Q 0 100 0 50 Z');
  assert.equal(geometry.smoothTracePath([...points, points[0]], true), geometry.smoothTracePath(points, true));
  assert.ok(!geometry.smoothTracePath(points, false).endsWith(' Z'));
  assert.equal(geometry.smoothTracePath([], true), '');
});
