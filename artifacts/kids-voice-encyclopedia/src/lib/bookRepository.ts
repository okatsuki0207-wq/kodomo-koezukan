import {
  collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, onSnapshot,
  orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch,
  type DocumentData, type Firestore, type QuerySnapshot,
} from 'firebase/firestore';
import type { Category } from './categories.ts';
import { DEFAULT_CATEGORIES } from './categories.ts';
import type { Keepsake } from './keepsakeRepository.ts';
import { keepsakeFromData } from './voiceAssets.ts';
import { DEFAULT_GALLERY_SETTINGS, normalizeGallerySettings, type GallerySettings } from './gallerySettings.ts';
import { createBookId, isBookId, type BookId } from './bookIdentity.ts';

export type OwnerBookContext = { ownerUid: string; bookId: BookId };
export type SharedBook = {
  items: Keepsake[];
  categories: Category[];
  settings: GallerySettings;
  objectUrls: string[];
};
export type BookShareState = OwnerBookContext & { enabled: boolean };

let database: Firestore | null = null;
let getUid: (() => Promise<string>) | null = null;
let cachedUid = '';
let cachedContext: Promise<OwnerBookContext> | null = null;

export function configureBookRepository(db: Firestore, userId: () => Promise<string>) {
  database = db;
  getUid = userId;
  cachedUid = '';
  cachedContext = null;
}

function services() {
  if (!database || !getUid) throw new Error('図鑑の保存先を利用できません。Firebaseの設定を確認してください。');
  return { db: database, userId: getUid };
}

function libraryPointer(db: Firestore, uid: string) {
  return doc(db, 'users', uid, 'library', 'primary');
}

function bookDocument(db: Firestore, bookId: string) {
  return doc(db, 'books', bookId);
}

function bookCollection(db: Firestore, bookId: string, child: string) {
  return collection(db, 'books', bookId, child);
}

function stableValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toMillis' in value &&
      typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return { timestamp: (value as { toMillis: () => number }).toMillis() };
  }
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

async function writeMissingDocuments(
  db: Firestore,
  source: QuerySnapshot<DocumentData>,
  bookId: string,
  child: string,
) {
  for (let offset = 0; offset < source.docs.length; offset += 5) {
    await Promise.all(source.docs.slice(offset, offset + 5).map(async (record) => {
      const target = doc(db, 'books', bookId, child, record.id);
      const existing = await getDocFromServer(target);
      if (!existing.exists()) await setDoc(target, record.data());
      else if (stableJson(existing.data()) !== stableJson(record.data())) {
        throw new Error(`移行先の ${child}/${record.id} が元データと一致しません。データは上書きせず停止しました。`);
      }
    }));
  }
}

async function verifyCollection(
  db: Firestore,
  source: QuerySnapshot<DocumentData>,
  bookId: string,
  child: string,
) {
  for (let offset = 0; offset < source.docs.length; offset += 5) {
    await Promise.all(source.docs.slice(offset, offset + 5).map(async (record) => {
      const target = await getDocFromServer(doc(db, 'books', bookId, child, record.id));
      if (!target.exists() || stableJson(target.data()) !== stableJson(record.data())) {
        throw new Error(`移行した ${child}/${record.id} を確認できません。元データはそのまま残しています。`);
      }
    }));
  }
}

async function retireLiveProjection(db: Firestore, uid: string, bookId: string) {
  const shareRef = doc(db, 'users', uid, 'shares', bookId);
  const share = await getDocFromServer(shareRef);
  if (!share.exists() || share.data().version !== 2 || share.data().mode !== 'live') return;

  if (share.data().active === true) {
    await updateDoc(shareRef, { active: false });
  }
  const [cards, categories, settings] = await Promise.all([
    getDocsFromServer(collection(db, 'users', uid, 'shares', bookId, 'cards')),
    getDocsFromServer(collection(db, 'users', uid, 'shares', bookId, 'categories')),
    getDocFromServer(doc(db, 'users', uid, 'shares', bookId, 'settings', 'gallery')),
  ]);
  const oldDocuments = [
    ...cards.docs.map((entry) => entry.ref),
    ...categories.docs.map((entry) => entry.ref),
    ...(settings.exists() ? [settings.ref] : []),
  ];
  for (let offset = 0; offset < oldDocuments.length; offset += 400) {
    const batch = writeBatch(db);
    for (const reference of oldDocuments.slice(offset, offset + 400)) batch.delete(reference);
    await batch.commit();
  }
}

