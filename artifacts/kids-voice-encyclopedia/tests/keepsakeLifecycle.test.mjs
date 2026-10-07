import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, deleteDoc, setDoc, updateDoc, runTransaction, collection, getDocs, Timestamp, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, getMetadata, getBytes, deleteObject, list } from 'firebase/storage';
import { createKeepsakeRepository } from '../src/lib/keepsakeRepository.ts';
import { createUnusedMediaService, MEDIA_RETENTION_MS } from '../src/lib/unusedMedia.ts';
import { createKeepsakeEditor } from '../src/lib/keepsakeEditor.ts';

const projectId = 'demo-keepsakes-test';
const storageOrigin = 'http://127.0.0.1:9197';
// Hard fail before opening a client if someone runs this file outside the isolated runner.
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8087');
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:9197');

const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
// 10 ms silent mono PCM WAV, generated in memory (no family media).
const voiceBytes = Buffer.alloc(204);
voiceBytes.write('RIFF'); voiceBytes.writeUInt32LE(196, 4); voiceBytes.write('WAVEfmt ', 8);
voiceBytes.writeUInt32LE(16, 16); voiceBytes.writeUInt16LE(1, 20); voiceBytes.writeUInt16LE(1, 22);
voiceBytes.writeUInt32LE(8000, 24); voiceBytes.writeUInt32LE(16000, 28);
voiceBytes.writeUInt16LE(2, 32); voiceBytes.writeUInt16LE(16, 34);
voiceBytes.write('data', 36); voiceBytes.writeUInt32LE(160, 40);
const source = (bytes, type) => `data:${type};base64,${bytes.toString('base64')}`;
const item = (id, voice = true) => ({
  id, itemName: 'テスト', photo: source(photoBytes, 'image/png'),
  voice: voice ? source(voiceBytes, 'audio/wav') : null, createdAt: 1_700_000_000_000,
});

let env;
let alice;
let bob;
let anonymous;
const clients = (context) => ({ db: context.firestore(), storage: context.storage(`${projectId}.appspot.com`) });

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: 8087, rules: await readFile(new URL('../firebase/firestore.rules', import.meta.url), 'utf8') },
    storage: { host: '127.0.0.1', port: 9197, rules: await readFile(new URL('../firebase/storage.rules', import.meta.url), 'utf8') },
  });
  alice = clients(env.authenticatedContext('alice'));
  bob = clients(env.authenticatedContext('bob'));
  anonymous = clients(env.unauthenticatedContext());
});
beforeEach(async () => {
  await env.clearFirestore();
  // rules-unit-testing clearStorage() only deletes root-level items in its default
  // bucket, not nested prefixes or explicitly selected buckets. Clean both demo
  // buckets recursively so every inventory test starts with truly isolated data.
  await env.withSecurityRulesDisabled(async (context) => {
    async function clearDirectory(directory) {
      const { items, prefixes } = await directory.listAll();
      await Promise.all(items.map((file) => file.delete()));
      for (const prefix of prefixes) await clearDirectory(prefix);
    }
    for (const bucket of [`${projectId}.appspot.com`, `${projectId}-old.appspot.com`]) {
      await clearDirectory(context.storage(bucket).ref());
    }
  });
});
after(async () => { await env?.cleanup(); });

// Emulator download URLs use HTTP loopback. Production rules intentionally accept only HTTPS
// Firebase URLs. Normalize only the host on the real SDK-returned URL (retain bucket/path/token);
// do not weaken production rules just to allow an emulator host. Byte checks reverse this mapping.
const canonicalUrl = async (file) => (await getDownloadURL(file)).replace(storageOrigin, 'https://firebasestorage.googleapis.com');
const nodeUpload = async (file, blob, metadata) => uploadBytes(file, new Uint8Array(await blob.arrayBuffer()), metadata);
const repository = (client = alice, uid = 'alice', faults = {}, timeout = 5000) =>
  createKeepsakeRepository(client.db, client.storage, async () => uid,
    {
      uploadBytes: nodeUpload, getDownloadURL: canonicalUrl,
      ref: (storage, path) => ref(storage, path.replace('https://firebasestorage.googleapis.com', storageOrigin)),
      // Never run the production read-only bucket probe from an emulator test.
      diagnoseStorageError: async (error) => error,
      ...faults,
    }, timeout);

const editor = (client = alice, uid = 'alice', faults = {}, timeout = 5000) =>
  createKeepsakeEditor(client.db, client.storage, async () => uid, {
    uploadBytes: nodeUpload, getDownloadURL: canonicalUrl,
    ref: (storage, path) => ref(storage, path?.replace('https://firebasestorage.googleapis.com', storageOrigin)),
    diagnoseStorageError: async (error) => error, ...faults,
  }, timeout);

