import './voice-editing.css';

type Props = {
  phase: 'idle' | 'guide' | 'recording';
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

export default function RecordingGuide({ phase }: Props) {
  if (phase === 'idle') return null;
  return (
    <div
      className="rg"
      data-testid="recording-guide"
      data-phase={phase}
      aria-label={phase === 'guide' ? '録音の案内' : '録音中'}
    >
      <RecordingCharacter pose={phase === 'guide' ? 'listen' : 'record'} />
    </div>
  );
}
