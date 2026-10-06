import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, deleteDoc, setDoc, updateDoc, runTransaction, collection, getDocs, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, getMetadata, getBytes, deleteObject } from 'firebase/storage';
import { createKeepsakeRepository } from '../src/lib/keepsakeRepository.ts';

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
beforeEach(async () => { await env.clearFirestore(); await env.clearStorage(); });
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
