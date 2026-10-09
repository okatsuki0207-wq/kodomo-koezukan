import test from 'node:test';
import assert from 'node:assert/strict';
import { bookIdForPassphrase, createBookId, isBookId } from '../src/lib/bookIdentity.ts';
import { ACTIVE_BOOK_ID_STORAGE_KEY, getActiveBookId, storeActiveBookId } from '../src/lib/bookSelection.ts';

test('book identifiers are random-format 256-bit hex values', () => {
  const first = createBookId();
  const second = createBookId();
  assert.equal(isBookId(first), true);
  assert.equal(first.length, 64);
  assert.notEqual(first, second);
  assert.equal(isBookId('A'.repeat(64)), false);
  assert.equal(isBookId('a'.repeat(63)), false);
});

test('the same normalized passphrase selects the same stable book ID on another device', async () => {
  const first = await bookIdForPassphrase('  あいちゃん  ');
  const normalized = await bookIdForPassphrase('あいちゃん');
  const second = await bookIdForPassphrase('たろう');
  assert.equal(first, normalized);
  assert.equal(isBookId(first), true);
  assert.notEqual(first, second);
});

test('the device stores only the derived book ID, never the typed passphrase', async () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
  };
  const phrase = 'ひみつのあいことば';
  const bookId = await bookIdForPassphrase(phrase);
  storeActiveBookId(bookId, storage);
  assert.equal(records.size, 1);
  assert.equal(records.get(ACTIVE_BOOK_ID_STORAGE_KEY), bookId);
  assert.equal(records.has(phrase), false);
  assert.equal(getActiveBookId(storage), bookId);
});

