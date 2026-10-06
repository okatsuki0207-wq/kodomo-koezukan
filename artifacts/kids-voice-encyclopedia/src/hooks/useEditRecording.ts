import { useCallback, useEffect, useRef, useState } from 'react';

export const MAX_RECORD_SECONDS = 60;
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

/** 編集用の録音フック。結果の Blob は onResult へ渡す（古いセッションの結果は破棄）。 */
export function useEditRecording(onResult: (blob: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const session = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  const release = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLevel(0);
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
    setSeconds(0);
  }, [release]);

  const start = useCallback(async () => {
    if (recorder.current || starting) return;
    setError('');
    if (!canRecord()) { setError('このブラウザでは録音できません。音声ファイルをえらんで追加できます。'); return; }
    const mine = ++session.current;
    setStarting(true);
    let acquired: MediaStream | null = null;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (mine !== session.current) { acquired.getTracks().forEach((t) => t.stop()); return; }
      stream.current = acquired;
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
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          audioCtx.current = ctx;
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
        }
      } catch { /* level meter is optional */ }
      recorder.current = rec;
      rec.start();
      setStarting(false);
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
      const denied = caught instanceof DOMException && (caught.name === 'NotAllowedError' || caught.name === 'PermissionDeniedError');
      setError(denied
        ? 'マイクが使えませんでした。端末の設定でマイクを許可すると録音できます。'
        : 'マイクにつながりませんでした。もう一度お試しください。');
    }
  }, [release, starting, stop]);

  useEffect(() => cancel, [cancel]);

  return { recording, starting, seconds, level, error, setError, start, stop, cancel };
}