async function migrateLegacyBook(db: Firestore, uid: string, bookId: string) {
  const rootRef = bookDocument(db, bookId);
  const root = await getDocFromServer(rootRef);
  if (!root.exists() || root.data().ownerUid !== uid) {
    throw new Error('図鑑の所有者を確認できません。元のデータは変更していません。');
  }
  if (root.data().migrationState === 'ready') return;

  // The original owner-only paths are read once. Storage objects and their download URLs
  // are kept in place; only Firestore card/category/settings documents are migrated.
  const [cards, categories, settings, legacyShares] = await Promise.all([
    getDocsFromServer(collection(db, 'users', uid, 'keepsakes')),
    getDocsFromServer(collection(db, 'users', uid, 'categories')),
    getDocFromServer(doc(db, 'users', uid, 'settings', 'gallery')),
    getDocsFromServer(collection(db, 'users', uid, 'shares')),
  ]);
  const hadLiveShare = legacyShares.docs.some((share) =>
    share.id === bookId && share.data().active === true &&
    share.data().version === 2 && share.data().mode === 'live');

  // Categories must exist before card rules validate category references.
  await writeMissingDocuments(db, categories, bookId, 'categories');
  if (settings.exists()) {
    const target = doc(db, 'books', bookId, 'settings', 'gallery');
    const existing = await getDocFromServer(target);
    if (!existing.exists()) await setDoc(target, settings.data());
    else if (stableJson(existing.data()) !== stableJson(settings.data())) {
      throw new Error('移行先の図鑑設定が元データと一致しません。設定は上書きせず停止しました。');
    }
  }
  await writeMissingDocuments(db, cards, bookId, 'cards');

  await Promise.all([
    verifyCollection(db, categories, bookId, 'categories'),
    verifyCollection(db, cards, bookId, 'cards'),
    ...(settings.exists() ? [getDocFromServer(doc(db, 'books', bookId, 'settings', 'gallery')).then((target) => {
      if (!target.exists() || stableJson(target.data()) !== stableJson(settings.data())) {
        throw new Error('移行した図鑑設定を確認できません。元データはそのまま残しています。');
      }
    })] : []),
  ]);

  await updateDoc(rootRef, {
    migrationState: 'ready',
    shareEnabled: hadLiveShare,
    readyAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Old live projections are deleted only after every source document has been verified.
  // Failure here does not affect the canonical book or stop owner access.
  try {
    await retireLiveProjection(db, uid, bookId);
  } catch (error) {
    console.warn('Legacy live-share projection cleanup is pending.', error);
  }
}

async function ensureOwnerBook(uid: string): Promise<OwnerBookContext> {
  const { db } = services();
  const pointerRef = libraryPointer(db, uid);
  const pointer = await getDocFromServer(pointerRef);
  if (pointer.exists()) {
    const bookId = pointer.data().bookId;
    if (!isBookId(bookId)) throw new Error('この端末に保存された図鑑IDを確認できません。');
    const root = await getDocFromServer(bookDocument(db, bookId));
    if (!root.exists()) throw new Error('図鑑データの移行先が見つかりません。元データは変更していません。');
    if (root.data().ownerUid !== uid) throw new Error('図鑑の所有者が一致しません。');
    if (root.data().migrationState !== 'ready') await migrateLegacyBook(db, uid, bookId);
    return { ownerUid: uid, bookId };
  }

  const oldShares = await getDocsFromServer(collection(db, 'users', uid, 'shares'));
  const activeLiveShare = oldShares.docs.find((share) =>
    share.data().active === true && share.data().version === 2 && share.data().mode === 'live');
  const proposedBookId = activeLiveShare?.id ?? createBookId();
  if (!isBookId(proposedBookId)) throw new Error('図鑑IDを作成できません。');

  const bookId = await runTransaction(db, async (transaction) => {
    const currentPointer = await transaction.get(pointerRef);
    if (currentPointer.exists()) {
      const currentId = currentPointer.data().bookId;
      if (!isBookId(currentId)) throw new Error('保存された図鑑IDを確認できません。');
      return currentId;
    }
    const rootRef = bookDocument(db, proposedBookId);
    const existingRoot = await transaction.get(rootRef);
    if (existingRoot.exists() && existingRoot.data().ownerUid !== uid) {
      throw new Error('図鑑IDが重複しました。もう一度接続してください。');
    }
    transaction.set(pointerRef, { bookId: proposedBookId, createdAt: serverTimestamp() });
    if (!existingRoot.exists()) {
      transaction.set(rootRef, {
        ownerUid: uid,
        shareEnabled: false,
        migrationState: 'copying',
        schemaVersion: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (existingRoot.data().migrationState !== 'ready') {
      transaction.update(rootRef, { shareEnabled: false, migrationState: 'copying', updatedAt: serverTimestamp() });
    }
    return proposedBookId;
  });

  const context = { ownerUid: uid, bookId };
  await migrateLegacyBook(db, uid, bookId);
  return context;
}

export async function getOwnerBookContext(): Promise<OwnerBookContext> {
  const { userId } = services();
  const uid = await userId();
  if (cachedUid !== uid || !cachedContext) {
    cachedUid = uid;
    cachedContext = ensureOwnerBook(uid).catch((error) => {
      if (cachedUid === uid) cachedContext = null;
      throw error;
    });
  }
  return cachedContext;
}

export async function getOwnerBookShareState(): Promise<BookShareState> {
  const { db } = services();
  const context = await getOwnerBookContext();
  const snapshot = await getDocFromServer(bookDocument(db, context.bookId));
  if (!snapshot.exists() || snapshot.data().migrationState !== 'ready') {
    throw new Error('図鑑の準備が終わっていません。少し待ってからもう一度お試しください。');
  }
  return { ...context, enabled: snapshot.data().shareEnabled === true };
}

export async function setOwnerBookSharing(enabled: boolean): Promise<BookId> {
  const { db } = services();
  const context = await getOwnerBookContext();
  await updateDoc(bookDocument(db, context.bookId), {
    shareEnabled: enabled,
    updatedAt: serverTimestamp(),
  });
  return context.bookId;
}

function timestampMillis(value: unknown) {
  if (value && typeof value === 'object' && 'toMillis' in value &&
      typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return typeof value === 'number' ? value : 0;
}

export async function subscribePublicBook(
  bookId: string,
  onChange: (book: SharedBook) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  if (!isBookId(bookId)) throw new Error('共有リンクが正しくありません。');
  const { db } = services();
  const rootRef = bookDocument(db, bookId);
  const root = await getDocFromServer(rootRef);
  if (!root.exists() || root.data().shareEnabled !== true || root.data().migrationState !== 'ready') {
    throw new Error('この共有リンクは停止されているか、確認できません。');
  }

  let items: Keepsake[] | null = null;
  let categories: Category[] | null = null;
  let settings: GallerySettings = normalizeGallerySettings(DEFAULT_GALLERY_SETTINGS);
  let settingsLoaded = false;
  let stopped = false;
  const stops: Array<() => void> = [];
  const emit = () => {
    if (!stopped && items && categories && settingsLoaded) {
      onChange({ items, categories, settings, objectUrls: [] });
    }
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    stopped = true;
    stops.splice(0).forEach((stop) => stop());
    onError(error);
  };

  stops.push(onSnapshot(rootRef, (snapshot) => {
    if (!snapshot.exists() || snapshot.data().shareEnabled !== true ||
        snapshot.data().migrationState !== 'ready') {
      fail(new Error('この共有リンクは停止されています。'));
    }
  }, fail));
  stops.push(onSnapshot(
    query(bookCollection(db, bookId, 'cards'), orderBy('createdAt', 'desc')),
    (snapshot) => {
      items = snapshot.docs.map((record) => keepsakeFromData(record.id, record.data()));
      emit();
    },
    fail,
  ));
  stops.push(onSnapshot(
    query(bookCollection(db, bookId, 'categories'), orderBy('createdAt', 'asc')),
    (snapshot) => {
      categories = [
        ...DEFAULT_CATEGORIES,
        ...snapshot.docs.map((record) => ({
          id: record.id,
          name: String(record.data().name ?? ''),
          createdAt: timestampMillis(record.data().createdAt),
        })),
      ];
      emit();
    },
    fail,
  ));
  stops.push(onSnapshot(doc(db, 'books', bookId, 'settings', 'gallery'), (snapshot) => {
    settings = normalizeGallerySettings(snapshot.exists() ? snapshot.data() : DEFAULT_GALLERY_SETTINGS);
    settingsLoaded = true;
    emit();
  }, fail));

  return () => {
    stopped = true;
    stops.splice(0).forEach((stop) => stop());
  };
}
