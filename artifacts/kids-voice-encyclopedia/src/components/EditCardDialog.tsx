import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Category } from '../lib/categories';
import type { Keepsake } from '../lib/keepsakeStore';
import CategorySelect from './CategorySelect';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  item: Keepsake;
  categories: readonly Category[];
  onSave: (itemName: string, categoryId: string | null) => Promise<void>;
  describeError: (caught: unknown) => string;
  onClose: () => void;
};

export default function EditCardDialog({ item, categories, onSave, describeError, onClose }: Props) {
  const [name, setName] = useState(item.itemName);
  const [categoryId, setCategoryId] = useState<string | null>(item.categoryId ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const dialog = useRef<HTMLFormElement | null>(null);
  useDialogFocus(dialog, '[data-testid="button-edit-card"]');
  const close = () => { if (!lock.current) onClose(); };

  const submit = async () => {
    if (lock.current) return;
    const clean = name.trim();
    if (!clean) { setError('図鑑に登録するモノの名前を入力してください。'); return; }
    lock.current = true; setBusy(true); setError('');
    try { await onSave(clean, categoryId); lock.current = false; onClose(); }
    catch (caught) { setError(describeError(caught)); lock.current = false; setBusy(false); }
  };

  return (
    <div className="overlay overlay-top" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <form ref={dialog} className="dialog dialog-small" role="dialog" aria-modal="true" aria-labelledby="edit-title" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="dialog-head">
          <div><h2 id="edit-title" className="dialog-title">なまえとカテゴリを直す</h2><p className="dialog-lede">写真と声はそのままです。</p></div>
          <button type="button" className="icon-button" disabled={busy} onClick={close} aria-label="閉じる" data-testid="button-close-edit"><X size={19} /></button>
        </div>
        <div className="form-block">
          <label className="field-label" htmlFor="edit-item-name">モノの名前</label>
          <input id="edit-item-name" className="title-input" value={name} disabled={busy} maxLength={48} onChange={(e) => { setName(e.currentTarget.value); setError(''); }} aria-invalid={!!error} data-testid="input-edit-name" />
        </div>
        <div className="form-block">
          <CategorySelect id="edit-category" categories={categories} value={categoryId} onChange={setCategoryId} disabled={busy} testId="select-edit-category" />
        </div>
        {error && <p className="form-error" role="alert" data-testid="status-edit-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="cancel-button" disabled={busy} onClick={close} data-testid="button-cancel-edit">やめる</button>
          <button type="submit" className="save-button" disabled={busy} data-testid="button-save-edit"><Check size={16} /> {busy ? '保存中…' : 'なおして保存'}</button>
        </div>
      </form>
    </div>
  );
}
