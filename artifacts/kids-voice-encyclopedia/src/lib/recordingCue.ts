/** Fixed local guide voice. Microphone recording waits for ended + an acoustic
 * tail. Never silently skip a failed guide or start recording after cancellation. */
export function recordingCue(
  url = `${import.meta.env.BASE_URL}assets/audio/voice_what_is_this.mp3`,
  createAudio: (url: string) => HTMLAudioElement = (src) => new Audio(src),
) {
  const audio = createAudio(url);
  audio.preload = 'auto';
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  let tail: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const finished = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const finish = (error?: Error) => {
    if (done) return;
    done = true;
    clearTimeout(tail); clearTimeout(watchdog);
    audio.onended = null; audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src'); audio.load();
    if (error) reject(error); else resolve();
  };
  audio.onended = () => { if (!done) tail = setTimeout(() => finish(), 180); };
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
