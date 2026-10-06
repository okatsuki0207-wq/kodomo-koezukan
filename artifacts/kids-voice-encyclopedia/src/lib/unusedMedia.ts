import { collection, doc, getDocsFromServer, runTransaction, type Firestore } from 'firebase/firestore';
import { deleteObject, getMetadata, list, ref, type FirebaseStorage, type FullMetadata, type StorageReference } from 'firebase/storage';

export const MEDIA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export type UnusedFile = {
  path: string;
  bucket: string;
  size: number;
  updatedAt: number;
  generation: string;
  cardId: string | null;
  attemptId: string | null;
  status: 'referenced' | 'active' | 'legacy' | 'waiting' | 'eligible';
};
export type UnusedMediaReport = { files: UnusedFile[]; checkedAt: number; bucket: string };
const sdk = { getDocsFromServer, runTransaction, getMetadata, list, deleteObject };

// No URLs/tokens are returned to the UI or written to logs. A path without a bucket is
// also protected conservatively when an older card points at a different bucket.
function references(data: Record<string, unknown>): Set<string> {
  const paths = new Set<string>();
  for (const field of ['photoPath', 'voicePath']) {
    if (typeof data[field] === 'string') paths.add(data[field] as string);
  }
  if (data.voices !== undefined) {
    if (!Array.isArray(data.voices)) throw new Error('音声ファイルの参照を確認できません。削除しません。');
    for (const voice of data.voices) {
      if (!voice || typeof voice.url !== 'string') throw new Error('音声ファイルの参照を確認できません。削除しません。');
      for (const path of references({ voice: voice.url, voicePath: voice.path })) paths.add(path);
    }
  }
  for (const field of ['photo', 'voice']) {
    const url = data[field];
    if (url == null) continue;
    if (typeof url !== 'string') throw new Error('古いカードのファイル参照を確認できません。削除は行いません。');
    try {
      // Parse independently of the currently configured bucket/emulator host.
      // Query parameters (including download tokens) never leave this function.
      const gs = /^gs:\/\/[^/]+\/(.+)$/.exec(url);
      if (gs) paths.add(gs[1]);
      else {
        const parsed = new URL(url);
        if (parsed.origin !== 'https://firebasestorage.googleapis.com') throw new Error('unknown media URL');
        const match = /^\/v0\/b\/[^/]+\/o\/(.+)$/.exec(parsed.pathname);
        if (!match) throw new Error('unknown media URL');
        paths.add(decodeURIComponent(match[1]));
      }
    } catch {
      throw new Error('古いカードのファイル参照を確認できません。削除は行いません。');
    }
  }
  return paths;
}

function identity(path: string, uid: string) {
  const parts = path.split('/');
  if (parts.length !== 6 || parts[0] !== 'users' || parts[1] !== uid ||
      parts[2] !== 'keepsakes' || !/^[a-zA-Z0-9-]+$/.test(parts[4]) ||
      !['photo', 'voice'].includes(parts[5])) return null;
  return { cardId: parts[3], attemptId: parts[4] };
}

