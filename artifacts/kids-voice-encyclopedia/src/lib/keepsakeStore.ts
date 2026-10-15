import { initializeApp } from 'firebase/app';
import { collection, doc, getDocFromServer, getDocsFromServer, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { firebaseConfig, isFirebaseConfigured } from '../firebaseConfig';
import { configureBookRepository, getOwnerBookContext } from './bookRepository';
import type { Keepsake } from './keepsakeRepository';
import { getVoices, keepsakeFromData } from './voiceAssets';
import { DEFAULT_CATEGORIES, categoryIdForName, keepsakeMetadata, validateCategoryId, validateCategoryName, type Category } from './categories';
import { DEFAULT_GALLERY_SETTINGS, normalizeGallerySettings, type GallerySettings } from './gallerySettings';
import * as local from './localKeepsakeDb';

export type { Keepsake } from './keepsakeRepository';
const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
const db = app ? getFirestore(app) : null;
const storage = app ? getStorage(app, `gs://${firebaseConfig.storageBucket}`) : null;
const PUBLIC_OWNER_ID = 'public';
if (db) configureBookRepository(db, async () => PUBLIC_OWNER_ID);
let migration: Promise<void> | null = null;

async function downloadBlob(url: string, kind: 'image' | 'audio') {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`初回取り込みでFirebase Storageの${kind === 'image' ? '写真' : '音声'}を読み込めませんでした。StorageバケットのCORS設定を確認してください。元のデータは変更していません。`);
  }
  if (!response.ok) throw new Error(`Firebaseから${kind === 'image' ? '写真' : '音声'}を取得できませんでした。`);
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith(`${kind}/`)) throw new Error('Firebaseの保存データを確認できません。元のデータは変更していません。');
  return blob;
}

async function ensureLocalData(): Promise<void> {
  if (await local.getMeta<boolean>('firebase-import-complete-v1')) return;
  if (!db || !storage) {
    throw new Error('初回データ取り込みの設定がありません。Firebaseの設定を確認してください。端末内データは変更していません。');
  }
  if (!migration) migration = (async () => {
    const { bookId } = await getOwnerBookContext();
    const [cardSnapshot, categorySnapshot, settingsSnapshot] = await Promise.all([
      getDocsFromServer(collection(db, 'books', bookId, 'cards')),
      getDocsFromServer(collection(db, 'books', bookId, 'categories')),
      getDocFromServer(doc(db, 'books', bookId, 'settings', 'gallery')),
    ]);
    const cards: Keepsake[] = await Promise.all(cardSnapshot.docs.map(async (record) => {
      const item = keepsakeFromData(record.id, record.data());
      item.photoBlob = await downloadBlob(item.photo, 'image');
      const voices = await Promise.all(getVoices(item).map(async (voice) => ({
        ...voice,
        blob: await downloadBlob(voice.url, 'audio'),
      })));
      item.voices = voices;
      item.voiceBlob = voices[0]?.blob;
      return item;
    }));
    const categories: Category[] = [
      ...DEFAULT_CATEGORIES,
      ...categorySnapshot.docs.map((record) => ({
        id: record.id,
        name: String(record.data().name ?? ''),
        createdAt: record.data().createdAt?.toMillis?.() ?? 0,
      })),
    ];
    const settings = normalizeGallerySettings(settingsSnapshot.exists() ? settingsSnapshot.data() : DEFAULT_GALLERY_SETTINGS);
    await local.replaceImportedData(cards, categories, settings);
  })().catch((error) => {
    migration = null;
    throw error;
  });
  await migration;
}

export async function subscribeKeepsakes(onChange: (items: Keepsake[]) => void, onError: (error: unknown) => void) {
  await ensureLocalData();
  return local.subscribe(onChange, onError);
}
export async function saveKeepsake(item: Keepsake) { await ensureLocalData(); await local.save(item); }
export async function deleteKeepsake(item: Keepsake) { await ensureLocalData(); await local.remove(item); }
export async function editKeepsake(base: Keepsake, changes: Parameters<typeof local.edit>[1], _editId: string) {
  await ensureLocalData();
  return local.edit(base, changes);
}
export async function updateKeepsakeMetadata(id: string, itemName: string, categoryId: string | null) {
  await ensureLocalData();
  const metadata = keepsakeMetadata(itemName, categoryId);
  const items = await local.listKeepsakes();
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error('このキロクが見つかりません。');
  await local.edit(item, { itemName: metadata.itemName, categoryId });
}
export async function updateKeepsakeCategory(id: string, categoryId: string | null) {
  await ensureLocalData(); validateCategoryId(categoryId); await local.patchCard(id, { categoryId });
}
export async function setKeepsakeArchived(id: string, archived: boolean) {
  await ensureLocalData();
  await local.patchCard(id, { archived, archivedAt: archived ? Date.now() : null });
}
export async function subscribeCategories(onChange: (categories: Category[]) => void, onError: (error: unknown) => void) {
  try { await ensureLocalData(); onChange(await local.listCategories()); return () => {}; } catch (error) { onError(error); return () => {}; }
}
export async function createCategory(name: string) {
  await ensureLocalData();
  const clean = validateCategoryName(name);
  const id = await categoryIdForName(clean);
  const category = { id, name: clean, createdAt: Date.now() };
  await local.addCategory(category);
  return category;
}
export async function subscribeGallerySettings(onChange: (settings: GallerySettings) => void, onError: (error: unknown) => void) {
  try { await ensureLocalData(); onChange(await local.listSettings()); return () => {}; } catch (error) { onError(error); return () => {}; }
}
export async function saveGallerySettings(value: GallerySettings) {
  await ensureLocalData(); await local.saveSettings(normalizeGallerySettings(value));
}
export async function refreshVoiceDownloadUrl(_path: string): Promise<string> {
  throw new Error('音声は端末内に保存されています。編集画面を開き直してください。');
}
export async function inspectUnusedMedia(): Promise<never> { throw new Error('端末内保存では未使用のクラウドファイル整理は利用できません。'); }
export async function deleteUnusedMedia(_path: string, _confirmed: boolean): Promise<never> { throw new Error('端末内保存ではクラウドファイル削除は利用できません。'); }
export function firebaseError(error: unknown) { return error instanceof Error ? error.message : '端末内の保存処理に失敗しました。'; }
