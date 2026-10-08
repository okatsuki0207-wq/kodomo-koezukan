import {
  collection, deleteDoc, doc, getDocFromServer, getDocsFromServer,
  onSnapshot, orderBy, query, runTransaction, serverTimestamp, updateDoc,
  writeBatch, type Firestore,
} from 'firebase/firestore';
import {
  deleteObject, getBytes, listAll, ref,
  type FirebaseStorage, type StorageReference,
} from 'firebase/storage';
import type { Category } from './categories.ts';
import type { Keepsake } from './keepsakeRepository.ts';
import { getVoices } from './voiceAssets.ts';
import { DEFAULT_GALLERY_SETTINGS, normalizeGallerySettings, type GallerySettings } from './gallerySettings.ts';
import {
  createShareId, decryptShareBytes, decryptShareManifest, deriveShareKey,
  fromBase64, SHARE_KDF, SHARE_KDF_ITERATIONS, validateSharePasswordForUnlock,
} from './shareCrypto.ts';

export const MAX_SHARE_MEDIA_BYTES = 200 * 1024 * 1024;
const MAX_SHARE_CARDS = 250;
const MAX_SHARE_FILE_BYTES = 20 * 1024 * 1024 - 32;
const MAX_SHARED_FILES = MAX_SHARE_CARDS * 6;
const SHARE_FORMAT_VERSION = 1;

export type ShareId = { ownerUid: string; shareId: string };
export type ShareOperationStage = 'lookup' | 'create' | 'projection';
export class ShareOperationError extends Error {
  readonly stage: ShareOperationStage;
  readonly originalError: unknown;

  constructor(
    stage: ShareOperationStage,
    originalError: unknown,
  ) {
    super('共有リンクの処理に失敗しました。');
    this.name = 'ShareOperationError';
    this.stage = stage;
    this.originalError = originalError;
  }
}
export type ShareSummary = {
  ownerUid: string;
  shareId: string;
  active: boolean;
  createdAt: number;
  mode: 'live' | 'encrypted';
};
type AssetDescriptor = { id: string; path: string; iv: string; mimeType: string; size: number };
type EncryptedManifest = {
  version: 1;
  categories: Category[];
  cards: Array<{
    id: string;
    itemName: string;
    categoryId: string | null;
    createdAt: number;
    photo: AssetDescriptor;
    voices: AssetDescriptor[];
  }>;
};
type ShareDocument = {
  active: boolean;
  version: number;
  mode?: string;
  kdf: string;
  iterations: number;
  salt: string;
  manifestIv: string;
  manifest: string;
  createdAt?: { toMillis?: () => number } | number;
};

function collectionPath(uid: string) {
  return collection(database!, 'users', uid, 'shares');
}

let database: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;
let getUid: (() => Promise<string>) | null = null;

export function configureShareRepository(
  db: Firestore,
  storage: FirebaseStorage,
  userId: () => Promise<string>,
) {
  database = db;
  storageInstance = storage;
  getUid = userId;
}

function services() {
  if (!database || !storageInstance || !getUid) {
    throw new Error('Firebaseの共有設定を利用できません。Firebase設定と接続を確認してください。');
  }
  return { db: database, storage: storageInstance, userId: getUid };
}

function metadataFrom(value: Record<string, unknown>): ShareDocument {
  if (
    value.version !== SHARE_FORMAT_VERSION ||
    value.kdf !== SHARE_KDF ||
    value.iterations !== SHARE_KDF_ITERATIONS ||
    value.active !== true ||
    typeof value.salt !== 'string' ||
    typeof value.manifestIv !== 'string' ||
    typeof value.manifest !== 'string' ||
    value.manifest.length > 960_000
  ) throw new Error('この共有リンクは無効か、利用を停止しています。');
  return value as ShareDocument;
}

function validateAssetDescriptor(value: unknown, ownerUid: string, shareId: string, kind: 'photo' | 'voice'): value is AssetDescriptor {
  if (!value || typeof value !== 'object') return false;
  const asset = value as Partial<AssetDescriptor>;
  return typeof asset.id === 'string' && /^[a-f0-9]{32}$/.test(asset.id)
    && asset.path === `users/${ownerUid}/shares/${shareId}/assets/${asset.id}`
    && typeof asset.iv === 'string'
    && /^[A-Za-z0-9+/]{16}$/.test(asset.iv)
    && typeof asset.mimeType === 'string'
    && asset.mimeType.length <= 128
    && typeof asset.size === 'number';
}

