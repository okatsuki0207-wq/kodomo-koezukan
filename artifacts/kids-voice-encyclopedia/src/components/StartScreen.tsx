import { BookOpen, Plus } from 'lucide-react';

type Props = {
  onRecord: () => void;
  showRecordAction?: boolean;
  onOpenEncyclopedia: () => void;
  isTransitioning?: boolean;
};

export default function StartScreen({ onRecord, showRecordAction = true, onOpenEncyclopedia, isTransitioning = false }: Props) {
  return (
    <section className={`start-screen${isTransitioning ? ' is-transitioning' : ''}`} aria-labelledby="start-title">
      <div className="start-character" role="img" aria-label="ボイスルがクッションに座って図鑑を読んでいます">
        <span className="start-orbit start-orbit-one" />
        <span className="start-orbit start-orbit-two" />
        <span className="start-reading-cushion" aria-hidden="true"><span /><span /></span>
        <img
          className="rg-char"
          src={`${import.meta.env.BASE_URL}character/voicel_sit.png`}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          fetchPriority="high"
          data-testid="start-voicel"
        />
        <svg className="start-reading-book" viewBox="0 0 96 62" aria-hidden="true">
          <path d="M8 13c14-5 27-2 40 5v35C35 46 22 44 8 49V13Z" fill="#fffdf8" stroke="#718b73" strokeWidth="3" strokeLinejoin="round" />
          <path d="M88 13c-14-5-27-2-40 5v35c13-7 26-9 40-4V13Z" fill="#fffdf8" stroke="#718b73" strokeWidth="3" strokeLinejoin="round" />
          <path d="M48 18v35" stroke="#93a88d" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M15 23c9-2 17-1 25 3m-25 7c9-2 17-1 25 3m16-10c8-4 16-5 25-3m-25 10c8-4 16-5 25-3" fill="none" stroke="#e7c6a3" strokeWidth="2" strokeLinecap="round" />
          <path d="M9 11c14-5 27-2 39 5m39-5c-14-5-27-2-39 5" fill="none" stroke="#d7a9c1" strokeWidth="1.5" />
        </svg>
      </div>
      <p className="start-kicker">だいすきなものを</p>
      <h2 id="start-title" className="start-title">さあ キロクしよう！</h2>
      <p className="start-message">わが家の声をあつめて育てる、<br />世界にひとつの宝物ずかん。</p>
      <div className="start-actions">
        {showRecordAction && <button type="button" className="start-record-button" onClick={onRecord} disabled={isTransitioning} data-testid="button-start-record">
          <Plus size={21} strokeWidth={2.5} />
          <span>キロクする</span>
        </button>}
        <button type="button" className="start-library-button" onClick={onOpenEncyclopedia} disabled={isTransitioning} data-testid="button-open-encyclopedia">
          <BookOpen size={19} />
          <span>ずかんをみる</span>
        </button>
      </div>
    </section>
  );
}
