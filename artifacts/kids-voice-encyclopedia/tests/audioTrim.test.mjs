import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, findVoiceStart } from '../src/lib/audioTrim.ts';

test('leading silence is removed with 50ms preroll, preserving tail', async () => {
  const samples = new Float32Array(2000);
  samples.fill(0.2, 500, 1500);
  const start = findVoiceStart([samples], 1000);
  assert.equal(start, 450);
  const wav = await encodeWav([samples], 1000, start).arrayBuffer();
  const view = new DataView(wav);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 1000);
  assert.equal(view.getUint32(40, true), 1550 * 2);
  assert.equal(wav.byteLength, 44 + 1550 * 2);
});

test('voice from the start stays intact', () => {
  assert.equal(findVoiceStart([new Float32Array(100).fill(0.1)], 1000), 0);
});

test('silent and low-level background noise are rejected', () => {
  assert.equal(findVoiceStart([new Float32Array(100)], 1000), null);
  assert.equal(findVoiceStart([new Float32Array(100).fill(0.005)], 1000), null);
});

test('isolated click does not count as voice', () => {
  const samples = new Float32Array(1000);
  samples[100] = 0.8;
  samples.fill(0.2, 500, 700);
  assert.equal(findVoiceStart([samples], 1000), 450);
});

test('checks every channel and interleaves stereo WAV', async () => {
  const left = new Float32Array(1000);
  const right = new Float32Array(1000);
  right.fill(0.3, 400);
  const start = findVoiceStart([left, right], 1000);
  assert.equal(start, 350);
  const wav = await encodeWav([left, right], 1000, start).arrayBuffer();
  const view = new DataView(wav);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(40, true), 650 * 4);
  assert.equal(view.getInt16(44 + 50 * 4, true), 0);
  assert.ok(view.getInt16(46 + 50 * 4, true) > 9000);
});