test('media editing atomically replaces photo/voice, adds clips, preserves dates and old bytes; receipt retry is idempotent', async () => {
  const repo = repository();
  await repo.saveKeepsake(item('edited'));
  const original = (await getDocFromServer(doc(alice.db, 'users/alice/keepsakes/edited'))).data();
  const base = { ...item('edited'), ...original };
  const api = editor();
  const changed = await api.editKeepsake(base, {
    photo: source(photoBytes, 'image/png'), itemName: '編集後',
    voices: [{ id: 'primary', source: source(voiceBytes, 'audio/wav') }, { id: 'extra', source: source(voiceBytes, 'audio/wav') }],
  }, 'edit-one');
  assert.equal(changed.voices.length, 2);
  assert.equal(changed.voice, changed.voices[0].url);
  assert.equal(changed.itemName, '編集後');
  assert.equal(changed.createdAt, original.createdAt.toMillis());
  assert.notEqual(changed.photoPath, original.photoPath);
  assert.notEqual(changed.voicePath, original.voicePath);
  assert.deepEqual(Buffer.from(await getBytes(ref(alice.storage, original.voicePath))), voiceBytes);
  assert.deepEqual(Buffer.from(await getBytes(ref(alice.storage, original.photoPath))), photoBytes);
  const retry = await api.editKeepsake(base, { voices: [{ id: 'extra', source: source(voiceBytes, 'audio/wav') }] }, 'edit-one');
  assert.deepEqual(retry.voices, changed.voices);
  const restored = (await getDocFromServer(doc(alice.db, 'users/alice/keepsakes/edited'))).data();
  assert.deepEqual(restored.voices, changed.voices);
  assert.equal(restored.createdAt.toMillis(), original.createdAt.toMillis());
  await repo.deleteKeepsake(changed);
  for (const v of changed.voices) await assert.rejects(getMetadata(ref(alice.storage, v.path)), (e) => e.code === 'storage/object-not-found');
});

