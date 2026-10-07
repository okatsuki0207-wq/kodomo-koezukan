import { useCallback, useEffect, useRef, useState } from 'react';
import { recordingCue } from '../lib/recordingCue';
import { primeMicrophonePermission } from '../lib/microphonePermission';

export const MAX_RECORD_SECONDS = 60;
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

function playRecordingStartCue(context: AudioContext) {
  return new Promise<void>((resolve) => {
    let timeout: number | undefined;
    const done = () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      resolve();
    };
    try {
      const now = context.currentTime;
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(1046.5, now);
      tone.frequency.setValueAtTime(1568, now + 0.055);
      volume.gain.setValueAtTime(0.0001, now);
      volume.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
      volume.gain.setValueAtTime(0.08, now + 0.075);
      volume.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      tone.onended = done;
      tone.connect(volume);
      volume.connect(context.destination);
      tone.start(now);
      tone.stop(now + 0.15);
      timeout = window.setTimeout(done, 250);
    } catch {
      // The visual start cue and recording must continue if sound synthesis fails.
      done();
    }
  });
}

/** 新規・編集共通。合図の終了後に録音し、結果のBlobだけを返す。古いセッションは破棄。 */
export function useEditRecording(onResult: (blob: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [guiding, setGuiding] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [guideProgress, setGuideProgress] = useState(0);
  const [guideDurationMs, setGuideDurationMs] = useState(5000);
  const [error, setError] = useState('');
  const [micStatus, setMicStatus] = useState<'idle' | 'preparing' | 'ready' | 'denied' | 'unsupported'>('idle');
  const session = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const guideRaf = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const cue = useRef<ReturnType<typeof recordingCue> | null>(null);
  const startingRef = useRef(false);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;
  const preparingRef = useRef(false);

  const release = useCallback(() => {
    cue.current?.cancel(); cue.current = null;
    setGuiding(false);
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    if (guideRaf.current) cancelAnimationFrame(guideRaf.current);
    guideRaf.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLevel(0);
    setGuideProgress(0);
  }, []);

  const stop = useCallback(() => {
    const rec = recorder.current;
    recorder.current = null;
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    // Keep the form locked until onstop delivers its final Blob.
    if (rec && rec.state === 'recording') rec.stop(); else { setRecording(false); release(); }
  }, [release]);

  /** 録音を捨てて止める（結果は返さない）。 */
  const cancel = useCallback(() => {
    session.current++;
    const rec = recorder.current;
    recorder.current = null;
    if (rec && rec.state === 'recording') { try { rec.stop(); } catch { /* ignore */ } }
    release();
    setRecording(false);
    setStarting(false);
    startingRef.current = false;
    preparingRef.current = false;
    setMicStatus('idle');
    setSeconds(0);
  }, [release]);

  const prepareMicrophone = useCallback(async () => {
    if (preparingRef.current || startingRef.current || recorder.current) return;
    if (!canRecord()) { setMicStatus('unsupported'); return; }
    const mine = ++session.current;
    preparingRef.current = true;
    setMicStatus('preparing');
    setError('');
    try {
      await primeMicrophonePermission(navigator.mediaDevices);
      if (mine === session.current) setMicStatus('ready');
    } catch (caught) {
      if (mine !== session.current) return;
      const denied = caught instanceof DOMException && (caught.name === 'NotAllowedError' || caught.name === 'PermissionDeniedError');
      setMicStatus(denied ? 'denied' : 'idle');
      setError(denied
        ? 'マイクの使用が許可されませんでした。ブラウザで許可すると録音できます。'
        : 'マイクを準備できませんでした。録音ボタンからもう一度お試しください。');
    } finally {
      if (mine === session.current) preparingRef.current = false;
    }
  }, []);

  const start = useCallback(async () => {
    if (recorder.current || startingRef.current || preparingRef.current) return;
    setError('');
    if (!canRecord()) { setError('このブラウザではマイク録音をご利用いただけません。'); return; }
    const mine = ++session.current;
    startingRef.current = true;
    setStarting(true);
    setGuideProgress(0);
    let acquired: MediaStream | null = null;
    try {
      // Unlock Web Audio synchronously in the tap gesture, before microphone
      // permission or any other asynchronous work (important on iPhone).
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) throw new Error('このブラウザではガイドボイスと録音を準備できません。');
      const ctx = new Ctx();
      audioCtx.current = ctx;
      const ready = ctx.resume().then(() => null, (error: unknown) => error);
      setGuiding(true);
      cue.current = recordingCue();
      setGuideDurationMs(cue.current.durationMs);
      const updateGuideProgress = () => {
        if (mine !== session.current || !cue.current) return;
        setGuideProgress(cue.current.progress);
        guideRaf.current = requestAnimationFrame(updateGuideProgress);
      };
      guideRaf.current = requestAnimationFrame(updateGuideProgress);
      // Attach rejection immediately: permission dialogs can outlast the guide.
      const guideReady = cue.current.finished.then(
        () => {
          if (mine === session.current) {
            if (guideRaf.current) cancelAnimationFrame(guideRaf.current);
            guideRaf.current = null;
            setGuideProgress(1);
            setGuiding(false);
          }
          return null;
        },
        (error: unknown) => error,
      );
      acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (mine !== session.current) { acquired.getTracks().forEach((t) => t.stop()); return; }
      stream.current = acquired;
      setMicStatus('ready');
      const resumeError = await ready;
      if (mine !== session.current) return;
      if (resumeError === null && ctx.state !== 'running') await ctx.resume();
      if (mine !== session.current) return;
      if (resumeError !== null || ctx.state !== 'running') throw new Error('ガイドボイスと録音を準備できませんでした。もう一度録音ボタンを押してください。');
      const guideError = await guideReady;
      if (mine !== session.current) return;
      if (guideError !== null) throw guideError;
      cue.current = null; setGuiding(false);
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(acquired, { mimeType: mime }) : new MediaRecorder(acquired);
      const parts: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };
      rec.onerror = () => {
        if (mine !== session.current) return;
        session.current++;
        recorder.current = null;
        release(); setRecording(false);
        setError('録音に失敗しました。もう一度お試しください。');
      };
      rec.onstop = () => {
        const type = rec.mimeType || mime || 'audio/webm';
        if (mine !== session.current) return;
        release(); setRecording(false);
        const blob = new Blob(parts, { type });
        if (!blob.size) { setError('録音が空でした。もう一度録音してください。'); return; }
        resultRef.current(blob);
      };
      try {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          ctx.createMediaStreamSource(acquired).connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
            setLevel(Math.min(1, peak / 64));
            raf.current = requestAnimationFrame(tick);
          };
          tick();
      } catch { /* level meter is optional */ }
      recorder.current = rec;
      // Play a short cue, then start immediately so it is not captured in the
      // child's recording.
      await playRecordingStartCue(ctx);
      if (mine !== session.current) return;
      rec.start();
      setStarting(false);
      startingRef.current = false;
      setRecording(true);
      setSeconds(0);
      let elapsed = 0;
      timer.current = window.setInterval(() => {
        elapsed++;
        setSeconds(elapsed);
        if (elapsed >= MAX_RECORD_SECONDS) stop();
      }, 1000);
    } catch (caught) {
      acquired?.getTracks().forEach((t) => t.stop());
      if (mine !== session.current) return;
      recorder.current = null; release(); setRecording(false);
      setStarting(false);
      startingRef.current = false;
      const denied = caught instanceof DOMException && (caught.name === 'NotAllowedError' || caught.name === 'PermissionDeniedError');
      setError(denied
        ? 'マイクが使えませんでした。端末の設定でマイクを許可すると録音できます。'
        : caught instanceof Error && caught.message.includes('ガイドボイス') ? caught.message : 'マイクにつながりませんでした。もう一度お試しください。');
    }
  }, [release, stop]);

  useEffect(() => cancel, [cancel]);

  return { recording, starting, guiding, seconds, level, guideProgress, guideDurationMs, error, setError, micStatus, prepareMicrophone, start, stop, cancel };
}
