export type NewKeepsakeDraftInput = {
  itemName: string;
  photo: string | null;
  pendingPhotoBlob: Blob | null;
  voiceBlob: Blob | null;
  categoryId: string | null;
};

export type NewKeepsakeDraft = NewKeepsakeDraftInput & {
  updatedAt: number;
};

export function hasNewKeepsakeDraftContent(draft: NewKeepsakeDraftInput): boolean {
  return Boolean(draft.itemName.trim() || draft.photo || draft.pendingPhotoBlob || draft.voiceBlob);
}

const DATABASE_NAME = 'kids-voice-encyclopedia-local';
const DATABASE_VERSION = 1;
const STORE_NAME = 'drafts';
const DRAFT_KEY = 'new-keepsake';

function openDatabase(factory?: IDBFactory): Promise<IDBDatabase> {
  const indexedDBFactory = factory ?? globalThis.indexedDB;
  if (!indexedDBFactory) {
    return Promise.reject(new Error('このブラウザでは端末内の下書き保存を利用できません。'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDBFactory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('下書きデータベースを開けませんでした。'));
    request.onblocked = () => reject(new Error('下書きデータベースを開けませんでした。ページを再読み込みしてください。'));
  });
}

function withStore<T>(
  factory: IDBFactory | undefined,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<unknown>,
): Promise<T> {
  return openDatabase(factory).then((database) => new Promise<T>((resolve, reject) => {
    let result: unknown;
    let settled = false;
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        database.close();
        reject(request.error ?? new Error('下書きを読み書きできませんでした。'));
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        database.close();
        resolve(result as T);
      };
      transaction.onerror = () => {
        if (settled) return;
        settled = true;
        database.close();
        reject(transaction.error ?? new Error('下書きを読み書きできませんでした。'));
      };
      transaction.onabort = () => {
        if (settled) return;
        settled = true;
        database.close();
        reject(transaction.error ?? new Error('下書きの保存が中断されました。'));
      };
    } catch (error) {
      database.close();
      reject(error);
    }
  }));
}

function validDraft(value: unknown): NewKeepsakeDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Partial<NewKeepsakeDraft>;
  if (typeof draft.itemName !== 'string' || typeof draft.updatedAt !== 'number') return null;
  if (draft.photo !== null && typeof draft.photo !== 'string') return null;
  if (draft.pendingPhotoBlob !== null && !(draft.pendingPhotoBlob instanceof Blob)) return null;
  if (draft.voiceBlob !== null && !(draft.voiceBlob instanceof Blob)) return null;
  if (draft.categoryId !== null && typeof draft.categoryId !== 'string') return null;
  return {
    itemName: draft.itemName,
    photo: draft.photo ?? null,
    pendingPhotoBlob: draft.pendingPhotoBlob ?? null,
    voiceBlob: draft.voiceBlob ?? null,
    categoryId: draft.categoryId ?? null,
    updatedAt: draft.updatedAt,
  };
}

export function createNewKeepsakeDraftStore(factory?: IDBFactory) {
  return {
    async read(): Promise<NewKeepsakeDraft | null> {
      const value = await withStore<unknown>(factory, 'readonly', (store) => store.get(DRAFT_KEY));
      return validDraft(value);
    },
    async write(draft: NewKeepsakeDraft): Promise<void> {
      await withStore<unknown>(factory, 'readwrite', (store) => store.put(draft, DRAFT_KEY));
    },
    async clear(): Promise<void> {
      await withStore<unknown>(factory, 'readwrite', (store) => store.delete(DRAFT_KEY));
    },
  };
}
