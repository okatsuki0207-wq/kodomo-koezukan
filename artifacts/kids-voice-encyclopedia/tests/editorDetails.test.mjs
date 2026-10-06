import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

async function load(name) {
  const text = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString('base64')}`);
}
const gesture = await load('longPressGesture');
const subject = await load('subjectMask');

test('long press tolerates small finger jitter but cancels drags and scroll-sized movement', () => {
  assert.equal(gesture.LONG_PRESS_MS, 550);
  assert.equal(gesture.movedTooFar(0, 0, 6, 8), false);
  assert.equal(gesture.movedTooFar(0, 0, 8, 8), true);
  assert.equal(gesture.movedTooFar(20, 20, 20, -1), true);
});
test('child touch taps tolerate 25px final displacement even after native scrolling, but not long presses or cancelled gestures', () => {
  assert.equal(gesture.TOUCH_TAP_SLOP, 25);
  assert.equal(gesture.isChildTap(0, 0, 15, 20), true);
  assert.equal(gesture.isChildTap(0, 0, 0, 25), true);
  assert.equal(gesture.isChildTap(0, 0, 20, 20), false);
  assert.equal(gesture.isChildTap(0, 0, 0, 26), false);
  assert.equal(gesture.isChildTap(0, 0, 0, 0, true), false);
  assert.equal(gesture.isChildTap(0, 0, 0, 0, false, true), false);
});
test('AI selection intersection cannot restore outside-lasso pixels, retains original colour and alpha', () => {
  const original = new Uint8ClampedArray([99, 66, 22, 0, 180, 30, 20, 255, 12, 90, 70, 128]);
  const mask = new Uint8ClampedArray([1, 2, 3, 255, 1, 2, 3, 128, 1, 2, 3, 255]);
  const before = [...original];
  assert.deepEqual([...subject.intersectSubjectMask(original, mask)], [0, 0, 0, 0, 180, 30, 20, 128, 12, 90, 70, 128]);
  assert.deepEqual([...original], before);
});
test('AI background alpha is removed with hidden RGB and transparent padding is tightly cropped', () => {
  const original = new Uint8ClampedArray(3 * 3 * 4).fill(255);
  const mask = new Uint8ClampedArray(3 * 3 * 4);
  mask[3] = 1; mask[(1 * 3 + 1) * 4 + 3] = 255;
  const result = subject.intersectSubjectMask(original, mask);
  assert.deepEqual([...result.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual(subject.subjectBounds(result, 3, 3), { x: 1, y: 1, width: 1, height: 1 });
  assert.throws(() => subject.subjectBounds(new Uint8ClampedArray(36), 3, 3), /被写体/);
  assert.throws(() => subject.intersectSubjectMask(original, new Uint8ClampedArray(4)), /大きさ/);
});

test('AI-anchored opacity repair fills connected solid foreground without filling background holes or disconnected patches', () => {
  const width = 10, height = 6;
  const source = new Uint8ClampedArray(width * height * 4).fill(255);
  const mask = new Uint8ClampedArray(source.length);
  const paint = (x, y, alpha = 30) => {
    const i = (y * width + x) * 4;
    source.set([220, 30, 30, 255], i); mask[i + 3] = alpha;
  };
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 4; x++) paint(x, y, x <= 2 ? 180 : 30);
  source.set([255, 255, 255, 255], (2 * width + 3) * 4);
  mask[(2 * width + 3) * 4 + 3] = 0; // real white-background hole in the object
  paint(8, 2, 0); // disconnected matching colour must not be recovered
  source[(3 * width + 4) * 4 + 3] = 0; // excluded lasso pixels must stay excluded
  const before = [...mask];
  const refined = subject.refineSubjectOpacity(source, mask, width, height);
  const result = subject.intersectSubjectMask(source, refined);
  assert.equal(result[(1 * width + 4) * 4 + 3], 255);
  assert.equal(result[(2 * width + 3) * 4 + 3], 0);
  assert.equal(result[(2 * width + 8) * 4 + 3], 0);
  assert.equal(result[(3 * width + 4) * 4 + 3], 0);
  assert.deepEqual([...mask], before);
  const empty = subject.refineSubjectOpacity(source, new Uint8ClampedArray(mask.length), width, height);
  assert.ok(empty.every((value) => value === 0)); // no semantic anchors = no fabricated success
});
