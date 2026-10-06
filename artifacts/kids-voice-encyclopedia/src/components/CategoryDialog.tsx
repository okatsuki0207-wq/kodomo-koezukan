import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { categoryNameKey, validateCategoryName, type Category } from '../lib/categories';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  categories: readonly Category[];
  onCreate: (name: string) => Promise<Category>;
  describeError: (caught: unknown) => string;
  onCreated: (category: Category) => void;
  onClose: () => void;
  returnSelector?: string;
};

export default function CategoryDialog({ categories, onCreate, describeError, onCreated, onClose, returnSelector = '[data-testid="button-new-category"]' }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const dialog = useRef<HTMLFormElement | null>(null);
  useDialogFocus(dialog, returnSelector, () => { if (!busy) onClose(); });

  const close = () => { if (!lock.current) onClose(); };

  const submit = async () => {
    if (lock.current) return;
    let clean: string;
    try {
      clean = validateCategoryName(name);
      if (categories.some((c) => categoryNameKey(c.name) === categoryNameKey(clean))) throw new Error('そのカテゴリはすでにあります。一覧から選んでください。');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '名前を確認してください。'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const made = await onCreate(clean);
      lock.current = false;
      onCreated(made);
    } catch (caught) { setError(describeError(caught)); lock.current = false; setBusy(false); }
  };

  return (
    <div className="overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <form ref={dialog} className="dialog dialog-small" role="dialog" aria-modal="true" aria-labelledby="category-title" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="dialog-head">
          <div><h2 id="category-title" className="dialog-title">新しいカテゴリ</h2><p className="dialog-lede">図鑑をわけるなまえを、24文字までで入力します。</p></div>
          <button type="button" className="icon-button" disabled={busy} onClick={close} aria-label="閉じる" data-testid="button-close-category"><X size={19} /></button>
        </div>
        <div className="form-block">
          <label className="field-label" htmlFor="category-name">カテゴリの名前</label>
          <input id="category-name" className="title-input" value={name} disabled={busy} maxLength={24} onChange={(e) => { setName(e.currentTarget.value); setError(''); }} placeholder="のりもの、おはな など" aria-invalid={!!error} data-testid="input-category-name" />
          <p className="field-hint" style={{ marginTop: 8 }}>{name.length} / 24</p>
        </div>
        {error && <p className="form-error" role="alert" data-testid="status-category-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="cancel-button" disabled={busy} onClick={close} data-testid="button-cancel-category">やめる</button>
          <button type="submit" className="save-button" disabled={busy} data-testid="button-save-category"><Check size={16} /> {busy ? '保存中…' : 'カテゴリをつくる'}</button>
        </div>
      </form>
    </div>
  );
}
