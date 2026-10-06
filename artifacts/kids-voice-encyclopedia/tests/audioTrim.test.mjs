import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, findVoiceStart, trimAudioRange, waveformPeaks } from '../src/lib/audioTrim.ts';
import { randomVoice, VoicePlayback } from '../src/lib/voicePlayback.ts';
import { recordingCue } from '../src/lib/recordingCue.ts';

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

test('manual range encodes only selected frames in all channels without changing source', async () => {
  const channels = [Float32Array.from({ length: 1000 }, (_, i) => i / 1000), new Float32Array(1000).fill(-0.5)];
  const audio = { channels, sampleRate: 1000, duration: 1 };
  const before = [...channels[0]];
  const wav = await trimAudioRange(audio, 0.2, 0.6).arrayBuffer();
  const view = new DataView(wav);
  assert.equal(wav.byteLength, 44 + 400 * 4);
  assert.equal(view.getUint32(40, true), 400 * 4);
  assert.equal(view.getInt16(44, true), Math.round(0.2 * 32767));
  assert.equal(view.getInt16(46, true), -16384);
  assert.deepEqual([...channels[0]], before);
  for (const [s, e] of [[-1, 1], [0, 2], [0.5, 0.51], [NaN, 1], [0.8, 0.2]]) {
    assert.throws(() => trimAudioRange(audio, s, e));
  }
});

test('waveform peaks include negative samples and every channel', () => {
  assert.deepEqual(waveformPeaks([new Float32Array([0, -0.8, 0, 0]), new Float32Array([0, 0, 0.7, 0])], 2).map(v => Math.round(v * 10)), [8, 7]);
  assert.deepEqual(waveformPeaks([], 160), []);
});

function fakeAudio() {
  return { preload: '', currentTime: 9, paused: true, ended: false, playCalls: 0,
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }, removeAttribute() {}, load() {},
    onended: null, onpause: null, onerror: null };
}

test('one random voice is selected, synchronous cached playback ends without a next clip', async () => {
  assert.equal(randomVoice(['a', 'b', 'c'], () => 0), 'a');
  assert.equal(randomVoice(['a', 'b', 'c'], () => 0.99), 'c');
  assert.equal(randomVoice([], () => 0), undefined);
  const pool = new Map(); const states = [];
  const p = new VoicePlayback({ onChange: s => states.push(s), onError: () => assert.fail('unexpected error'),
    createAudio: url => { const a = fakeAudio(); pool.set(url, a); return a; } });
  p.warm(['a', 'b']);
  p.play('b', 'card');
  assert.equal(pool.get('b').playCalls, 1); // called before yielding, in the gesture
  assert.equal(pool.get('b').currentTime, 0);
  await Promise.resolve();
  assert.equal(states.at(-1).playing, true);
  pool.get('b').ended = true; pool.get('b').onended();
  assert.equal(states.at(-1), null);
  assert.equal(pool.get('a').playCalls, 0); // no sequential playback
  p.dispose();
});

test('switching, same-card stop and stale play completion cannot activate another card', async () => {
  const states = [], audios = [], resolves = [];
  const p = new VoicePlayback({ onChange: s => states.push(s), onError: () => assert.fail('unexpected error'),
    createAudio: () => { const a = fakeAudio(); a.play = () => { a.paused = false; return new Promise(r => resolves.push(r)); }; audios.push(a); return a; } });
  p.play('first', 'one'); p.play('second', 'two');
  resolves[0](); await Promise.resolve();
  assert.equal(states.at(-1).id, 'two');
  assert.equal(states.at(-1).playing, false);
  resolves[1](); await Promise.resolve();
  assert.equal(states.at(-1).playing, true);
  assert.equal(audios[0].paused, true);
  p.play('second', 'two');
  assert.equal(states.at(-1), null);
  p.dispose();
});

test('preload metadata is bounded and playback failures clear the active state', async () => {
  let created = 0, errors = 0; const states = [];
  const p = new VoicePlayback({ onChange: s => states.push(s), onError: () => errors++,
    createAudio: () => { created++; const a = fakeAudio(); a.play = () => Promise.reject(new Error('unavailable')); return a; } });
  p.warm(Array.from({ length: 80 }, (_, i) => `url-${i}`));
  assert.equal(created, 24);
  p.play('url-0', 'one');
  await new Promise(r => setImmediate(r));
  assert.equal(errors, 1);
  assert.equal(states.at(-1), null);
  p.dispose();
});

test('recording cue completes only after oscillator end and acoustic tail; cancellation settles immediately', async () => {
  const osc = { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null };
  const context = { currentTime: 0, destination: {}, createOscillator: () => osc,
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }) };
  const cue = recordingCue(context);
  let finished = false;
  cue.finished.then(() => { finished = true; });
  await Promise.resolve(); assert.equal(finished, false);
  osc.onended();
  await Promise.resolve(); assert.equal(finished, false);
  await cue.finished; assert.equal(finished, true);
  const second = recordingCue(context);
  second.cancel(); await second.finished;
});