test('voice-less card accepts added audio, metadata edits upload nothing, maximum five is enforced', async () => {
  await repository().saveKeepsake(item('silent-edit', false));
  const stored = (await getDocFromServer(doc(alice.db, 'users/alice/keepsakes/silent-edit'))).data();
  const base = { ...item('silent-edit', false), ...stored };
  const named = await editor(alice, 'alice', { uploadBytes: () => { throw new Error('unexpected upload'); } })
    .editKeepsake(base, { itemName: '新しい名前' }, 'name-only');
  assert.equal(named.photoPath, stored.photoPath);
  assert.equal(named.voice, null);
  const categoryId = `custom-${'a'.repeat(64)}`;
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/alice/categories/${categoryId}`), { name: 'テスト分類', createdAt: Timestamp.now() });
  });
  // Six-file edits fail before any upload. Worst supported edit: a new photo,
  // four new voices and a custom category
  // in one commit, including real Firestore expression/access-call limits.
  const firstFour = Array.from({ length: 4 }, (_, i) => ({ id: `clip-${i}`, source: source(voiceBytes, 'audio/wav') }));
  await assert.rejects(editor(alice, 'alice', { uploadBytes: () => { throw new Error('should not upload'); } })
    .editKeepsake(named, { photo: source(photoBytes, 'image/png'), voices: [...firstFour, { id: 'clip-4', source: source(voiceBytes, 'audio/wav') }] }, 'too-many-files'), /合計5ファイル/);
  const four = await editor().editKeepsake(named, { photo: source(photoBytes, 'image/png'), categoryId, voices: firstFour }, 'add-four');
  const voiced = await editor().editKeepsake(four, { voices: [{ id: 'clip-4', source: source(voiceBytes, 'audio/wav') }] }, 'add-last');
  assert.equal(voiced.voices.length, 5);
  await assert.rejects(editor().editKeepsake(voiced, { voices: [{ id: 'sixth', source: source(voiceBytes, 'audio/wav') }] }, 'add-six'), /5件/);
  assert.equal((await getDocFromServer(doc(alice.db, 'users/alice/keepsakes/silent-edit'))).data().voices.length, 5);
});

test('failed upload or missing card cannot replace existing data or remove original media', async () => {
  await repository().saveKeepsake(item('fail-edit'));
  const stored = (await getDocFromServer(doc(alice.db, 'users/alice/keepsakes/fail-edit'))).data();
  const base = { ...item('fail-edit'), ...stored };
  await assert.rejects(editor(alice, 'alice', { uploadBytes: async () => { throw new Error('injected upload failure'); } })
    .editKeepsake(base, { photo: source(photoBytes, 'image/png') }, 'fail-edit'), /upload failure/);
  assert.deepEqual((await getDocFromServer(doc(alice.db, 'users/alice/keepsakes/fail-edit'))).data(), stored);
  assert.deepEqual(Buffer.from(await getBytes(ref(alice.storage, stored.voicePath))), voiceBytes);
  await assert.rejects(editor().editKeepsake({ ...base, id: 'missing' }, { photo: source(photoBytes, 'image/png') }, 'missing-edit'), /削除/);
});

test('lost edit acknowledgement retains committed bytes and retry cannot duplicate added voices', async () => {
  await repository().saveKeepsake(item('unknown-edit'));
  const stored = (await getDocFromServer(doc(alice.db, 'users/alice/keepsakes/unknown-edit'))).data();
  const base = { ...item('unknown-edit'), ...stored };
  const faulty = editor(alice, 'alice', { runTransaction: async (...args) => {
    await runTransaction(...args); throw Object.assign(new Error('lost ack'), { code: 'unavailable' });
  } });
  await assert.rejects(faulty.editKeepsake(base, { voices: [{ id: 'added', source: source(voiceBytes, 'audio/wav') }] }, 'unknown-one'), /結果を確認/);
  const result = await editor().editKeepsake(base, { voices: [{ id: 'added', source: source(voiceBytes, 'audio/wav') }] }, 'unknown-one');
  assert.equal(result.voices.length, 2);
  for (const voice of result.voices) assert.deepEqual(Buffer.from(await getBytes(ref(alice.storage, voice.path))), voiceBytes);
});

test('concurrent replacements conflict without overwriting the winner; concurrent additions merge', async () => {
  await repository().saveKeepsake(item('race-edit'));
  const base = { ...item('race-edit'), ...(await getDocFromServer(doc(alice.db, 'users/alice/keepsakes/race-edit'))).data() };
  const replacements = await Promise.allSettled(['replace-one', 'replace-two'].map((id) =>
    editor().editKeepsake(base, { photo: source(photoBytes, 'image/png') }, id)));
  assert.equal(replacements.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(replacements.filter((r) => r.status === 'rejected').length, 1);
  await Promise.all(['audio-one', 'audio-two'].map((id) =>
    editor().editKeepsake(base, { voices: [{ id, source: source(voiceBytes, 'audio/wav') }] }, id)));
  const data = (await getDocFromServer(doc(alice.db, 'users/alice/keepsakes/race-edit'))).data();
  assert.equal(data.voices.length, 3);
  assert.equal(new Set(data.voices.map((v) => v.id)).size, 3);
});

test('additional audio is protected from orphan cleanup and foreign UID writes; creation date and immutable receipts are fenced', async () => {
  await repository().saveKeepsake(item('protected-edit'));
  const base = { ...item('protected-edit'), ...(await getDocFromServer(doc(alice.db, 'users/alice/keepsakes/protected-edit'))).data() };
  const changed = await editor().editKeepsake(base, { voices: [{ id: 'additional', source: source(voiceBytes, 'audio/wav') }] }, 'protected-one');
  const attempt = changed.voices[1].path.split('/')[4];
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `users/alice/saveAttempts/${attempt}`), { finishedAt: Timestamp.fromMillis(Date.now() - MEDIA_RETENTION_MS * 2) });
  });
  await assertFails(updateDoc(doc(alice.db, `users/alice/saveAttempts/${attempt}`), { state: 'blocked' }));
  await assertFails(updateDoc(doc(bob.db, 'users/alice/keepsakes/protected-edit'), { voices: [] }));
  await assertFails(updateDoc(doc(alice.db, 'users/alice/keepsakes/protected-edit'), { createdAt: Timestamp.now() }));
  await assertFails(deleteDoc(doc(alice.db, 'users/alice/mediaEdits/protected-one')));
  const report = await createUnusedMediaService(alice.db, alice.storage, async () => 'alice').inspectUnusedMedia();
  assert.equal(report.files.find((f) => f.path === changed.voices[1].path).status, 'referenced');
});
const record = (id, client = alice, uid = 'alice') => doc(client.db, 'users', uid, 'keepsakes', id);
async function stored(id) {
  const snapshot = await getDocFromServer(record(id));
  assert.equal(snapshot.exists(), true);
  return { id, ...snapshot.data(), categoryId: snapshot.data().categoryId ?? null, createdAt: snapshot.data().createdAt.toMillis() };
}
async function mediaBytes(url) {
  const response = await fetch(url.replace('https://firebasestorage.googleapis.com', storageOrigin));
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
}
async function absent(path) {
  await assert.rejects(getMetadata(ref(alice.storage, path)), { code: 'storage/object-not-found' });
}
async function unchanged(id, previous) {
  assert.deepEqual(await stored(id), previous);
  assert.deepEqual(await mediaBytes(previous.photo), photoBytes);
  if (previous.voice) assert.deepEqual(await mediaBytes(previous.voice), voiceBytes);
}
async function reload(repo) {
  let unsubscribe;
  const items = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscription timed out')), 5000);
    repo.subscribeKeepsakes((items) => { clearTimeout(timer); resolve(items); },
      (error) => { clearTimeout(timer); reject(error); }).then((stop) => { unsubscribe = stop; }, reject);
  });
  unsubscribe?.();
  return items;
}

test('photo and voice upload → Firestore URLs → fresh subscription → playback bytes → deletion', async () => {
  await repository().saveKeepsake(item('lifecycle'));
  const value = await stored('lifecycle');
  assert.match(value.photoPath, /^users\/alice\/keepsakes\/lifecycle\/[a-z0-9-]+\/photo$/);
  assert.equal(value.voicePath, value.photoPath.replace(/photo$/, 'voice'));
  assert.match(value.photo, /^https:\/\/firebasestorage.googleapis.com\//);
  assert.match(value.voice, /^https:\/\/firebasestorage.googleapis.com\//);
  assert.ok(value.createdAt > item('lifecycle').createdAt);
  assert.equal((await getMetadata(ref(alice.storage, value.photoPath))).contentType, 'image/png');
  assert.equal((await getMetadata(ref(alice.storage, value.voicePath))).contentType, 'audio/wav');
  const fresh = clients(env.authenticatedContext('alice'));
  const reloaded = await reload(repository(fresh));
  assert.deepEqual(reloaded, [value]);
  assert.deepEqual(await mediaBytes(reloaded[0].photo), photoBytes);
  const playback = await getDownloadURL(ref(fresh.storage, reloaded[0].voicePath));
  assert.deepEqual(await mediaBytes(playback), voiceBytes);
  await repository(fresh).deleteKeepsake(reloaded[0]);
  assert.equal((await getDocFromServer(record('lifecycle'))).exists(), false);
  await absent(value.photoPath); await absent(value.voicePath);
  assert.deepEqual(await reload(repository(fresh)), []);
  await repository(fresh).deleteKeepsake(reloaded[0]); // retry is safe
});

test('photo-only and migration retry preserve the original timestamp and do not duplicate', async () => {
  await repository().saveKeepsake(item('migration', false), true);
  const previous = await stored('migration');
  assert.equal(previous.voice, null); assert.equal(previous.voicePath, null);
  assert.equal(previous.createdAt, item('migration').createdAt);
  await repository().saveKeepsake({ ...item('migration'), itemName: '別の名前' }, true);
  await unchanged('migration', previous);
});

test('categorized saves and metadata edits preserve unique media paths and creation time', async () => {
  await repository().saveKeepsake({ ...item('categorized'), categoryId: 'default-toys' });
  const previous = await stored('categorized');
  assert.equal(previous.categoryId, 'default-toys');
  const categoryId = `custom-${'b'.repeat(64)}`;
  await setDoc(doc(alice.db, 'users', 'alice', 'categories', categoryId), {
    name: 'テストのページ', createdAt: Timestamp.now(),
  });
  await updateDoc(record('categorized'), { itemName: '変更後', categoryId });
  const updated = await stored('categorized');
  assert.deepEqual(updated, { ...previous, itemName: '変更後', categoryId });
  assert.deepEqual(await reload(repository(clients(env.authenticatedContext('alice')))), [updated]);
  await unchanged('categorized', updated);
  await assertFails(updateDoc(record('categorized', bob), { categoryId: null }));
  await assertFails(updateDoc(record('categorized'), { categoryId: `custom-${'c'.repeat(64)}` }));
  await updateDoc(record('categorized'), { categoryId: null });
  await unchanged('categorized', { ...updated, categoryId: null });
});

test('failure after photo upload rolls back only this attempt, keeping existing media', async () => {
  await repository().saveKeepsake(item('existing'));
  const previous = await stored('existing');
  const paths = [];
  const repo = repository(alice, 'alice', {
    uploadBytes: async (file, blob, metadata) => {
      paths.push(file.fullPath);
      if (file.name === 'voice') throw Object.assign(new Error('interrupted upload'), { code: 'storage/canceled' });
      return nodeUpload(file, blob, metadata);
    },
  });
  await assert.rejects(repo.saveKeepsake(item('failed')), /interrupted/);
  assert.equal((await getDocFromServer(record('failed'))).exists(), false);
  for (const path of paths) await absent(path);
  await unchanged('existing', previous);
  await repository().saveKeepsake(item('failed')); // retry completes
});

test('first upload failure and invalid source do not create a card or touch existing data', async () => {
  await repository().saveKeepsake(item('existing'));
  const previous = await stored('existing');
  let uploads = 0;
  const repo = repository(alice, 'alice', {
    uploadBytes: async () => { uploads++; throw Object.assign(new Error('first upload failed'), { code: 'storage/canceled' }); },
  });
  await assert.rejects(repo.saveKeepsake(item('first')), /first upload failed/);
  assert.equal(uploads, 1);
  assert.equal((await getDocFromServer(record('first'))).exists(), false);
  for (const [id, photo, message] of [
    ['empty', 'data:image/png;base64,', /空です/],
    ['wrong-type', source(Buffer.from('text'), 'text/plain'), /形式/],
    ['large', source(Buffer.alloc(20 * 1024 * 1024), 'image/png'), /20MB/],
  ]) {
    await assert.rejects(repository().saveKeepsake({ ...item(id), photo }), message);
    assert.equal((await getDocFromServer(record(id))).exists(), false);
  }
  await unchanged('existing', previous);
});

test('download URL failure after upload and definite Firestore rejection clean up uploaded files', async () => {
  for (const stage of ['url', 'rules']) {
    const paths = [];
    const faults = {
      uploadBytes: async (file, blob, metadata) => { paths.push(file.fullPath); return nodeUpload(file, blob, metadata); },
    };
    if (stage === 'url') faults.getDownloadURL = async () => { throw Object.assign(new Error('URL failure'), { code: 'storage/canceled' }); };
    const input = stage === 'rules' ? { ...item(stage), categoryId: `custom-${'a'.repeat(64)}` } : item(stage);
    await assert.rejects(repository(alice, 'alice', faults).saveKeepsake(input));
    assert.equal((await getDocFromServer(record(stage))).exists(), false);
    for (const path of paths) await absent(path);
  }
});

test('disconnected rollback verification leaves uploaded photo intact and preserves other cards', async () => {
  await repository().saveKeepsake(item('existing'));
  const previous = await stored('existing');
  let reads = 0;
  let path;
  const repo = repository(alice, 'alice', {
    getDoc: async (record) => {
      if (++reads > 1) throw Object.assign(new Error('network disconnected'), { code: 'unavailable' });
      return getDocFromServer(record);
    },
    uploadBytes: async (file, blob, metadata) => {
      if (file.name === 'voice') throw Object.assign(new Error('network disconnected'), { code: 'storage/retry-limit-exceeded' });
      path = file.fullPath; return nodeUpload(file, blob, metadata);
    },
  });
  await assert.rejects(repo.saveKeepsake(item('offline')), /保存結果を確認できません/);
  await assertSucceeds(getMetadata(ref(alice.storage, path)));
  await unchanged('existing', previous);
});

test('lost commit acknowledgement keeps committed files; retry with changed input cannot overwrite', async () => {
  let paths = [];
  const repo = repository(alice, 'alice', {
    uploadBytes: async (file, blob, metadata) => { paths.push(file.fullPath); return nodeUpload(file, blob, metadata); },
    runTransaction: async (...args) => {
      await runTransaction(...args);
      throw Object.assign(new Error('connection lost after commit'), { code: 'unavailable' });
    },
  });
  await assert.rejects(repo.saveKeepsake(item('ack')), /保存結果を確認できません/);
  const previous = await stored('ack');
  for (const path of paths) await assertSucceeds(getMetadata(ref(alice.storage, path)));
  await repository().saveKeepsake({ ...item('ack'), photo: source(Buffer.from('changed'), 'image/png') });
  await unchanged('ack', previous);
});

test('deadline does not remove files when the pending transaction commits later', async () => {
  let release;
  let finished;
  const gate = new Promise((resolve) => { release = resolve; });
  const repo = repository(alice, 'alice', {
    runTransaction: (...args) => {
      finished = gate.then(() => runTransaction(...args));
      return finished;
    },
  }, 500);
  await assert.rejects(repo.saveKeepsake(item('late')), /応答がありません/);
  release(); await finished;
  const value = await stored('late');
  await unchanged('late', value);
});

test('double save in one session is coalesced', async () => {
  let uploads = 0;
  const repo = repository(alice, 'alice', {
    uploadBytes: (...args) => { uploads++; return nodeUpload(...args); },
  });
  await Promise.all([repo.saveKeepsake(item('double')), repo.saveKeepsake(item('double'))]);
  assert.equal(uploads, 2);
  assert.equal((await getDocs(collection(alice.db, 'users', 'alice', 'keepsakes'))).size, 1);
  const value = await stored('double');
  await unchanged('double', value);
});

test('concurrent sessions choose one committed card and remove only the losing attempt', async () => {
  let reads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const paths = [];
  const faults = {
    getDoc: async (reference) => {
      const snapshot = await getDocFromServer(reference);
      if (++reads === 2) release();
      await gate; return snapshot;
    },
    uploadBytes: async (file, blob, metadata) => { paths.push(file.fullPath); return nodeUpload(file, blob, metadata); },
  };
  const other = clients(env.authenticatedContext('alice'));
  await Promise.all([
    repository(alice, 'alice', faults).saveKeepsake(item('race')),
    repository(other, 'alice', faults).saveKeepsake({ ...item('race'), itemName: '別の保存操作' }),
  ]);
  const value = await stored('race');
  assert.equal(paths.length, 4);
  for (const path of paths) {
    if ([value.photoPath, value.voicePath].includes(path)) await assertSucceeds(getMetadata(ref(alice.storage, path)));
    else await absent(path);
  }
  await unchanged('race', value);
});

test('partial deletion is retriable; failed document deletion is retriable', async () => {
  for (const stage of ['media', 'document']) {
    await repository().saveKeepsake(item(stage));
    const value = await stored(stage);
    const faults = stage === 'media' ? {
      deleteObject: (file) => file.name === 'voice'
        ? Promise.reject(new Error('delete interrupted')) : deleteObject(file),
    } : { deleteDoc: async () => { throw new Error('delete interrupted'); } };
    await assert.rejects(repository(alice, 'alice', faults).deleteKeepsake(value), /delete interrupted/);
    assert.equal((await getDocFromServer(record(stage))).exists(), true);
    await repository().deleteKeepsake(value);
    assert.equal((await getDocFromServer(record(stage))).exists(), false);
    await absent(value.photoPath); await absent(value.voicePath);
  }
});

test('different UID and unauthenticated clients cannot read, list, write, get URLs or delete owner data', async () => {
  await repository().saveKeepsake(item('private'));
  const value = await stored('private');
  const { id, ...document } = value;
  for (const attacker of [bob, anonymous]) {
    const reference = record('private', attacker);
    await assertFails(getDocFromServer(reference));
    await assertFails(getDocs(collection(attacker.db, 'users', 'alice', 'keepsakes')));
    await assertFails(setDoc(reference, { ...document, createdAt: Timestamp.now() }));
    await assertFails(deleteDoc(reference));
    for (const path of [value.photoPath, value.voicePath]) {
      const file = ref(attacker.storage, path);
      await assertFails(getMetadata(file));
      await assertFails(getBytes(file));
      await assertFails(getDownloadURL(file));
      await assertFails(uploadBytes(file, photoBytes, { contentType: 'image/png' }));
      await assertFails(deleteObject(file));
    }
  }
  await unchanged('private', value);
  // bob can create a separate card with the same ID in bob's own namespace.
  await repository(bob, 'bob').saveKeepsake(item('private'));
  // The store also refuses foreign paths even when handed a forged/stale card.
  await repository(bob, 'bob').deleteKeepsake(value);
  await unchanged('private', value);
});

test('legacy flat paths still load and delete; malformed deletion URL cannot remove another file', async () => {
  const photoPath = 'users/alice/keepsakes/legacy/photo';
  const voicePath = 'users/alice/keepsakes/legacy/voice';
  await uploadBytes(ref(alice.storage, photoPath), photoBytes, { contentType: 'image/png' });
  await uploadBytes(ref(alice.storage, voicePath), voiceBytes, { contentType: 'audio/wav' });
  await setDoc(record('legacy'), {
    itemName: '旧カード', photo: await canonicalUrl(ref(alice.storage, photoPath)),
    voice: await canonicalUrl(ref(alice.storage, voicePath)), photoPath, voicePath, createdAt: Timestamp.now(),
  });
  const value = await stored('legacy');
  await assert.rejects(repository().deleteKeepsake({ ...value, photo: value.voice }), /保存パスが一致しません/);
  await unchanged('legacy', value);
  await repository().deleteKeepsake(value);
  await absent(photoPath); await absent(voicePath);
});

test('rules reject invalid media kinds, types, size and foreign document paths', async () => {
  for (const [path, type, bytes] of [
    ['users/alice/keepsakes/bad/attempt/photo', 'text/plain', photoBytes],
    ['users/alice/keepsakes/bad/attempt/voice', 'image/png', photoBytes],
    ['users/alice/keepsakes/bad/attempt/other', 'image/png', photoBytes],
    ['users/alice/keepsakes/bad/attempt/photo', 'image/png', Buffer.alloc(20 * 1024 * 1024)],
  ]) await assertFails(uploadBytes(ref(alice.storage, path), bytes, { contentType: type }));
  await repository().saveKeepsake(item('valid'));
  const { id, ...value } = await stored('valid');
  await assertFails(setDoc(record('valid'), {
    ...value, createdAt: Timestamp.now(), photoPath: 'users/bob/keepsakes/valid/attempt/photo',
  }));
});

// Storage time cannot be backdated through the Web SDK. Only this adapter simulates
// elapsed object age, retaining real emulator path/bucket/generation/bytes. Firestore
// timestamps are seeded via emulator-only rules-disabled context; production rules
// still enforce their own request.time retention check.
const oldDate = () => new Date(Date.now() - MEDIA_RETENTION_MS - 60_000).toISOString();
const cleanup = (faults = {}, client = alice, uid = 'alice') => createUnusedMediaService(
  client.db, client.storage, async () => uid,
  { getMetadata: async (file) => ({ ...await getMetadata(file), updated: oldDate() }), ...faults },
);
const attemptDoc = (attempt, client = alice) => doc(client.db, 'users', 'alice', 'saveAttempts', attempt);
async function orphan(cardId, attemptId, state = 'finished', kind = 'photo') {
  const path = `users/alice/keepsakes/${cardId}/${attemptId}/${kind}`;
  await uploadBytes(ref(alice.storage, path), kind === 'photo' ? photoBytes : voiceBytes,
    { contentType: kind === 'photo' ? 'image/png' : 'audio/wav' });
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'alice', 'saveAttempts', attemptId), {
      cardId, bucket: ref(alice.storage).bucket, state,
      startedAt: Timestamp.fromMillis(Date.now() - MEDIA_RETENTION_MS - 120_000),
      ...(state !== 'active' ? { finishedAt: Timestamp.fromMillis(Date.now() - MEDIA_RETENTION_MS - 60_000) } : {}),
    });
  });
  return path;
}

test('read-only inventory protects references, active outcomes, legacy attempts and recent files', async () => {
  await repository().saveKeepsake(item('in-use'));
  const value = await stored('in-use');
  const active = await orphan('pending', 'pending-attempt', 'active');
  const eligible = await orphan('unused', 'unused-attempt');
  const historical = 'users/alice/keepsakes/historical/old-attempt/photo';
  const flat = 'users/alice/keepsakes/flat/photo';
  for (const path of [historical, flat]) await uploadBytes(ref(alice.storage, path), photoBytes, { contentType: 'image/png' });
  const inventory = await cleanup().inspectUnusedMedia();
  const status = (path) => inventory.files.find((file) => file.path === path)?.status;
  assert.equal(status(value.photoPath), 'referenced');
  assert.equal(status(value.voicePath), 'referenced');
  assert.equal(status(active), 'active');
  assert.equal(status(eligible), 'eligible');
  assert.equal(status(historical), 'legacy');
  assert.equal(status(flat), 'legacy');
  assert.equal(JSON.stringify(inventory).includes('token='), false);
  for (const file of inventory.files) await assertSucceeds(getMetadata(ref(alice.storage, file.path)));
  const fresh = createUnusedMediaService(alice.db, alice.storage, async () => 'alice');
  assert.equal((await fresh.inspectUnusedMedia()).files.find((file) => file.path === eligible).status, 'waiting');
  const service = cleanup();
  await service.inspectUnusedMedia();
  for (const path of [value.photoPath, active, historical, flat]) await assert.rejects(service.deleteUnusedMedia(path, true), /個別/);
  await unchanged('in-use', value);
});

test('cleanup needs a fresh report and individual confirmation; permanent fence rejects delayed reuse', async () => {
  const path = await orphan('discarded', 'discarded-attempt');
  const service = cleanup();
  await assert.rejects(service.deleteUnusedMedia(path, true), /個別/);
  await service.inspectUnusedMedia();
  await assert.rejects(service.deleteUnusedMedia(path, false), /個別/);
  await service.deleteUnusedMedia(path, true);
  await absent(path);
  assert.equal((await getDocFromServer(attemptDoc('discarded-attempt'))).data().state, 'blocked');
  await assert.rejects(service.deleteUnusedMedia(path, true), /個別/);
  await assertFails(deleteDoc(attemptDoc('discarded-attempt')));
  await assertFails(updateDoc(attemptDoc('discarded-attempt'), { state: 'active' }));
  await assertFails(setDoc(record('discarded'), {
    itemName: '遅延確定', photo: `https://firebasestorage.googleapis.com/v0/b/${ref(alice.storage).bucket}/o/${encodeURIComponent(path)}?alt=media`,
    voice: null, photoPath: path, voicePath: null, createdAt: Timestamp.now(),
  }));
});

