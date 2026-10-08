import { initializeApp } from 'firebase/app';
import { indexedDBLocalPersistence, initializeAuth, signInAnonymously } from 'firebase/auth';
import { collection, doc, getFirestore, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref } from 'firebase/storage';
import { firebaseConfig, isFirebaseConfigured } from '../firebaseConfig';
import { storageFailureMessage } from './storageDiagnostics';
import { createKeepsakeRepository, FirebaseTimeoutError, type Keepsake } from './keepsakeRepository';
import { createKeepsakeEditor } from './keepsakeEditor';
import { createUnusedMediaService } from './unusedMedia';
import { configureShareRepository, syncLiveShareProjections } from './shareRepository';
export type { Keepsake } from './keepsakeRepository';
import { categoryIdForName, DEFAULT_CATEGORIES, keepsakeMetadata, validateCategoryId, validateCategoryName, type Category } from './categories';
import { DEFAULT_GALLERY_SETTINGS, normalizeGallerySettings, type GallerySettings } from './gallerySettings';

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
const auth = app ? initializeAuth(app, { persistence: indexedDBLocalPersistence }) : null;
const db = app ? getFirestore(app) : null;
// GCSで作成した指定バケットを明示。写真・音声のアップロード、URL取得、
// 削除はすべてこのStorageインスタンスからrefを作成する。
const storage = app ? getStorage(app, `gs://${firebaseConfig.storageBucket}`) : null;
if (storage) {
  storage.maxOperationRetryTime = 25_000;
  storage.maxUploadRetryTime = 25_000;
}
let ready: Promise<string> | null = null;

function deadline<T>(operation: Promise<T>, milliseconds = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new FirebaseTimeoutError('Firebase の応答がありません。処理が後から完了する場合があります。再接続後に一覧を確認してからもう一度お試しください。')), milliseconds);
    operation.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

async function userId(): Promise<string> {
  if (!auth) throw new Error('Firebase が未設定です。src/firebaseConfig.ts の設定とセットアップ手順を確認してください。');
  if (!ready) {
    ready = (async () => {
      await auth.authStateReady();
      return auth.currentUser?.uid ?? (await signInAnonymously(auth)).user.uid;
    })().catch((error: unknown) => { ready = null; throw error; });
  }
  return deadline(ready, 20_000);
}

if (db && storage) configureShareRepository(db, storage, userId);

const repository = createKeepsakeRepository(db!, storage!, userId);
export const { saveKeepsake, deleteKeepsake } = repository;
export const { editKeepsake } = createKeepsakeEditor(db!, storage!, userId);
export { getOrCreateLiveShare, listPasswordShares, openPasswordShare, revokePasswordShare, subscribeLiveShare } from './shareRepository';

let latestItems: Keepsake[] | null = null;
let latestCategories: Category[] | null = null;
let latestGallerySettings: GallerySettings | null = null;
let shareSyncTimer: number | undefined;
let shareSyncQueue: Promise<void> = Promise.resolve();
let lastSuccessfulShareSync: string | null = null;
function scheduleLiveShareSync() {
  if (!latestItems || !latestCategories || !latestGallerySettings || !db || !storage || shareSyncTimer !== undefined) return;
  shareSyncTimer = window.setTimeout(() => {
    shareSyncTimer = undefined;
    const items = latestItems;
    const categories = latestCategories;
    const settings = latestGallerySettings;
    if (!items || !categories || !settings) return;
    const signature = JSON.stringify([items, categories, settings]);
    shareSyncQueue = shareSyncQueue
      .then(async () => {
        if (signature === lastSuccessfulShareSync) return;
        await syncLiveShareProjections(items, categories, settings);
        lastSuccessfulShareSync = signature;
      })
      .catch(() => { /* Keep owner editing available if a share projection sync is temporarily unavailable. */ });
  }, 200);
}

export async function subscribeKeepsakes(
  onChange: (items: Keepsake[]) => void,
  onError: (error: unknown) => void,
) {
  return repository.subscribeKeepsakes((items) => {
    latestItems = items;
    scheduleLiveShareSync();
    onChange(items);
  }, onError);
}
/** Read-only link refresh for saved voices; never access another user's paths. */
export async function refreshVoiceDownloadUrl(path: string): Promise<string> {
  const uid = await userId();
  if (!storage || !path.startsWith(`users/${uid}/keepsakes/`) || path.includes('..')) {
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
  return cleanupService ??= createUnusedMediaService(db!, storage!, userId);
}

/** カテゴリも匿名認証UID配下で分離。既定のページはクラウド書き込み不要。 */
export async function subscribeCategories(
  onChange: (categories: Category[]) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  const uid = await userId();
  return onSnapshot(query(collection(db!, 'users', uid, 'categories'), orderBy('createdAt', 'asc')), (snapshot) => {
    const next = [
      ...DEFAULT_CATEGORIES,
      ...snapshot.docs.map((record) => ({
        id: record.id, name: String(record.data().name),
        createdAt: record.data().createdAt?.toMillis?.() ?? 0,
      })),
    ];
    latestCategories = next;
    scheduleLiveShareSync();
    onChange(next);
  }, onError);
}

export async function subscribeGallerySettings(
  onChange: (settings: GallerySettings) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  const uid = await userId();
  return onSnapshot(doc(db!, 'users', uid, 'settings', 'gallery'), (snapshot) => {
    const settings = normalizeGallerySettings(snapshot.exists() ? snapshot.data() : DEFAULT_GALLERY_SETTINGS);
    latestGallerySettings = settings;
    scheduleLiveShareSync();
    onChange(settings);
  }, onError);
}

export async function saveGallerySettings(value: GallerySettings): Promise<void> {
  const uid = await userId();
  const settings = normalizeGallerySettings(value);
  await deadline(setDoc(doc(db!, 'users', uid, 'settings', 'gallery'), {
    ...settings,
    updatedAt: serverTimestamp(),
  }));
  latestGallerySettings = settings;
  scheduleLiveShareSync();
}

export async function createCategory(name: string): Promise<Category> {
  const clean = validateCategoryName(name);
  const id = await categoryIdForName(clean);
  const uid = await userId();
  const record = doc(db!, 'users', uid, 'categories', id);
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
  const uid = await userId();
  await deadline(updateDoc(doc(db!, 'users', uid, 'keepsakes', id), patch));
}

/** A category-only change must not overwrite a name edited in another session. */
export async function updateKeepsakeCategory(id: string, categoryId: string | null): Promise<void> {
  validateCategoryId(categoryId);
  const uid = await userId();
  await deadline(updateDoc(doc(db!, 'users', uid, 'keepsakes', id), { categoryId }));
}

export function firebaseError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  const storageMessage = storageFailureMessage(error, firebaseConfig.storageBucket!);
  if (storageMessage) return storageMessage;
  if (code.includes('configuration-not-found')) return 'Firebase Authentication が未設定です。Firebase ConsoleでAuthenticationの「始める」を押し、ログイン方法の「匿名」を有効にしてから再接続してください。';
  if (code.includes('permission-denied') || code.includes('unauthorized')) return 'Firebase のアクセス権限がありません。Firestore / Storage のルールとBlazeプランをご確認ください。';
  if (code.includes('operation-not-allowed')) return 'Firebase Authentication の匿名ログインを有効にしてください。';
  if (code.includes('network') || code.includes('unavailable') || code.includes('retry-limit')) return 'Firebase に接続できませんでした。通信を確認してもう一度お試しください。';
  return error instanceof Error ? error.message : 'Firebase の処理に失敗しました。設定と通信をご確認ください。';
}
