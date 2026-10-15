import assert from 'node:assert/strict';
import test from 'node:test';

const stores = new Map();
const objectStoreNames = { contains: (name) => stores.has(name) };
const database = {
  objectStoreNames,
  createObjectStore(name) { stores.set(name, new Map()); },
  transaction(names) {
    const tx = { oncomplete: null, onabort: null, pending: 0 };
    tx.objectStore = (name) => ({
      get(key) { return operation(tx, () => stores.get(name).get(key)); },
      getAll() { return operation(tx, () => [...stores.get(name).values()]); },
      put(value, key) { return operation(tx, () => { stores.get(name).set(key ?? value.id, value); return key ?? value.id; }); },
      delete(key) { return operation(tx, () => stores.get(name).delete(key)); },
    });
    return tx;
  },
};
function operation(tx, run) {
  const req = {};
  tx.pending++;
  queueMicrotask(() => {
    req.result = run();
    req.onsuccess?.();
    tx.pending--;
    if (!tx.pending) queueMicrotask(() => tx.oncomplete?.());
  });
  return req;
}
globalThis.indexedDB = {
  open() {
    const req = { result: database };
    queueMicrotask(() => {
      req.onupgradeneeded?.();
      queueMicrotask(() => req.onsuccess?.());
    });
    return req;
  },
};
const local = await import('../src/lib/localKeepsakeDb.ts');

test('IndexedDB keeps card media as blobs and applies local edits, archive, restore, and delete', async () => {
  const photoBlob = new Blob(['photo'], { type: 'image/png' });
  const voiceBlob = new Blob(['voice'], { type: 'audio/webm' });
  const states = [];
  const stop = await local.subscribe((items) => states.push(items), assert.fail);
  await local.save({
    id: 'local-card', itemName: '絵', photo: '', photoBlob, voice: null, voiceBlob,
    voices: [{ id: 'voice-a', url: '', blob: voiceBlob }], createdAt: 123,
  });
  assert.equal(states.at(-1)[0].photoBlob.size, photoBlob.size);
  assert.equal(states.at(-1)[0].voices[0].blob.size, voiceBlob.size);
  await local.edit(states.at(-1)[0], { itemName: '新しい絵', categoryId: 'default-toys' });
  assert.equal(states.at(-1)[0].itemName, '新しい絵');
  assert.equal(states.at(-1)[0].categoryId, 'default-toys');
  await local.patchCard('local-card', { archived: true, archivedAt: 456 });
  assert.equal(states.at(-1)[0].archived, true);
  assert.equal(states.at(-1)[0].photoBlob.size, photoBlob.size);
  await local.patchCard('local-card', { archived: false, archivedAt: null });
  assert.equal(states.at(-1)[0].archived, false);
  await local.remove(states.at(-1)[0]);
  assert.deepEqual(states.at(-1), []);
  stop();
});

test('local categories and gallery settings survive reads and writes', async () => {
  const category = { id: 'local-cat', name: 'のりもの', createdAt: 200 };
  await local.addCategory(category);
  assert.ok((await local.listCategories()).some((entry) => entry.id === category.id));
  await local.saveSettings({ displayMode: 'shuffle', shuffleSeed: 22 });
  assert.equal((await local.listSettings()).displayMode, 'shuffle');
});
