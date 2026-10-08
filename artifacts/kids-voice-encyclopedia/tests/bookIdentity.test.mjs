import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookId, createBookUrl, decodeLegacyShareId, isBookId } from '../src/lib/bookIdentity.ts';

test('book identifiers are random-format 256-bit hex values', () => {
  const first = createBookId();
  const second = createBookId();
  assert.equal(isBookId(first), true);
  assert.equal(first.length, 64);
  assert.notEqual(first, second);
  assert.equal(isBookId('A'.repeat(64)), false);
  assert.equal(isBookId('a'.repeat(63)), false);
});

test('canonical view URL preserves an app path prefix and removes stale fragments', () => {
  const id = 'a'.repeat(64);
  assert.equal(
    createBookUrl(id, 'https://example.test/kids-encyclopedia/?mode=home#old'),
    `https://example.test/kids-encyclopedia/view/${id}?mode=home`,
  );
  assert.equal(createBookUrl(id, 'https://example.test/#share=old'), `https://example.test/view/${id}`);
});

test('legacy live-share fragments map to the canonical book id, malformed tokens fail closed', () => {
  const payload = Buffer.from(JSON.stringify({ ownerUid: 'old-owner', shareId: 'c'.repeat(64) }))
    .toString('base64url');
  assert.equal(decodeLegacyShareId(payload), 'c'.repeat(64));
  assert.equal(decodeLegacyShareId('not-a-token'), null);
  assert.equal(decodeLegacyShareId(Buffer.from(JSON.stringify({ ownerUid: 'owner', shareId: 'x' })).toString('base64url')), null);
});
