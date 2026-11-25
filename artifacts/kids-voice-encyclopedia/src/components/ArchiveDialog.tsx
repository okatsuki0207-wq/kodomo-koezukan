import { useRef, useState } from 'react';
import { ArchiveRestore, ChevronLeft, ChevronRight, Image as ImageIcon, Trash2, X } from 'lucide-react';
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
  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = 4;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const pageItems = items.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, '[data-testid="button-settings"]', onClose);
  const close = () => { if (!busyId) onClose(); };
  const pendingDelete = items.find((item) => item.id === deleteId) ?? null;

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
            {pageItems.map((item) => (
              <li className="archive-row" key={item.id} data-testid={`archive-item-${item.id}`}>
                {item.photo
                  ? <img className="archive-thumbnail" src={item.photo} alt="" />
                  : <span className="archive-thumbnail archive-thumbnail-empty"><ImageIcon size={20} /></span>}
                <div className="archive-copy">
                  <strong>{item.itemName}</strong>
                  <small>{formatDate(item.createdAt)}</small>
                </div>
                <div className="archive-actions">
                  <button type="button" className="archive-restore" disabled={!!busyId} onClick={() => onRestore(item)} data-testid={`archive-restore-${item.id}`} aria-label={`${item.itemName}をもどす`}>
                    <ArchiveRestore size={17} /><span>もどす</span>
                  </button>
                  <button type="button" className="archive-delete" disabled={!!busyId} onClick={() => setDeleteId(item.id)} data-testid={`archive-delete-${item.id}`} aria-label={`${item.itemName}を完全に削除`}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {pageCount > 1 && (
          <nav className="gallery-pagination archive-pagination" aria-label="アーカイブのページ">
            <button type="button" className="gallery-page-button" disabled={currentPage === 0} onClick={() => setPageIndex(Math.max(0, currentPage - 1))} aria-label="前のページ" data-testid="button-archive-previous"><ChevronLeft size={18} /></button>
            <span aria-live="polite" data-testid="archive-page-count">{currentPage + 1} / {pageCount}</span>
            <button type="button" className="gallery-page-button" disabled={currentPage >= pageCount - 1} onClick={() => setPageIndex(Math.min(pageCount - 1, currentPage + 1))} aria-label="次のページ" data-testid="button-archive-next"><ChevronRight size={18} /></button>
          </nav>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
      {pendingDelete && (
        <div className="overlay overlay-confirm" role="presentation">
          <section className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="archive-delete-title">
            <Trash2 size={25} aria-hidden="true" />
            <h2 id="archive-delete-title" className="dialog-title">完全に削除しますか？</h2>
            <p>「{pendingDelete.itemName}」の写真と声も完全に消します。この操作はもとにもどせません。</p>
            <div className="dialog-actions">
              <button type="button" className="record-button" disabled={!!busyId} onClick={() => setDeleteId(null)}>やめる</button>
              <button type="button" className="danger-button" disabled={!!busyId} onClick={() => onDelete(pendingDelete)} data-testid={`archive-confirm-delete-${pendingDelete.id}`}>完全に削除</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
