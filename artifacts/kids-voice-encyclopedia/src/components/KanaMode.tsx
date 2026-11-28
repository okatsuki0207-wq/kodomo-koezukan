import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, Mic } from 'lucide-react';
import type { Keepsake } from '../lib/keepsakeRepository';
import { ALL_KANA, KANA_N, KANA_ROWS, displayKana, groupItemsByKana } from '../lib/kanaChart';

type Props = {
  items: Keepsake[];
  childMode: 'normal' | 'view' | 'add';
  playing: boolean;
  playingItemId: string | null;
  onPlay: (item: Keepsake) => void;
  onRecordKana: () => void;
  onClose: () => void;
};

function shuffledIds(items: Keepsake[]): string[] {
  const ids = items.map((item) => item.id);
  for (let index = ids.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[target]] = [ids[target], ids[index]];
  }
  return ids;
}

export default function KanaMode({ items, childMode, playing, playingItemId, onPlay, onRecordKana, onClose }: Props) {
  const [script, setScript] = useState<'hiragana' | 'katakana'>('hiragana');
  const [selectedKana, setSelectedKana] = useState<string | null>(null);
  const [stageItem, setStageItem] = useState<Keepsake | null>(null);
  const cycles = useRef(new Map<string, { order: string[]; index: number }>());

  const grouped = useMemo(() => groupItemsByKana(items), [items]);
  const collected = ALL_KANA.filter((kana) => (grouped.get(kana)?.length ?? 0) > 0).length;

  const tapKana = (kana: string) => {
    const list = grouped.get(kana) ?? [];
    if (!list.length) {
      setSelectedKana(kana);
      setStageItem(null);
      return;
    }
    const entry = cycles.current.get(kana);
    let order: string[];
    let index: number;
    if (!entry || selectedKana !== kana || entry.index + 1 >= entry.order.length) {
      order = shuffledIds(list);
      index = 0;
    } else {
      order = entry.order;
      index = entry.index + 1;
    }
    cycles.current.set(kana, { order, index });
    const item = list.find((candidate) => candidate.id === order[index]) ?? list[0];
    setSelectedKana(kana);
    setStageItem(item);
    onPlay(item);
  };

  const renderCell = (kana: string) => {
    const list = grouped.get(kana) ?? [];
    const filled = list.length > 0;
    const representative = selectedKana === kana && stageItem ? stageItem : list[0];
    return (
      <button
        key={kana}
        type="button"
        className={`kana-cell${filled ? ' is-filled' : ' is-empty'}${selectedKana === kana ? ' is-selected' : ''}`}
        onClick={() => tapKana(kana)}
        aria-label={filled ? `${kana}のキロク` : `${kana}（まだキロクがない）`}
        data-testid={`kana-cell-${kana}`}
      >
        {filled && representative?.photo
          ? <img className="kana-cell-photo" src={representative.photo} alt="" aria-hidden="true" />
          : null}
        <span className="kana-cell-kana">{displayKana(kana, script)}</span>
      </button>
    );
  };

  return (
    <main className="kana-view mode-flip-in" data-testid="kana-mode">
      <div className="kana-view-inner">
        <div className="kana-head">
          <button type="button" className="kana-back-button" onClick={onClose} data-testid="button-close-kana">
            <ChevronLeft size={18} /><span>ずかんにもどる</span>
          </button>
          <h2 className="kana-title">あいうえお</h2>
        </div>
        <p className="dialog-lede">もじを おすと、その もじではじまる キロクの こえが ながれるよ。</p>

        <div className="kana-script-toggle" role="group" aria-label="ひらがなとカタカナの切り替え">
          <button type="button" className={script === 'hiragana' ? 'selected' : ''} aria-pressed={script === 'hiragana'} onClick={() => setScript('hiragana')} data-testid="button-kana-hiragana">ひらがな</button>
          <button type="button" className={script === 'katakana' ? 'selected' : ''} aria-pressed={script === 'katakana'} onClick={() => setScript('katakana')} data-testid="button-kana-katakana">カタカナ</button>
        </div>

        <div className="kana-stage" data-testid="kana-stage">
          {stageItem ? (
            <>
              {stageItem.photo && <img className="kana-stage-photo" src={stageItem.photo} alt={`${stageItem.itemName}の写真`} />}
              <p className="kana-stage-name">
                {stageItem.itemName}
                {playing && playingItemId === stageItem.id && <span className="voice-notes" aria-hidden="true"><span>♪</span><span>♫</span><span>♪</span></span>}
              </p>
            </>
          ) : selectedKana ? (
            <>
              <p className="kana-stage-letter" aria-hidden="true">{displayKana(selectedKana, script)}</p>
              <p className="kana-stage-name">『{displayKana(selectedKana, script)}』のキロクは、まだないよ</p>
              {childMode === 'normal' && (
                <button type="button" className="record-button primary" onClick={onRecordKana} data-testid="button-kana-record">
                  <Mic size={18} /><span>この音でキロクする</span>
                </button>
              )}
            </>
          ) : (
            <p className="kana-stage-name">すきな もじを おしてね</p>
          )}
        </div>

        <div className="kana-chart">
          {KANA_ROWS.map((row, rowIndex) => (
            <div className="kana-row" key={rowIndex}>
              {row.map((kana, cellIndex) => (kana === null
                ? <span key={cellIndex} className="kana-cell-spacer" aria-hidden="true" />
                : renderCell(kana)))}
            </div>
          ))}
          <div className="kana-row kana-row-last">
            {renderCell(KANA_N)}
            <p className="kana-progress" data-testid="kana-progress">{collected}／{ALL_KANA.length} もじ あつまった</p>
          </div>
        </div>
      </div>
    </main>
  );
}
