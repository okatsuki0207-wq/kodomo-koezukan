import type { Keepsake } from './keepsakeRepository.ts';
import type { Category } from './categories.ts';
import type { GallerySettings } from './gallerySettings.ts';
import { DEFAULT_CATEGORIES } from './categories.ts';
import { DEFAULT_GALLERY_SETTINGS, normalizeGallerySettings } from './gallerySettings.ts';
import { getVoices } from './voiceAssets.ts';

type StoredVoice = { id: string; blob: Blob };
type StoredKeepsake = Omit<Keepsake, 'photo' | 'voice' | 'voices' | 'photoBlob' | 'voiceBlob'> & {
  photoBlob: Blob;
  voices: Array<{ id: string; blob: Blob; path?: string | null }>;
};
const DB_NAME = 'kids-voice-encyclopedia-local';
const DB_VERSION = 3;
const URLS = new Map<string, string>();
const listeners = new Set<(items: Keepsake[]) => void>();
let opening: Promise<IDBDatabase> | null = null;

function db() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('このブラウザでは端末内保存を利用できません。'));
  if (!opening) {
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      let settled = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('cards')) database.createObjectStore('cards', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('categories')) database.createObjectStore('categories', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings');
        if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
        if (!database.objectStoreNames.contains('drafts')) database.createObjectStore('drafts');
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          if (opening === pending) opening = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        settled = true;
        reject(request.error ?? new Error('端末内データを開けませんでした。'));
      };
      request.onblocked = () => {
        settled = true;
        reject(new Error('別の画面がデータベースを使用中です。ほかのアプリ画面を閉じて再試行してください。'));
      };
    });
    opening = pending;
    void pending.catch(() => { if (opening === pending) opening = null; });
  }
  return opening;
}

function isConnectionClosingError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'InvalidStateError';
}

async function request<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  try {
    return await requestOnce<T>(storeName, mode, run);
  } catch (error) {
    if (!isConnectionClosingError(error)) throw error;
    // The cached connection was closed (e.g. by a versionchange in another tab).
    // Discard it, reopen once, and retry.
    opening = null;
    return requestOnce<T>(storeName, mode, run);
  }
}

async function requestOnce<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    let resultValue: T;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('端末内データを保存できませんでした。'));
    };
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(resultValue);
    };
    transaction.onerror = () => fail(transaction.error ?? new Error('端末内データの保存に失敗しました。'));
    transaction.onabort = () => fail(transaction.error ?? new Error('端末内データの保存を完了できませんでした。'));
    try {
      const result = run(transaction.objectStore(storeName));
      result.onsuccess = () => { resultValue = result.result; };
      result.onerror = () => fail(result.error ?? new Error('端末内データを保存できませんでした。'));
    } catch (error) {
      fail(error);
    }
  });
}

// Media URLs are generation-scoped per card. Rewriting a card bumps its
// generation so present() hands out fresh URLs, while URLs from older
// generations are revoked only after a delay. Revoking a URL the moment a
// card is saved can strand a mounted <img> on a dead URL — on iOS Safari the
// photo then stays blank until the app is reopened, even though the stored
// data is intact.
const GENERATIONS = new Map<string, number>();
const REVOKE_DELAY_MS = 30_000;

