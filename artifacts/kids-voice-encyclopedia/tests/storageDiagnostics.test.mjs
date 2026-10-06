import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseStorageError, storageFailureMessage, storageResponse } from '../src/lib/storageDiagnostics.ts';

const bucket = 'kids_voice_zukan';
const setupPayload = JSON.stringify({ error: { code: 400, message: 'Your bucket has not been set up properly for Firebase Storage.' } });

test('reads both SDK serverResponse locations', () => {
  assert.equal(storageResponse({ serverResponse: setupPayload }), setupPayload);
  assert.equal(storageResponse({ customData: { serverResponse: setupPayload } }), setupPayload);
  assert.equal(storageResponse(null), '');
});

test('distinguishes missing Firebase setup from CORS', () => {
  const message = storageFailureMessage({ code: 'storage/unknown', serverResponse: setupPayload }, bucket);
  assert.match(message, /Firebase設定が未完了/);
  assert.match(message, /HTTP 400/);
  assert.match(message, /CORS設定だけでは解消しません/);
});

test('maps permissions, billing and timeouts without raw payload disclosure', () => {
  assert.match(storageFailureMessage({ code: 'storage/unauthorized' }, bucket), /Storageルール/);
  assert.match(storageFailureMessage({ code: 'storage/quota-exceeded' }, bucket), /Blaze/);
  assert.match(storageFailureMessage({ code: 'storage/retry-limit-exceeded' }, bucket), /時間内/);
  const message = storageFailureMessage({ code: 'storage/unknown', serverResponse: '{"private":"DO_NOT_DISPLAY"}' }, bucket);
  assert.ok(!message.includes('DO_NOT_DISPLAY'));
});

test('missing SDK payload gets read-only diagnosis, without token or write', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (url, options) => {
    called = true;
    assert.match(url, /\/b\/kids_voice_zukan\/o\/__firebase_setup_probe__/);
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers, undefined);
    return new Response(setupPayload, { status: 400 });
  };
  try {
    const diagnosed = await diagnoseStorageError({ code: 'storage/unknown' }, bucket);
    assert.equal(called, true);
    assert.match(storageFailureMessage(diagnosed, bucket), /Firebase設定が未完了/);
  } finally { globalThis.fetch = originalFetch; }
});

test('probe failure, generic 403 and unknown errors preserve the original failure', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = { code: 'storage/unknown' };
  try {
    globalThis.fetch = async () => { throw new TypeError('network'); };
    assert.equal(await diagnoseStorageError(originalError, bucket), originalError);
    globalThis.fetch = async () => new Response('Forbidden', { status: 403 });
    assert.equal(await diagnoseStorageError(originalError, bucket), originalError);
    globalThis.fetch = async () => { throw new Error('must not call'); };
    assert.equal(await diagnoseStorageError({ code: 'storage/unknown', serverResponse: setupPayload }, bucket).then(storageResponse), setupPayload);
    const permissionError = { code: 'storage/unauthorized' };
    assert.equal(await diagnoseStorageError(permissionError, bucket), permissionError);
  } finally { globalThis.fetch = originalFetch; }
});
