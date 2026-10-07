import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../src/lib/newKeepsakeDraft.ts', import.meta.url), 'utf8');
const draftModule = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const startScreenSource = await readFile(new URL('../src/components/StartScreen.tsx', import.meta.url), 'utf8');

class FakeIndexedDB {
  values = new Map();
  hasStore = false;

  open() {
    const request = {};
    queueMicrotask(() => {
      const database = {
        objectStoreNames: { contains: () => this.hasStore },
        createObjectStore: () => { this.hasStore = true; },
        close() {},
        transaction: () => {
          const transaction = {};
          transaction.objectStore = () => {
            const requestWith = (result, mutate) => {
              const operation = {};
              queueMicrotask(() => {
                mutate?.();
                operation.result = result;
                operation.onsuccess?.();
                transaction.oncomplete?.();
              });
              return operation;
            };
            return {
              get: (key) => requestWith(this.values.get(key), () => {}),
              put: (value, key) => requestWith(key, () => this.values.set(key, value)),
              delete: (key) => requestWith(undefined, () => this.values.delete(key)),
            };
          };
          return transaction;
        },
      };
      request.result = database;
      if (!this.hasStore) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
}

test('new-record drafts retain text, category, selected image Blob, and voice Blob until cleared', async () => {
  const store = draftModule.createNewKeepsakeDraftStore(new FakeIndexedDB());
  assert.equal(await store.read(), null);
  const draft = {
    itemName: 'あかい くるま',
    photo: 'data:image/png;base64,cGhvdG8=',
    pendingPhotoBlob: new Blob(['image bytes'], { type: 'image/png' }),
    voiceBlob: new Blob(['voice bytes'], { type: 'audio/webm' }),
    categoryId: 'toys',
    updatedAt: 123,
  };
  await store.write(draft);

  const restored = await store.read();
  assert.equal(restored.itemName, draft.itemName);
  assert.equal(restored.photo, draft.photo);
  assert.equal(restored.categoryId, 'toys');
  assert.equal(await restored.pendingPhotoBlob.text(), 'image bytes');
  assert.equal(await restored.voiceBlob.text(), 'voice bytes');

  await store.clear();
  assert.equal(await store.read(), null);
});

test('draft content is detected for silent startup recovery', () => {
  const empty = { itemName: '  ', photo: null, pendingPhotoBlob: null, voiceBlob: null, categoryId: 'toys' };
  assert.equal(draftModule.hasNewKeepsakeDraftContent(empty), false);
  assert.equal(draftModule.hasNewKeepsakeDraftContent({ ...empty, itemName: 'くるま' }), true);
  assert.equal(draftModule.hasNewKeepsakeDraftContent({ ...empty, pendingPhotoBlob: new Blob(['image']) }), true);
  assert.equal(draftModule.hasNewKeepsakeDraftContent({ ...empty, voiceBlob: new Blob(['voice']) }), true);
});

test('startup silently opens the populated form without a restore notice or manual restore button', () => {
  assert.match(appSource, /localDraft\.load\(\)\.then\(\(draft\) => \{[\s\S]*?hasNewKeepsakeDraftContent\(draft\)[\s\S]*?setCreateOpen\(true\)/u);
  assert.doesNotMatch(appSource, /draftRestored|draftAvailable|status-draft-restored|button-resume-draft|onResumeDraft/u);
  assert.doesNotMatch(startScreenSource, /onResumeDraft|button-resume-draft|status-start-draft/u);
});

test('successful cloud save clears the local draft afterward', () => {
  const cloudSave = appSource.indexOf('await saveKeepsake({');
  const clearDraft = appSource.indexOf('await localDraft.clear()', cloudSave);
  assert.ok(cloudSave >= 0 && clearDraft > cloudSave);
});
