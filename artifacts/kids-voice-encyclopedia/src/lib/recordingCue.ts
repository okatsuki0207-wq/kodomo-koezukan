/** Fixed local guide voice. The microphone starts while it plays; browsers
 * use acoustic echo cancellation to reduce guide playback in the recording. */
const GUIDE_URL = `${import.meta.env?.BASE_URL ?? '/'}assets/audio/voice_what_is_this.mp3`;

// Start fetching the tiny, fixed voice as soon as this module loads. Playback
// still calls play() directly inside the recording button's tap handler.
const preloadedGuideAudio = typeof Audio === 'undefined' ? null : new Audio(GUIDE_URL);
function ensureGuideLoaded(audio: HTMLAudioElement) {
  audio.preload = 'auto';
  // load() restarts an in-flight request in some browsers. Only start/retry it
  // when there is no active request or the previous request failed.
  if (audio.networkState === 0 || audio.networkState === 3 || audio.error) {
    try { audio.load(); } catch { /* playback will report a useful error */ }
  }
}
function rewindWhenReady(audio: HTMLAudioElement) {
  // Safari can throw InvalidStateError when currentTime is assigned before
  // preload has established a media timeline. A fresh audio element already
  // starts at zero, so defer rewinding until metadata exists.
  if (audio.readyState < 1) return;
  try { audio.currentTime = 0; } catch { /* play() can still start/restart the clip */ }
}
if (preloadedGuideAudio) ensureGuideLoaded(preloadedGuideAudio);

/** Warm the fixed guide again as soon as the creation form is opened. */
export function preloadRecordingGuide() {
  if (!preloadedGuideAudio) return;
  ensureGuideLoaded(preloadedGuideAudio);
}

export function recordingCue(
  url = GUIDE_URL,
  createAudio?: (url: string) => HTMLAudioElement,
) {
  const usingPreloaded = !createAudio && url === GUIDE_URL && preloadedGuideAudio !== null;
  const audio = createAudio ? createAudio(url) : usingPreloaded ? preloadedGuideAudio : new Audio(url);
  try { audio.preload = 'auto'; } catch { /* playback remains the source of truth */ }
  // A slightly faster rate shortens the prompt and raises its pitch without
  // replacing the original character voice.
  try { audio.playbackRate = 1.2; } catch { /* use the browser's default rate */ }
  try {
    audio.preservesPitch = false;
    const prefixed = audio as HTMLAudioElement & { webkitPreservesPitch?: boolean };
    if ('webkitPreservesPitch' in prefixed) prefixed.webkitPreservesPitch = false;
  } catch { /* pitch adjustment is optional */ }
  const getDurationMs = () => Number.isFinite(audio.duration) && audio.duration > 0
    ? Math.round((audio.duration / audio.playbackRate) * 1000)
    : 5000;
  const getProgress = () => Number.isFinite(audio.duration) && audio.duration > 0
    ? Math.min(1, Math.max(0, audio.currentTime / audio.duration))
    : 0;
  // Rewind a previously used shared element without discarding its cached data.
  if (usingPreloaded) rewindWhenReady(audio);
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const finished = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const finish = (error?: Error) => {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    audio.onended = null; audio.onerror = null;
    audio.pause();
    if (usingPreloaded) {
      rewindWhenReady(audio);
    } else {
      audio.removeAttribute('src'); audio.load();
    }
    if (error) reject(error); else resolve();
  };
  audio.onended = () => finish();
  audio.onerror = () => finish(new Error('ガイドボイスを読み込めませんでした。通信を確認して、もう一度録音ボタンを押してください。'));
  watchdog = setTimeout(() => finish(new Error('ガイドボイスの再生が完了しませんでした。もう一度録音ボタンを押してください。')), 20_000);
  // play() must run synchronously inside the user's tap, before permissions.
  try {
    // Older Safari versions may start playback but return undefined instead
    // of a Promise. Promise.resolve preserves the synchronous play() call and
    // handles both forms without stopping a successfully-started guide.
    void Promise.resolve(audio.play()).catch(() => finish(new Error('ガイドボイスを再生できませんでした。もう一度録音ボタンを押してください。')));
  } catch {
    finish(new Error('ガイドボイスを再生できませんでした。'));
  }
  return {
    finished,
    cancel: () => finish(new DOMException('Guide cancelled', 'AbortError')),
    get durationMs() { return getDurationMs(); },
    get progress() { return getProgress(); },
  };
}
