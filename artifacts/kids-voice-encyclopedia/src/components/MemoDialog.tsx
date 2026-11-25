import { useState } from 'react';
import { Pencil, X } from 'lucide-react';

type Props = {
  value: string;
  onClose: () => void;
  onSave: (value: string) => void;
};

const MAX_MEMO_LENGTH = 1000;

export default function MemoDialog({ value, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(value);

  return (
    <div className="overlay memo-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog memo-dialog" role="dialog" aria-modal="true" aria-labelledby="memo-dialog-title" data-testid="dialog-card-memo">
        <div className="dialog-head memo-dialog-head">
          <div>
            <h2 id="memo-dialog-title" className="dialog-title"><Pencil size={19} aria-hidden="true" /> 詳細メモ</h2>
            <p className="dialog-lede">カードについて残しておきたいことを書けます。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="メモを閉じる" data-testid="button-close-card-memo"><X size={19} /></button>
        </div>
        <label className="sr-only" htmlFor="card-detail-memo">詳細メモ</label>
        <textarea
          id="card-detail-memo"
          className="memo-input"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          maxLength={MAX_MEMO_LENGTH}
          placeholder="たとえば、いつ・どこで見つけたか、思い出など"
          autoFocus
          data-testid="input-card-memo"
        />
        <p className="memo-counter" aria-live="polite">{draft.length} / {MAX_MEMO_LENGTH}</p>
        <div className="dialog-actions">
          <button type="button" className="record-button" onClick={onClose}>やめる</button>
          <button type="button" className="save-button" onClick={() => onSave(draft.trim())} data-testid="button-save-card-memo">メモを保存</button>
        </div>
      </section>
    </div>
  );
}