export function createUnusedMediaService(
  db: Firestore,
  storage: FirebaseStorage,
  userId: () => Promise<string>,
  operations: Partial<typeof sdk> = {},
) {
  const io = { ...sdk, ...operations };
  const bucket = ref(storage).bucket;
  // Prevent forged UI input and require a read-only scan in this service/session first.
  const approvals = new Map<string, UnusedFile>();

  async function serverReferences(uid: string) {
    const snapshot = await io.getDocsFromServer(collection(db, 'users', uid, 'keepsakes'));
    const result = new Set<string>();
    for (const card of snapshot.docs) for (const path of references(card.data())) result.add(path);
    return result;
  }

  async function allFiles(root: StorageReference): Promise<FullMetadata[]> {
    const result: FullMetadata[] = [];
    let pageToken: string | undefined;
    do {
      const page = await io.list(root, { maxResults: 100, ...(pageToken ? { pageToken } : {}) });
      for (const file of page.items) result.push(await io.getMetadata(file));
      for (const prefix of page.prefixes) result.push(...await allFiles(prefix));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return result;
  }

  async function inspectUnusedMedia(): Promise<UnusedMediaReport> {
    approvals.clear();
    const uid = await userId();
    // Always server reads. Any unavailable/denied read fails the entire report closed.
    const [referenced, attempts, metadata] = await Promise.all([
      serverReferences(uid),
      io.getDocsFromServer(collection(db, 'users', uid, 'saveAttempts')),
      allFiles(ref(storage, `users/${uid}/keepsakes`)),
    ]);
    const states = new Map(attempts.docs.map((entry) => [entry.id, entry.data()]));
    const referencedAttempts = new Set<string>();
    for (const path of referenced) {
      const id = identity(path, uid);
      if (id) referencedAttempts.add(`${id.cardId}/${id.attemptId}`);
    }
    const now = Date.now();
    const files = metadata.map((file): UnusedFile => {
      const id = identity(file.fullPath, uid);
      const state = id ? states.get(id.attemptId) : undefined;
      const updatedAt = Date.parse(file.updated);
      const finishedAt = state?.finishedAt?.toMillis?.();
      let status: UnusedFile['status'];
      if (referenced.has(file.fullPath) || (id && referencedAttempts.has(`${id.cardId}/${id.attemptId}`))) status = 'referenced';
      else if (!id || !state || state.cardId !== id.cardId || state.bucket !== bucket) status = 'legacy';
      else if (state.state === 'active') status = 'active';
      else if (!['finished', 'blocked'].includes(state.state) || !Number.isFinite(finishedAt) ||
        !Number.isFinite(updatedAt) || now - Math.max(updatedAt, finishedAt) < MEDIA_RETENTION_MS) status = 'waiting';
      else status = 'eligible';
      return {
        path: file.fullPath, bucket: file.bucket, size: file.size, updatedAt,
        generation: file.generation, cardId: id?.cardId ?? null, attemptId: id?.attemptId ?? null, status,
      };
    });
    for (const file of files) if (file.status === 'eligible' && file.bucket === bucket) approvals.set(file.path, file);
    return { files: files.sort((a, b) => a.path.localeCompare(b.path)), checkedAt: now, bucket };
  }

  async function deleteUnusedMedia(path: string, confirmed: boolean): Promise<void> {
    const uid = await userId();
    const candidate = approvals.get(path);
    const id = identity(path, uid);
    if (!confirmed || !candidate || !id || candidate.bucket !== bucket) {
      throw new Error('最新の確認一覧で対象を選び、個別に削除を確認してください。');
    }
    approvals.delete(path);
    if ((await serverReferences(uid)).has(path)) throw new Error('このファイルはカードから参照されています。削除しません。');
    const file = ref(storage, path);
    const metadata = await io.getMetadata(file);
    const updatedAt = Date.parse(metadata.updated);
    if (metadata.bucket !== bucket || metadata.generation !== candidate.generation ||
      !Number.isFinite(updatedAt) || Date.now() - updatedAt < MEDIA_RETENTION_MS) {
      throw new Error('確認後にファイルが変わりました。もう一度一覧を確認してください。');
    }
    // A permanent, server-validated fence wins atomically against a delayed commit.
    // The per-card transaction is necessary in addition to the collection server read.
    await io.runTransaction(db, async (transaction) => {
      const attemptRecord = doc(db, 'users', uid, 'saveAttempts', id.attemptId);
      const [attempt, card] = await Promise.all([
        transaction.get(attemptRecord), transaction.get(doc(db, 'users', uid, 'keepsakes', id.cardId)),
      ]);
      const value = attempt.data();
      if (value?.cardId !== id.cardId || value.bucket !== bucket ||
        !['finished', 'blocked'].includes(value.state) ||
        !Number.isFinite(value.finishedAt?.toMillis?.()) ||
        Date.now() - value.finishedAt.toMillis() < MEDIA_RETENTION_MS) {
        throw new Error('保存中または待機期間中のファイルです。削除しません。');
      }
      if (card.exists() && [...references(card.data()!)].some((cardPath) =>
        cardPath.startsWith(`users/${uid}/keepsakes/${id.cardId}/${id.attemptId}/`))) {
        throw new Error('このファイルはカードから参照されています。削除しません。');
      }
      if (value.state === 'finished') transaction.update(attemptRecord, { state: 'blocked' });
    });
    // No automatic retries/bulk deletion. A partial failure keeps the permanent fence.
    // A new scan + explicit confirmation allows the user to retry the remaining file.
    if ((await serverReferences(uid)).has(path)) throw new Error('ファイルの参照が見つかりました。削除しません。');
    await io.deleteObject(file);
  }

  return { inspectUnusedMedia, deleteUnusedMedia };
}
