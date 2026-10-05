/** RMS -40dBFS。短いノイズで開始判定しないよう、10ms窓を2つ連続で確認。 */
export const SILENCE_THRESHOLD = 0.01;
export const VOICE_PREROLL_SECONDS = 0.05;

export function findVoiceStart(channels: Float32Array[], sampleRate: number): number | null {
  const length = channels[0]?.length ?? 0;
  const windowSize = Math.max(1, Math.round(sampleRate * 0.01));
  let firstLoud = -1;
  for (let offset = 0; offset < length; offset += windowSize) {
    const end = Math.min(offset + windowSize, length);
    let loud = false;
    for (const channel of channels) {
      let squares = 0;
      for (let i = offset; i < end; i++) squares += channel[i] ** 2;
      if (Math.sqrt(squares / (end - offset)) >= SILENCE_THRESHOLD) loud = true;
    }
    if (loud) {
      if (firstLoud >= 0) return Math.max(0, firstLoud - Math.round(sampleRate * VOICE_PREROLL_SECONDS));
      firstLoud = offset;
    } else {
      firstLoud = -1;
    }
  }
  return null;
}

/** PCM 16-bit WAV: MediaRecorder の WebM / MP4 に依存しない再生形式。 */
export function encodeWav(channels: Float32Array[], sampleRate: number, start: number): Blob {
  const frames = channels[0].length - start;
  const byteLength = frames * channels.length * 2;
  const output = new ArrayBuffer(44 + byteLength);
  const view = new DataView(output);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, 36 + byteLength, true);
  text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, byteLength, true);
  let offset = 44;
  for (let i = start; i < channels[0].length; i++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return new Blob([output], { type: 'audio/wav' });
}

export async function trimLeadingSilence(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    const start = findVoiceStart(channels, decoded.sampleRate);
    if (start === null) throw new Error('声が聞こえませんでした。マイクの近くでもう一度録音してください。');
    return encodeWav(channels, decoded.sampleRate, start);
  } finally {
    await context.close();
  }
}