function validateManifest(value: unknown, token: ShareId): value is EncryptedManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<EncryptedManifest>;
  if (manifest.version !== 1 || !Array.isArray(manifest.categories) || !Array.isArray(manifest.cards)
      || manifest.cards.length > MAX_SHARE_CARDS || manifest.categories.length > 100) return false;
  if (!manifest.categories.every((category) => category && typeof category.id === 'string'
      && typeof category.name === 'string' && category.name.length <= 24)) return false;
  const categoryIds = new Set(manifest.categories.map((category) => category.id));
  let mediaBytes = 0;
  const assetIds = new Set<string>();
  const addAsset = (asset: unknown, kind: 'photo' | 'voice') => {
    if (!validateAssetDescriptor(asset, token.ownerUid, token.shareId, kind)) return false;
    if (!Number.isInteger(asset.size) || asset.size < 1 || asset.size > MAX_SHARE_FILE_BYTES) return false;
    if (kind === 'photo' ? !/^image\/(jpeg|png|webp)$/.test(asset.mimeType) : !/^audio\/[a-z0-9.+-]+$/i.test(asset.mimeType)) return false;
    if (assetIds.has(asset.id)) return false;
    assetIds.add(asset.id);
    mediaBytes += asset.size;
    return mediaBytes <= MAX_SHARE_MEDIA_BYTES;
  };
  return manifest.cards.every((card) => card && typeof card.id === 'string'
    && card.id.length <= 128 && typeof card.itemName === 'string' && card.itemName.length <= 48
    && (card.categoryId === null || (typeof card.categoryId === 'string' && categoryIds.has(card.categoryId)))
    && Number.isFinite(card.createdAt)
    && addAsset(card.photo, 'photo')
    && Array.isArray(card.voices) && card.voices.length <= 5
    && card.voices.every((asset) => addAsset(asset, 'voice')));
}

function objectUrl(bytes: Uint8Array, mimeType: string): string {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: mimeType }));
}

function shareAssetRef(storage: FirebaseStorage, path: string): StorageReference {
  return ref(storage, path);
}

type ProjectionOperation = { path: string; data?: Record<string, unknown> };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function projectionOperations(
  db: Firestore,
  uid: string,
  shareId: string,
  items: readonly Keepsake[],
  categories: readonly Category[],
  settings: GallerySettings,
  storedCards: readonly string[],
  storedCategories: readonly string[],
): ProjectionOperation[] {
  const base = `users/${uid}/shares/${shareId}`;
  const operations: ProjectionOperation[] = [];
  const cardIds = new Set(items.map((item) => item.id));
  for (const item of items) {
    operations.push({
      path: `${base}/cards/${item.id}`,
      data: {
        itemName: item.itemName,
        photo: item.photo,
        photoPath: item.photoPath ?? null,
        voice: item.voice ?? null,
        voicePath: item.voicePath ?? null,
        voices: getVoices(item).map((voice) => ({ id: voice.id, url: voice.url, path: voice.path ?? null })),
        categoryId: item.categoryId ?? null,
        createdAt: item.createdAt,
      },
    });
  }
  for (const id of storedCards) if (!cardIds.has(id)) operations.push({ path: `${base}/cards/${id}` });

  const categoryIds = new Set(categories.map((category) => category.id));
  for (const category of categories) {
    operations.push({
      path: `${base}/categories/${category.id}`,
      data: { name: category.name, createdAt: category.createdAt },
    });
  }
  for (const id of storedCategories) if (!categoryIds.has(id)) operations.push({ path: `${base}/categories/${id}` });
  const normalizedSettings = normalizeGallerySettings(settings);
  operations.push({
    path: `${base}/settings/gallery`,
    data: {
      displayMode: normalizedSettings.displayMode,
      shuffleSeed: normalizedSettings.shuffleSeed,
    },
  });
  return operations;
}