test('result-unknown transaction is excluded before and after a delayed commit', async () => {
  let release;
  let finished;
  const gate = new Promise((resolve) => { release = resolve; });
  const repo = repository(alice, 'alice', {
    runTransaction: (...args) => { finished = gate.then(() => runTransaction(...args)); return finished; },
  }, 500);
  await assert.rejects(repo.saveKeepsake(item('pending-cleanup')), /応答がありません/);
  const service = cleanup();
  const pending = await service.inspectUnusedMedia();
  assert.equal(pending.files.length, 2);
  assert.ok(pending.files.every((file) => file.status === 'active'));
  for (const file of pending.files) await assert.rejects(service.deleteUnusedMedia(file.path, true), /個別/);
  release(); await finished;
  const committed = await service.inspectUnusedMedia();
  assert.ok(committed.files.every((file) => file.status === 'referenced'));
  await unchanged('pending-cleanup', await stored('pending-cleanup'));
});

test('concurrent saves leave only referenced winning files in the inventory', async () => {
  const other = clients(env.authenticatedContext('alice'));
  await Promise.all([repository().saveKeepsake(item('cleanup-race')), repository(other).saveKeepsake(item('cleanup-race'))]);
  const report = await cleanup().inspectUnusedMedia();
  assert.equal(report.files.length, 2);
  assert.ok(report.files.every((file) => file.status === 'referenced'));
});

