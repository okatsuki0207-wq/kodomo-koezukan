import { useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';

const VOICELE_IMAGES = [
  'voicel_welcome.png',
  'voicel_stand.png',
  'voicel_listen.png',
  'voicel_record.png',
  'voicel_happy.png',
  'voicel_sleep.png',
  'voicel_think.png',
  'voicel_fly.png',
  'voicel_cheer.png',
  'voicel_surprise.png',
  'voicel_sit.png',
  'voicel_zukan.png',
] as const;

type Props = {
  onRecord: () => void;
  showRecordAction?: boolean;
  onOpenEncyclopedia: () => void;
};

export default function StartScreen({ onRecord, showRecordAction = true, onOpenEncyclopedia }: Props) {
  const [characterImage] = useState(() => VOICELE_IMAGES[Math.floor(Math.random() * VOICELE_IMAGES.length)]);
  return (
    <section className="start-screen" aria-labelledby="start-title">
      <div className="start-character" role="img" aria-label="ボイスルが図鑑を見ています">
        <span className="start-orbit start-orbit-one" />
        <span className="start-orbit start-orbit-two" />
        <img
          className="rg-char"
          src={`${import.meta.env.BASE_URL}character/${characterImage}`}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          fetchPriority="high"
          data-testid="start-voicel"
        />
      </div>
      <p className="start-kicker">だいすきなものを</p>
      <h2 id="start-title" className="start-title">さあ キロクしよう！</h2>
      <p className="start-message">わが家の声をあつめて育てる、<br />世界にひとつの宝物ずかん。</p>
      <div className="start-actions">
        {showRecordAction && <button type="button" className="start-record-button" onClick={onRecord} data-testid="button-start-record">
          <Plus size={21} strokeWidth={2.5} />
          <span>キロクする</span>
        </button>}
        <button type="button" className="start-library-button" onClick={onOpenEncyclopedia} data-testid="button-open-encyclopedia">
          <BookOpen size={19} />
          <span>ずかんをみる</span>
        </button>
      </div>
    </section>
  );
}
