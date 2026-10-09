import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampGalleryPage,
  galleryPageCount,
  galleryPageItems,
  galleryPageSize,
  gallerySwipeDelta,
} from '../src/lib/galleryPagination.ts';

test('gallery uses four rows on short screens and five rows on taller screens', () => {
  assert.equal(galleryPageSize(568), 12);
  assert.equal(galleryPageSize(699), 12);
  assert.equal(galleryPageSize(700), 15);
  assert.equal(galleryPageSize(874), 15);
});

test('gallery divides cards into bounded pages and clamps removed last pages', () => {
  const items = Array.from({ length: 31 }, (_, index) => `card-${index + 1}`);
  assert.equal(galleryPageCount(items.length, 15), 3);
  assert.deepEqual(galleryPageItems(items, 0, 15), items.slice(0, 15));
  assert.deepEqual(galleryPageItems(items, 1, 15), items.slice(15, 30));
  assert.deepEqual(galleryPageItems(items, 2, 15), ['card-31']);
  assert.equal(clampGalleryPage(8, 3), 2);
  assert.equal(galleryPageCount(0, 15), 1);
});

test('gallery recognizes horizontal swipes and ignores short or mostly vertical gestures', () => {
  assert.equal(gallerySwipeDelta(200, 100, 130, 110), 1);
  assert.equal(gallerySwipeDelta(130, 100, 200, 110), -1);
  assert.equal(gallerySwipeDelta(200, 100, 170, 105), 0);
  assert.equal(gallerySwipeDelta(200, 100, 120, 190), 0);
});