test('cleanup rechecks server references and transaction state rather than trusting stale inventory', async () => {
  const path = await orphan('new-reference', 'reference-attempt');
  const service = cleanup();
  await service.inspectUnusedMedia();
  await setDoc(record('new-reference'), {
    itemName: 'サーバーの参照', photo: await canonicalUrl(ref(alice.storage, path)), photoPath: path,
    voice: null, voicePath: null, createdAt: Timestamp.now(),
  });
  await assert.rejects(service.deleteUnusedMedia(path, true), /参照/);
  await assertSucceeds(getMetadata(ref(alice.storage, path)));
  // Race after the initial full collection read: transaction sees the new card.
  const another = await orphan('transaction-reference', 'transaction-attempt');
  let readCount = 0;
  const race = cleanup({
    getDocsFromServer: async (reference) => {
      const result = await import('firebase/firestore').then(({ getDocsFromServer }) => getDocsFromServer(reference));
      if (reference.path.endsWith('/keepsakes') && ++readCount === 2) {
        await setDoc(record('transaction-reference'), {
          itemName: '同時確定', photo: await canonicalUrl(ref(alice.storage, another)), photoPath: another,
          voice: null, voicePath: null, createdAt: Timestamp.now(),
        });
      }
      return result;
    },
  });
  await race.inspectUnusedMedia();
  await assert.rejects(race.deleteUnusedMedia(another, true), /参照/);
  await assertSucceeds(getMetadata(ref(alice.storage, another)));
});

