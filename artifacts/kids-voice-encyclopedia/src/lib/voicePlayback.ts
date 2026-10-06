type Playback = { id: string; url: string; playing: boolean } | null;
type Options = { onChange: (state: Playback) => void; onError: () => void; createAudio?: (url: string) => HTMLAudioElement };

export function randomVoice<T>(voices: readonly T[], random = Math.random): T | undefined {
  return voices.length ? voices[Math.min(voices.length - 1, Math.max(0, Math.floor(random() * voices.length)))] : undefined;
}

/** Bounded metadata preloading; play() is called directly in the tap gesture,
 * without awaiting a fetch/decode. No playlist or automatic next voice. */
export class VoicePlayback {
  private cache = new Map<string, HTMLAudioElement>();
  private active: HTMLAudioElement | null = null;
  private id: string | null = null;
  private token = 0;
  private options: Options;
  constructor(options: Options) { this.options = options; }

  private get(url: string) {
    let audio = this.cache.get(url);
    if (!audio) {
      audio = this.options.createAudio?.(url) ?? new Audio(url);
      audio.preload = 'metadata';
      this.cache.set(url, audio);
    }
    return audio;
  }

  warm(urls: string[]) {
    const keep = new Set([...new Set(urls)].slice(0, 24));
    for (const [url, audio] of this.cache) if (!keep.has(url) && audio !== this.active) {
      audio.onended = audio.onerror = audio.onpause = null;
      audio.pause(); audio.removeAttribute('src'); audio.load(); this.cache.delete(url);
    }
    keep.forEach((url) => this.get(url));
  }

  isActive(id: string) { return this.id === id; }
  stop() {
    this.token++;
    const audio = this.active;
    this.active = null; this.id = null;
    if (audio) {
      audio.onended = audio.onerror = audio.onpause = null;
      audio.pause();
    }
    this.options.onChange(null);
  }

  play(url: string, id: string) {
    if (this.id === id && this.active) { this.stop(); return; }
    this.stop();
    const audio = this.get(url), token = ++this.token;
    this.active = audio; this.id = id;
    try { audio.currentTime = 0; } catch { /* still loading metadata */ }
    const live = () => this.token === token && this.active === audio;
    const fail = () => { if (live()) { this.stop(); this.options.onError(); } };
    this.options.onChange({ id, url, playing: false });
    audio.onended = () => { if (live() && audio.ended) this.stop(); };
    audio.onpause = () => { if (live() && audio.paused && !audio.ended) this.stop(); };
    audio.onerror = fail;
    try {
      audio.play().then(() => { if (live()) this.options.onChange({ id, url, playing: true }); }).catch(fail);
    } catch { fail(); }
  }

  dispose() {
    this.stop();
    for (const audio of this.cache.values()) { audio.removeAttribute('src'); audio.load(); }
    this.cache.clear();
  }
}
