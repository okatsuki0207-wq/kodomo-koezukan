type BrowserWindow = Window & { webkitAudioContext?: typeof AudioContext };

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextConstructor = window.AudioContext ?? (window as BrowserWindow).webkitAudioContext;
  if (!AudioContextConstructor) return null;

  try {
    sharedAudioContext ??= new AudioContextConstructor();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

/** Plays a quiet, short filtered-noise page swish after a successful user-triggered turn. */
export function playPageTurnSound(contextOverride?: AudioContext): boolean {
  const context = contextOverride ?? getAudioContext();
  if (!context) return false;

  try {
    if (context.state === 'suspended') void context.resume().catch(() => {});

    const duration = 0.26;
    const frameCount = Math.max(1, Math.ceil(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      const fade = Math.pow(1 - index / samples.length, 1.8);
      samples[index] = (Math.random() * 2 - 1) * fade;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.65;
    filter.frequency.setValueAtTime(2600, context.currentTime);
    filter.frequency.exponentialRampToValueAtTime(850, context.currentTime + duration);

    const volume = context.createGain();
    volume.gain.setValueAtTime(0.0001, context.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.035);
    volume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

    source.connect(filter);
    filter.connect(volume);
    volume.connect(context.destination);
    source.start(context.currentTime);
    source.stop(context.currentTime + duration);
    return true;
  } catch {
    return false;
  }
}
