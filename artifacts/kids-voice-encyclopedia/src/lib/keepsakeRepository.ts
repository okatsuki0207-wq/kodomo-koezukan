import { collection, deleteDoc, doc, getDocFromServer, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { diagnoseStorageError } from './storageDiagnostics.ts';
import { keepsakeMetadata } from './categories.ts';
import { getVoices, keepsakeFromData, type VoiceAsset } from './voiceAssets.ts';

export type Keepsake = {
  id: string;
  itemName: string;
  photo: string;
  voice: string | null;
  /** Optional in-memory bytes avoid re-fetching restored IndexedDB Blob URLs. */
  photoBlob?: Blob;
  voiceBlob?: Blob;
  createdAt: number;
  photoPath?: string;
  voicePath?: string | null;
  categoryId?: string | null;
  voices?: VoiceAsset[];
};

export class FirebaseTimeoutError extends Error {}

export function deadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new FirebaseTimeoutError('Firebase の応答がありません。処理が後から完了する場合があります。再接続後に一覧を確認してからもう一度お試しください。')), milliseconds);
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

// The production SDK remains the default; tests inject faults around real emulator operations.
const sdk = { getDoc: getDocFromServer, runTransaction, uploadBytes, getDownloadURL, deleteObject, deleteDoc, ref, diagnoseStorageError };
export function createKeepsakeRepository(
  db: Firestore,
  storage: FirebaseStorage,
  userId: () => Promise<string>,
  bookId: () => Promise<string>,
  operations: Partial<typeof sdk> = {},
  timeoutMs = 30_000,
) {
  const io = { ...sdk, ...operations };
  const pending = new Map<string, Promise<void>>();

  async function removeFile(path: string, downloadUrl?: string) {
    const file = io.ref(storage, downloadUrl ?? path);
    if (file.fullPath !== path) throw new Error('ファイルの保存パスが一致しません。削除は行いませんでした。');
    try { await io.deleteObject(file); }
    catch (error) {
      if ((error as { code?: string }).code !== 'storage/object-not-found') throw error;
    }
  }

  async function save(item: Keepsake, migrating: boolean, uid: string, ownerBookId: string) {
    const record = doc(db, 'books', ownerBookId, 'cards', item.id);
    // A retry is not an edit. Never overwrite a committed card, even after a lost acknowledgement.
    if ((await deadline(io.getDoc(record), timeoutMs)).exists()) return;
    const metadata = keepsakeMetadata(item.itemName, item.categoryId ?? null);
    const uploaded: string[] = [];
    const attempt = crypto.randomUUID();
    const attemptRecord = doc(db, 'users', uid, 'saveAttempts', attempt);
    // Register before uploading. Unknown outcomes stay active, however old they become.
    await deadline(setDoc(attemptRecord, {
      cardId: item.id, bucket: ref(storage).bucket, state: 'active', startedAt: serverTimestamp(),
    }), timeoutMs);
    let commitStarted = false;
    try {
      const put = async (source: string | Blob, kind: 'photo' | 'voice') => {
        let blob: Blob;
        if (typeof source === 'string') {
          const response = await fetch(source);
          if (!response.ok) throw new Error('画像または音声を読み込めませんでした。');
          blob = await response.blob();
        } else {
          blob = source;
        }
        if (!blob.type.startsWith(kind === 'photo' ? 'image/' : 'audio/')) throw new Error('ファイル形式が正しくありません。');
        if (!blob.size) throw new Error('ファイルが空です。写真または音声を選び直してください。');
        if (blob.size >= 20 * 1024 * 1024) throw new Error('ファイルは20MB未満にしてください。');
        // Separate attempts cannot overwrite or clean up each other's files.
        const path = `users/${uid}/keepsakes/${item.id}/${attempt}/${kind}`;
        const file = ref(storage, path);
        try { await io.uploadBytes(file, blob, { contentType: blob.type }); }
        catch (error) { throw await io.diagnoseStorageError(error, file.bucket); }
        uploaded.push(path);
        try { return { url: await io.getDownloadURL(file), path }; }
        catch (error) { throw await io.diagnoseStorageError(error, file.bucket); }
      };
      const photo = await put(item.photoBlob ?? item.photo, 'photo');
      const voice = item.voiceBlob || item.voice
        ? await put(item.voiceBlob ?? item.voice!, 'voice')
        : null;
      commitStarted = true;
      const committed = await deadline(io.runTransaction(db, async (transaction) => {
        const existing = await transaction.get(record);
        const status = await transaction.get(attemptRecord);
        if (status.data()?.state !== 'active') throw new Error('この保存試行は終了しています。新しい保存操作をお試しください。');
        transaction.update(attemptRecord, { state: 'finished', finishedAt: serverTimestamp() });
        if (existing.exists()) return false;
        transaction.set(record, {
          itemName: metadata.itemName, photo: photo.url, voice: voice?.url ?? null,
          ...(metadata.categoryId ? { categoryId: metadata.categoryId } : {}),
          photoPath: photo.path, voicePath: voice?.path ?? null,
          createdAt: migrating ? new Date(item.createdAt) : serverTimestamp(),
        });
        return true;
      }), timeoutMs);
      if (!committed) await Promise.all(uploaded.map((path) => removeFile(path)));
    } catch (error) {
      if (error instanceof FirebaseTimeoutError || uploaded.length === 0) throw error;
      // An interrupted commit can finish later. Only a definite rules rejection is safe to roll back.
      if (commitStarted && (error as { code?: string }).code !== 'permission-denied') {
        throw new Error('保存結果を確認できませんでした。再接続後に一覧を確認してください。結果不明のファイルは安全のため保持します。');
      }
      // If acknowledgement was lost, keep any files referenced by the committed card.
      // If the result cannot be read, preserve all files rather than risk data loss.
      try {
        const result = await deadline(io.getDoc(record), timeoutMs);
        const value = result.data();
        await Promise.all(uploaded.filter((path) => path !== value?.photoPath && path !== value?.voicePath).map((path) => removeFile(path)));
        await deadline(updateDoc(attemptRecord, { state: 'finished', finishedAt: serverTimestamp() }), timeoutMs);
      } catch {
        throw new Error('保存結果を確認できませんでした。再接続後に一覧を確認してください。結果不明のファイルは安全のため保持します。');
      }
      throw error;
    }
  }

  async function saveKeepsake(item: Keepsake, migrating = false): Promise<void> {
    const [uid, ownerBookId] = await Promise.all([userId(), bookId()]);
    const key = `${ownerBookId}/${item.id}`;
    if (pending.has(key)) return pending.get(key)!;
    const operation = save(item, migrating, uid, ownerBookId).finally(() => pending.delete(key));
    pending.set(key, operation);
    return operation;
  }

  async function deleteKeepsake(item: Keepsake): Promise<void> {
    const ownerBookId = await bookId();
    const isCardMediaPath = (path: string | null | undefined) => {
      if (!path) return false;
      const parts = path.split('/');
      return parts.length >= 5 && parts[0] === 'users' && parts[1] !== '' &&
        parts[2] === 'keepsakes' && parts[3] === item.id &&
        parts.slice(4).every((part) => part !== '' && part !== '.' && part !== '..');
    };
    // Validate the supplied snapshot before resolving the current server version.
    // A stale but valid snapshot may be refreshed; a mismatched URL is never trusted.
    for (const [path, url] of [[item.photoPath, item.photo], ...getVoices(item).map((v) => [v.path, v.url])]) {
      if (isCardMediaPath(path) && url && io.ref(storage, url).fullPath !== path) {
        throw new Error('ファイルの保存パスが一致しません。削除していません。');
      }
    }
    const record = doc(db, 'books', ownerBookId, 'cards', item.id);
    const latest = await deadline(io.getDoc(record), timeoutMs);
    // A stale dialog must not use its old snapshot to delete files after another
    // client has already removed the card.
    if (!latest.exists()) return;
    const current = keepsakeFromData(item.id, latest.data()!);
    const files = [[current.photoPath, current.photo], ...getVoices(current).map((v) => [v.path, v.url])];
    const removed = new Set<string>();
    for (const [path, url] of files) {
      if (!path || removed.has(path)) continue;
      if (isCardMediaPath(path)) await removeFile(path, url ?? undefined);
      removed.add(path);
    }
    await deadline(io.deleteDoc(record), timeoutMs);
  }

  async function subscribeKeepsakes(onChange: (items: Keepsake[]) => void, onError: (error: unknown) => void) {
    const ownerBookId = await bookId();
    return onSnapshot(query(collection(db, 'books', ownerBookId, 'cards'), orderBy('createdAt', 'desc')), (snapshot) => {
      onChange(snapshot.docs.map((record) => keepsakeFromData(record.id, record.data())));
    }, onError);
  }
  return { saveKeepsake, deleteKeepsake, subscribeKeepsakes };
}
