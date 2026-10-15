import { useRef, useState } from 'react';
import { Archive, Eye, Shuffle, X } from 'lucide-react';
import { normalizeGallerySettings, type GallerySettings } from '../lib/gallerySettings';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  settings: GallerySettings;
  childMode: 'normal' | 'view' | 'add';
  onChildModeChange: (mode: 'normal' | 'view' | 'add') => void;
  onManageArchive: () => void;
  onSave: (settings: GallerySettings) => Promise<void>;
  onClose: () => void;
};

function nextShuffleSeed() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0x1_0000_0000);
}

export default function SettingsDialog({
  settings,
  childMode,
  onChildModeChange,
  onManageArchive,
  onSave,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, '[data-testid="button-settings"]', () => { if (!busy) onClose(); });

  const close = () => { if (!busy) onClose(); };
  const toggleShuffle = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const enable = settings.displayMode !== 'shuffle';
    const next = normalizeGallerySettings({
      ...settings,
      displayMode: enable ? 'shuffle' : 'ordered',
      shuffleSeed: enable ? nextShuffleSeed() : settings.shuffleSeed,
    });
    try {
      await onSave(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'この端末に設定を保存できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay overlay-top" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} onKeyDown={(event) => { if (event.key === 'Escape') close(); }}>
      <div ref={dialog} className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-head">
          <div>
            <h2 id="settings-title" className="dialog-title">ずかんの設定</h2>
            <p className="dialog-lede">閲覧・編集と、ずかんの表示方法を切り替えられます。</p>
          </div>
          <button type="button" className="icon-button" disabled={busy} onClick={close} aria-label="閉じる" data-testid="button-close-settings"><X size={19} /></button>
        </div>

        <section className="settings-section settings-toggles" aria-label="設定項目">
          <div className="settings-mode-options" role="group" aria-label="ずかんの設定">
            <button
              type="button"
              className={`settings-mode-option${childMode === 'normal' ? ' selected' : ''}`}
              aria-pressed={childMode === 'normal'}
              aria-label="通常モード"
              disabled={busy}
              onClick={() => onChildModeChange('normal')}
              data-testid="setting-mode-normal"
            >
              <X size={18} />
              <span className="settings-option-copy">
                <strong>通常モード</strong>
                <small>追加・編集・削除など、すべての操作ができます。</small>
              </span>
              <span className={`settings-switch${childMode === 'normal' ? ' is-on' : ''}`} aria-hidden="true"><span /></span>
            </button>
            <button type="button" className={`settings-mode-option${childMode === 'view' ? ' selected' : ''}`} aria-pressed={childMode === 'view'} disabled={busy} onClick={() => onChildModeChange('view')} data-testid="setting-mode-child-view">
              <Eye size={18} /><span className="settings-option-copy"><strong>こどもモード：見る・聞く</strong><small>追加・編集・削除はできません。</small></span>
              <span className={`settings-switch${childMode === 'view' ? ' is-on' : ''}`} aria-hidden="true"><span /></span>
            </button>
            <button type="button" className={`settings-mode-option${childMode === 'add' ? ' selected' : ''}`} aria-pressed={childMode === 'add'} disabled={busy} onClick={() => onChildModeChange('add')} data-testid="setting-mode-child-add">
              <Eye size={18} /><span className="settings-option-copy"><strong>こどもモード：追加・編集もOK</strong><small>新しいキロクや声を追加・編集できます。削除はできません。</small></span>
              <span className={`settings-switch${childMode === 'add' ? ' is-on' : ''}`} aria-hidden="true"><span /></span>
            </button>
            <button
              type="button"
              className={`settings-mode-option${settings.displayMode === 'shuffle' ? ' selected' : ''}`}
              aria-pressed={settings.displayMode === 'shuffle'}
              aria-label={`シャッフルモード ${settings.displayMode === 'shuffle' ? 'オン' : 'オフ'}`}
              disabled={busy}
              onClick={() => { void toggleShuffle(); }}
              data-testid="setting-display-shuffle"
            >
              <Shuffle size={18} />
              <span className="settings-option-copy">
                <strong>シャッフルモード</strong>
                <small>{settings.displayMode === 'shuffle' ? 'オン：最新のキロクが先頭、ほかはランダムに並びます。' : 'オフ：新しいキロクから順に並びます。'}</small>
              </span>
              <span className={`settings-switch${settings.displayMode === 'shuffle' ? ' is-on' : ''}`} aria-hidden="true"><span /></span>
            </button>
            {childMode === 'normal' && <button
              type="button"
              className="settings-mode-option settings-archive-option"
              disabled={busy}
              onClick={onManageArchive}
              data-testid="setting-manage-archive"
            >
              <Archive size={18} />
              <span className="settings-option-copy">
                <strong>アーカイブの整理</strong>
                <small>しまったキロクをもどす、または完全に削除します。</small>
              </span>
            </button>}
          </div>
        </section>

        {error && <p className="form-error" role="alert" data-testid="status-settings-error">{error}</p>}
      </div>
    </div>
  );
}