test('server read failure, changed generation and recent ledger all fail closed', async () => {
  const path = await orphan('safe-error', 'safe-error-attempt');
  const unavailable = cleanup({ getDocsFromServer: async () => { throw new Error('server unavailable'); } });
  await assert.rejects(unavailable.inspectUnusedMedia(), /unavailable/);
  await assert.rejects(unavailable.deleteUnusedMedia(path, true), /個別/);
  let scans = 0;
  const changed = cleanup({
    getMetadata: async (file) => ({
      ...await getMetadata(file), updated: oldDate(), generation: ++scans === 1 ? 'original' : 'changed',
    }),
  });
  await changed.inspectUnusedMedia();
  await assert.rejects(changed.deleteUnusedMedia(path, true), /変わりました/);
  await assertSucceeds(getMetadata(ref(alice.storage, path)));
  const fresh = await orphan('recent-finish', 'recent-attempt', 'active');
  await updateDoc(attemptDoc('recent-attempt'), { state: 'finished', finishedAt: (await import('firebase/firestore')).serverTimestamp() });
  const report = await cleanup().inspectUnusedMedia();
  assert.equal(report.files.find((file) => file.path === fresh).status, 'waiting');
  await assertFails(updateDoc(attemptDoc('recent-attempt'), { state: 'blocked' }));
});

