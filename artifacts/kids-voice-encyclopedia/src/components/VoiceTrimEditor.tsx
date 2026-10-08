import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Play, Square, RotateCcw } from 'lucide-react';
import { decodeAudioBlob, trimAudioRange, waveformPeaks, type DecodedAudio } from '../lib/audioTrim';
import { loadVoiceSource } from '../lib/voiceSource';
import './voice-editing.css';

type Props = {
  source: string | Blob;
  refreshSource?: () => Promise<string>;
  disabled?: boolean;
  onApply: (blob: Blob) => void;
  onPendingChange?: (pending: boolean) => void;
  onBeforePreview?: () => void;
};

const MIN = 0.05;
const fmt = (s: number) => `${s.toFixed(2)}秒`;

export default function VoiceTrimEditor({ source, refreshSource, disabled, onApply, onPendingChange, onBeforePreview }: Props) {
  const [audio, setAudio] = useState<DecodedAudio | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reload, setReload] = useState(0);
  const refreshRef = useRef(refreshSource);
  refreshRef.current = refreshSource;
  const bar = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const player = useRef<{ audio: HTMLAudioElement; url: string; raf: number } | null>(null);
  const session = useRef(0);
  const dragCleanup = useRef<(() => void) | null>(null);
  const cbRef = useRef({ onPendingChange, onApply });
  cbRef.current = { onPendingChange, onApply };
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const stop = useCallback(() => {
    const p = player.current;
    if (!p) return;
    player.current = null;
    cancelAnimationFrame(p.raf);
    p.audio.onended = null; p.audio.onerror = null;
    p.audio.pause();
    URL.revokeObjectURL(p.url);
    if (head.current) head.current.style.display = 'none';
    setPlaying(false);
  }, []);

  useEffect(() => {
    const id = ++session.current;
    const ctl = new AbortController();
    stop();
    setAudio(null); setPeaks([]); setError(''); setLoading(true); setRange([0, 0]);
    cbRef.current.onPendingChange?.(false);
    // React effect runs after DOM commit; one frame also lets modal layout settle.
    const frame = requestAnimationFrame(() => { void (async () => {
      try {
        const blob = await loadVoiceSource(source, ctl.signal, refreshRef.current);
        ctl.signal.throwIfAborted();
        const decoded = await decodeAudioBlob(blob);
        if (id !== session.current) return;
        if (decoded.duration < MIN) throw new Error('音声が短すぎるため、範囲を調整できません。元の録音はそのままです。');
        setAudio(decoded);
        setPeaks(waveformPeaks(decoded.channels, 160));
        setRange([0, decoded.duration]);
      } catch (e) {
        if (id !== session.current || ctl.signal.aborted) return;
        setError(e instanceof Error && e.message ? `音声を読み込めませんでした。${e.message}` : '音声を読み込めませんでした。元の録音はそのまま使えます。');
      } finally {
        if (id === session.current) setLoading(false);
      }
    })(); });
    return () => {
      session.current++;
      cancelAnimationFrame(frame);
      dragCleanup.current?.(); dragCleanup.current = null;
      ctl.abort();
      stop();
      cbRef.current.onPendingChange?.(false);
    };
  }, [source, stop, reload]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !peaks.length) return;
    const draw = () => {
    const w = c.clientWidth, h = c.clientHeight, d = window.devicePixelRatio || 1;
    if (!w || !h) return;
    c.width = w * d; c.height = h * d;
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(d, d);
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#bd7057';
    const bw = w / peaks.length;
    peaks.forEach((p, i) => {
      const bh = Math.max(2, p * (h - 12));
      g.fillRect(i * bw + 0.5, (h - bh) / 2, Math.max(1, bw - 1), bh);
    });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(c);
    return () => observer.disconnect();
  }, [peaks, audio]);

  const dur = audio?.duration ?? 0;
  const pending = !!audio && (range[0] > 0.0005 || range[1] < dur - 0.0005);
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);

  const setEdge = (which: 0 | 1, v: number) => {
    if (!audio) return;
    stop();
    setRange(([s, e]) => which === 0
      ? [Math.max(0, Math.min(v, e - MIN)), e]
      : [s, Math.min(dur, Math.max(v, s + MIN))]);
  };

  const drag = (which: 0 | 1) => (ev: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || !audio) return;
    ev.preventDefault();
    const el = ev.currentTarget;
    dragCleanup.current?.();
    el.setPointerCapture(ev.pointerId);
    const move = (m: PointerEvent) => {
      const r = bar.current!.getBoundingClientRect();
      setEdge(which, Math.max(0, Math.min(1, (m.clientX - r.left) / r.width)) * dur);
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('lostpointercapture', up);
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      dragCleanup.current = null;
    };
    dragCleanup.current = up;
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  };

  const key = (which: 0 | 1) => (ev: React.KeyboardEvent) => {
    if (disabled || !audio) return;
    const cur = range[which];
    const step = ev.shiftKey ? 0.5 : 0.05;
    let v: number | null = null;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') v = cur - step;
    else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') v = cur + step;
    else if (ev.key === 'Home') v = 0;
    else if (ev.key === 'End') v = dur;
    if (v === null) return;
    ev.preventDefault();
    setEdge(which, v);
  };

  const preview = () => {
    if (playing) { stop(); return; }
    if (!audio) return;
    onBeforePreview?.();
    try {
      const [s, e] = rangeRef.current;
      const url = URL.createObjectURL(trimAudioRange(audio, s, e));
      const a = new Audio(url);
      const p = { audio: a, url, raf: 0 };
      player.current = p;
      const done = () => { if (player.current === p) stop(); };
      a.onended = done;
      a.onerror = () => { done(); setError('範囲を再生できませんでした。'); };
      const tick = () => {
        if (player.current !== p) return;
        if (head.current && bar.current && dur > 0) {
          const x = ((s + a.currentTime) / dur) * bar.current.clientWidth;
          head.current.style.display = 'block';
          head.current.style.transform = `translateX(${x}px)`;
        }
        p.raf = requestAnimationFrame(tick);
      };
      setError('');
      setPlaying(true);
      a.play().then(() => { if (player.current === p) p.raf = requestAnimationFrame(tick); }).catch(() => {
        if (player.current === p) { done(); setError('範囲を再生できませんでした。'); }
      });
    } catch (err) {
      stop();
      setError(err instanceof Error ? err.message : '範囲を再生できませんでした。');
    }
  };

  const apply = () => {
    if (!audio || applying) return;
    stop();
    setApplying(true);
    try {
      const blob = trimAudioRange(audio, range[0], range[1]);
      cbRef.current.onApply(blob);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '範囲を確定できませんでした。元の録音はそのままです。');
    } finally { setApplying(false); }
  };

  const reset = () => { stop(); if (audio) setRange([0, audio.duration]); setError(''); };
  const pct = (v: number) => (dur > 0 ? (v / dur) * 100 : 0);

  return (
    <div className="vte" data-testid="voice-trim-editor">
      <h3 className="vte-title">声の長さをととのえる</h3>
      <p className="vte-help">波形の左のハンドルで前を、右のハンドルで後ろを切ります。親の声などが入った部分を外せます。</p>
      {loading && <div className="vte-load" aria-label="読み込み中" />}
      {error && <div className="vte-msg err" role="alert" data-testid="status-trim-error">{error}
        {!audio && <button type="button" className="vte-btn" aria-label="声を再読み込み" title="声を再読み込み" disabled={disabled || loading} onClick={() => setReload((n) => n + 1)} data-testid="button-reload-voice"><RotateCcw size={18} /></button>}
      </div>}
      {audio && (
        <>
          <div className="vte-bar" ref={bar} data-testid="voice-waveform">
            <canvas className="vte-canvas" ref={canvas} aria-hidden="true" />
            <div className="vte-dim l" style={{ width: `${pct(range[0])}%` }} />
            <div className="vte-dim r" style={{ width: `${100 - pct(range[1])}%` }} />
            <div className="vte-playhead" ref={head} style={{ display: 'none' }} />
            <button type="button" role="slider" className="vte-handle" data-testid="trim-start-handle"
              style={{ left: `${pct(range[0])}%` }} aria-label="開始位置" aria-orientation="horizontal"
              aria-valuemin={0} aria-valuemax={Number((range[1] - MIN).toFixed(2))} aria-valuenow={Number(range[0].toFixed(2))}
              aria-valuetext={fmt(range[0])} disabled={disabled}
              onPointerDown={drag(0)} onKeyDown={key(0)} />
            <button type="button" role="slider" className="vte-handle end" data-testid="trim-end-handle"
              style={{ left: `${pct(range[1])}%` }} aria-label="終了位置" aria-orientation="horizontal"
              aria-valuemin={Number((range[0] + MIN).toFixed(2))} aria-valuemax={Number(dur.toFixed(2))} aria-valuenow={Number(range[1].toFixed(2))}
              aria-valuetext={fmt(range[1])} disabled={disabled}
              onPointerDown={drag(1)} onKeyDown={key(1)} />
          </div>
          <div className="vte-times" aria-live="off">
            <span>開始 <b data-testid="text-trim-start">{fmt(range[0])}</b></span>
            <span>長さ <b>{fmt(range[1] - range[0])}</b></span>
            <span>終了 <b data-testid="text-trim-end">{fmt(range[1])}</b></span>
          </div>
          <div className="vte-actions">
            <button type="button" className="vte-btn" aria-label={playing ? '再生をとめる' : '選んだ範囲を聞く'} title={playing ? '再生をとめる' : '選んだ範囲を聞く'} onClick={preview} disabled={disabled} data-testid="button-preview-audio-trim">
              {playing ? <Square size={19} /> : <Play size={19} />}
            </button>
            <button type="button" className="vte-btn" aria-label="元の範囲に戻す" title="元の範囲に戻す" onClick={reset} disabled={disabled || !pending} data-testid="button-reset-audio-trim">
              <RotateCcw size={19} />
            </button>
            <button type="button" className="vte-btn primary" aria-label={applying ? '範囲を反映中' : 'この範囲を反映'} title={applying ? '範囲を反映中' : 'この範囲を反映'} onClick={apply} disabled={disabled || !pending || applying} data-testid="button-apply-audio-trim">
              <Check size={19} />
            </button>
          </div>
          {pending && <p className="vte-msg" role="status">範囲を変えました。右のチェックを押すと反映されます。</p>}
        </>
      )}
    </div>
  );
}
