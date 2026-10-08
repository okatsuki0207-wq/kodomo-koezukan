import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

async function load(name) {
  const text = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString('base64')}`);
}
const gesture = await load('longPressGesture');
const subject = await load('subjectMask');
const { loadVoiceSource } = await load('voiceSource');
const { recordingCue } = await load('recordingCue');
const { primeMicrophonePermission } = await load('microphonePermission');

test('waveform drafts keep Blob bytes usable after their temporary URL is revoked', async () => {
  const blob = new Blob(['synthetic WAV bytes'], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  URL.revokeObjectURL(url);
  assert.equal(await loadVoiceSource(blob, new AbortController().signal), blob);
  await assert.rejects(loadVoiceSource(url, new AbortController().signal), /一時音声/);
});
test('waveform loader refreshes an expired saved URL once, validates bytes, and honours cancellation', async () => {
  const original = globalThis.fetch;
  let refreshed = 0;
  globalThis.fetch = async (url) => url.endsWith('expired')
    ? new Response('denied', { status: 403 })
    : new Response(new Blob(['wav'], { type: 'audio/wav' }));
  try {
    const result = await loadVoiceSource('https://example.invalid/expired', new AbortController().signal,
      async () => { refreshed++; return 'https://example.invalid/fresh'; });
    assert.equal(await result.text(), 'wav');
    assert.equal(refreshed, 1);
    await assert.rejects(loadVoiceSource(new Blob([]), new AbortController().signal), /空/);
    await assert.rejects(loadVoiceSource(new Blob(['<html>'], { type: 'text/html' }), new AbortController().signal), /音声ではない/);
    const ctl = new AbortController(); ctl.abort();
    await assert.rejects(loadVoiceSource(new Blob(['wav']), ctl.signal), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});
class GuideAudio {
  onended = null; onerror = null; played = 0; paused = 0;
  playbackRate = 1; preservesPitch = true;
  play() { this.played++; return Promise.resolve(); }
  pause() { this.paused++; }
  load() {}
  removeAttribute() {}
}
test('guide voice begins from tap and recording can proceed immediately after ended', async () => {
  const audio = new GuideAudio();
  const cue = recordingCue('/test-guide.mp3', () => audio);
  assert.equal(audio.played, 1);
  assert.equal(audio.playbackRate, 1.2);
  assert.equal(audio.preservesPitch, false);
  let finished = false;
  cue.finished.then(() => { finished = true; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(finished, false);
  audio.onended();
  await cue.finished;
  assert.equal(finished, true);
  assert.equal(audio.onended, null);
});
test('recording begins after the guide ends without an extra synthesized sound', async () => {
  const hook = await readFile(new URL('../src/hooks/useEditRecording.ts', import.meta.url), 'utf8');
  const guideCompletion = hook.indexOf('const guideError = await guideReady;');
  const recorderStart = hook.indexOf('rec.start();', guideCompletion);
  assert.ok(guideCompletion >= 0 && recorderStart > guideCompletion);
  assert.doesNotMatch(hook, /playRecordingStartCue|createOscillator/);
});
test('guide playback supports browsers where play() starts audio but returns no Promise', async () => {
  const audio = new GuideAudio();
  audio.play = function () { this.played++; return undefined; };
  const cue = recordingCue('/legacy-safari-guide.mp3', () => audio);
  assert.equal(audio.played, 1);
  await Promise.resolve();
  assert.equal(typeof audio.onended, 'function');
  audio.onended();
  await cue.finished;
});

test('microphone preflight requests audio permission and releases every temporary track', async () => {
  const stopped = [];
  let constraints;
  await primeMicrophonePermission({
    getUserMedia: async (value) => {
      constraints = value;
      return { getTracks: () => [{ stop: () => stopped.push('track-1') }, { stop: () => stopped.push('track-2') }] };
    },
  });
  assert.deepEqual(constraints, { audio: true });
  assert.deepEqual(stopped, ['track-1', 'track-2']);
});
test('guide cancellation and load failure reject instead of permitting recording', async () => {
  const audio = new GuideAudio();
  const cancelled = recordingCue('/test-guide.mp3', () => audio);
  const check = assert.rejects(cancelled.finished, { name: 'AbortError' });
  cancelled.cancel(); await check;
  const failedAudio = new GuideAudio();
  const failed = recordingCue('/test-guide.mp3', () => failedAudio);
  const error = assert.rejects(failed.finished, /ガイドボイス/);
  failedAudio.onerror(); await error;
});
test('preloaded guide is not reloaded while in flight and rewind waits for media metadata', async () => {
  const originalAudio = globalThis.Audio;
  class PendingAudio {
    static instances = [];
    readyState = 0;
    networkState = 2;
    error = null;
    onended = null;
    onerror = null;
    loadCalls = 0;
    playCalls = 0;
    paused = 0;
    _currentTime = 0;
    preload = '';
    playbackRate = 1;
    preservesPitch = true;
    get currentTime() { return this._currentTime; }
    set currentTime(value) {
      if (this.readyState < 1) throw new DOMException('No media timeline yet', 'InvalidStateError');
      this._currentTime = value;
    }
    constructor(src) { this.src = src; PendingAudio.instances.push(this); }
    load() { this.loadCalls++; }
    play() { this.playCalls++; return Promise.resolve(); }
    pause() { this.paused++; }
    removeAttribute() {}
  }
  globalThis.Audio = PendingAudio;
  try {
    const source = await readFile(new URL('../src/lib/recordingCue.ts', import.meta.url), 'utf8');
    const isolated = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}#preload-rewind`);
    const audio = PendingAudio.instances[0];
    // A new Audio(url) is already fetching; opening the form must not cancel and
    // restart that request by calling load() again.
    isolated.preloadRecordingGuide();
    assert.equal(audio.loadCalls, 0);

    audio.networkState = 3;
    isolated.preloadRecordingGuide();
    assert.equal(audio.loadCalls, 1);
    audio.networkState = 2;

    const cue = isolated.recordingCue();
    assert.equal(audio.playCalls, 1);
    assert.equal(audio._currentTime, 0);
    audio.onended();
    await cue.finished;
    assert.equal(audio.paused, 1);
  } finally {
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  }
});

