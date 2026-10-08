import {
  collection, collectionGroup, doc, getDocFromServer, getDocsFromServer,
  runTransaction, serverTimestamp, setDoc, updateDoc,
  type DocumentData, type Firestore, type QuerySnapshot,
} from 'firebase/firestore';
import { DEFAULT_CATEGORIES } from './categories.ts';
import { createBookId, isBookId, type BookId } from './bookIdentity.ts';

export type OwnerBookContext = { bookId: BookId };

let database: Firestore | null = null;
let getUid: (() => Promise<string>) | null = null;
let cachedContext: Promise<OwnerBookContext> | null = null;

export function configureBookRepository(db: Firestore, userId: () => Promise<string>) {
  database = db;
  getUid = userId;
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

async function migrateLegacyBook(db: Firestore, uid: string, bookId: string) {
  const rootRef = bookDocument(db, bookId);
  const root = await getDocFromServer(rootRef);
  if (!root.exists()) throw new Error('図鑑データを確認できません。元のデータは変更していません。');
  if (root.data().migrationState === 'ready') return;

  // The original owner-only paths are read once. Storage objects and their download URLs
  // are kept in place; only Firestore card/category/settings documents are migrated.
  const [cards, categories, settings] = await Promise.all([
    getDocsFromServer(collection(db, 'users', uid, 'keepsakes')),
    getDocsFromServer(collection(db, 'users', uid, 'categories')),
    getDocFromServer(doc(db, 'users', uid, 'settings', 'gallery')),
  ]);

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
    readyAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

type SourceDocument = { id: string; path: string; namespace: string; data: DocumentData };
const normalizeCategoryName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();

async function importedDocumentId(path: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  return `import-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function sourceNamespace(path: string) {
  const [root, id] = path.split('/');
  return `${root}/${id}`;
}

/**
 * The app now has one public book for every browser and origin. On the first
 * open, copy old canonical and legacy Firestore records into it without
 * deleting or moving the original documents or Storage objects.
 */
async function consolidateExistingData(db: Firestore, bookId: string) {
  const rootRef = bookDocument(db, bookId);
  const root = await getDocFromServer(rootRef);
  if (root.data()?.publicImportVersion === 1) return;

  const [allBookCards, allLegacyCards, allCategories, allSettings] = await Promise.all([
    getDocsFromServer(collectionGroup(db, 'cards')),
    getDocsFromServer(collectionGroup(db, 'keepsakes')),
    getDocsFromServer(collectionGroup(db, 'categories')),
    getDocsFromServer(collectionGroup(db, 'settings')),
  ]);

  const categorySources: SourceDocument[] = allCategories.docs.flatMap((record) => {
    const parts = record.ref.path.split('/');
    const isAppCategory = parts.length === 4 &&
      ((parts[0] === 'books' && parts[2] === 'categories') ||
       (parts[0] === 'users' && parts[2] === 'categories'));
    if (!isAppCategory || sourceNamespace(record.ref.path) === `books/${bookId}`) return [];
    return [{ id: record.id, path: record.ref.path, namespace: sourceNamespace(record.ref.path), data: record.data() }];
  }).sort((a, b) => a.path.localeCompare(b.path));

  const cardSources: SourceDocument[] = [
    ...allBookCards.docs.flatMap((record) => {
      const parts = record.ref.path.split('/');
      if (parts.length !== 4 || parts[0] !== 'books' || parts[2] !== 'cards' || parts[1] === bookId) return [];
      return [{ id: record.id, path: record.ref.path, namespace: `books/${parts[1]}`, data: record.data() }];
    }),
    ...allLegacyCards.docs.flatMap((record) => {
      const parts = record.ref.path.split('/');
      if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'keepsakes') return [];
      return [{ id: record.id, path: record.ref.path, namespace: `users/${parts[1]}`, data: record.data() }];
    }),
  ].sort((a, b) => a.path.localeCompare(b.path));

  const targetCategories = await getDocsFromServer(bookCollection(db, bookId, 'categories'));
  const categoryByName = new Map<string, string>(DEFAULT_CATEGORIES.map((category) => [normalizeCategoryName(category.name), category.id]));
  const targetCategoryNames = new Map<string, string>();
  targetCategories.docs.forEach((record) => {
    const name = String(record.data().name ?? '');
    categoryByName.set(normalizeCategoryName(name), record.id);
    targetCategoryNames.set(record.id, name);
  });
  const categoryMap = new Map<string, string>();
  for (const source of categorySources) {
    const name = String(source.data.name ?? '').trim();
    if (!name) continue;
    const key = `${source.namespace}/${source.id}`;
    const sameName = categoryByName.get(normalizeCategoryName(name));
    if (sameName) {
      categoryMap.set(key, sameName);
      continue;
    }
    let targetId = source.id;
    const nameAtId = targetCategoryNames.get(targetId);
    if (nameAtId && normalizeCategoryName(nameAtId) !== normalizeCategoryName(name)) {
      targetId = await importedDocumentId(source.path);
    }
    const targetRef = doc(db, 'books', bookId, 'categories', targetId);
    const target = await getDocFromServer(targetRef);
    if (!target.exists()) await setDoc(targetRef, source.data);
    else if (normalizeCategoryName(String(target.data().name ?? '')) !== normalizeCategoryName(name)) {
      throw new Error('既存カテゴリの内容が一致しません。元のデータはそのまま残しました。');
    }
    categoryMap.set(key, targetId);
    categoryByName.set(normalizeCategoryName(name), targetId);
    targetCategoryNames.set(targetId, name);
  }

  const targetCards = await getDocsFromServer(bookCollection(db, bookId, 'cards'));
  const targetCardData = new Map(targetCards.docs.map((record) => [record.id, record.data()]));
  for (const source of cardSources) {
    const sourceData = { ...source.data };
    const originalCategory = typeof sourceData.categoryId === 'string' ? sourceData.categoryId : null;
    if (originalCategory) {
      sourceData.categoryId = categoryMap.get(`${source.namespace}/${originalCategory}`) ?? originalCategory;
    }
    let targetId = source.id;
    const existing = targetCardData.get(targetId);
    if (existing && stableJson(existing) !== stableJson(sourceData)) {
      targetId = await importedDocumentId(source.path);
    } else if (existing) {
      continue;
    }
    const targetRef = doc(db, 'books', bookId, 'cards', targetId);
    const target = await getDocFromServer(targetRef);
    if (!target.exists()) {
      await setDoc(targetRef, sourceData);
      targetCardData.set(targetId, sourceData);
    } else if (stableJson(target.data()) !== stableJson(sourceData)) {
      throw new Error('既存キロクと移行元の内容が異なります。上書きせず、元データはそのまま残しました。');
    }
  }

  const targetSettingsRef = doc(db, 'books', bookId, 'settings', 'gallery');
  const targetSettings = await getDocFromServer(targetSettingsRef);
  if (!targetSettings.exists()) {
    const candidates = allSettings.docs.flatMap((record) => {
      const parts = record.ref.path.split('/');
      const isAppSettings = parts.length === 4 && parts[2] === 'settings' && parts[3] === 'gallery' &&
        (parts[0] === 'books' || parts[0] === 'users');
      if (!isAppSettings || record.ref.path === `books/${bookId}/settings/gallery`) return [];
      return [{ path: record.ref.path, data: record.data() }];
    }).sort((a, b) => a.path.localeCompare(b.path));
    if (candidates[0]) await setDoc(targetSettingsRef, candidates[0].data);
  }

  await updateDoc(rootRef, { publicImportVersion: 1, updatedAt: serverTimestamp() });
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
    if (root.data().migrationState !== 'ready') await migrateLegacyBook(db, uid, bookId);
    await consolidateExistingData(db, bookId);
    return { bookId };
  }

  const proposedBookId = createBookId();
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
    transaction.set(pointerRef, { bookId: proposedBookId, createdAt: serverTimestamp() });
    if (!existingRoot.exists()) {
      transaction.set(rootRef, {
        migrationState: 'copying',
        schemaVersion: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (existingRoot.data().migrationState !== 'ready') {
      transaction.update(rootRef, { migrationState: 'copying', updatedAt: serverTimestamp() });
    }
    return proposedBookId;
  });

  const context = { bookId };
  await migrateLegacyBook(db, uid, bookId);
  await consolidateExistingData(db, bookId);
  return context;
}

export async function getOwnerBookContext(): Promise<OwnerBookContext> {
  const { userId } = services();
  const uid = await userId();
  if (!cachedContext) {
    cachedContext = ensureOwnerBook(uid).catch((error) => {
      cachedContext = null;
      throw error;
    });
  }
  return cachedContext;
}
