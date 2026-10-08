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

/** Reads already-issued #share= links and maps their live share ID to the canonical book ID. */
export function decodeLegacyShareId(token: string): BookId | null {
  try {
    if (!token || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const base64 = token.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as {
      ownerUid?: unknown;
      shareId?: unknown;
    };
    return typeof payload.ownerUid === 'string' && payload.ownerUid.length > 0 && isBookId(payload.shareId)
      ? payload.shareId
      : null;
  } catch {
    return null;
  }
}

export function createBookUrl(bookId: BookId, currentHref: string): string {
  if (!isBookId(bookId)) throw new Error('図鑑IDを確認できません。');
  const url = new URL(currentHref);
  const basePath = url.pathname.replace(/\/+$/u, '');
  url.pathname = `${basePath}/view/${bookId}`.replace(/\/{2,}/gu, '/');
  url.hash = '';
  return url.toString();
}
