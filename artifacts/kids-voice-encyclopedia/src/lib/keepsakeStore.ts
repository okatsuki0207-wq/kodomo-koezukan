import { initializeApp } from 'firebase/app';
import { indexedDBLocalPersistence, initializeAuth, signInAnonymously } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getFirestore, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { firebaseConfig, isFirebaseConfigured } from '../firebaseConfig';

export type Keepsake = {
  id: string;
  itemName: string;
  photo: string;
  voice: string | null;
  createdAt: number;
  photoPath?: string;
  voicePath?: string | null;
};

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

class FirebaseTimeoutError extends Error {}

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

export async function subscribeKeepsakes(
  onChange: (items: Keepsake[]) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  const uid = await userId();
  return onSnapshot(query(collection(db!, 'users', uid, 'keepsakes'), orderBy('createdAt', 'desc')), (snapshot) => {
    onChange(snapshot.docs.map((record) => {
      const value = record.data();
      return {
        id: record.id, itemName: value.itemName, photo: value.photo, voice: value.voice ?? null,
        photoPath: value.photoPath, voicePath: value.voicePath ?? null,
        createdAt: value.createdAt?.toMillis?.() ?? Date.now(),
      };
    }));
  }, onError);
}

async function removeFile(path: string, downloadUrl?: string) {
  // 旧カードのファイルは旧バケットに残っているため、URLから所属バケットを
  // 解決する。新規アップロードの後片付けは現在の指定バケットを使う。
  const file = ref(storage!, downloadUrl ?? path);
  if (file.fullPath !== path) throw new Error('ファイルの保存パスが一致しません。削除は行いませんでした。');
  try { await deleteObject(file); }
  catch (error) {
    if ((error as { code?: string }).code !== 'storage/object-not-found') throw error;
  }
}

/** ファイルを先にアップロード。Firestore 確定前に失敗したらアップロードを片付ける。 */
export async function saveKeepsake(item: Keepsake, migrating = false): Promise<void> {
  const uid = await userId();
  const record = doc(db!, 'users', uid, 'keepsakes', item.id);
  if (migrating && (await deadline(getDoc(record), 12_000)).exists()) return; // 移行の再実行は重複させない。
  const uploaded: string[] = [];
  try {
    const put = async (source: string, kind: 'photo' | 'voice') => {
      const response = await fetch(source);
      if (!response.ok) throw new Error('画像または音声を読み込めませんでした。');
      const blob = await response.blob();
      if (!blob.type.startsWith(kind === 'photo' ? 'image/' : 'audio/')) throw new Error('ファイル形式が正しくありません。');
      if (blob.size > 20 * 1024 * 1024) throw new Error('ファイルは20MB以内にしてください。');
      const path = `users/${uid}/keepsakes/${item.id}/${kind}`;
      const file = ref(storage!, path);
      await uploadBytes(file, blob, { contentType: blob.type });
      uploaded.push(path);
      return { url: await getDownloadURL(file), path };
    };
    const photo = await put(item.photo, 'photo');
    const voice = item.voice ? await put(item.voice, 'voice') : null;
    await deadline(setDoc(record, {
      itemName: item.itemName, photo: photo.url, voice: voice?.url ?? null,
      photoPath: photo.path, voicePath: voice?.path ?? null,
      createdAt: migrating ? new Date(item.createdAt) : serverTimestamp(),
    }));
  } catch (error) {
    if (error instanceof FirebaseTimeoutError) throw error; // 書き込みが後から完了する可能性がある。
    if (uploaded.length === 0) throw error; // 初回アップロード失敗なら、元の原因をそのまま案内。
    // 接続切断等で書き込み結果が不明ならデータを削除しない。
    try {
      if (!(await deadline(getDoc(record), 12_000)).exists()) {
        await Promise.all(uploaded.map((path) => removeFile(path)));
      }
    } catch {
      throw new Error('保存結果を確認できませんでした。再接続後に一覧を確認してください。未使用ファイルが残った場合はFirebaseコンソールから確認できます。');
    }
    throw error;
  }
}

export async function deleteKeepsake(item: Keepsake): Promise<void> {
  const uid = await userId();
  // 他の利用者のパスを削除しない。部分失敗は再実行可能。
  for (const [path, url] of [[item.photoPath, item.photo], [item.voicePath, item.voice]]) {
    if (path?.startsWith(`users/${uid}/keepsakes/${item.id}/`)) await removeFile(path, url ?? undefined);
  }
  await deadline(deleteDoc(doc(db!, 'users', uid, 'keepsakes', item.id)));
}

export function firebaseError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  const response = (error as { customData?: { serverResponse?: string } })?.customData?.serverResponse ?? '';
  if (code.startsWith('storage/') && response.includes('has not been set up properly for Firebase Storage')) {
    return 'Storageバケット kids_voice_zukan のFirebase設定が未完了です。Firebase ConsoleのStorageでこのバケットを選び、firebase/storage.rules のルールを公開してください。';
  }
  if (code.includes('configuration-not-found')) return 'Firebase Authentication が未設定です。Firebase ConsoleでAuthenticationの「始める」を押し、ログイン方法の「匿名」を有効にしてから再接続してください。';
  if (code.includes('permission-denied') || code.includes('unauthorized')) return 'Firebase のアクセス権限がありません。Firestore / Storage のルールとBlazeプランをご確認ください。';
  if (code.includes('operation-not-allowed')) return 'Firebase Authentication の匿名ログインを有効にしてください。';
  if (code.includes('network') || code.includes('unavailable') || code.includes('retry-limit')) return 'Firebase に接続できませんでした。通信を確認してもう一度お試しください。';
  return error instanceof Error ? error.message : 'Firebase の処理に失敗しました。設定と通信をご確認ください。';
}
