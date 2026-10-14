type Playback = { id: string; url: string; playing: boolean } | null;
type Options = { onChange: (state: Playback) => void; onError: () => void; createAudio?: (url: string) => HTMLAudioElement };

/** Per-card shuffle bag: every voice is used once per round, without a repeat
 * between rounds when the card has more than one voice. */
export class VoiceShuffleBag<T> {
  private remaining: string[] = [];
  private previousKey: string | null = null;
  private signature = '';
  private readonly keyOf: (item: T) => string;
  private readonly random: () => number;

  constructor(
    keyOf: (item: T) => string,
    random: () => number = Math.random,
  ) {
    this.keyOf = keyOf;
    this.random = random;
  }

  prepare(items: readonly T[]) {
    const current = new Map<string, T>();
    for (const item of items) {
      const key = this.keyOf(item);
      if (key && !current.has(key)) current.set(key, item);
    }
    const keys = [...current.keys()];
    if (!keys.length) {
      this.remaining = [];
      this.previousKey = null;
      this.signature = '';
      return;
    }

    const signature = JSON.stringify([...keys].sort());
    if (signature !== this.signature) {
      this.signature = signature;
      this.remaining = [];
    }

    if (this.remaining.length) return;
    const shuffled = keys.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const value = this.random();
      const safeValue = Number.isFinite(value) ? Math.min(0.999999999999, Math.max(0, value)) : 0;
      const j = Math.floor(safeValue * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (shuffled.length > 1 && shuffled[0] === this.previousKey) {
      const value = this.random();
      const safeValue = Number.isFinite(value) ? Math.min(0.999999999999, Math.max(0, value)) : 0;
      const swapIndex = 1 + Math.floor(safeValue * (shuffled.length - 1));
      [shuffled[0], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[0]];
    }
    this.remaining = shuffled;
  }

  next(items: readonly T[]): T | undefined {
    this.prepare(items);
    if (!this.remaining.length) return undefined;
    const current = new Map(items.map((item) => [this.keyOf(item), item]));

    const key = this.remaining.shift();
    if (!key) return undefined;
    this.previousKey = key;
    return current.get(key);
  }

  reset() {
    this.remaining = [];
    this.previousKey = null;
    this.signature = '';
  }
}

/** Bounded metadata preloading; play() is called directly in the tap gesture,
 * without awaiting a fetch/decode. No playlist or automatic next voice. */
export class VoicePlayback {
  private cache = new Map<string, HTMLAudioElement>();
  private active: HTMLAudioElement | null = null;
  private activeUrl: string | null = null;
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
  restart(id: string) {
    const audio = this.active;
    const url = this.activeUrl;
    if (!audio || !url || this.id !== id) return false;
    const token = ++this.token;
    const live = () => this.token === token && this.active === audio;
    const fail = () => { if (live()) { this.stop(); this.options.onError(); } };
    audio.onended = () => { if (live() && audio.ended) this.stop(); };
    audio.onpause = () => { if (live() && audio.paused && !audio.ended) this.stop(); };
    audio.onerror = fail;
    try { audio.currentTime = 0; } catch { /* metadata may still be loading */ }
    try {
      audio.play().then(() => {
        if (live()) this.options.onChange({ id, url, playing: true });
      }).catch(fail);
    } catch { fail(); }
    return true;
  }
  stop() {
    this.token++;
    const audio = this.active;
    this.active = null; this.activeUrl = null; this.id = null;
    if (audio) {
      audio.onended = audio.onerror = audio.onpause = null;
      audio.pause();
    }
    this.options.onChange(null);
  }

  play(url: string, id: string) {
    this.stop();
    const audio = this.get(url), token = ++this.token;
    this.active = audio; this.activeUrl = url; this.id = id;
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