function generationOf(id: string) {
  return GENERATIONS.get(id) ?? 0;
}
function objectUrl(id: string, part: string, blob: Blob) {
  const key = `${id}:${part}@${generationOf(id)}`;
  const previous = URLS.get(key);
  if (previous) return previous;
  const created = URL.createObjectURL(blob);
  URLS.set(key, created);
  return created;
}
function advanceMediaGeneration(id: string) {
  const next = generationOf(id) + 1;
  GENERATIONS.set(id, next);
  const stale: Array<readonly [string, string]> = [];
  for (const [key, url] of URLS) {
    if (key.startsWith(`${id}:`) && !key.endsWith(`@${next}`)) stale.push([key, url] as const);
  }
  if (!stale.length) return;
  setTimeout(() => {
    for (const [key, url] of stale) {
      if (URLS.get(key) === url) {
        URL.revokeObjectURL(url);
        URLS.delete(key);
      }
    }
  }, REVOKE_DELAY_MS);
}
function present(value: StoredKeepsake): Keepsake {
  const voices = value.voices.map((voice) => ({
    id: voice.id,
    url: objectUrl(value.id, `voice:${voice.id}`, voice.blob),
    blob: voice.blob,
    path: voice.path ?? null,
  }));
  return {
    ...value,
    photo: objectUrl(value.id, 'photo', value.photoBlob),
    photoBlob: value.photoBlob,
    voice: voices[0]?.url ?? null,
    voiceBlob: voices[0]?.blob,
    voices,
  } as Keepsake;
}
async function allStored(): Promise<StoredKeepsake[]> {
  return request('cards', 'readonly', (store) => store.getAll());
}
export async function listKeepsakes(): Promise<Keepsake[]> {
  return (await allStored()).map(present).sort((a, b) => b.createdAt - a.createdAt);
}
async function publish() {
  const cards = await listKeepsakes();
  listeners.forEach((listener) => listener(cards));
}
async function asBlob(source: string | Blob, expected: 'image' | 'audio') {
  const blob = source instanceof Blob ? source : await fetch(source).then((response) => {
    if (!response.ok) throw new Error('メディアを読み込めませんでした。');
    return response.blob();
  });
  if (!blob.size || blob.size >= 20 * 1024 * 1024 || !blob.type.startsWith(`${expected}/`)) {
    throw new Error(`空でない20MB未満の${expected === 'image' ? '画像' : '音声'}を選んでください。`);
  }
  return blob;
}
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return request('meta', 'readonly', (store) => store.get(key));
}
export async function setMeta(key: string, value: unknown) {
  await request('meta', 'readwrite', (store) => store.put(value, key));
}
export async function replaceImportedData(cards: Keepsake[], categories: Category[], settings: GallerySettings) {
  try {
    await replaceImportedDataOnce(cards, categories, settings);
  } catch (error) {
    if (!isConnectionClosingError(error)) throw error;
    opening = null;
    await replaceImportedDataOnce(cards, categories, settings);
  }
}

export type ImportMergeResult = { addedCards: number; skippedCards: number; addedCategories: number };

export async function mergeImportedData(cards: Keepsake[], categories: Category[]): Promise<ImportMergeResult> {
  try {
    return await mergeImportedDataOnce(cards, categories);
  } catch (error) {
    if (!isConnectionClosingError(error)) throw error;
    opening = null;
    return await mergeImportedDataOnce(cards, categories);
  }
}

async function mergeImportedDataOnce(cards: Keepsake[], categories: Category[]): Promise<ImportMergeResult> {
  const database = await db();
  const existingCards = await allStored();
  const existingCardIds = new Set(existingCards.map((card) => card.id));
  const storedCategories = await request<Category[]>('categories', 'readonly', (store) => store.getAll());
  const existingCategoryIds = new Set(storedCategories.map((category) => category.id));
  const newCards = cards.filter((card) => !existingCardIds.has(card.id));
  const newCategories = categories.filter((category) =>
    !DEFAULT_CATEGORIES.some((defaultCategory) => defaultCategory.id === category.id) &&
    !existingCategoryIds.has(category.id));
  if (!newCards.length && !newCategories.length) {
    return { addedCards: 0, skippedCards: cards.length, addedCategories: 0 };
  }
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['cards', 'categories'], 'readwrite');
    const cardStore = tx.objectStore('cards');
    for (const item of newCards) {
      const sourceVoices = getVoices(item);
      const record: StoredKeepsake = {
        id: item.id, itemName: item.itemName, photoBlob: item.photoBlob!,
        createdAt: item.createdAt, photoPath: item.photoPath,
        categoryId: item.categoryId, memo: item.memo ?? '', archived: item.archived, archivedAt: item.archivedAt,
        voices: sourceVoices.map((voice) => ({ id: voice.id, blob: (voice as typeof voice & { blob?: Blob }).blob!, path: voice.path })),
      };
      cardStore.put(record);
    }
    const categoryStore = tx.objectStore('categories');
    for (const category of newCategories) categoryStore.put(category);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('バックアップの追加に失敗しました。'));
  });
  await publish();
  return { addedCards: newCards.length, skippedCards: cards.length - newCards.length, addedCategories: newCategories.length };
}

