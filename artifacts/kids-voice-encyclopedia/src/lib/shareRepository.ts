import {
  collection, deleteDoc, doc, getDocFromServer, getDocsFromServer,
  orderBy, query, runTransaction, serverTimestamp, updateDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  deleteObject, getBytes, getMetadata, listAll, ref, uploadBytes,
  type FirebaseStorage, type StorageReference,
} from 'firebase/storage';
import type { Category } from './categories';
import type { Keepsake } from './keepsakeRepository';
import { getVoices } from './voiceAssets';
import {
  createShareId, decryptShareBytes, decryptShareManifest, deriveShareKey,
  encryptShareBytes, encryptShareManifest, fromBase64, randomBytes, SHARE_KDF,
  SHARE_KDF_ITERATIONS, SHARE_PASSWORD_MIN_LENGTH, toBase64, validateSharePassword,
} from './shareCrypto';

export const MAX_SHARE_MEDIA_BYTES = 200 * 1024 * 1024;
const MAX_SHARE_CARDS = 250;
const MAX_SHARE_FILE_BYTES = 20 * 1024 * 1024 - 32;
const MAX_SHARED_FILES = MAX_SHARE_CARDS * 6;
const SHARE_FORMAT_VERSION = 1;

export type ShareId = { ownerUid: string; shareId: string };
export type ShareSummary = {
  ownerUid: string;
  shareId: string;
  active: boolean;
  createdAt: number;
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

export async function createPasswordShare(
  items: readonly Keepsake[],
  categories: readonly Category[],
  password: string,
): Promise<ShareId> {
  const passwordIssue = validateSharePassword(password);
  if (passwordIssue) throw new Error(passwordIssue);
  if (items.length > MAX_SHARE_CARDS) throw new Error(`一度に共有できるキロクは${MAX_SHARE_CARDS}件までです。カテゴリを分けてから共有してください。`);
  if (categories.length > 100) throw new Error('共有できるカテゴリは100件までです。使っていないカテゴリを整理してからお試しください。');

  const { db, storage, userId } = services();
  const ownerUid = await userId();
  const shareId = createShareId();
  const shareRef = doc(db, 'users', ownerUid, 'shares', shareId);
  const salt = randomBytes(16);
  const key = await deriveShareKey(password, salt);
  const prefix = `users/${ownerUid}/shares/${shareId}/assets`;
  const uploaded: StorageReference[] = [];
  let totalBytes = 0;
  const putEncryptedAsset = async (source: string, sourcePath?: string | null): Promise<AssetDescriptor> => {
    if (!source) throw new Error('写真または録音を読み込めません。共有は作成されませんでした。');
    const original = ref(storage, sourcePath || source);
    if (original.bucket !== storage.app.options.storageBucket || !original.fullPath.startsWith(`users/${ownerUid}/keepsakes/`)) {
      throw new Error('所有者の図鑑に保存されている写真・声以外は共有できません。');
    }
    const metadata = await getMetadata(original);
    const clear = new Uint8Array(await getBytes(original, MAX_SHARE_FILE_BYTES));
    if (!clear.byteLength || clear.byteLength > MAX_SHARE_FILE_BYTES) {
      throw new Error('写真または録音のサイズが共有上限を超えています。');
    }
    totalBytes += clear.byteLength;
    if (totalBytes > MAX_SHARE_MEDIA_BYTES) {
      throw new Error('共有するメディアの合計が200MBを超えました。キロクを減らしてから共有してください。');
    }
    const id = createShareId().slice(0, 32);
    const aad = `kids-voice-zukan:share:${shareId}:asset:${id}`;
    const { iv, ciphertext } = await encryptShareBytes(key, clear, aad);
    const size = clear.byteLength;
    clear.fill(0);
    const path = `${prefix}/${id}`;
    const target = ref(storage, path);
    uploaded.push(target);
    await uploadBytes(target, ciphertext, { contentType: 'application/octet-stream' });
    if (uploaded.length > MAX_SHARED_FILES) {
      throw new Error('共有するファイルの数が上限を超えています。');
    }
    return { id, path, iv: toBase64(iv), mimeType: metadata.contentType || 'application/octet-stream', size };
  };

  try {
    const cards: EncryptedManifest['cards'] = [];
    for (const item of items) {
      const photo = await putEncryptedAsset(item.photo, item.photoPath);
      const voices = [];
      for (const voice of getVoices(item)) {
        voices.push(await putEncryptedAsset(voice.url, voice.path));
      }
      cards.push({
        id: item.id,
        itemName: item.itemName,
        categoryId: item.categoryId ?? null,
        createdAt: item.createdAt,
        photo,
        voices,
      });
    }
    const encryptedManifest = await encryptShareManifest(key, {
      version: SHARE_FORMAT_VERSION,
      categories: [...categories],
      cards,
    } satisfies EncryptedManifest);
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(shareRef);
      if (existing.exists()) throw new Error('共有リンクIDが重複しました。もう一度お試しください。');
      transaction.set(shareRef, {
        active: true,
        version: SHARE_FORMAT_VERSION,
        kdf: SHARE_KDF,
        iterations: SHARE_KDF_ITERATIONS,
        salt: toBase64(salt),
        manifestIv: encryptedManifest.iv,
        manifest: encryptedManifest.ciphertext,
        createdAt: serverTimestamp(),
      });
    });
    return { ownerUid, shareId };
  } catch (error) {
    // A lost Firestore acknowledgement must not remove files from a share that
    // actually committed. Verify from the server before cleaning up.
    let confirmedAbsent = false;
    try {
      const receipt = await getDocFromServer(shareRef);
      if (receipt.exists()) {
        if (receipt.data().active === true) return { ownerUid, shareId };
        throw new Error('共有データの状態が変わりました。暗号化ファイルは安全のため残しました。共有一覧を更新して確認してください。');
      }
      confirmedAbsent = true;
    } catch {
      throw new Error('共有の保存結果を確認できません。ファイルは安全のため残しました。共有一覧を更新して状態を確認してください。');
    }
    if (confirmedAbsent) {
      const cleanup = await Promise.allSettled(uploaded.map(async (file) => {
        try { await deleteObject(file); }
        catch (caught) {
          if ((caught as { code?: string })?.code !== 'storage/object-not-found') throw caught;
        }
      }));
      if (cleanup.some((result) => result.status === 'rejected')) {
        throw new Error('共有は作成されませんでしたが、一部の暗号化ファイルを削除できませんでした。共有一覧を更新して確認してください。');
      }
    }
    throw error;
  }
}

