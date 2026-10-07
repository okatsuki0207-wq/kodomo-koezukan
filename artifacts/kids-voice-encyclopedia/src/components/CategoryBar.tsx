import { GripVertical, Plus } from 'lucide-react';
import type { Category } from '../lib/categories';

type Props = {
  categories: readonly Category[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
  disabled?: boolean;
  readOnly?: boolean;
  reorderMode?: boolean;
  reorderOverId?: string | null;
  reorderDraggingId?: string | null;
  onMoveCategory?: (id: string, offset: number) => void;
};

export default function CategoryBar({
  categories,
  selected,
  onSelect,
  onNew,
  disabled,
  readOnly,
  reorderMode,
  reorderOverId,
  reorderDraggingId,
  onMoveCategory,
}: Props) {
  return (
    <div className="category-bar" data-testid="category-bar">
      <div className="category-scroll">
        <div className="category-tabs" role="tablist" aria-label="カテゴリ" onKeyDown={(event) => {
          if (reorderMode && event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"][data-category-id]');
            const id = tab?.dataset.categoryId;
            if (id) {
              event.preventDefault();
              onMoveCategory?.(id, event.key === 'ArrowRight' ? 1 : -1);
              return;
            }
          }
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
          const index = tabs.findIndex((tab) => tab === document.activeElement);
          if (index < 0) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
            (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          tabs[next].focus();
          tabs[next].click();
        }}>
          <button id="category-tab-all" type="button" role="tab" aria-controls="category-panel" tabIndex={selected === null ? 0 : -1} aria-selected={selected === null} className={`category-chip${selected === null ? ' active' : ''}`} onClick={() => onSelect(null)} data-testid="tab-category-all">すべて</button>
          {categories.map((c) => (
            <button
              key={c.id}
              id={`category-tab-${c.id}`}
              type="button"
              role="tab"
              aria-controls="category-panel"
              tabIndex={selected === c.id ? 0 : -1}
              aria-selected={selected === c.id}
              aria-label={reorderMode ? `${c.name}、つかんで並び替え` : c.name}
              className={`category-chip${selected === c.id ? ' active' : ''}${reorderMode ? ' reorderable' : ''}`}
              onClick={() => onSelect(c.id)}
              data-category-id={c.id}
              data-reorder-drop-kind={reorderMode ? 'category' : undefined}
              data-reorder-drop-id={reorderMode ? c.id : undefined}
              data-reorder-over={reorderOverId === c.id ? 'true' : undefined}
              data-reorder-dragging={reorderDraggingId === c.id ? 'true' : undefined}
              data-testid={`tab-category-${c.id}`}
            >
              {reorderMode && <span
                className="category-reorder-grip"
                data-reorder-kind="category"
                data-reorder-id={c.id}
                aria-hidden="true"
              ><GripVertical size={14} /></span>}
              {c.name}
            </button>
          ))}
        </div>
        {!readOnly && <button type="button" className="category-chip category-new" onClick={onNew} disabled={disabled} aria-label="新しいカテゴリを追加" title="新しいカテゴリを追加" data-testid="button-new-category"><Plus size={15} /><span>新しいカテゴリ</span></button>}
      </div>
    </div>
  );
}
