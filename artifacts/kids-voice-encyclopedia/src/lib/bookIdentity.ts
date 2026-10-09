export type BookId = string;

const BOOK_ID_PATTERN = /^[a-f0-9]{64}$/;

export function isBookId(value: unknown): value is BookId {
  return typeof value === 'string' && BOOK_ID_PATTERN.test(value);
}

export function createBookId(): BookId {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('安全な図鑑IDを作成できません。このページを最新のブラウザで開いてください。');
  }
  return [...globalThis.crypto.getRandomValues(new Uint8Array(32))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function normalizeBookPassphrase(value: string) {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  if (!normalized || Array.from(normalized).length > 60) {
    throw new Error('あいことばは1〜60文字で入力してください。');
  }
  return normalized;
}

/** A deterministic namespace selector, not an authentication credential. */
export async function bookIdForPassphrase(value: string): Promise<BookId> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('このブラウザではあいことばを使えません。HTTPS接続で開いてください。');
  }
  const normalized = normalizeBookPassphrase(value);
  const input = new TextEncoder().encode(`kids-voice-encyclopedia:book:v1\u0000${normalized}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
