import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadImportedMedia, mapWithConcurrency } from '../src/lib/mediaImport.ts';

test('retries transient media errors and returns only a valid image blob', async () => {
  let calls = 0;
  const blob = await downloadImportedMedia('https://media.example/photo', 'image', async () => {
    calls++;
    if (calls === 1) throw new TypeError('network temporarily unavailable');
    return new Response(new Blob(['image'], { type: 'image/png' }), { status: 200 });
  }, async () => {});

  assert.equal(calls, 2);
  assert.equal(blob.type, 'image/png');
  assert.equal(blob.size, 5);
});

test('does not retry permanent HTTP failures or invalid media types', async () => {
  let calls = 0;
  await assert.rejects(
    downloadImportedMedia('https://media.example/missing', 'image', async () => {
      calls++;
      return new Response('', { status: 404 });
    }, async () => {}),
    /取得できませんでした（404）/,
  );
  assert.equal(calls, 1);

  await assert.rejects(
    downloadImportedMedia('https://media.example/wrong-type', 'image', async () =>
      new Response(new Blob(['not an image'], { type: 'text/plain' }), { status: 200 }),
    ),
    /データを確認できません/,
  );
});

test('bounded import worker preserves order and caps simultaneous downloads', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency([0, 1, 2, 3, 4, 5, 6], 2, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return value * 2;
  });

  assert.equal(peak, 2);
  assert.deepEqual(result, [0, 2, 4, 6, 8, 10, 12]);
});

test('stops starting new downloads after one item fails and waits for active downloads', async () => {
  const started = [];
  await assert.rejects(
    mapWithConcurrency([0, 1, 2, 3, 4], 2, async (value) => {
      started.push(value);
      if (value === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        throw new Error('temporary failure');
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return value;
    }),
    /temporary failure/,
  );
  assert.deepEqual(started, [0, 1]);
});
