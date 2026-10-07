import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GALLERY_SETTINGS,
  normalizeGallerySettings,
  orderCategories,
  orderCardsInCategory,
  sortGalleryItems,
  UNCATEGORIZED_CATEGORY_KEY,
} from '../src/lib/gallerySettings.ts';

const categories = [
  { id: 'toys', name: 'おもちゃ' },
  { id: 'animals', name: 'どうぶつ' },
];
const items = [
  { id: 'toy-1', categoryId: 'toys' },
  { id: 'animal-1', categoryId: 'animals' },
  { id: 'toy-2', categoryId: 'toys' },
  { id: 'unclassified', categoryId: null },
];

test('category order and per-category card order apply without mutating source data', () => {
  const settings = normalizeGallerySettings({
    categoryOrder: ['animals', 'toys'],
    cardOrderByCategory: { animals: ['animal-1'], toys: ['toy-2', 'toy-1'] },
  });
  const ordered = sortGalleryItems(items, categories, settings, null);
  assert.deepEqual(ordered.map((item) => item.id), ['animal-1', 'toy-2', 'toy-1', 'unclassified']);
  assert.deepEqual(orderCategories(categories, settings).map((category) => category.id), ['animals', 'toys']);
  assert.deepEqual(orderCardsInCategory(items, 'toys', settings).map((item) => item.id), ['toy-2', 'toy-1']);
  assert.deepEqual(items.map((item) => item.id), ['toy-1', 'animal-1', 'toy-2', 'unclassified']);
});

test('new cards and categories absent from saved order remain visible at the end', () => {
  const settings = normalizeGallerySettings({
    categoryOrder: ['toys'],
    cardOrderByCategory: {
      toys: ['toy-2'],
      [UNCATEGORIZED_CATEGORY_KEY]: [],
    },
  });
  const withNew = [...items, { id: 'toy-new', categoryId: 'toys' }];
  assert.deepEqual(sortGalleryItems(withNew, [...categories, { id: 'art', name: 'さくひん' }], settings, 'toys')
    .map((item) => item.id), ['toy-2', 'toy-1', 'toy-new']);
  assert.deepEqual(orderCategories([...categories, { id: 'art', name: 'さくひん' }], settings)
    .map((category) => category.id), ['toys', 'animals', 'art']);
});

test('shuffle layout is deterministic for shared viewers, filters by category, and preserves all cards', () => {
  const settings = {
    ...DEFAULT_GALLERY_SETTINGS,
    categoryOrder: ['toys', 'animals'],
    displayMode: 'shuffle',
    shuffleSeed: 12345,
  };
  const first = sortGalleryItems(items, categories, settings, null).map((item) => item.id);
  const second = sortGalleryItems(items, categories, settings, null).map((item) => item.id);
  assert.deepEqual(first, second);
  assert.deepEqual(new Set(first), new Set(items.map((item) => item.id)));
  assert.ok(sortGalleryItems(items, categories, settings, 'toys').every((item) => item.categoryId === 'toys'));
});
