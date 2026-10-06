import { Mic } from 'lucide-react';
import './voice-editing.css';

type Props = { photo: string; phase: 'idle' | 'guide' | 'recording'; name?: string };

function Character() {
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

export default function RecordingGuide({ photo, phase, name }: Props) {
  return (
    <div className="rg" data-testid="recording-guide" data-phase={phase}>
      <div className="rg-stage">
        <img className="rg-photo" src={photo} alt={name ? `${name}の絵` : '選んだ絵'} />
        {phase === 'guide' && (
          <div className="rg-guide">
            <Character />
            <div className="rg-bubble" data-testid="text-guide-bubble">これはなーに？</div>
          </div>
        )}
      </div>
      {name && <p className="rg-name">{name}</p>}
      {phase === 'guide' && <p className="rg-cue" role="status">くまさんがお話し中。終わったら話してね</p>}
      {phase === 'recording' && (
        <p className="rg-cue" role="status"><span className="rg-rec"><span className="rg-dot" /><Mic size={16} />聴いているよ・録音中</span></p>
      )}
    </div>
  );
}
