import { useRef, useState } from 'react';
import { Eye, Shuffle, X } from 'lucide-react';
import { normalizeGallerySettings, type GallerySettings } from '../lib/gallerySettings';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  settings: GallerySettings;
  readOnly: boolean;
  onSave: (settings: GallerySettings) => Promise<void>;
  onChooseViewMode: () => void;
  onExitReadOnly: () => void;
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
  readOnly,
  onSave,
  onChooseViewMode,
  onExitReadOnly,
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
      setError(caught instanceof Error ? caught.message : '設定を保存できませんでした。通信とFirebaseのルールを確認してください。');
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
            <p className="dialog-lede">閲覧モードとシャッフルモードを切り替えられます。</p>
          </div>
          <button type="button" className="icon-button" disabled={busy} onClick={close} aria-label="閉じる" data-testid="button-close-settings"><X size={19} /></button>
        </div>

        <section className="settings-section settings-toggles" aria-label="設定項目">
          <div className="settings-mode-options" role="group" aria-label="ずかんの設定">
            <button
              type="button"
              className={`settings-mode-option${readOnly ? ' selected' : ''}`}
              aria-pressed={readOnly}
              aria-label={`閲覧モード ${readOnly ? 'オン' : 'オフ'}`}
              disabled={busy}
              onClick={readOnly ? onExitReadOnly : onChooseViewMode}
              data-testid="button-mode-view"
            >
              <Eye size={18} />
              <span className="settings-option-copy">
                <strong>閲覧モード</strong>
                <small>{readOnly ? 'オン：キロクを見る・声をきくことができます。' : 'オフ：キロクの追加や編集ができます。'}</small>
              </span>
              <span className={`settings-switch${readOnly ? ' is-on' : ''}`} aria-hidden="true"><span /></span>
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
          </div>
        </section>

        {error && <p className="form-error" role="alert" data-testid="status-settings-error">{error}</p>}
      </div>
    </div>
  );
}
