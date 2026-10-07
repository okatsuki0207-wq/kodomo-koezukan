/** Fixed local guide voice. Recording starts as soon as playback ends.
 * Never silently skip a failed guide or start recording after cancellation. */
const GUIDE_URL = `${import.meta.env?.BASE_URL ?? '/'}assets/audio/voice_what_is_this.mp3`;

// Start fetching the tiny, fixed voice as soon as this module loads. Playback
// still calls play() directly inside the recording button's tap handler.
const preloadedGuideAudio = typeof Audio === 'undefined' ? null : new Audio(GUIDE_URL);
if (preloadedGuideAudio) {
  preloadedGuideAudio.preload = 'auto';
  preloadedGuideAudio.load();
}

/** Warm the fixed guide again as soon as the creation form is opened. */
export function preloadRecordingGuide() {
  if (!preloadedGuideAudio) return;
  preloadedGuideAudio.preload = 'auto';
  preloadedGuideAudio.load();
}

export function recordingCue(
  url = GUIDE_URL,
  createAudio?: (url: string) => HTMLAudioElement,
) {
  const usingPreloaded = !createAudio && url === GUIDE_URL && preloadedGuideAudio !== null;
  const audio = createAudio ? createAudio(url) : usingPreloaded ? preloadedGuideAudio : new Audio(url);
  audio.preload = 'auto';
  // A small rate increase makes the guide brighter without replacing its voice.
  // Disable pitch preservation where supported so the voice actually sounds higher.
  audio.playbackRate = 1.12;
  audio.preservesPitch = false;
  const prefixed = audio as HTMLAudioElement & { webkitPreservesPitch?: boolean };
  if ('webkitPreservesPitch' in prefixed) prefixed.webkitPreservesPitch = false;
  // Rewind a previously used shared element without discarding its cached data.
  if (usingPreloaded) audio.currentTime = 0;
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
      audio.currentTime = 0;
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
    void audio.play().catch(() => finish(new Error('ガイドボイスを再生できませんでした。もう一度録音ボタンを押してください。')));
  } catch {
    finish(new Error('ガイドボイスを再生できませんでした。'));
  }
  return { finished, cancel: () => finish(new DOMException('Guide cancelled', 'AbortError')) };
}
