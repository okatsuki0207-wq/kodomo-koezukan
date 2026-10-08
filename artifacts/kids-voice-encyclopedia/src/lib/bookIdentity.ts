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