test('long press tolerates small finger jitter but cancels drags and scroll-sized movement', () => {
  assert.equal(gesture.LONG_PRESS_MS, 550);
  assert.equal(gesture.movedTooFar(0, 0, 6, 8), false);
  assert.equal(gesture.movedTooFar(0, 0, 8, 8), true);
  assert.equal(gesture.movedTooFar(20, 20, 20, -1), true);
});
test('child touch taps tolerate 25px final displacement even after native scrolling, but not long presses or cancelled gestures', () => {
  assert.equal(gesture.TOUCH_TAP_SLOP, 25);
  assert.equal(gesture.isChildTap(0, 0, 15, 20), true);
  assert.equal(gesture.isChildTap(0, 0, 0, 25), true);
  assert.equal(gesture.isChildTap(0, 0, 20, 20), false);
  assert.equal(gesture.isChildTap(0, 0, 0, 26), false);
  assert.equal(gesture.isChildTap(0, 0, 0, 0, true), false);
  assert.equal(gesture.isChildTap(0, 0, 0, 0, false, true), false);
});
test('AI selection intersection cannot restore outside-lasso pixels, retains original colour and alpha', () => {
  const original = new Uint8ClampedArray([99, 66, 22, 0, 180, 30, 20, 255, 12, 90, 70, 128]);
  const mask = new Uint8ClampedArray([1, 2, 3, 255, 1, 2, 3, 128, 1, 2, 3, 255]);
  const before = [...original];
  assert.deepEqual([...subject.intersectSubjectMask(original, mask)], [0, 0, 0, 0, 180, 30, 20, 128, 12, 90, 70, 128]);
  assert.deepEqual([...original], before);
});
test('AI background alpha is removed with hidden RGB and transparent padding is tightly cropped', () => {
  const original = new Uint8ClampedArray(3 * 3 * 4).fill(255);
  const mask = new Uint8ClampedArray(3 * 3 * 4);
  mask[3] = 1; mask[(1 * 3 + 1) * 4 + 3] = 255;
  const result = subject.intersectSubjectMask(original, mask);
  assert.deepEqual([...result.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual(subject.subjectBounds(result, 3, 3), { x: 1, y: 1, width: 1, height: 1 });
  assert.throws(() => subject.subjectBounds(new Uint8ClampedArray(36), 3, 3), /被写体/);
  assert.throws(() => subject.intersectSubjectMask(original, new Uint8ClampedArray(4)), /大きさ/);
});

test('AI-anchored opacity repair fills connected solid foreground without filling background holes or disconnected patches', () => {
  const width = 10, height = 6;
  const source = new Uint8ClampedArray(width * height * 4).fill(255);
  const mask = new Uint8ClampedArray(source.length);
  const paint = (x, y, alpha = 30) => {
    const i = (y * width + x) * 4;
    source.set([220, 30, 30, 255], i); mask[i + 3] = alpha;
  };
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 4; x++) paint(x, y, x <= 2 ? 180 : 30);
  source.set([255, 255, 255, 255], (2 * width + 3) * 4);
  mask[(2 * width + 3) * 4 + 3] = 0; // real white-background hole in the object
  paint(8, 2, 0); // disconnected matching colour must not be recovered
  source[(3 * width + 4) * 4 + 3] = 0; // excluded lasso pixels must stay excluded
  const before = [...mask];
  const refined = subject.refineSubjectOpacity(source, mask, width, height);
  const result = subject.intersectSubjectMask(source, refined);
  assert.equal(result[(1 * width + 4) * 4 + 3], 255);
  assert.equal(result[(2 * width + 3) * 4 + 3], 0);
  assert.equal(result[(2 * width + 8) * 4 + 3], 0);
  assert.equal(result[(3 * width + 4) * 4 + 3], 0);
  assert.deepEqual([...mask], before);
  const empty = subject.refineSubjectOpacity(source, new Uint8ClampedArray(mask.length), width, height);
  assert.ok(empty.every((value) => value === 0)); // no semantic anchors = no fabricated success
});