async function writeProjection(
  db: Firestore,
  uid: string,
  shareId: string,
  items: readonly Keepsake[],
  categories: readonly Category[],
  settings: GallerySettings = DEFAULT_GALLERY_SETTINGS,
): Promise<void> {
  const base = `users/${uid}/shares/${shareId}`;
  const [storedCards, storedCategories, storedSettings] = await Promise.all([
    getDocsFromServer(collection(db, base, 'cards')),
    getDocsFromServer(collection(db, base, 'categories')),
    getDocFromServer(doc(db, base, 'settings', 'gallery')),
  ]);
  const existingValues = new Map([
    ...storedCards.docs.map((record) => [record.ref.path, stableJson(record.data())] as const),
    ...storedCategories.docs.map((record) => [record.ref.path, stableJson(record.data())] as const),
  ]);
  if (storedSettings.exists()) existingValues.set(storedSettings.ref.path, stableJson(storedSettings.data()));
  const operations = projectionOperations(
    db, uid, shareId, items, categories, settings,
    storedCards.docs.map((record) => record.id),
    storedCategories.docs.map((record) => record.id),
  ).filter((operation) => !operation.data || existingValues.get(operation.path) !== stableJson(operation.data));
  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = writeBatch(db);
    for (const operation of operations.slice(offset, offset + 400)) {
      const target = doc(db, operation.path);
      if (operation.data) batch.set(target, operation.data);
      else batch.delete(target);
    }
    await batch.commit();
  }
}

