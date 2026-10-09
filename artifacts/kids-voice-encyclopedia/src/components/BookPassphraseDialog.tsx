import { useRef, useState, type FormEvent } from 'react';
import { BookOpen, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  mode: 'open' | 'switch';
  onSelect: (passphrase: string) => Promise<void>;
  onClose: () => void;
};

export default function BookPassphraseDialog({ mode, onSelect, onClose }: Props) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const title = mode === 'switch' ? 'あいことばを切り替える' : 'あいことばで図鑑をひらく';
  useDialogFocus(dialog, '[data-testid="button-settings"]', () => { if (!busy) onClose(); });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSelect(passphrase);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '図鑑を切り替えられませんでした。もう一度お試しください。');
      setBusy(false);
    }
  };

  return (
    <div
      className="overlay overlay-top"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
      onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }}
    >
      <div
        ref={dialog}
        className="dialog book-passphrase-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-passphrase-title"
        data-testid="dialog-book-passphrase"
      >
        <div className="dialog-head">
          <div>
            <h2 id="book-passphrase-title" className="dialog-title">{title}</h2>
            <p className="dialog-lede">同じあいことばを使うと、別の端末でも同じ図鑑をひらけます。</p>
          </div>
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            onClick={onClose}
            aria-label="閉じる"
            data-testid="button-close-book-passphrase"
          >
            <X size={19} />
          </button>
        </div>

        <form onSubmit={(event) => { void submit(event); }}>
          <label className="field-label" htmlFor="book-passphrase-input">図鑑のあいことば</label>
          <input
            id="book-passphrase-input"
            className="title-input"
            type="text"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="例：あいちゃん"
            maxLength={60}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            data-testid="input-book-passphrase"
          />
          <p className="book-passphrase-hint">
            あいことばごとに写真・声・カテゴリを分けて保存します。まだ最初のあいことばなら、これまでのキロクを引き継ぎます。
          </p>
          <p className="book-passphrase-warning">
            試作中の公開ルールでは、あいことばは図鑑を選ぶためのキーです。ほかの人からデータを守る認証ではありません。
          </p>
          {error && <p className="form-error" role="alert" data-testid="status-book-passphrase-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="cancel-button" onClick={onClose} disabled={busy}>やめる</button>
            <button type="submit" className="save-button" disabled={busy || !passphrase.trim()} data-testid="button-select-book">
              <BookOpen size={16} />
              {busy ? '準備中…' : 'この図鑑をひらく'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
