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
export function encodeWav(channels: Float32Array[], sampleRate: number, start: number, end = channels[0]?.length ?? 0): Blob {
  if (!channels.length || channels.some((c) => c.length !== channels[0].length) ||
    !Number.isFinite(sampleRate) || sampleRate <= 0 ||
    !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > channels[0].length || end <= start) {
    throw new Error('音声の切り抜き範囲が正しくありません。');
  }
  const frames = end - start;
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
  for (let i = start; i < end; i++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return new Blob([output], { type: 'audio/wav' });
}

export type DecodedAudio = { channels: Float32Array[]; sampleRate: number; duration: number };

export async function decodeAudioBlob(recording: Blob): Promise<DecodedAudio> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('このブラウザでは音声を編集できません。');
  const context = new Ctx();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    return { channels, sampleRate: decoded.sampleRate, duration: decoded.length / decoded.sampleRate };
  } finally {
    // Closing an already-closed context must not mask a successful decode.
    await context.close().catch(() => undefined);
  }
}

export async function trimLeadingSilence(recording: Blob): Promise<Blob> {
  const decoded = await decodeAudioBlob(recording);
  const start = findVoiceStart(decoded.channels, decoded.sampleRate);
  if (start === null) throw new Error('声が聞こえませんでした。マイクの近くでもう一度録音してください。');
  return encodeWav(decoded.channels, decoded.sampleRate, start);
}

/** 前後の余白は声の始まり・終わりに少しだけ残す。 */
export const VOICE_RANGE_PREROLL_SECONDS = 0.05;
export const VOICE_RANGE_POSTROLL_SECONDS = 0.2;
/**
 * 一番大きな声の窓を基準に、この割合未満の窓は「声なし」とみなす。
 * ガイドボイス再生中の残響や小さな物音を残さないよう、しっかり声が
 * 入っている範囲だけを残す厳しめの値にする。
 */
export const VOICE_RELATIVE_THRESHOLD = 0.25;
/** 声の開始・終了とみなすために必要な、しきい値超えの連続窓数（10ms窓）。 */
export const VOICE_RANGE_MIN_RUN_WINDOWS = 3;

/**
 * 声らしい大きさがある範囲だけを返す。判定は10ms窓のRMSで、一番大きな窓に
 * 対する相対しきい値（下限は SILENCE_THRESHOLD）。短いノイズで判定しないよう、
 * 開始・終了とも原則3窓連続でしきい値を超えた位置を使う（見つからなければ
 * 2窓・1窓の順に緩める）。
 */
export function findVoiceRange(channels: Float32Array[], sampleRate: number): { start: number; end: number } | null {
  const length = channels[0]?.length ?? 0;
  if (!length || !channels.length) return null;
  const windowSize = Math.max(1, Math.round(sampleRate * 0.01));
  const windows = Math.ceil(length / windowSize);
  const rms = new Float32Array(windows);
  let peak = 0;
  for (let w = 0; w < windows; w++) {
    const from = w * windowSize;
    const to = Math.min(from + windowSize, length);
    let loudest = 0;
    for (const channel of channels) {
      let squares = 0;
      for (let i = from; i < to; i++) squares += channel[i] ** 2;
      loudest = Math.max(loudest, Math.sqrt(squares / (to - from)));
    }
    rms[w] = loudest;
    if (loudest > peak) peak = loudest;
  }
  if (peak < SILENCE_THRESHOLD) return null;
  const threshold = Math.max(SILENCE_THRESHOLD, peak * VOICE_RELATIVE_THRESHOLD);
  const findRunStart = (minRun: number): number => {
    for (let w = 0; w + minRun - 1 < windows; w++) {
      let ok = true;
      for (let k = 0; k < minRun; k++) if (rms[w + k] < threshold) { ok = false; break; }
      if (ok) return w;
    }
    return -1;
  };
  const findRunEnd = (minRun: number): number => {
    for (let w = windows - 1; w - minRun + 1 >= 0; w--) {
      let ok = true;
      for (let k = 0; k < minRun; k++) if (rms[w - k] < threshold) { ok = false; break; }
      if (ok) return w;
    }
    return -1;
  };
  let first = findRunStart(VOICE_RANGE_MIN_RUN_WINDOWS);
  if (first < 0) first = findRunStart(2);
  if (first < 0) first = findRunStart(1);
  if (first < 0) return null;
  let last = findRunEnd(VOICE_RANGE_MIN_RUN_WINDOWS);
  if (last < 0) last = findRunEnd(2);
  if (last < 0) last = findRunEnd(1);
  if (last < first) return null;
  const start = Math.max(0, first * windowSize - Math.round(sampleRate * VOICE_RANGE_PREROLL_SECONDS));
  const end = Math.min(length, (last + 1) * windowSize + Math.round(sampleRate * VOICE_RANGE_POSTROLL_SECONDS));
  if (end - start < Math.round(sampleRate * 0.05)) return null;
  return { start, end };
}

/** 録音の前後にある小さい音量の部分を自動で切り取り、声の範囲だけをWAVで返す。 */
export async function autoTrimVoiceEdges(recording: Blob): Promise<Blob> {
  const decoded = await decodeAudioBlob(recording);
  const range = findVoiceRange(decoded.channels, decoded.sampleRate);
  if (range === null) throw new Error('声が聞こえませんでした。マイクの近くでもう一度録音してください。');
  return encodeWav(decoded.channels, decoded.sampleRate, range.start, range.end);
}

export function trimAudioRange(audio: DecodedAudio, startSeconds: number, endSeconds: number): Blob {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
    startSeconds < 0 || endSeconds > audio.duration + 0.001 || endSeconds - startSeconds < 0.05) {
    throw new Error('開始と終了の間を0.05秒以上あけてください。');
  }
  return encodeWav(audio.channels, audio.sampleRate, Math.round(startSeconds * audio.sampleRate),
    Math.min(audio.channels[0].length, Math.round(endSeconds * audio.sampleRate)));
}

export function waveformPeaks(channels: Float32Array[], count = 160): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length || !Number.isInteger(count) || count < 1 || count > 1000) return [];
  return Array.from({ length: count }, (_, bin) => {
    const start = Math.floor(bin * length / count), end = Math.max(start + 1, Math.floor((bin + 1) * length / count));
    let peak = 0;
    for (const channel of channels) for (let i = start; i < Math.min(end, channel.length); i++) peak = Math.max(peak, Math.abs(channel[i]));
    return Math.min(1, peak);
  });
}
