import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import './voice-editing.css';

/**
 * recordingStartSignal should change (for example, increment) whenever a new
 * recording begins. guideDurationMs controls how long the guide ring takes to fill.
 */
type Props = {
  photo?: string;
  phase: 'idle' | 'guide' | 'recording';
  name?: string;
  guideDurationMs?: number;
  guideProgress?: number;
  recordingStartSignal?: number | string;
};

export function RecordingCharacter() {
  return (
    <svg className="rg-char" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="26" cy="28" r="14" fill="#e5be7a" />
      <circle cx="74" cy="28" r="14" fill="#e5be7a" />
      <circle cx="26" cy="28" r="7" fill="#f5e7dc" />
      <circle cx="74" cy="28" r="7" fill="#f5e7dc" />
      <ellipse cx="50" cy="56" rx="36" ry="34" fill="#f2cf94" stroke="#bd7057" strokeWidth="2.5" />
      <circle cx="38" cy="50" r="4.5" fill="#493d33" />
      <circle cx="62" cy="50" r="4.5" fill="#493d33" />
      <ellipse cx="50" cy="62" rx="8" ry="6" fill="#bd7057" />
      <path className="rg-mouth" d="M42 72 Q50 80 58 72" fill="none" stroke="#493d33" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="28" cy="64" r="5" fill="#f0b7a2" opacity=".7" />
      <circle cx="72" cy="64" r="5" fill="#f0b7a2" opacity=".7" />
    </svg>
  );
}

export default function RecordingGuide({
  phase,
  name,
  photo,
  guideDurationMs = 5000,
  guideProgress: controlledGuideProgress,
  recordingStartSignal,
}: Props) {
  const [guideProgress, setGuideProgress] = useState(0);
  const [flash, setFlash] = useState(false);
  const previousSignal = useRef<number | string | undefined>(undefined);

  useEffect(() => {
    if (controlledGuideProgress !== undefined || phase !== 'guide') {
      setGuideProgress(phase === 'recording' ? 1 : 0);
      return;
    }
    const duration = Math.max(0, guideDurationMs);
    if (duration === 0) {
      setGuideProgress(1);
      return;
    }
    let frame = 0;
    let startTime: number | undefined;
    const tick = (now: number) => {
      startTime ??= now;
      const progress = Math.min(1, (now - startTime) / duration);
      setGuideProgress(progress);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    setGuideProgress(0);
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [phase, guideDurationMs, controlledGuideProgress]);

  useEffect(() => {
    if (phase !== 'recording' || recordingStartSignal === undefined) {
      setFlash(false);
      return;
    }
    if (previousSignal.current === recordingStartSignal) return;
    previousSignal.current = recordingStartSignal;
    setFlash(true);
    const timeout = window.setTimeout(() => setFlash(false), 520);
    return () => window.clearTimeout(timeout);
  }, [phase, recordingStartSignal]);

  if (phase === 'idle') return null;
  const ringProgress = phase === 'guide' ? (controlledGuideProgress ?? guideProgress) : 1;
  const circumference = 2 * Math.PI * 48;
  return (
    <div
      className={`rg${flash ? ' is-starting' : ''}`}
      data-testid="recording-guide"
      data-phase={phase}
      aria-label={phase === 'guide' ? '録音の案内' : '録音中'}
    >
      {flash && <span className="rg-flash" aria-hidden="true" data-testid="recording-start-flash" />}
      <div className="rg-stage">
        {photo && (
          <img
            className="rg-photo"
            src={photo}
            alt={name ? `${name}の写真` : 'キロクの写真'}
            data-testid="recording-guide-photo"
          />
        )}
        <div className="rg-character-wrap" data-testid="recording-character-stage">
          <RecordingCharacter />
          {phase === 'recording' && (
            <span className="rg-mic-pose" aria-hidden="true" data-testid="recording-microphone-pose">
              <Mic size={17} strokeWidth={2.4} />
            </span>
          )}
        </div>
        <svg
          className="rg-progress"
          viewBox="0 0 100 100"
          role="progressbar"
          aria-label="お話しの時間"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ringProgress * 100)}
          data-testid="recording-progress-ring"
        >
          <circle className="rg-progress-track" cx="50" cy="50" r="48" />
          <circle
            className="rg-progress-value"
            cx="50"
            cy="50"
            r="48"
            style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - ringProgress) }}
          />
        </svg>
        <div className="rg-bubble" data-testid="text-guide-bubble">
          {phase === 'guide' ? 'これはなーに？' : 'きいているよ'}
        </div>
      </div>
      {name && <p className="rg-name">{name}</p>}
      {phase === 'guide' && <p className="rg-cue" role="status" data-testid="recording-guide-status">くまさんがお話し中。終わったら話してね</p>}
      {phase === 'recording' && (
        <p className="rg-cue" role="status" data-testid="recording-guide-status"><span className="rg-rec"><span className="rg-dot" /><Mic size={16} />聴いているよ・録音中</span></p>
      )}
    </div>
  );
}
