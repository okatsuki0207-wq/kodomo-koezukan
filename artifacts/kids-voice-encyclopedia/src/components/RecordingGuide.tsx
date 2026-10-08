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

export type VoicelPose =
  | 'welcome'
  | 'stand'
  | 'listen'
  | 'record'
  | 'happy'
  | 'sleep'
  | 'think'
  | 'fly'
  | 'cheer'
  | 'surprise'
  | 'sit';

const voicelImageByPose: Record<VoicelPose, string> = {
  welcome: 'voicel_welcome.png',
  stand: 'voicel_stand.png',
  listen: 'voicel_listen.png',
  record: 'voicel_record.png',
  happy: 'voicel_happy.png',
  sleep: 'voicel_sleep.png',
  think: 'voicel_think.png',
  fly: 'voicel_fly.png',
  cheer: 'voicel_cheer.png',
  surprise: 'voicel_surprise.png',
  sit: 'voicel_sit.png',
};

export function RecordingCharacter({ pose = 'welcome' }: { pose?: VoicelPose }) {
  return (
    <img
      className="rg-char"
      src={`${import.meta.env.BASE_URL}character/${voicelImageByPose[pose]}`}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
    />
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
          <RecordingCharacter pose={phase === 'guide' ? 'listen' : 'record'} />
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
