import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, ListOrdered, Shuffle, X } from 'lucide-react';
import type { Category } from '../lib/categories';
import {
  normalizeGallerySettings,
  orderCardsInCategory,
  orderCategories,
  UNCATEGORIZED_CATEGORY_KEY,
  type GallerySettings,
} from '../lib/gallerySettings';
import type { Keepsake } from '../lib/keepsakeRepository';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  categories: readonly Category[];
  items: readonly Keepsake[];
  settings: GallerySettings;
  onSave: (settings: GallerySettings) => Promise<void>;
  onClose: () => void;
};

function move<T>(values: readonly T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (index < 0 || target < 0 || target >= values.length) return [...values];
  const next = [...values];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function nextShuffleSeed() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0x1_0000_0000);
}

export default function SettingsDialog({ categories, items, settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(() => normalizeGallerySettings(settings));
  const initialCategory = orderCategories(categories, settings)[0]?.id ?? UNCATEGORIZED_CATEGORY_KEY;
  const [cardCategoryKey, setCardCategoryKey] = useState(initialCategory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLFormElement>(null);
  useDialogFocus(dialog, '[data-testid="button-settings"]', () => { if (!busy) onClose(); });

  const orderedCategories = useMemo(() => orderCategories(categories, draft), [categories, draft]);
  const selectedCategoryId = cardCategoryKey === UNCATEGORIZED_CATEGORY_KEY ? null : cardCategoryKey;
  const categoryCards = useMemo(
    () => orderCardsInCategory(items, selectedCategoryId, draft),
    [items, selectedCategoryId, draft],
  );

  const close = () => { if (!busy) onClose(); };
  const reorderCategories = (index: number, offset: number) => {
    setDraft((current) => ({
      ...current,
      categoryOrder: move(orderCategories(categories, current).map((category) => category.id), index, offset),
    }));
  };
  const reorderCards = (index: number, offset: number) => {
    setDraft((current) => ({
      ...current,
      cardOrderByCategory: {
        ...current.cardOrderByCategory,
        [cardCategoryKey]: move(
          orderCardsInCategory(items, selectedCategoryId, current).map((item) => item.id),
          index,
          offset,
        ),
      },
    }));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave(normalizeGallerySettings(draft));
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '設定を保存できませんでした。通信とFirebaseのルールを確認してください。');
      setBusy(false);
    }
  };

  return (
    <div className="overlay overlay-top" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} onKeyDown={(event) => { if (event.key === 'Escape') close(); }}>
      <form ref={dialog} className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onSubmit={(event) => { void save(event); }}>
        <div className="dialog-head">
          <div>
            <h2 id="settings-title" className="dialog-title">ずかんの設定</h2>
            <p className="dialog-lede">ページとキロクの並び方を整えます。</p>
          </div>
          <button type="button" className="icon-button" disabled={busy} onClick={close} aria-label="閉じる" data-testid="button-close-settings"><X size={19} /></button>
        </div>

        <section className="settings-section" aria-labelledby="settings-display-title">
          <h3 id="settings-display-title" className="settings-heading">キロクの表示</h3>
          <div className="settings-mode-options" role="group" aria-label="キロクの表示順">
            <button type="button" className={`settings-mode-option${draft.displayMode === 'ordered' ? ' selected' : ''}`} aria-pressed={draft.displayMode === 'ordered'} disabled={busy} onClick={() => setDraft((current) => ({ ...current, displayMode: 'ordered' }))} data-testid="setting-display-ordered">
              <ListOrdered size={18} /><span><strong>設定した順番</strong><small>下で決めたページ・キロクの順に並べます。</small></span>
            </button>
            <button type="button" className={`settings-mode-option${draft.displayMode === 'shuffle' ? ' selected' : ''}`} aria-pressed={draft.displayMode === 'shuffle'} disabled={busy} onClick={() => setDraft((current) => ({ ...current, displayMode: 'shuffle', shuffleSeed: nextShuffleSeed() }))} data-testid="setting-display-shuffle">
              <Shuffle size={18} /><span><strong>シャッフル配置</strong><small>同じ設定を共有端末でも再現できる順番です。</small></span>
            </button>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-category-title">
          <h3 id="settings-category-title" className="settings-heading">カテゴリの並び順</h3>
          {orderedCategories.length ? (
            <ol className="settings-order-list">
              {orderedCategories.map((category, index) => (
                <li key={category.id} className="settings-order-row">
                  <span className="settings-order-number">{index + 1}</span>
                  <span className="settings-order-name">{category.name}</span>
                  <div className="settings-order-actions">
                    <button type="button" className="settings-move-button" disabled={busy || index === 0} onClick={() => reorderCategories(index, -1)} aria-label={`${category.name}を上へ`} data-testid={`button-category-up-${category.id}`}><ArrowUp size={17} /></button>
                    <button type="button" className="settings-move-button" disabled={busy || index === orderedCategories.length - 1} onClick={() => reorderCategories(index, 1)} aria-label={`${category.name}を下へ`} data-testid={`button-category-down-${category.id}`}><ArrowDown size={17} /></button>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="settings-empty">カテゴリはまだありません。</p>}
        </section>

        <section className="settings-section" aria-labelledby="settings-cards-title">
          <h3 id="settings-cards-title" className="settings-heading">カテゴリ内のキロク順</h3>
          <label className="settings-select-label" htmlFor="settings-card-category">並べ替えるページ</label>
          <select id="settings-card-category" className="title-input settings-category-select" value={cardCategoryKey} disabled={busy} onChange={(event) => setCardCategoryKey(event.currentTarget.value)} data-testid="select-settings-category">
            {orderedCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            <option value={UNCATEGORIZED_CATEGORY_KEY}>カテゴリなし</option>
          </select>
          {categoryCards.length ? (
            <ol className="settings-order-list settings-card-list">
              {categoryCards.map((item, index) => (
                <li key={item.id} className="settings-order-row">
                  <span className="settings-order-number">{index + 1}</span>
                  <span className="settings-order-name">{item.itemName}</span>
                  <div className="settings-order-actions">
                    <button type="button" className="settings-move-button" disabled={busy || index === 0} onClick={() => reorderCards(index, -1)} aria-label={`${item.itemName}を上へ`} data-testid={`button-card-up-${item.id}`}><ArrowUp size={17} /></button>
                    <button type="button" className="settings-move-button" disabled={busy || index === categoryCards.length - 1} onClick={() => reorderCards(index, 1)} aria-label={`${item.itemName}を下へ`} data-testid={`button-card-down-${item.id}`}><ArrowDown size={17} /></button>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="settings-empty">このページには、まだキロクがありません。</p>}
        </section>

        {error && <p className="form-error" role="alert" data-testid="status-settings-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="cancel-button" disabled={busy} onClick={close} data-testid="button-cancel-settings">やめる</button>
          <button type="submit" className="save-button" disabled={busy} data-testid="button-save-settings"><Check size={16} />{busy ? '保存中…' : '設定を保存'}</button>
        </div>
      </form>
    </div>
  );
}
