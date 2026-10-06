import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Firebaseをネットワーク越しに変更せず、SDK境界で書き込みパスと差分を確認する。
// 通常の node --test でも、このテストだけ必要なVMフラグで子プロセス実行する。
if (!vm.SourceTextModule) {
  test('Firestore category persistence and media-preserving edits', () => {
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', import.meta.filename], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
} else {
  async function fixture() {
    const records = new Map();
    const calls = [];
    const timestamp = { serverTimestamp: true };
    const uid = 'test-owner';
    const context = vm.createContext({
      crypto, TextEncoder, Uint8Array, Date, console,
      setTimeout, clearTimeout,
      window: { setTimeout, clearTimeout },
      fetch: async () => new Response(new Blob(['test image'], { type: 'image/png' })),
    });
    const exports = {
      'firebase/app': { initializeApp: () => ({}) },
      'firebase/auth': {
        indexedDBLocalPersistence: {},
        initializeAuth: () => ({ authStateReady: async () => {}, currentUser: { uid } }),
        signInAnonymously: async () => ({ user: { uid } }),
      },
      'firebase/firestore': {
        getFirestore: () => ({}),
        collection: (_db, ...parts) => parts.join('/'),
        doc: (_db, ...parts) => parts.join('/'),
        orderBy: (...args) => args,
        query: (...args) => args,
        serverTimestamp: () => timestamp,
        getDoc: async (path) => ({ exists: () => records.has(path), data: () => records.get(path) }),
        getDocFromServer: async (path) => ({ exists: () => records.has(path), data: () => records.get(path) }),
        setDoc: async (path, data) => { calls.push(['setDoc', path, data]); records.set(path, data); },
        updateDoc: async (path, data) => {
          calls.push(['updateDoc', path, data]);
          if (!records.has(path)) throw new Error('missing record');
          records.set(path, { ...records.get(path), ...data });
        },
        deleteDoc: async (path) => { calls.push(['deleteDoc', path]); records.delete(path); },
        onSnapshot: (query, onChange) => {
          calls.push(['subscribe', query]);
          onChange({ docs: [...records.entries()].filter(([path]) => path.startsWith(`${query[0]}/`))
            .map(([path, data]) => ({ id: path.split('/').at(-1), data: () => data })) });
          return () => calls.push(['unsubscribe']);
        },
        runTransaction: async (_db, execute) => execute({
          get: async (path) => ({ exists: () => records.has(path), data: () => records.get(path) }),
          set: (path, data) => { calls.push(['transaction.set', path, data]); records.set(path, data); },
          update: (path, data) => { calls.push(['transaction.update', path, data]); records.set(path, { ...records.get(path), ...data }); },
        }),
      },
      'firebase/storage': {
        getStorage: (_app, bucket) => ({ bucket }),
        ref: (_storage, path) => ({ fullPath: path, bucket: 'test-bucket' }),
        uploadBytes: async (file) => { calls.push(['uploadBytes', file.fullPath]); },
        getDownloadURL: async (file) => `https://firebasestorage.googleapis.com/${file.fullPath}`,
        deleteObject: async (file) => calls.push(['deleteObject', file.fullPath]),
      },
      '../firebaseConfig': { firebaseConfig: { storageBucket: 'test-bucket' }, isFirebaseConfigured: true },
      './storageDiagnostics': { diagnoseStorageError: async (error) => error, storageFailureMessage: () => null },
      './unusedMedia': { createUnusedMediaService: () => { throw new Error('Metadata edits must not inspect or delete unused media'); } },
      './keepsakeEditor': { createKeepsakeEditor: () => ({ editKeepsake: () => { throw new Error('Not a metadata-only operation'); } }) },
    };
    const categories = new vm.SourceTextModule(
      stripTypeScriptTypes(await readFile(new URL('../src/lib/categories.ts', import.meta.url), 'utf8')),
      { context },
    );
    await categories.link(() => { throw new Error('Unexpected helper import'); });
    const voices = new vm.SourceTextModule(
      stripTypeScriptTypes(await readFile(new URL('../src/lib/voiceAssets.ts', import.meta.url), 'utf8')), { context },
    );
    await voices.link(() => { throw new Error('Unexpected voice helper import'); });
    const repository = new vm.SourceTextModule(
      stripTypeScriptTypes(await readFile(new URL('../src/lib/keepsakeRepository.ts', import.meta.url), 'utf8')),
      { context },
    );
    const link = (name) => {
      if (name === './categories' || name === './categories.ts') return categories;
      if (name === './voiceAssets' || name === './voiceAssets.ts') return voices;
      const values = exports[name.replace(/\.ts$/, '')];
      assert.ok(values, `Unexpected dependency: ${name}`);
      return new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context });
    };
    await repository.link(link);
    const source = stripTypeScriptTypes(await readFile(new URL('../src/lib/keepsakeStore.ts', import.meta.url), 'utf8'));
    const store = new vm.SourceTextModule(source, { context });
    await store.link((name) => {
      if (name === './keepsakeRepository') return repository;
      if (name === './categories') return categories;
      const values = exports[name];
      assert.ok(values, `Unexpected dependency: ${name}`);
      return new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context });
    });
    await store.evaluate();
    return { api: store.namespace, records, calls, timestamp, uid };
  }

  test('category creation writes only to the current owner and retries are idempotent', async () => {
    const { api, records, calls, uid } = await fixture();
    const first = await api.createCategory('  のりもの  ');
    const second = await api.createCategory('のりもの');
    assert.equal(first.id, second.id);
    assert.equal(first.name, 'のりもの');
    assert.ok(records.has(`users/${uid}/categories/${first.id}`));
    assert.equal(calls.filter(([operation]) => operation === 'transaction.set').length, 1);
    assert.deepEqual(Object.keys(records.values().next().value).sort(), ['createdAt', 'name']);
  });

  test('category subscriptions are private and include all three defaults', async () => {
    const { api, calls, uid } = await fixture();
    let categories;
    const stop = await api.subscribeCategories((value) => { categories = value; }, assert.fail);
    assert.equal(categories.length, 3);
    assert.equal(calls[0][1][0], `users/${uid}/categories`);
    stop();
    assert.equal(calls.at(-1)[0], 'unsubscribe');
  });

  test('editing category/name uses updateDoc without replacing or deleting media', async () => {
    const { api, records, calls, uid } = await fixture();
    const path = `users/${uid}/keepsakes/card`;
    const original = { itemName: '以前', photo: 'photo-url', voice: 'voice-url', photoPath: 'photo-path', voicePath: 'voice-path', createdAt: 123 };
    records.set(path, original);
    await api.updateKeepsakeMetadata('card', '  新しい名前  ', 'default-animals');
    assert.deepEqual(records.get(path), { ...original, itemName: '新しい名前', categoryId: 'default-animals' });
    assert.deepEqual(calls.map(([operation]) => operation), ['updateDoc']);
    await api.updateKeepsakeMetadata('card', '名前', null);
    assert.equal(records.get(path).categoryId, null);
    assert.equal(records.get(path).photo, original.photo);
    assert.equal(records.get(path).voice, original.voice);
    assert.equal(records.get(path).createdAt, original.createdAt);
  });

  test('missing-card edits and invalid names report failure without creating replacement data', async () => {
    const { api, records, calls } = await fixture();
    await assert.rejects(api.updateKeepsakeMetadata('missing', '名前', null), /missing record/);
    await assert.rejects(api.createCategory('すべて'));
    assert.equal(records.size, 0);
    assert.ok(calls.every(([operation]) => operation === 'updateDoc'));
  });

  test('category-only edit preserves the current name, URLs and timestamps and only writes categoryId', async () => {
    const { api, records, calls, uid } = await fixture();
    const path = `users/${uid}/keepsakes/card`;
    const latest = { itemName: '別の端末で直した名前', photo: 'photo-url', voice: 'voice-url', createdAt: 123 };
    records.set(path, latest);
    await api.updateKeepsakeCategory('card', 'default-animals');
    assert.deepEqual(records.get(path), { ...latest, categoryId: 'default-animals' });
    assert.deepEqual(calls.map(([op, target, patch]) => [op, target, { ...patch }]), [['updateDoc', path, { categoryId: 'default-animals' }]]);
    await api.updateKeepsakeCategory('card', null);
    assert.equal(records.get(path).categoryId, null);
    await assert.rejects(api.updateKeepsakeCategory('card', 'untrusted'));
  });

  test('new card persists assigned category; unclassified legacy saves stay compatible', async () => {
    const { api, records, uid } = await fixture();
    const item = { id: 'new-card', itemName: 'おもちゃ', photo: 'blob:test', voice: null, createdAt: 100, categoryId: 'default-toys' };
    await api.saveKeepsake(item);
    assert.equal(records.get(`users/${uid}/keepsakes/new-card`).categoryId, 'default-toys');
    await api.saveKeepsake({ ...item, id: 'legacy-card', categoryId: null }, true);
    const legacy = records.get(`users/${uid}/keepsakes/legacy-card`);
    assert.equal('categoryId' in legacy, false);
    assert.equal(legacy.createdAt.getTime(), 100);
  });
}