test('old bucket URL-only references protect matching paths; old buckets are never enumerated', async () => {
  const path = await orphan('old-bucket', 'old-bucket-attempt');
  const oldStorage = env.authenticatedContext('alice').storage('demo-keepsakes-test-old.appspot.com');
  await uploadBytes(ref(oldStorage, path), photoBytes, { contentType: 'image/png' });
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'alice', 'keepsakes', 'old-url-only'), {
      itemName: '旧バケット', photo: await canonicalUrl(ref(oldStorage, path)), voice: null, createdAt: Timestamp.now(),
    });
  });
  const report = await cleanup().inspectUnusedMedia();
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0].status, 'referenced');
  assert.equal(report.bucket, ref(alice.storage).bucket);
  await assertSucceeds(getMetadata(ref(oldStorage, path)));
});

test('partial cleanup failures retain a fence and need a new scan before explicit retry', async () => {
  const path = await orphan('retry-cleanup', 'retry-attempt');
  const voice = await orphan('retry-cleanup', 'retry-attempt', 'finished', 'voice');
  const service = cleanup({ deleteObject: async () => { throw new Error('delete disconnected'); } });
  await service.inspectUnusedMedia();
  await assert.rejects(service.deleteUnusedMedia(path, true), /disconnected/);
  await assertSucceeds(getMetadata(ref(alice.storage, path)));
  assert.equal((await getDocFromServer(attemptDoc('retry-attempt'))).data().state, 'blocked');
  const fresh = cleanup();
  await fresh.inspectUnusedMedia();
  await fresh.deleteUnusedMedia(path, true);
  await absent(path);
  // Explicitly deleting one photo must not delete the sibling voice.
  await assertSucceeds(getMetadata(ref(alice.storage, voice)));
});

