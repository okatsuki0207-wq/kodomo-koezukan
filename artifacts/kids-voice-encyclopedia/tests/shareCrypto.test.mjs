import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createShareId,
  createShareUrl,
  decodeShareToken,
  decryptShareBytes,
  decryptShareManifest,
  deriveShareKey,
  encryptShareBytes,
  encryptShareManifest,
  randomBytes,
  sanitizeSharePin,
  validateSharePassword,
  validateSharePasswordForUnlock,
} from '../src/lib/shareCrypto.ts';

const password = '0427';

test('new share passwords require exactly four ASCII digits and old links remain unlockable', () => {
  assert.equal(validateSharePassword(password), null);
  assert.match(validateSharePassword('123') ?? '', /数字4桁/u);
  assert.match(validateSharePassword('12345') ?? '', /数字4桁/u);
  assert.match(validateSharePassword('12a4') ?? '', /数字4桁/u);
  assert.equal(sanitizeSharePin('0a 4-2x7'), '0427');
  const oldPassword = 'かぞくのたいせつなことば2026';
  assert.match(validateSharePassword(oldPassword) ?? '', /数字4桁/u);
  assert.equal(validateSharePasswordForUnlock(oldPassword), null);
  assert.match(validateSharePasswordForUnlock('短い') ?? '', /16文字以上/u);
  assert.equal(validateSharePassword(password), null);
});

test('share manifest decrypts only with the right password and detects tampering', async () => {
  const salt = randomBytes(16);
  const key = await deriveShareKey(password, salt);
  const manifest = {
    version: 1,
    categories: [{ id: 'default-artworks', name: 'さくひん' }],
    cards: [{ id: 'test-card', itemName: 'あおい車', createdAt: 1_700_000_000_000 }],
  };
  const encrypted = await encryptShareManifest(key, manifest);
  assert.deepEqual(await decryptShareManifest(key, encrypted), manifest);

  const wrongKey = await deriveShareKey('1234', salt);
  await assert.rejects(decryptShareManifest(wrongKey, encrypted));
  await assert.rejects(decryptShareManifest(key, { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` }));
});

test('legacy long-password shares still derive a key for existing links', async () => {
  const oldPassword = 'かぞくのたいせつなことば2026';
  const salt = randomBytes(16);
  const key = await deriveShareKey(oldPassword, salt);
  const manifest = { version: 1, categories: [], cards: [] };
  const encrypted = await encryptShareManifest(key, manifest);
  assert.deepEqual(await decryptShareManifest(key, encrypted), manifest);
});

test('encrypted media is bound to its share and asset identity', async () => {
  const key = await deriveShareKey(password, randomBytes(16));
  const { iv, ciphertext } = await encryptShareBytes(key, new TextEncoder().encode('media bytes'), 'asset:share-a:photo-1');
  assert.equal(new TextDecoder().decode(await decryptShareBytes(key, iv, ciphertext, 'asset:share-a:photo-1')), 'media bytes');
  await assert.rejects(decryptShareBytes(key, iv, ciphertext, 'asset:share-b:photo-1'));
});

test('share URLs keep the random capability in the URL fragment and reject malformed tokens', () => {
  const shareId = createShareId();
  assert.match(shareId, /^[a-f0-9]{64}$/u);
  const link = createShareUrl('owner_uid-0123456789', shareId, 'https://example.test/app?theme=light');
  const token = new URL(link).hash.slice('#share='.length);
  assert.equal(decodeShareToken(token)?.shareId, shareId);
  assert.equal(decodeShareToken(token)?.ownerUid, 'owner_uid-0123456789');
  assert.equal(decodeShareToken('not-a-share'), null);
});
