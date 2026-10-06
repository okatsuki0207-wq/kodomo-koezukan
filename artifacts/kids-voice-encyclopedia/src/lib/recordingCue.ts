/** A local two-note cue. Recording must wait for completion, including a short
 * acoustic tail, so the cue is not captured by the microphone. */
export function recordingCue(context: AudioContext) {
  let settle: () => void = () => {};
  let tail: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const finished = new Promise<void>((resolve) => { settle = resolve; });
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const finish = () => {
    if (done) return;
    done = true;
    if (tail) clearTimeout(tail);
    oscillator.onended = null;
    oscillator.disconnect(); gain.disconnect();
    settle();
  };
  oscillator.connect(gain); gain.connect(context.destination);
  const t = context.currentTime;
  oscillator.frequency.setValueAtTime(880, t);
  oscillator.frequency.setValueAtTime(1174.66, t + 0.24);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.09, t + 0.025);
  gain.gain.linearRampToValueAtTime(0.03, t + 0.22);
  gain.gain.linearRampToValueAtTime(0.09, t + 0.27);
  gain.gain.linearRampToValueAtTime(0, t + 0.6);
  oscillator.onended = () => { tail = setTimeout(finish, 180); };
  oscillator.start(t); oscillator.stop(t + 0.62);
  return { finished, cancel: () => { try { oscillator.stop(); } catch { /* already ended */ } finish(); } };
}