export async function createLiveShare(
  items: readonly Keepsake[],
  categories: readonly Category[],
  settings: GallerySettings = DEFAULT_GALLERY_SETTINGS,
): Promise<ShareId> {
  const { db, userId } = services();
  const ownerUid = await userId();
  const shareId = createShareId();
  const shareRef = doc(db, 'users', ownerUid, 'shares', shareId);
  try {
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(shareRef);
      if (existing.exists()) throw new Error('共有リンクIDが重複しました。もう一度お試しください。');
      transaction.set(shareRef, {
        active: true,
        version: 2,
        mode: 'live',
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    throw new ShareOperationError('create', error);
  }
  try {
    await writeProjection(db, ownerUid, shareId, items, categories, settings);
    return { ownerUid, shareId };
  } catch (error) {
    // Never leave an intentionally incomplete public link active.
    await updateDoc(shareRef, { active: false }).catch(() => {});
    throw new ShareOperationError('projection', error);
  }
}

export async function syncLiveShareProjections(
  items: readonly Keepsake[],
  categories: readonly Category[],
  settings: GallerySettings = DEFAULT_GALLERY_SETTINGS,
): Promise<void> {
  const { db, userId } = services();
  const uid = await userId();
  const shares = await getDocsFromServer(collectionPath(uid));
  for (const share of shares.docs) {
    const data = share.data();
    if (data.active === true && data.version === 2 && data.mode === 'live') {
      await writeProjection(db, uid, share.id, items, categories, settings);
    }
  }
}

export async function subscribeLiveShare(
  token: ShareId,
  onChange: (book: SharedBook) => void,
  onError: (error: unknown) => void,
): Promise<(() => void) | null> {
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(token.ownerUid) || !/^[a-f0-9]{64}$/.test(token.shareId)) {
    throw new Error('共有リンクが正しくありません。');
  }
  const { db } = services();
  const shareRef = doc(db, 'users', token.ownerUid, 'shares', token.shareId);
  const share = await getDocFromServer(shareRef);
  if (!share.exists() || share.data().active !== true) throw new Error('この共有リンクは停止されたか、確認できません。');
  if (share.data().version !== 2 || share.data().mode !== 'live') return null;

  let items: Keepsake[] | null = null;
  let categories: Category[] | null = null;
  let settings: GallerySettings = normalizeGallerySettings(DEFAULT_GALLERY_SETTINGS);
  const emit = () => {
    if (items && categories) onChange({ items, categories, settings, objectUrls: [] });
  };
  const cardsStop = onSnapshot(
    query(collection(db, 'users', token.ownerUid, 'shares', token.shareId, 'cards'), orderBy('createdAt', 'desc')),
    (snapshot) => {
      items = snapshot.docs.map((record) => ({
        id: record.id,
        itemName: String(record.data().itemName ?? ''),
        photo: String(record.data().photo ?? ''),
        photoPath: typeof record.data().photoPath === 'string' ? record.data().photoPath : undefined,
        voice: typeof record.data().voice === 'string' ? record.data().voice : null,
        voicePath: typeof record.data().voicePath === 'string' ? record.data().voicePath : null,
        voices: Array.isArray(record.data().voices) ? record.data().voices : [],
        categoryId: typeof record.data().categoryId === 'string' ? record.data().categoryId : null,
        createdAt: record.data().createdAt?.toMillis?.() ?? Number(record.data().createdAt ?? 0),
      }));
      emit();
    },
    onError,
  );
  const categoriesStop = onSnapshot(
    query(collection(db, 'users', token.ownerUid, 'shares', token.shareId, 'categories'), orderBy('createdAt', 'asc')),
    (snapshot) => {
      categories = snapshot.docs.map((record) => ({
        id: record.id,
        name: String(record.data().name ?? ''),
        createdAt: record.data().createdAt?.toMillis?.() ?? Number(record.data().createdAt ?? 0),
      }));
      emit();
    },
    onError,
  );
  const settingsStop = onSnapshot(
    doc(db, 'users', token.ownerUid, 'shares', token.shareId, 'settings', 'gallery'),
    (snapshot) => {
      settings = snapshot.exists() ? normalizeGallerySettings(snapshot.data()) : normalizeGallerySettings(DEFAULT_GALLERY_SETTINGS);
      emit();
    },
    onError,
  );
  return () => { cardsStop(); categoriesStop(); settingsStop(); };
}

export async function listPasswordShares(): Promise<ShareSummary[]> {
  const { db, userId } = services();
  const uid = await userId();
  const snapshot = await getDocsFromServer(query(collectionPath(uid), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((record) => {
    const created = record.data().createdAt;
    const live = record.data().version === 2 && record.data().mode === 'live';
    return {
      ownerUid: uid,
      shareId: record.id,
      active: record.data().active === true,
      createdAt: typeof created?.toMillis === 'function' ? created.toMillis() : 0,
      mode: live ? 'live' : 'encrypted',
    };
  });
}

/**
 * Keep one active live-share URL for the owner. Reuse and refresh its projection
 * on subsequent requests instead of generating a new public capability token.
 */
export async function getOrCreateLiveShare(
  items: readonly Keepsake[],
  categories: readonly Category[],
  settings: GallerySettings = DEFAULT_GALLERY_SETTINGS,
): Promise<ShareId> {
  let shares: ShareSummary[];
  try {
    shares = await listPasswordShares();
  } catch (error) {
    throw new ShareOperationError('lookup', error);
  }
  const existing = shares.find((share) => share.active && share.mode === 'live');
  if (existing) return { ownerUid: existing.ownerUid, shareId: existing.shareId };
  return createLiveShare(items, categories, settings);
}

async function listShareFiles(directory: StorageReference): Promise<StorageReference[]> {
  const { items, prefixes } = await listAll(directory);
  const nested = await Promise.all(prefixes.map(listShareFiles));
  return [...items, ...nested.flat()];
}

export async function revokePasswordShare(shareId: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(shareId)) throw new Error('共有リンクを確認できません。');
  const { db, storage, userId } = services();
  const uid = await userId();
  const shareRef = doc(db, 'users', uid, 'shares', shareId);
  const snapshot = await getDocFromServer(shareRef);
  if (!snapshot.exists()) return;
  const live = snapshot.data().version === 2 && snapshot.data().mode === 'live';
  if (snapshot.data().active === true) {
    try {
      await updateDoc(shareRef, { active: false });
    } catch {
      const current = await getDocFromServer(shareRef).catch(() => null);
      if (!current || current.data()?.active !== false) {
        throw new Error('共有停止の結果を確認できません。データは削除せず、一覧を更新してください。');
      }
    }
  }
  if (live) {
    const [cards, categories, settings] = await Promise.all([
      getDocsFromServer(collection(db, 'users', uid, 'shares', shareId, 'cards')),
      getDocsFromServer(collection(db, 'users', uid, 'shares', shareId, 'categories')),
      getDocFromServer(doc(db, 'users', uid, 'shares', shareId, 'settings', 'gallery')),
    ]);
    const paths = [
      ...cards.docs.map((record) => record.ref),
      ...categories.docs.map((record) => record.ref),
      ...(settings.exists() ? [settings.ref] : []),
    ];
    for (let offset = 0; offset < paths.length; offset += 400) {
      const batch = writeBatch(db);
      for (const target of paths.slice(offset, offset + 400)) batch.delete(target);
      await batch.commit();
    }
  } else {
    const files = await listShareFiles(ref(storage, `users/${uid}/shares/${shareId}`));
    const results = await Promise.allSettled(files.map((file) => deleteObject(file)));
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('共有リンクは停止しましたが、一部の旧形式ファイルを削除できませんでした。もう一度「共有を停止」を押すと続きから削除します。');
    }
  }
  try {
    await deleteDoc(shareRef);
  } catch {
    const remaining = await getDocFromServer(shareRef).catch(() => null);
    if (remaining?.exists()) throw new Error('共有は停止しましたが、一覧の整理結果を確認できません。共有一覧を更新してください。');
  }
}

export type SharedBook = { items: Keepsake[]; categories: Category[]; settings: GallerySettings; objectUrls: string[] };

export async function openPasswordShare(
  token: ShareId,
  password: string,
): Promise<SharedBook> {
  const passwordIssue = validateSharePasswordForUnlock(password);
  if (passwordIssue) throw new Error(passwordIssue);
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(token.ownerUid) || !/^[a-f0-9]{64}$/.test(token.shareId)) {
    throw new Error('共有リンクが正しくありません。');
  }
  const { db, storage } = services();
  let snapshot;
  try {
    snapshot = await getDocFromServer(doc(db, 'users', token.ownerUid, 'shares', token.shareId));
  } catch {
    throw new Error('共有リンクを読み込めませんでした。通信を確認してもう一度お試しください。');
  }
  if (!snapshot.exists()) throw new Error('この共有リンクは無効か、利用を停止しています。');
  const shared = metadataFrom(snapshot.data());
  let key: CryptoKey;
  let manifest: EncryptedManifest;
  try {
    key = await deriveShareKey(password, fromBase64(shared.salt));
    manifest = await decryptShareManifest<EncryptedManifest>(key, {
      iv: shared.manifestIv,
      ciphertext: shared.manifest,
    });
  } catch {
    throw new Error('パスワードが違うか、共有データを読み込めませんでした。もう一度確認してください。');
  }
  if (!validateManifest(manifest, token)) {
    throw new Error('共有データの形式を確認できません。リンクを作成した人に確認してください。');
  }

  const descriptors = manifest.cards.flatMap((card) => [card.photo, ...card.voices]);
  if (descriptors.length > MAX_SHARED_FILES) throw new Error('共有データのファイル数が上限を超えています。');
  const objectUrls: string[] = [];
  const decrypted = new Map<string, string>();
  try {
    for (let offset = 0; offset < descriptors.length; offset += 4) {
      const batch = descriptors.slice(offset, offset + 4);
      const results = await Promise.all(batch.map(async (asset) => {
        const cipher = new Uint8Array(await getBytes(shareAssetRef(storage, asset.path), MAX_SHARE_FILE_BYTES + 16));
        if (cipher.byteLength !== asset.size + 16) throw new Error('共有ファイルのサイズを確認できません。');
        const clear = await decryptShareBytes(
          key,
          fromBase64(asset.iv),
          cipher,
          `kids-voice-zukan:share:${token.shareId}:asset:${asset.id}`,
        );
        if (clear.byteLength > MAX_SHARE_FILE_BYTES) throw new Error('共有ファイルのサイズが上限を超えています。');
        const url = objectUrl(clear, asset.mimeType);
        clear.fill(0);
        return { id: asset.id, url };
      }));
      for (const result of results) {
        decrypted.set(result.id, result.url);
        objectUrls.push(result.url);
      }
    }
    const items: Keepsake[] = manifest.cards.map((card) => {
      const voices = card.voices.map((voice) => ({
        id: voice.id,
        url: decrypted.get(voice.id)!,
        path: null,
      }));
      return {
        id: card.id,
        itemName: card.itemName,
        categoryId: card.categoryId,
        createdAt: card.createdAt,
        photo: decrypted.get(card.photo.id)!,
        voice: voices[0]?.url ?? null,
        voicePath: null,
        voices,
      };
    });
    return { items, categories: manifest.categories, settings: normalizeGallerySettings(DEFAULT_GALLERY_SETTINGS), objectUrls };
  } catch {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    throw new Error('共有データの読み込みに失敗しました。通信を確認し、パスワードを入れ直してください。');
  }
}

export const sharePasswordRequirements = '新しい共有用パスワードは数字4桁です。以前の共有リンクには、作成時の長いパスワードを引き続き使用できます。';
