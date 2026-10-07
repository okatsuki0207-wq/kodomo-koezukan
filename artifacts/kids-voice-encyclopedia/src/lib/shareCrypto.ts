const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export const SHARE_KDF = 'PBKDF2-SHA256' as const;
export const SHARE_KDF_ITERATIONS = 600_000;
export const SHARE_PASSWORD_MIN_LENGTH = 16;
export const SHARE_PASSWORD_MAX_LENGTH = 128;
export const SHARE_SALT_BYTES = 16;
export const SHARE_IV_BYTES = 12;
// Leave room for base64 expansion and field/document metadata under Firestore's
// 1 MiB per-field limit.
export const MAX_SHARE_MANIFEST_BYTES = 700_000;

export type EncryptedValue = { iv: string; ciphertext: string };

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error('このブラウザでは安全な暗号化を利用できません。最新のブラウザで開いてください。');
  }
  return globalThis.crypto;
}

export function randomBytes(length: number): Uint8Array {
  return cryptoApi().getRandomValues(new Uint8Array(length));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

export function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function validateSharePassword(password: string): string | null {
  const normalized = password.normalize('NFC');
  const length = [...normalized].length;
  if (length < SHARE_PASSWORD_MIN_LENGTH) return `パスワードは${SHARE_PASSWORD_MIN_LENGTH}文字以上にしてください。`;
  if (length > SHARE_PASSWORD_MAX_LENGTH) return `${SHARE_PASSWORD_MAX_LENGTH}文字以内で設定してください。`;
  if (/^\s|\s$/.test(normalized)) return 'パスワードの最初と最後に空白は使えません。';
  return null;
}

export async function deriveShareKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const problem = validateSharePassword(password);
  if (problem) throw new Error(problem);
  if (salt.byteLength !== SHARE_SALT_BYTES) throw new Error('共有データの形式を確認できません。');

  const crypto = cryptoApi();
  const passwordBytes = encoder.encode(password.normalize('NFC'));
  const material = await crypto.subtle.importKey('raw', ownedBuffer(passwordBytes), 'PBKDF2', false, ['deriveKey']);
  passwordBytes.fill(0);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: ownedBuffer(salt), iterations: SHARE_KDF_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptShareBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
  additionalData?: string | Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = randomBytes(SHARE_IV_BYTES);
  const parameters: AesGcmParams = { name: 'AES-GCM', iv: ownedBuffer(iv), tagLength: 128 };
  const aad = typeof additionalData === 'string' ? encoder.encode(additionalData) : additionalData;
  if (aad) parameters.additionalData = ownedBuffer(aad);
  const ciphertext = new Uint8Array(await cryptoApi().subtle.encrypt(parameters, key, ownedBuffer(plaintext)));
  return { iv, ciphertext };
}

export async function decryptShareBytes(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  additionalData?: string | Uint8Array,
): Promise<Uint8Array> {
  if (iv.byteLength !== SHARE_IV_BYTES || ciphertext.byteLength < 16) throw new Error('共有データの形式を確認できません。');
  const parameters: AesGcmParams = { name: 'AES-GCM', iv: ownedBuffer(iv), tagLength: 128 };
  const aad = typeof additionalData === 'string' ? encoder.encode(additionalData) : additionalData;
  if (aad) parameters.additionalData = ownedBuffer(aad);
  const plaintext = await cryptoApi().subtle.decrypt(parameters, key, ownedBuffer(ciphertext));
  return new Uint8Array(plaintext);
}

export async function encryptShareManifest(key: CryptoKey, manifest: unknown): Promise<EncryptedValue> {
  const plain = encoder.encode(JSON.stringify(manifest));
  if (plain.byteLength > MAX_SHARE_MANIFEST_BYTES) {
    throw new Error('共有するキロクの量が上限を超えています。カテゴリや声の数を減らしてからお試しください。');
  }
  const { iv, ciphertext } = await encryptShareBytes(key, plain, 'kids-voice-zukan:share-manifest:v1');
  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export async function decryptShareManifest<T>(key: CryptoKey, encrypted: EncryptedValue): Promise<T> {
  const cipher = fromBase64(encrypted.ciphertext);
  if (cipher.byteLength > MAX_SHARE_MANIFEST_BYTES + 16) throw new Error('共有データのサイズが上限を超えています。');
  const plain = await decryptShareBytes(key, fromBase64(encrypted.iv), cipher, 'kids-voice-zukan:share-manifest:v1');
  if (plain.byteLength > MAX_SHARE_MANIFEST_BYTES) throw new Error('共有データのサイズが上限を超えています。');
  return JSON.parse(decoder.decode(plain)) as T;
}

export function createShareId(): string {
  return [...randomBytes(32)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function encodeShareToken(ownerUid: string, shareId: string): string {
  const payload = encoder.encode(JSON.stringify({ ownerUid, shareId }));
  return toBase64(payload).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function decodeShareToken(token: string): { ownerUid: string; shareId: string } | null {
  try {
    if (!token || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const base64 = token.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - token.length % 4) % 4);
    const decoded = JSON.parse(decoder.decode(fromBase64(base64))) as { ownerUid?: unknown; shareId?: unknown };
    if (Object.keys(decoded).sort().join(',') !== 'ownerUid,shareId') return null;
    if (typeof decoded.ownerUid !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(decoded.ownerUid)) return null;
    if (typeof decoded.shareId !== 'string' || !/^[a-f0-9]{64}$/.test(decoded.shareId)) return null;
    return { ownerUid: decoded.ownerUid, shareId: decoded.shareId };
  } catch {
    return null;
  }
}

export function createShareUrl(ownerUid: string, shareId: string, currentUrl: string): string {
  const url = new URL(currentUrl);
  url.search = '';
  url.hash = `share=${encodeShareToken(ownerUid, shareId)}`;
  return url.href;
}
