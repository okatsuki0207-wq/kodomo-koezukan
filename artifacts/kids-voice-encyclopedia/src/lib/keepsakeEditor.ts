import { doc, getDocFromServer, runTransaction, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, type FirebaseStorage } from 'firebase/storage';
import { deadline, FirebaseTimeoutError, type Keepsake } from './keepsakeRepository.ts';
import { keepsakeMetadata, validateCategoryId } from './categories.ts';
import { getVoices, keepsakeFromData, MAX_VOICES, MAX_EDIT_FILES, type KeepsakeEdit, type VoiceAsset } from './voiceAssets.ts';
import { diagnoseStorageError } from './storageDiagnostics.ts';

class EditConflict extends Error {}
const sdk = { getDoc: getDocFromServer, runTransaction, uploadBytes, getDownloadURL, ref, diagnoseStorageError };

/** Replacements never overwrite object bytes; receipts make ambiguous retries idempotent. */
export function createKeepsakeEditor(db: Firestore, storage: FirebaseStorage, userId: () => Promise<string>,
  operations: Partial<typeof sdk> = {}, timeoutMs = 30_000) {
  const io = { ...sdk, ...operations };
  const pending = new Map<string, Promise<Keepsake>>();
  async function edit(base: Keepsake, changes: KeepsakeEdit, editId: string, uid: string): Promise<Keepsake> {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(editId) || !base.id || base.id.includes('/')) throw new Error('編集情報を確認できません。画面を開き直してください。');
    const additions = changes.voices ?? [];
    if (additions.length + (changes.photo !== undefined ? 1 : 0) > MAX_EDIT_FILES) {
      throw new Error('1回の保存で変更できる写真・音声は合計5ファイルまでです。音声5件と写真を変える場合は、写真の変更を戻して音声を保存し、もう一度編集して写真を変更してください。');
    }
    if (additions.length > MAX_VOICES || new Set(additions.map((v) => v.id)).size !== additions.length ||
      additions.some((v) => !/^[a-zA-Z0-9-]{1,64}$/.test(v.id))) throw new Error('音声の編集情報を確認してください。');
    if (changes.itemName !== undefined) keepsakeMetadata(changes.itemName);
    if (changes.categoryId !== undefined) validateCategoryId(changes.categoryId);
    const record = doc(db, 'users', uid, 'keepsakes', base.id);
    const receipt = doc(db, 'users', uid, 'mediaEdits', editId);
    const initial = await deadline(io.getDoc(record), timeoutMs);
    if (!initial.exists()) throw new EditConflict('このカードは削除されています。編集画面を閉じて一覧を確認してください。');
    // Metadata-only editing stays compatible with existing deployed rules and
    // never needs Storage or the new media-edit receipt collection.
    if (changes.photo === undefined && additions.length === 0) {
      const patch: Record<string, unknown> = {};
      if (changes.itemName !== undefined) patch.itemName = keepsakeMetadata(changes.itemName).itemName;
      if (changes.categoryId !== undefined) patch.categoryId = changes.categoryId;
      if (Object.keys(patch).length) await deadline(updateDoc(record, patch), timeoutMs);
      return keepsakeFromData(base.id, { ...initial.data(), ...patch });
    }
    const previous = await deadline(io.getDoc(receipt), timeoutMs);
    if (previous.exists()) {
      if (previous.data()?.cardId !== base.id) throw new Error('編集情報が一致しません。');
      return keepsakeFromData(base.id, initial.data()!);
    }
    const attempts: ReturnType<typeof doc>[] = [];
    const finished = new Set<string>();
    const uploads = new Map<string, { url: string; path: string }>();
    let commitStarted = false;
    try {
      const put = async (source: string, key: string, kind: 'photo' | 'voice') => {
        const response = await fetch(source);
        if (!response.ok) throw new Error('変更するファイルを読み込めませんでした。');
        const blob = await response.blob();
        if (!blob.size || blob.size >= 20 * 1024 * 1024 || !blob.type.startsWith(kind === 'photo' ? 'image/' : 'audio/')) {
          throw new Error('空でない20MB未満の画像・音声ファイルを選んでください。');
        }
        const attemptId = crypto.randomUUID();
        const attempt = doc(db, 'users', uid, 'saveAttempts', attemptId);
        await deadline(setDoc(attempt, { cardId: base.id, bucket: io.ref(storage).bucket,
          state: 'active', startedAt: serverTimestamp() }), timeoutMs);
        attempts.push(attempt);
        const path = `users/${uid}/keepsakes/${base.id}/${attemptId}/${kind}`;
        const file = io.ref(storage, path);
        try {
          await deadline(io.uploadBytes(file, blob, { contentType: blob.type }), timeoutMs);
          uploads.set(key, { path, url: await deadline(io.getDownloadURL(file), timeoutMs) });
        } catch (caught) { throw await io.diagnoseStorageError(caught, file.bucket); }
      };
      if (changes.photo !== undefined) await put(changes.photo, 'photo', 'photo');
      for (const voice of additions) await put(voice.source, `voice:${voice.id}`, 'voice');
      // Finish verified uploads in separate small requests to stay within the
      // Firestore rule-expression budget for a five-clip edit. The final transaction
      // reads these fences; cleanup changing one to blocked forces it to abort.
      const uploaded = [...uploads.values()];
      await Promise.all(attempts.map(async (attempt, index) => {
        await deadline(updateDoc(attempt, { state: 'finished', finishedAt: serverTimestamp(), media: uploaded[index] }), timeoutMs);
        finished.add(attempt.id);
      }));
      commitStarted = true;
      const result = await deadline(io.runTransaction(db, async (tx) => {
        // All reads precede writes. Completed attempts cannot be reused by late writers.
        const [current, committed, ...statuses] = await Promise.all([
          tx.get(record), tx.get(receipt), ...attempts.map((attempt) => tx.get(attempt)),
        ]);
        if (!current.exists()) throw new EditConflict('カードが削除されました。元のファイルは削除していません。');
        if (statuses.some((status) => status.data()?.state !== 'finished')) throw new EditConflict('この編集の保存試行は終了しています。もう一度保存してください。');
        const data = current.data()!;
        const currentItem = keepsakeFromData(base.id, data);
        if (committed.exists()) {
          if (committed.data()?.cardId !== base.id) throw new EditConflict('編集情報が一致しません。');
          return currentItem;
        }
        if (changes.photo !== undefined && data.photo !== base.photo) {
          throw new EditConflict('写真が別の画面で変更されました。編集画面を開き直してください。');
        }
        if (data.voices !== undefined && (!Array.isArray(data.voices) ||
          data.voices.some((v: VoiceAsset) => !v || typeof v.id !== 'string' || typeof v.url !== 'string'))) {
          throw new EditConflict('保存済み音声を確認できません。変更せずに中断しました。');
        }
        const voices = getVoices(currentItem).map((v) => ({ ...v, path: v.path ?? null }));
        const original = getVoices(base);
        for (const change of additions) {
          const before = original.find((v) => v.id === change.id);
          const index = voices.findIndex((v) => v.id === change.id);
          if ((before && (index < 0 || voices[index].url !== before.url)) || (!before && index >= 0)) {
            throw new EditConflict('音声が別の画面で変更されました。編集画面を開き直してください。');
          }
          const voice = { id: change.id, ...uploads.get(`voice:${change.id}`)! };
          if (index < 0) voices.push(voice); else voices[index] = voice;
        }
        if (voices.length > MAX_VOICES) throw new EditConflict(`音声は${MAX_VOICES}件までです。編集画面を開き直してください。`);
        const patch: Record<string, unknown> = {};
        if (changes.itemName !== undefined) patch.itemName = keepsakeMetadata(changes.itemName).itemName;
        if (changes.categoryId !== undefined) patch.categoryId = changes.categoryId;
        if (changes.photo !== undefined) { patch.photo = uploads.get('photo')!.url; patch.photoPath = uploads.get('photo')!.path; }
        if (additions.length) {
          patch.voices = voices; patch.voice = voices[0]?.url ?? null; patch.voicePath = voices[0]?.path ?? null;
        }
        if (Object.keys(patch).length) tx.update(record, patch);
        tx.set(receipt, { cardId: base.id, createdAt: serverTimestamp() });
        return keepsakeFromData(base.id, { ...data, ...patch });
      }), timeoutMs);
      // Old files and losing concurrent candidates are deliberately retained. Only
      // the existing seven-day, individually confirmed fenced cleanup may remove them.
      return result;
    } catch (caught) {
      if (caught instanceof FirebaseTimeoutError ||
        (commitStarted && !(caught instanceof EditConflict) && (caught as { code?: string })?.code !== 'permission-denied')) {
        throw new Error('編集の保存結果を確認できません。後から完了する場合があります。再接続後に一覧を確認してください。同じ編集の再保存では音声を二重追加しません。元のファイルは保持しています。');
      }
      // A definite failed operation has no delayed commit. Keep its bytes for the
      // normal grace period, and mark finished only if the status write succeeds.
      await Promise.all(attempts.filter((attempt) => !finished.has(attempt.id)).map(async (attempt) => {
        try { await deadline(updateDoc(attempt, { state: 'finished', finishedAt: serverTimestamp() }), timeoutMs); } catch { /* protected active */ }
      }));
      throw caught;
    }
  }
  return {
    async editKeepsake(base: Keepsake, changes: KeepsakeEdit, editId: string) {
      const uid = await userId(), key = `${uid}/${base.id}/${editId}`;
      if (pending.has(key)) return pending.get(key)!;
      const operation = edit(base, changes, editId, uid).finally(() => pending.delete(key));
      pending.set(key, operation);
      return operation;
    },
  };
}
