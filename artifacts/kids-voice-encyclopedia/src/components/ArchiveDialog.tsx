import { useRef, useState } from 'react';
import { ArchiveRestore, Image as ImageIcon, Trash2, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { Keepsake } from '../lib/keepsakeStore';

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(timestamp);
}

type Props = {
  items: Keepsake[];
  busyId: string | null;
  error: string;
  onRestore: (item: Keepsake) => void;
  onDelete: (item: Keepsake) => void;
  onClose: () => void;
};

export default function ArchiveDialog({ items, busyId, error, onRestore, onDelete, onClose }: Props) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, '[data-testid="button-settings"]', onClose);
  const close = () => { if (!busyId) onClose(); };

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialog} className="dialog archive-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-title">
        <div className="dialog-head">
          <div>
            <h2 id="archive-title" className="dialog-title">アーカイブの整理</h2>
            <p className="dialog-lede">しまったキロクは、ここからいつでももどせます。</p>
          </div>
          <button type="button" className="icon-button" onClick={close} disabled={!!busyId} aria-label="閉じる"><X size={19} /></button>
        </div>

        {items.length === 0 ? (
          <div className="archive-empty" data-testid="archive-empty">アーカイブしたキロクはありません。</div>
        ) : (
          <ul className="archive-list" data-testid="archive-list">
            {items.map((item) => (
              <li className="archive-row" key={item.id} data-testid={`archive-item-${item.id}`}>
                {item.photo
                  ? <img className="archive-thumbnail" src={item.photo} alt="" />
                  : <span className="archive-thumbnail archive-thumbnail-empty"><ImageIcon size={20} /></span>}
                <div className="archive-copy">
                  <strong>{item.itemName}</strong>
                  <small>{formatDate(item.createdAt)}</small>
                  {deleteId === item.id && (
                    <span className="archive-delete-confirm" role="alert">
                      写真と声も完全に消しますか？
                      <button type="button" disabled={busyId === item.id} onClick={() => onDelete(item)} data-testid={`archive-confirm-delete-${item.id}`}>完全に削除</button>
                      <button type="button" disabled={busyId === item.id} onClick={() => setDeleteId(null)}>やめる</button>
                    </span>
                  )}
                </div>
                <div className="archive-actions">
                  <button type="button" className="archive-restore" disabled={!!busyId} onClick={() => onRestore(item)} data-testid={`archive-restore-${item.id}`} aria-label={`${item.itemName}をもどす`}>
                    <ArchiveRestore size={17} /><span>もどす</span>
                  </button>
                  <button type="button" className="archive-delete" disabled={!!busyId} onClick={() => setDeleteId(deleteId === item.id ? null : item.id)} data-testid={`archive-delete-${item.id}`} aria-label={`${item.itemName}を完全に削除`}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
