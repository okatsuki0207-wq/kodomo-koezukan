import { BookOpen, Plus } from 'lucide-react';
import { RecordingCharacter } from './RecordingGuide';

type Props = {
  onRecord: () => void;
  onOpenEncyclopedia: () => void;
  onResumeDraft?: () => void;
};

export default function StartScreen({ onRecord, onOpenEncyclopedia, onResumeDraft }: Props) {
  return (
    <section className="start-screen" aria-labelledby="start-title">
      <div className="start-character" aria-hidden="true">
        <span className="start-orbit start-orbit-one" />
        <span className="start-orbit start-orbit-two" />
        <RecordingCharacter />
      </div>
      <p className="start-kicker">だいすきなものを</p>
      <h2 id="start-title" className="start-title">さあ キロクしよう！</h2>
      <p className="start-message">わが家の声をあつめて育てる、<br />世界にひとつの宝物ずかん。</p>
      <div className="start-actions">
        <button type="button" className="start-record-button" onClick={onRecord} data-testid="button-start-record">
          <Plus size={21} strokeWidth={2.5} />
          <span>キロクする</span>
        </button>
        <button type="button" className="start-library-button" onClick={onOpenEncyclopedia} data-testid="button-open-encyclopedia">
          <BookOpen size={19} />
          <span>ずかんをみる</span>
        </button>
      </div>
      {onResumeDraft && (
        <div className="start-resume-draft" role="status" data-testid="status-start-draft">
          <span>前回の下書きがあります。</span>
          <button type="button" onClick={onResumeDraft} data-testid="button-resume-draft">つづきからキロクする</button>
        </div>
      )}
    </section>
  );
}
