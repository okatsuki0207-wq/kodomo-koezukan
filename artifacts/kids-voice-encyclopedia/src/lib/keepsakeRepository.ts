import { collection, deleteDoc, doc, getDocFromServer, onSnapshot, orderBy, query, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { diagnoseStorageError } from './storageDiagnostics.ts';
import { keepsakeMetadata } from './categories.ts';

export type Keepsake = {
  id: string;
  itemName: string;
  photo: string;
  voice: string | null;
  createdAt: number;
  photoPath?: string;
  voicePath?: string | null;
  categoryId?: string | null;
};

export class FirebaseTimeoutError extends Error {}

function deadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
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

  async function save(item: Keepsake, migrating: boolean, uid: string) {
    const record = doc(db, 'users', uid, 'keepsakes', item.id);
    // A retry is not an edit. Never overwrite a committed card, even after a lost acknowledgement.
    if ((await deadline(io.getDoc(record), timeoutMs)).exists()) return;
    const metadata = keepsakeMetadata(item.itemName, item.categoryId ?? null);
    const uploaded: string[] = [];
    const attempt = crypto.randomUUID();
    let commitStarted = false;
    try {
      const put = async (source: string, kind: 'photo' | 'voice') => {
        const response = await fetch(source);
        if (!response.ok) throw new Error('画像または音声を読み込めませんでした。');
        const blob = await response.blob();
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
      const photo = await put(item.photo, 'photo');
      const voice = item.voice ? await put(item.voice, 'voice') : null;
      commitStarted = true;
      const committed = await deadline(io.runTransaction(db, async (transaction) => {
        if ((await transaction.get(record)).exists()) return false;
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
        throw new Error('保存結果を確認できませんでした。再接続後に一覧を確認してください。未使用ファイルが残った場合はFirebaseコンソールから確認できます。');
      }
      // If acknowledgement was lost, keep any files referenced by the committed card.
      // If the result cannot be read, preserve all files rather than risk data loss.
      try {
        const result = await deadline(io.getDoc(record), timeoutMs);
        const value = result.data();
        await Promise.all(uploaded.filter((path) => path !== value?.photoPath && path !== value?.voicePath).map((path) => removeFile(path)));
      } catch {
        throw new Error('保存結果を確認できませんでした。再接続後に一覧を確認してください。未使用ファイルが残った場合はFirebaseコンソールから確認できます。');
      }
      throw error;
    }
  }

  async function saveKeepsake(item: Keepsake, migrating = false): Promise<void> {
    const uid = await userId();
    const key = `${uid}/${item.id}`;
    if (pending.has(key)) return pending.get(key)!;
    const operation = save(item, migrating, uid).finally(() => pending.delete(key));
    pending.set(key, operation);
    return operation;
  }

  async function deleteKeepsake(item: Keepsake): Promise<void> {
    const uid = await userId();
    for (const [path, url] of [[item.photoPath, item.photo], [item.voicePath, item.voice]]) {
      if (path?.startsWith(`users/${uid}/keepsakes/${item.id}/`)) await removeFile(path, url ?? undefined);
    }
    await deadline(io.deleteDoc(doc(db, 'users', uid, 'keepsakes', item.id)), timeoutMs);
  }

  async function subscribeKeepsakes(onChange: (items: Keepsake[]) => void, onError: (error: unknown) => void) {
    const uid = await userId();
    return onSnapshot(query(collection(db, 'users', uid, 'keepsakes'), orderBy('createdAt', 'desc')), (snapshot) => {
      onChange(snapshot.docs.map((record) => {
        const value = record.data();
        return {
          id: record.id, itemName: value.itemName, photo: value.photo, voice: value.voice ?? null,
          photoPath: value.photoPath, voicePath: value.voicePath ?? null,
          categoryId: value.categoryId ?? null,
          createdAt: value.createdAt?.toMillis?.() ?? Date.now(),
        };
      }));
    }, onError);
  }
  return { saveKeepsake, deleteKeepsake, subscribeKeepsakes };
}
