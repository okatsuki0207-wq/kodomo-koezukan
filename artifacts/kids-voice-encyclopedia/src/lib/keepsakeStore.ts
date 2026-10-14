import { initializeApp } from 'firebase/app';
import { collection, deleteField, doc, getFirestore, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref } from 'firebase/storage';
import { firebaseConfig, isFirebaseConfigured } from '../firebaseConfig';
import { storageFailureMessage } from './storageDiagnostics';
import { createKeepsakeRepository, FirebaseTimeoutError, type Keepsake } from './keepsakeRepository';
import { createKeepsakeEditor } from './keepsakeEditor';
import { createUnusedMediaService } from './unusedMedia';
import { activateBookForPassphrase, configureBookRepository, getOwnerBookContext, hasActivePassphraseBook } from './bookRepository';
export type { Keepsake } from './keepsakeRepository';
import { categoryIdForName, DEFAULT_CATEGORIES, keepsakeMetadata, validateCategoryId, validateCategoryName, type Category } from './categories';
import { DEFAULT_GALLERY_SETTINGS, normalizeGallerySettings, type GallerySettings } from './gallerySettings';

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
const db = app ? getFirestore(app) : null;
// GCSで作成した指定バケットを明示。写真・音声のアップロード、URL取得、
// 削除はすべてこのStorageインスタンスからrefを作成する。
const storage = app ? getStorage(app, `gs://${firebaseConfig.storageBucket}`) : null;
if (storage) {
  storage.maxOperationRetryTime = 25_000;
  storage.maxUploadRetryTime = 25_000;
}
const PUBLIC_OWNER_ID = 'public';
const currentBookId = async () => (await getOwnerBookContext()).bookId;

function deadline<T>(operation: Promise<T>, milliseconds = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new FirebaseTimeoutError('Firebase の応答がありません。処理が後から完了する場合があります。再接続後に一覧を確認してからもう一度お試しください。')), milliseconds);
    operation.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

async function userId(): Promise<string> {
  if (!db) throw new Error('Firebase が未設定です。src/firebaseConfig.ts の設定を確認してください。');
  // All origins use the same public namespace; no browser identity or login is involved.
  return PUBLIC_OWNER_ID;
}

if (db) configureBookRepository(db, userId);

export { activateBookForPassphrase, hasActivePassphraseBook };

const repository = createKeepsakeRepository(db!, storage!, userId, currentBookId);
export const { saveKeepsake, deleteKeepsake } = repository;
export const { editKeepsake } = createKeepsakeEditor(db!, storage!, userId, currentBookId);

export async function subscribeKeepsakes(
  onChange: (items: Keepsake[]) => void,
  onError: (error: unknown) => void,
) {
  return repository.subscribeKeepsakes(onChange, onError);
}
/** Refresh media URLs from the shared app namespace, including imported old records. */
export async function refreshVoiceDownloadUrl(path: string): Promise<string> {
  await userId();
  const parts = path.split('/');
  const validAppVoicePath = parts.length >= 5 && parts[0] === 'users' &&
    parts[1] !== '' && parts[2] === 'keepsakes' && parts[3] !== '' &&
    parts.at(-1) === 'voice' && parts.every((part) => part !== '' && part !== '.' && part !== '..');
  if (!storage || !validAppVoicePath) {
    throw new Error('保存済み音声の参照先を確認できません。元の音声は変更していません。');
  }
  return deadline(getDownloadURL(ref(storage, path)), 20_000);
}
// Deferred construction avoids touching an unconfigured Storage instance at module load.
export async function inspectUnusedMedia() {
  await userId();
  return unusedMedia().inspectUnusedMedia();
}
export async function deleteUnusedMedia(path: string, confirmed: boolean) {
  await userId();
  return unusedMedia().deleteUnusedMedia(path, confirmed);
}
let cleanupService: ReturnType<typeof createUnusedMediaService> | undefined;
function unusedMedia() {
  return cleanupService ??= createUnusedMediaService(db!, storage!, userId, {}, currentBookId);
}