test('inventory/attempt records remain private and malformed legacy references fail closed', async () => {
  const path = await orphan('privacy', 'privacy-attempt');
  for (const attacker of [bob, anonymous]) {
    await assertFails(list(ref(attacker.storage, 'users/alice/keepsakes')));
    await assertFails(getDocs(collection(attacker.db, 'users', 'alice', 'saveAttempts')));
    await assertFails(getDocFromServer(attemptDoc('privacy-attempt', attacker)));
  }
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'alice', 'keepsakes', 'malformed'), { photo: 'not a download URL' });
  });
  // Storage ref accepts plain paths, so invalid URL-shaped references must also be rejected.
  const service = cleanup();
  await assert.rejects(service.inspectUnusedMedia(), /参照を確認できません/);
  await assertSucceeds(getMetadata(ref(alice.storage, path)));
});

test('password-share rules expose only active encrypted share reads; owners alone can create, list, revoke and delete', async () => {
  const shareId = 'd'.repeat(64);
  const assetId = 'e'.repeat(32);
  const shareDoc = doc(alice.db, 'users', 'alice', 'shares', shareId);
  const encrypted = {
    active: true,
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    salt: `${'A'.repeat(22)}==`,
    manifestIv: 'B'.repeat(16),
    manifest: 'C'.repeat(256),
    createdAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(shareDoc, encrypted));
  await assertSucceeds(getDocFromServer(doc(bob.db, 'users', 'alice', 'shares', shareId)));
  await assertSucceeds(getDocFromServer(doc(anonymous.db, 'users', 'alice', 'shares', shareId)));
  await assertSucceeds(getDocs(collection(alice.db, 'users', 'alice', 'shares')));
  await assertFails(getDocs(collection(bob.db, 'users', 'alice', 'shares')));
  await assertFails(setDoc(doc(bob.db, 'users', 'alice', 'shares', 'f'.repeat(64)), encrypted));
  await assertFails(updateDoc(doc(bob.db, 'users', 'alice', 'shares', shareId), { active: false }));
  await assertFails(deleteDoc(doc(bob.db, 'users', 'alice', 'shares', shareId)));
  await assertFails(setDoc(doc(alice.db, 'users', 'alice', 'shares', 'bad-id'), encrypted));
  await assertFails(setDoc(doc(alice.db, 'users', 'alice', 'shares', 'a'.repeat(64)), {
    ...encrypted, password: 'plaintext-never-stored',
  }));

  const path = `users/alice/shares/${shareId}/assets/${assetId}`;
  const ownerAsset = ref(alice.storage, path);
  const publicAsset = ref(bob.storage, path);
  const bytes = Buffer.from('synthetic encrypted bytes');
  await assertSucceeds(uploadBytes(ownerAsset, bytes, { contentType: 'application/octet-stream' }));
  assert.deepEqual(Buffer.from(await getBytes(publicAsset)), bytes);
  await assertSucceeds(getBytes(ref(anonymous.storage, path)));
  await assertSucceeds(list(ref(alice.storage, `users/alice/shares/${shareId}`)));
  await assertFails(list(ref(bob.storage, `users/alice/shares/${shareId}`)));
  await assertFails(uploadBytes(ref(bob.storage, `users/alice/shares/${shareId}/assets/${assetId}`), bytes, { contentType: 'application/octet-stream' }));
  await assertFails(uploadBytes(ref(alice.storage, `users/alice/shares/${shareId}/assets/${'f'.repeat(32)}`), bytes, { contentType: 'image/png' }));

  await assertSucceeds(updateDoc(shareDoc, { active: false }));
  await assertFails(getDocFromServer(doc(bob.db, 'users', 'alice', 'shares', shareId)));
  await assertFails(getDocFromServer(doc(anonymous.db, 'users', 'alice', 'shares', shareId)));
  await assertSucceeds(deleteObject(ownerAsset));
  await assert.rejects(getBytes(publicAsset), (error) => error.code === 'storage/object-not-found');
  await assertSucceeds(deleteDoc(shareDoc));
});