async function replaceImportedDataOnce(cards: Keepsake[], categories: Category[], settings: GallerySettings) {
  const database = await db();
  const existingCards = await allStored();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['cards', 'categories', 'settings', 'meta'], 'readwrite');
    const cardStore = tx.objectStore('cards');
    cardStore.clear();
    const categoryStore = tx.objectStore('categories');
    categoryStore.clear();
    for (const item of cards) {
      const sourceVoices = getVoices(item);
      const record: StoredKeepsake = {
        id: item.id, itemName: item.itemName, photoBlob: item.photoBlob!,
        createdAt: item.createdAt, photoPath: item.photoPath,
        categoryId: item.categoryId, memo: item.memo ?? '', archived: item.archived, archivedAt: item.archivedAt,
        voices: sourceVoices.map((voice) => ({ id: voice.id, blob: (voice as typeof voice & { blob?: Blob }).blob! , path: voice.path })),
      };
      cardStore.put(record);
    }
    categories.filter((category) => !DEFAULT_CATEGORIES.some((defaultCategory) => defaultCategory.id === category.id))
      .forEach((category) => categoryStore.put(category));
    tx.objectStore('settings').put(normalizeGallerySettings(settings), 'gallery');
    tx.objectStore('meta').put(true, 'firebase-import-complete-v1');
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('初回データ移行に失敗しました。元のFirebaseデータは残っています。'));
  });
  existingCards.forEach((card) => advanceMediaGeneration(card.id));
  await publish();
}
export async function subscribe(onChange: (items: Keepsake[]) => void, onError: (error: unknown) => void) {
  listeners.add(onChange);
  try { await publish(); } catch (error) { onError(error); }
  return () => listeners.delete(onChange);
}
export async function save(item: Keepsake) {
  const photoBlob = await asBlob(item.photoBlob ?? item.photo, 'image');
  const voices = getVoices(item);
  const storedVoices: StoredVoice[] = [];
  for (const voice of voices) storedVoices.push({
    id: voice.id,
    blob: await asBlob((voice as typeof voice & { blob?: Blob }).blob ?? voice.url, 'audio'),
  });
  const record: StoredKeepsake = {
    id: item.id, itemName: item.itemName, photoBlob, createdAt: item.createdAt || Date.now(),
    categoryId: item.categoryId, memo: item.memo ?? '', archived: item.archived, archivedAt: item.archivedAt,
    voices: storedVoices,
  };
  await request('cards', 'readwrite', (store) => store.put(record));
  advanceMediaGeneration(item.id);
  await publish();
}
export async function edit(base: Keepsake, changes: { itemName?: string; categoryId?: string | null; memo?: string; photo?: string; voices?: Array<{id:string;source:string}> }) {
  const current = (await allStored()).find((item) => item.id === base.id);
  if (!current) throw new Error('このキロクが見つかりません。');
  const voices = current.voices.slice();
  for (const change of changes.voices ?? []) {
    const blob = await asBlob(change.source, 'audio');
    const index = voices.findIndex((voice) => voice.id === change.id);
    if (index < 0) voices.push({ id: change.id, blob });
    else voices[index] = { ...voices[index], blob };
  }
  const next: StoredKeepsake = {
    ...current,
    ...(changes.itemName !== undefined ? { itemName: changes.itemName.trim() } : {}),
    ...(changes.categoryId !== undefined ? { categoryId: changes.categoryId } : {}),
    ...(changes.memo !== undefined ? { memo: changes.memo } : {}),
    ...(changes.photo !== undefined ? { photoBlob: await asBlob(changes.photo, 'image') } : {}),
    voices,
  };
  await request('cards', 'readwrite', (store) => store.put(next));
  advanceMediaGeneration(base.id);
  await publish();
  return present(next);
}
export async function remove(item: Keepsake) {
  await request('cards', 'readwrite', (store) => store.delete(item.id));
  advanceMediaGeneration(item.id);
  await publish();
}
export async function patchCard(id: string, patch: Partial<Keepsake>) {
  const current = (await allStored()).find((item) => item.id === id);
  if (!current) throw new Error('このキロクが見つかりません。');
  const next = { ...current, ...patch };
  await request('cards', 'readwrite', (store) => store.put(next));
  await publish();
}
export async function listCategories() {
  const extra = await request<Category[]>('categories', 'readonly', (store) => store.getAll());
  return [...DEFAULT_CATEGORIES, ...extra];
}
export async function addCategory(category: Category) {
  await request('categories', 'readwrite', (store) => store.put(category));
}
export async function listSettings() {
  return normalizeGallerySettings((await request<GallerySettings | undefined>('settings', 'readonly', (store) => store.get('gallery'))) ?? DEFAULT_GALLERY_SETTINGS);
}
export async function saveSettings(settings: GallerySettings) {
  await request('settings', 'readwrite', (store) => store.put(normalizeGallerySettings(settings), 'gallery'));
}
