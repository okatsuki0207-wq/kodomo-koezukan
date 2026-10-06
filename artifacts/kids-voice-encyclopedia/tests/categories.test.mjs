import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryIdForName, categoryNameKey, DEFAULT_CATEGORIES, filterByCategory, keepsakeMetadata, validateCategoryName } from '../src/lib/categories.ts';

test('provides the three initial pages', () => {
  assert.deepEqual(DEFAULT_CATEGORIES.map((category) => category.name), ['おもちゃ', 'どうぶつ', 'さくひん']);
});

test('validates names and prevents reserved/default category duplicates', () => {
  assert.equal(validateCategoryName('  のりもの  '), 'のりもの');
  for (const name of ['', '   ', 'すべて', ' おもちゃ ', 'あ'.repeat(25)]) {
    assert.throws(() => validateCategoryName(name));
  }
  assert.equal(validateCategoryName('あ'.repeat(24)).length, 24);
});

test('same normalized name has same stable ID for retries and concurrent creation', async () => {
  assert.equal(categoryNameKey(' ＡＢＣ '), categoryNameKey('abc'));
  const [one, two, three] = await Promise.all([' ＡＢＣ ', 'abc', 'AbC'].map(categoryIdForName));
  assert.equal(one, two);
  assert.equal(two, three);
  assert.match(one, /^custom-[a-f0-9]{64}$/);
  assert.notEqual(one, await categoryIdForName('別のページ'));
  assert.match(await categoryIdForName('写真/イラスト'), /^custom-[a-f0-9]{64}$/);
});

test('all includes legacy cards and specific pages filter without mutating cards', () => {
  const items = [
    { id: 'legacy' }, { id: 'uncategorized', categoryId: null },
    { id: 'toy', categoryId: 'default-toys' }, { id: 'animal', categoryId: 'default-animals' },
  ];
  assert.deepEqual(filterByCategory(items, null), items);
  assert.deepEqual(filterByCategory(items, 'default-toys').map((item) => item.id), ['toy']);
  assert.deepEqual(filterByCategory(items, 'default-artworks'), []);
  assert.equal(items.length, 4);
});

test('metadata edit changes only title and category, including clearing the category', () => {
  const original = { itemName: '以前', categoryId: 'default-toys', photo: 'photo-url', voice: 'voice-url', createdAt: 123 };
  const patch = keepsakeMetadata('  新しい名前  ', 'default-animals');
  assert.deepEqual(Object.keys(patch).sort(), ['categoryId', 'itemName']);
  const updated = { ...original, ...patch };
  assert.equal(updated.photo, original.photo);
  assert.equal(updated.voice, original.voice);
  assert.equal(updated.createdAt, original.createdAt);
  assert.equal(keepsakeMetadata('名前', null).categoryId, null);
  assert.throws(() => keepsakeMetadata(' ', null));
  assert.throws(() => keepsakeMetadata('あ'.repeat(49), null));
  assert.throws(() => keepsakeMetadata('名前', 'users/another/categories/unowned'));
});
