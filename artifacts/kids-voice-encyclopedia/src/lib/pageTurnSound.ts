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

/** Plays a short, paper-like foley swish after a successful user-triggered turn. */
export function playPageTurnSound(contextOverride?: AudioContext): boolean {
  const context = contextOverride ?? getAudioContext();
  if (!context) return false;

  try {
    if (context.state === 'suspended') void context.resume().catch(() => {});

    const duration = 0.48;
    const frameCount = Math.max(1, Math.ceil(context.sampleRate * duration));
    const buffer = context.createBuffer(2, frameCount, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = buffer.getChannelData(channel);
      let coloredNoise = 0;
      let previousWhiteNoise = 0;
      const flutterPhase = Math.random() * Math.PI * 2 + channel * 0.31;
      for (let index = 0; index < samples.length; index += 1) {
        const progress = index / Math.max(1, samples.length - 1);
        const whiteNoise = Math.random() * 2 - 1;
        coloredNoise = coloredNoise * 0.91 + whiteNoise * 0.09;
        const paperGrain = whiteNoise - previousWhiteNoise * 0.72;
        previousWhiteNoise = whiteNoise;

        const swell = Math.pow(Math.sin(Math.PI * progress), 0.72);
        const flutter = 0.79
          + Math.sin(progress * Math.PI * 2 * 13 + flutterPhase) * 0.13
          + Math.sin(progress * Math.PI * 2 * 27 + flutterPhase * 0.7) * 0.08;
        samples[index] = (coloredNoise * 0.64 + paperGrain * 0.14 + whiteNoise * 0.11)
          * swell * flutter * 0.75;
      }
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    const bodyFilter = context.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.Q.value = 0.35;
    bodyFilter.frequency.setValueAtTime(1900, context.currentTime);
    bodyFilter.frequency.exponentialRampToValueAtTime(1150, context.currentTime + duration);
    const bodyVolume = context.createGain();
    bodyVolume.gain.setValueAtTime(0.0001, context.currentTime);
    bodyVolume.gain.exponentialRampToValueAtTime(0.34, context.currentTime + 0.045);
    bodyVolume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

    const detailFilter = context.createBiquadFilter();
    detailFilter.type = 'highpass';
    detailFilter.Q.value = 0.45;
    detailFilter.frequency.setValueAtTime(900, context.currentTime);
    detailFilter.frequency.exponentialRampToValueAtTime(1550, context.currentTime + duration);
    const detailVolume = context.createGain();
    detailVolume.gain.setValueAtTime(0.0001, context.currentTime);
    detailVolume.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.09);
    detailVolume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration * 0.82);

    source.connect(bodyFilter);
    bodyFilter.connect(bodyVolume);
    bodyVolume.connect(context.destination);
    source.connect(detailFilter);
    detailFilter.connect(detailVolume);
    detailVolume.connect(context.destination);
    source.start(context.currentTime);
    source.stop(context.currentTime + duration);
    return true;
  } catch {
    return false;
  }
}
