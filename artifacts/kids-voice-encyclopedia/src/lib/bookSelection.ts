import { isBookId, type BookId } from './bookIdentity.ts';

export const ACTIVE_BOOK_ID_STORAGE_KEY = 'kids-voice-encyclopedia:active-book-id';

export type BookIdStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): BookIdStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getActiveBookId(storage: BookIdStorage | null = browserStorage()): BookId | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(ACTIVE_BOOK_ID_STORAGE_KEY);
    return isBookId(value) ? value : null;
  } catch {
    return null;
  }
}

/** Only the derived book ID is persisted; the typed passphrase itself is not stored. */
export function storeActiveBookId(bookId: BookId, storage: BookIdStorage | null = browserStorage()) {
  if (!isBookId(bookId)) throw new Error('図鑑IDを確認できません。');
  if (!storage) throw new Error('この端末に図鑑の選択を保存できません。ブラウザの保存設定を確認してください。');
  try {
    storage.setItem(ACTIVE_BOOK_ID_STORAGE_KEY, bookId);
  } catch {
    throw new Error('この端末に図鑑の選択を保存できません。ブラウザの保存設定を確認してください。');
  }
}
