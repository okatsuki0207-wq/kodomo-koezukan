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

/** Synthesizes a soft, papery page flutter after a successful user-triggered turn. */
export function playPageTurnSound(contextOverride?: AudioContext): boolean {
  const context = contextOverride ?? getAudioContext();
  if (!context) return false;

  try {
    if (context.state === 'suspended') void context.resume().catch(() => {});

    const duration = 0.56;
    const frameCount = Math.max(1, Math.ceil(context.sampleRate * duration));
    const buffer = context.createBuffer(2, frameCount, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = buffer.getChannelData(channel);
      let coloredNoise = 0;
      let previousWhiteNoise = 0;
      const phase = Math.random() * Math.PI * 2 + channel * 0.31;
      const foldCrinkles = Array.from({ length: 8 }, (_, index) => ({
        center: Math.max(0.05, Math.min(0.94, 0.08 + index * 0.115 + (Math.random() - 0.5) * 0.11)),
        width: 0.006 + Math.random() * 0.018,
        strength: 0.06 + Math.random() * 0.13,
      }));
      for (let index = 0; index < samples.length; index += 1) {
        const progress = index / Math.max(1, samples.length - 1);
        const whiteNoise = Math.random() * 2 - 1;
        coloredNoise = coloredNoise * 0.91 + whiteNoise * 0.09;
        const paperGrain = whiteNoise - previousWhiteNoise * 0.76;
        previousWhiteNoise = whiteNoise;

        const broadRustle = Math.pow(Math.sin(Math.PI * progress), 0.62);
        const flutter = 0.82
          + Math.sin(progress * Math.PI * 2 * 8 + phase) * 0.10
          + Math.sin(progress * Math.PI * 2 * 17 + phase * 0.73) * 0.06;
        const foldCrinkle = foldCrinkles.reduce((sum, crinkle) => {
          const distance = (progress - crinkle.center) / crinkle.width;
          return sum + crinkle.strength * Math.exp(-distance * distance);
        }, 0);
        samples[index] = (
          coloredNoise * 0.42
          + paperGrain * 0.32
          + whiteNoise * 0.035
          + foldCrinkle * (whiteNoise * 0.55 + paperGrain * 0.45)
        ) * broadRustle * flutter * 0.7;
      }
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    const bodyFilter = context.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.Q.value = 0.35;
    bodyFilter.frequency.setValueAtTime(2400, context.currentTime);
    bodyFilter.frequency.exponentialRampToValueAtTime(1450, context.currentTime + duration);
    const bodyVolume = context.createGain();
    bodyVolume.gain.setValueAtTime(0.0001, context.currentTime);
    bodyVolume.gain.exponentialRampToValueAtTime(0.25, context.currentTime + 0.06);
    bodyVolume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

    const detailFilter = context.createBiquadFilter();
    detailFilter.type = 'highpass';
    detailFilter.Q.value = 0.45;
    detailFilter.frequency.setValueAtTime(1100, context.currentTime);
    detailFilter.frequency.exponentialRampToValueAtTime(2100, context.currentTime + duration);
    const detailVolume = context.createGain();
    detailVolume.gain.setValueAtTime(0.0001, context.currentTime);
    detailVolume.gain.exponentialRampToValueAtTime(0.09, context.currentTime + 0.11);
    detailVolume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration * 0.9);

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
