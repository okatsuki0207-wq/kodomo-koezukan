import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GALLERY_SETTINGS,
  normalizeGallerySettings,
  sortGalleryItems,
  UNCATEGORIZED_CATEGORY_KEY,
} from '../src/lib/gallerySettings.ts';

const items = [
  { id: 'toy-1', categoryId: 'toys', createdAt: 100 },
  { id: 'animal-1', categoryId: 'animals', createdAt: 200 },
  { id: 'toy-2', categoryId: 'toys', createdAt: 300 },
  { id: 'unclassified', categoryId: null, createdAt: 400 },
];

test('default order is newest first across all, categorized, and uncategorized cards', () => {
  const settings = normalizeGallerySettings(DEFAULT_GALLERY_SETTINGS);
  assert.deepEqual(sortGalleryItems(items, settings, null).map((item) => item.id), [
    'unclassified', 'toy-2', 'animal-1', 'toy-1',
  ]);
  assert.deepEqual(sortGalleryItems(items, settings, 'toys').map((item) => item.id), ['toy-2', 'toy-1']);
  assert.deepEqual(sortGalleryItems(items, settings, 'animals').map((item) => item.id), ['animal-1']);
  assert.deepEqual(sortGalleryItems(items, settings, 'missing-category'), []);
  assert.deepEqual(sortGalleryItems(items, settings, UNCATEGORIZED_CATEGORY_KEY).map((item) => item.id), ['unclassified']);
  assert.deepEqual(items.map((item) => item.id), ['toy-1', 'animal-1', 'toy-2', 'unclassified']);
});

test('legacy manual-order fields are ignored and removed from normalized settings', () => {
  assert.deepEqual(normalizeGallerySettings({
    categoryOrder: ['animals'],
    cardOrderByCategory: { toys: ['toy-1'] },
    displayMode: 'ordered',
    shuffleSeed: 3,
  }), { displayMode: 'ordered', shuffleSeed: 3 });
});

test('shuffle mode keeps the newest card first and shuffles the remainder for each page', () => {
  const settings = {
    ...DEFAULT_GALLERY_SETTINGS,
    displayMode: 'shuffle',
    shuffleSeed: 12345,
  };
  const first = sortGalleryItems(items, settings, null).map((item) => item.id);
  const second = sortGalleryItems(items, settings, null).map((item) => item.id);
  assert.deepEqual(first, second);
  assert.equal(first[0], 'unclassified');
  assert.deepEqual(new Set(first), new Set(items.map((item) => item.id)));

  const toys = sortGalleryItems(items, settings, 'toys').map((item) => item.id);
  assert.equal(toys[0], 'toy-2');
  assert.deepEqual(new Set(toys), new Set(['toy-1', 'toy-2']));
  assert.deepEqual(sortGalleryItems(items, settings, 'animals').map((item) => item.id), ['animal-1']);
  assert.deepEqual(sortGalleryItems(items, settings, UNCATEGORIZED_CATEGORY_KEY).map((item) => item.id), ['unclassified']);
});

test('turning shuffle off restores strict newest-first ordering', () => {
  const settings = normalizeGallerySettings({ displayMode: 'ordered', shuffleSeed: 12345 });
  assert.deepEqual(sortGalleryItems(items, settings, null).map((item) => item.id), [
    'unclassified', 'toy-2', 'animal-1', 'toy-1',
  ]);
});
