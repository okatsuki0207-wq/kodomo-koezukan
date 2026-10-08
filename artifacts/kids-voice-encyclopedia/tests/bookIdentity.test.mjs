import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookId, isBookId } from '../src/lib/bookIdentity.ts';

test('book identifiers are random-format 256-bit hex values', () => {
  const first = createBookId();
  const second = createBookId();
  assert.equal(isBookId(first), true);
  assert.equal(first.length, 64);
  assert.notEqual(first, second);
  assert.equal(isBookId('A'.repeat(64)), false);
  assert.equal(isBookId('a'.repeat(63)), false);
});

