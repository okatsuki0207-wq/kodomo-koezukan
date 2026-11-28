import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, Mic, X } from 'lucide-react';
import type { Keepsake } from '../lib/keepsakeRepository';
import {
  ALL_DAKUTEN, ALL_KANA, ALL_YOON, DAKUTEN_ROWS, KANA_N, KANA_ROWS, NON_INITIAL_KANA, YOON_ROWS,
  displayKana, groupItemsByKana,
} from '../lib/kanaChart';

type Props = {
  items: Keepsake[];
  childMode: 'normal' | 'view' | 'add';
  playing: boolean;
  playingItemId: string | null;
  onPlay: (item: Keepsake) => void;
  onStop: () => void;
  onRecordKana: () => void;
  onClose: () => void;
};

type KanaPage = {
  id: 'seion' | 'dakuten' | 'yoon';
  label: string;
  rows: Array<Array<string | null>>;
  keys: string[];
  /** true のページは画面に出さない（仕組みだけ残し、将来の開放用）。 */
  hidden?: boolean;
};

const PAGES: KanaPage[] = [
  { id: 'seion', label: 'せいおん', rows: KANA_ROWS, keys: ALL_KANA },
  { id: 'dakuten', label: 'だくおん', rows: DAKUTEN_ROWS, keys: ALL_DAKUTEN },
  // ようおんは当面非表示。判定・表の仕組みは残してある（隠し要素として後から開放する想定）。
  { id: 'yoon', label: 'ようおん', rows: YOON_ROWS, keys: ALL_YOON, hidden: true },
];
const VISIBLE_PAGES = PAGES.filter((candidate) => !candidate.hidden);

function shuffledIds(items: Keepsake[]): string[] {
  const ids = items.map((item) => item.id);
  for (let index = ids.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[target]] = [ids[target], ids[index]];
  }
  return ids;
}

