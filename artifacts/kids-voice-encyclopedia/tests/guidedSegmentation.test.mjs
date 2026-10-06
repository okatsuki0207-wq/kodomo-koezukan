import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../src/lib/guidedSegmentation.ts', import.meta.url), 'utf8');
const { computeGuidedMask } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const width = 100, height = 100;
function fixture() {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const object = x >= 28 && x <= 72 && y >= 28 && y <= 72;
    const i = (y * width + x) * 4;
    pixels.set(object ? [220, 40, 30, 255] : [250, 250, 250, 255], i);
  }
  return pixels;
}
const keep = { kind: 'keep', radius: 3, points: [{ x: 49, y: 49 }, { x: 52, y: 52 }] };
const alpha = (pixels, x, y) => pixels[(y * width + x) * 4 + 3];

test('infers the coloured object well beyond the small painted seed, excludes background', () => {
  const original = fixture(), before = new Uint8ClampedArray(original);
  const result = computeGuidedMask(original, width, height, [keep]);
  assert.equal(alpha(result, 35, 35), 255);
  assert.equal(alpha(result, 65, 65), 255);
  assert.equal(alpha(result, 15, 50), 0);
  assert.equal(alpha(result, 90, 50), 0);
  assert.ok(alpha(result, 28, 28) > 0 && alpha(result, 28, 28) < 255);
  assert.deepEqual(original, before, 'do not mutate the original');
  assert.deepEqual(result.slice((50 * width + 15) * 4, (50 * width + 15) * 4 + 4), new Uint8ClampedArray(4), 'removed RGB is not retained');
});

test('remove marks override keep pixels; undo recomputation restores the result', () => {
  const original = fixture();
  const remove = { kind: 'remove', radius: 5, points: [{ x: 65, y: 50 }] };
  assert.equal(alpha(computeGuidedMask(original, width, height, [keep, remove]), 65, 50), 0);
  assert.equal(alpha(computeGuidedMask(original, width, height, [keep]), 65, 50), 255);
  assert.throws(() => computeGuidedMask(original, width, height, [keep,
    { kind: 'remove', radius: 10, points: [{ x: 50, y: 50 }] }]), /内側を塗って/);
});

test('transparent source pixels remain transparent and non-selected disconnected objects are removed', () => {
  const pixels = fixture();
  for (let y = 10; y <= 20; y++) for (let x = 10; x <= 20; x++) pixels.set([220, 40, 30, 255], (y * width + x) * 4);
  pixels.set([0, 0, 0, 0], (50 * width + 60) * 4);
  const result = computeGuidedMask(pixels, width, height, [keep]);
  assert.equal(alpha(result, 60, 50), 0);
  assert.equal(alpha(result, 15, 15), 0);
});

test('empty/invalid/entirely transparent foreground is rejected explicitly', () => {
  assert.throws(() => computeGuidedMask(fixture(), width, height, []), /内側を塗って/);
  assert.throws(() => computeGuidedMask(new Uint8ClampedArray(4), 601, 1, []), /サイズ/);
  assert.throws(() => computeGuidedMask(new Uint8ClampedArray(width * height * 4), width, height, [keep]), /内側を塗って/);
});