/** カテゴリも正本図鑑ID配下で分離。既定のページはクラウド書き込み不要。 */
export async function subscribeCategories(
  onChange: (categories: Category[]) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  const { bookId } = await getOwnerBookContext();
  return onSnapshot(query(collection(db!, 'books', bookId, 'categories'), orderBy('createdAt', 'asc')), (snapshot) => {
    const next = [
      ...DEFAULT_CATEGORIES,
      ...snapshot.docs.map((record) => ({
        id: record.id, name: String(record.data().name),
        createdAt: record.data().createdAt?.toMillis?.() ?? 0,
      })),
    ];
    onChange(next);
  }, onError);
}

export async function subscribeGallerySettings(
  onChange: (settings: GallerySettings) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  const { bookId } = await getOwnerBookContext();
  return onSnapshot(doc(db!, 'books', bookId, 'settings', 'gallery'), (snapshot) => {
    const settings = normalizeGallerySettings(snapshot.exists() ? snapshot.data() : DEFAULT_GALLERY_SETTINGS);
    onChange(settings);
  }, onError);
}

export async function saveGallerySettings(value: GallerySettings): Promise<void> {
  const { bookId } = await getOwnerBookContext();
  const settings = normalizeGallerySettings(value);
  await deadline(setDoc(doc(db!, 'books', bookId, 'settings', 'gallery'), {
    ...settings,
    updatedAt: serverTimestamp(),
  }));
}

export async function createCategory(name: string): Promise<Category> {
  const clean = validateCategoryName(name);
  const id = await categoryIdForName(clean);
  const { bookId } = await getOwnerBookContext();
  const record = doc(db!, 'books', bookId, 'categories', id);
  return deadline(runTransaction(db!, async (transaction) => {
    const existing = await transaction.get(record);
    if (existing.exists()) return { id, name: String(existing.data().name) };
    transaction.set(record, { name: clean, createdAt: serverTimestamp() });
    return { id, name: clean };
  }));
}

/** 分類・名前だけの編集。ファイルの再アップロード・置換・削除は行わない。 */
export async function updateKeepsakeMetadata(id: string, itemName: string, categoryId: string | null): Promise<void> {
  const patch = keepsakeMetadata(itemName, categoryId);
  const { bookId } = await getOwnerBookContext();
  await deadline(updateDoc(doc(db!, 'books', bookId, 'cards', id), patch));
}

/** A category-only change must not overwrite a name edited in another session. */
export async function updateKeepsakeCategory(id: string, categoryId: string | null): Promise<void> {
  validateCategoryId(categoryId);
  const { bookId } = await getOwnerBookContext();
  await deadline(updateDoc(doc(db!, 'books', bookId, 'cards', id), { categoryId }));
}

/** Archive and restore only update card metadata; media files remain untouched. */
export async function setKeepsakeArchived(id: string, archived: boolean): Promise<void> {
  const { bookId } = await getOwnerBookContext();
  await deadline(updateDoc(doc(db!, 'books', bookId, 'cards', id), archived
    ? { archived: true, archivedAt: serverTimestamp() }
    : { archived: false, archivedAt: deleteField() }));
}

export function firebaseError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  const storageMessage = storageFailureMessage(error, firebaseConfig.storageBucket!);
  if (storageMessage) return storageMessage;
  if (code.includes('permission-denied') || code.includes('unauthorized')) return 'Firebaseへのアクセスが拒否されました。Firestore・Storageの公開ルールをFirebase Consoleに反映したか確認してください。';
  if (code.includes('network') || code.includes('unavailable') || code.includes('retry-limit')) return 'Firebase に接続できませんでした。通信を確認してもう一度お試しください。';
  return error instanceof Error ? error.message : 'Firebase の処理に失敗しました。設定と通信をご確認ください。';
}
