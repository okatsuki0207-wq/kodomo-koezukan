const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const SHARE_KDF = 'PBKDF2-SHA256' as const;
export const SHARE_KDF_ITERATIONS = 600_000;
export const SHARE_PASSWORD_MIN_LENGTH = 12;
export const SHARE_PASSWORD_MAX_LENGTH = 128;
export const SHARE_SALT_BYTES = 16;
export const SHARE_IV_BYTES = 12;
export const MAX_SHARE_MANIFEST_BYTES = 850_000;

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
  const material = await crypto.subtle.importKey('raw', encoder.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: SHARE_KDF_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptShareBytes(key: CryptoKey, plaintext: Uint8Array): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = randomBytes(SHARE_IV_BYTES);
  const ciphertext = new Uint8Array(await cryptoApi().subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plaintext));
  return { iv, ciphertext };
}

export async function decryptShareBytes(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  if (iv.byteLength !== SHARE_IV_BYTES || ciphertext.byteLength < 16) throw new Error('共有データの形式を確認できません。');
  const plaintext = await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, ciphertext);
  return new Uint8Array(plaintext);
}

export async function encryptShareManifest(key: CryptoKey, manifest: unknown): Promise<EncryptedValue> {
  const plain = encoder.encode(JSON.stringify(manifest));
  if (plain.byteLength > MAX_SHARE_MANIFEST_BYTES) {
    throw new Error('共有するキロクの量が上限を超えています。カテゴリや声の数を減らしてからお試しください。');
  }
  const { iv, ciphertext } = await encryptShareBytes(key, plain);
  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export async function decryptShareManifest<T>(key: CryptoKey, encrypted: EncryptedValue): Promise<T> {
  const cipher = fromBase64(encrypted.ciphertext);
  if (cipher.byteLength > MAX_SHARE_MANIFEST_BYTES + 16) throw new Error('共有データのサイズが上限を超えています。');
  const plain = await decryptShareBytes(key, fromBase64(encrypted.iv), cipher);
  if (plain.byteLength > MAX_SHARE_MANIFEST_BYTES) throw new Error('共有データのサイズが上限を超えています。');
  return JSON.parse(decoder.decode(plain)) as T;
}

export function createShareId(): string {
  return [...randomBytes(32)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