export default function KanaMode({ items, childMode, playing, playingItemId, onPlay, onStop, onRecordKana, onClose }: Props) {
  const [script, setScript] = useState<'hiragana' | 'katakana'>('hiragana');
  const [pageIndex, setPageIndex] = useState(0);
  const [slideDir, setSlideDir] = useState<'next' | 'prev' | null>(null);
  const [popupKana, setPopupKana] = useState<string | null>(null);
  const [popupItem, setPopupItem] = useState<Keepsake | null>(null);
  const cycles = useRef(new Map<string, { order: string[]; index: number }>());
  const touchX = useRef<number | null>(null);

  const grouped = useMemo(() => groupItemsByKana(items), [items]);
  const page = VISIBLE_PAGES[pageIndex];
  const filledCount = page.keys.filter((kana) => grouped.has(kana) || NON_INITIAL_KANA.includes(kana)).length;
  const popupCount = popupKana ? (grouped.get(popupKana)?.length ?? 0) : 0;

  const goPage = (next: number) => {
    const clamped = Math.max(0, Math.min(VISIBLE_PAGES.length - 1, next));
    if (clamped === pageIndex) return;
    setSlideDir(clamped > pageIndex ? 'next' : 'prev');
    setPageIndex(clamped);
  };

  const advance = (kana: string): Keepsake | null => {
    const list = grouped.get(kana) ?? [];
    if (!list.length) return null;
    const entry = cycles.current.get(kana);
    let order: string[];
    let index: number;
    if (!entry || entry.index + 1 >= entry.order.length) {
      order = shuffledIds(list);
      index = 0;
    } else {
      order = entry.order;
      index = entry.index + 1;
    }
    cycles.current.set(kana, { order, index });
    return list.find((candidate) => candidate.id === order[index]) ?? list[0];
  };

  const tapKana = (kana: string) => {
    const item = advance(kana);
    setPopupKana(kana);
    setPopupItem(item);
    if (item) onPlay(item);
  };

  const popupNext = () => {
    if (!popupKana || popupCount < 2) return;
    const item = advance(popupKana);
    setPopupItem(item);
    if (item) onPlay(item);
  };

  const closePopup = () => {
    setPopupKana(null);
    setPopupItem(null);
    onStop();
  };

  const renderCell = (kana: string) => {
    const filled = (grouped.get(kana)?.length ?? 0) > 0;
    const prefilled = !filled && NON_INITIAL_KANA.includes(kana);
    return (
      <button
        key={kana}
        type="button"
        className={`kana-cell${filled ? ' is-filled' : prefilled ? ' is-prefilled' : ' is-empty'}`}
        onClick={() => tapKana(kana)}
        aria-label={filled ? `${kana}のキロク` : prefilled ? kana : `${kana}（まだキロクがない）`}
        data-testid={`kana-cell-${kana}`}
      >
        <span className={`kana-cell-kana${kana.length > 1 ? ' is-combo' : ''}`}>{displayKana(kana, script)}</span>
      </button>
    );
  };

  return (
    <main className="kana-view mode-flip-in" data-testid="kana-mode">
      <div
        className="kana-view-inner"
        onTouchStart={(event) => { touchX.current = event.touches[0].clientX; }}
        onTouchEnd={(event) => {
          if (touchX.current === null) return;
          const dx = event.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          // 左スワイプで右のページへ、右スワイプで左のページへ。
          if (dx <= -48) goPage(pageIndex + 1);
          else if (dx >= 48) goPage(pageIndex - 1);
        }}
      >
        <div className="kana-head">
          <button type="button" className="kana-back-button" onClick={onClose} data-testid="button-close-kana">
            <ChevronLeft size={18} /><span>ずかんにもどる</span>
          </button>
          <h2 className="kana-title">あいうえお</h2>
          <div className="kana-script-toggle" role="group" aria-label="ひらがなとカタカナの切り替え">
            <button type="button" className={script === 'hiragana' ? 'selected' : ''} aria-pressed={script === 'hiragana'} onClick={() => setScript('hiragana')} data-testid="button-kana-hiragana">ひらがな</button>
            <button type="button" className={script === 'katakana' ? 'selected' : ''} aria-pressed={script === 'katakana'} onClick={() => setScript('katakana')} data-testid="button-kana-katakana">カタカナ</button>
          </div>
        </div>

        <div className="kana-page-bar">
          <span className="kana-page-label" data-testid="kana-page-label">{page.label}</span>
          <span className="kana-page-hint">スライドで ページが かわるよ</span>
          <div className="kana-dots" role="group" aria-label="ページ切り替え">
            {VISIBLE_PAGES.map((candidate, index) => (
              <button
                key={candidate.id}
                type="button"
                className={`kana-dot${index === pageIndex ? ' selected' : ''}`}
                aria-label={`${candidate.label}のページ`}
                aria-pressed={index === pageIndex}
                onClick={() => goPage(index)}
                data-testid={`kana-dot-${candidate.id}`}
              />
            ))}
          </div>
        </div>

        <div
          key={pageIndex}
          className={`kana-chart page-${page.id}${slideDir === 'next' ? ' slide-next' : slideDir === 'prev' ? ' slide-prev' : ''}`}
          data-testid="kana-chart"
        >
          {page.rows.map((row, rowIndex) => (
            <div className="kana-row" key={rowIndex} style={page.id === 'yoon' ? { gridTemplateColumns: 'repeat(3,minmax(0,1fr))' } : undefined}>
              {row.map((kana, cellIndex) => (kana === null
                ? <span key={cellIndex} className="kana-cell-spacer" aria-hidden="true" />
                : renderCell(kana)))}
            </div>
          ))}
          {page.id === 'seion' && (
            <div className="kana-row kana-row-last">
              {renderCell(KANA_N)}
              <p className="kana-progress" data-testid="kana-progress">{filledCount}／{page.keys.length} もじ あつまった</p>
            </div>
          )}
        </div>
        {page.id !== 'seion' && (
          <p className="kana-progress-line" data-testid="kana-progress">{filledCount}／{page.keys.length} もじ あつまった</p>
        )}
      </div>

      {popupKana && (
        <div
          className="overlay"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closePopup(); }}
        >
          <section className="dialog kana-popup" role="dialog" aria-modal="true" aria-label={`${popupKana}のポップアップ`} data-testid="kana-popup">
            <button type="button" className="kana-popup-close" onClick={closePopup} aria-label="とじる" data-testid="button-close-kana-popup">
              <X size={20} />
            </button>
            <p className={`kana-popup-kana${popupKana.length > 1 ? ' is-combo' : ''}`}>{displayKana(popupKana, script)}</p>
            {popupItem ? (
              <>
                {popupItem.photo && (
                  <button type="button" className="kana-popup-photo-button" onClick={popupNext} aria-label={popupCount > 1 ? 'つぎのキロク' : popupItem.itemName}>
                    <img className="kana-popup-photo" src={popupItem.photo} alt={`${popupItem.itemName}の写真`} />
                  </button>
                )}
                <p className="kana-popup-name">
                  {popupItem.itemName}
                  {playing && playingItemId === popupItem.id && <span className="voice-notes" aria-hidden="true"><span>♪</span><span>♫</span><span>♪</span></span>}
                </p>
                {popupCount > 1 && <p className="kana-popup-hint">しゃしんを タップすると つぎのキロクが でるよ</p>}
              </>
            ) : !NON_INITIAL_KANA.includes(popupKana) && childMode === 'normal' ? (
              <button
                type="button"
                className="record-button primary"
                onClick={() => { setPopupKana(null); setPopupItem(null); onRecordKana(); }}
                data-testid="button-kana-record"
              >
                <Mic size={18} /><span>この音でキロクする</span>
              </button>
            ) : null}
          </section>
        </div>
      )}
    </main>
  );
}