export async function listPasswordShares(): Promise<ShareSummary[]> {
  const { db, userId } = services();
  const uid = await userId();
  const snapshot = await getDocsFromServer(query(collectionPath(uid), orderBy('createdAt', 'desc')));
  return snapshot.docs.map((record) => {
    const created = record.data().createdAt;
    return {
      ownerUid: uid,
      shareId: record.id,
      active: record.data().active === true,
      createdAt: typeof created?.toMillis === 'function' ? created.toMillis() : 0,
    };
  });
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
  const files = await listShareFiles(ref(storage, `users/${uid}/shares/${shareId}`));
  const results = await Promise.allSettled(files.map((file) => deleteObject(file)));
  if (results.some((result) => result.status === 'rejected')) {
    throw new Error('共有リンクは停止しましたが、一部の暗号化ファイルを削除できませんでした。もう一度「共有を停止」を押すと続きから削除します。');
  }
  try {
    await deleteDoc(shareRef);
  } catch {
    const remaining = await getDocFromServer(shareRef).catch(() => null);
    if (remaining?.exists()) throw new Error('共有は停止して暗号化コピーを削除しましたが、一覧の整理結果を確認できません。共有一覧を更新してください。');
  }
}

export type SharedBook = { items: Keepsake[]; categories: Category[]; objectUrls: string[] };

export async function openPasswordShare(
  token: ShareId,
  password: string,
): Promise<SharedBook> {
  const passwordIssue = validateSharePassword(password);
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
    return { items, categories: manifest.categories, objectUrls };
  } catch {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    throw new Error('共有データの読み込みに失敗しました。通信を確認し、パスワードを入れ直してください。');
  }
}

export const sharePasswordRequirements = `共有用パスワードは${SHARE_PASSWORD_MIN_LENGTH}〜${SHARE_PASSWORD_MIN_LENGTH + 116}文字です。推測されにくい言葉を組み合わせてください。`;
