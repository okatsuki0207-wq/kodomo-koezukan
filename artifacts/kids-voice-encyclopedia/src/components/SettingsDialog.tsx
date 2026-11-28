import { useRef, useState } from 'react';
import { Archive, Check, Download, Eye, Shuffle, Smartphone, Upload, X } from 'lucide-react';
import { normalizeGallerySettings, type GallerySettings } from '../lib/gallerySettings';
import { isRunningStandalone } from '../lib/installGuide';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  settings: GallerySettings;
  childMode: 'normal' | 'view' | 'add';
  onChildModeChange: (mode: 'normal' | 'view' | 'add') => void;
  onManageArchive: () => void;
  onExportBackup: () => Promise<void>;
  onRestoreBackup: (file: File) => Promise<void>;
  onSave: (settings: GallerySettings) => Promise<void>;
  onShowInstallGuide: () => void;
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
  onExportBackup,
  onRestoreBackup,
  onSave,
  onShowInstallGuide,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [runningStandalone] = useState(isRunningStandalone);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
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
  const exportBackup = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onExportBackup();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'バックアップを書き出せませんでした。');
    } finally {
      setBusy(false);
    }
  };
  const restoreBackup = async (file?: File) => {
    if (!file || busy) return;
    if (!window.confirm('この端末のキロク・カテゴリ・表示設定を、バックアップの内容に置き換えます。先に現在のデータを書き出してください。復元しますか？')) {
      if (backupInput.current) backupInput.current.value = '';
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onRestoreBackup(file);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'バックアップを復元できませんでした。');
    } finally {
      setBusy(false);
      if (backupInput.current) backupInput.current.value = '';
    }
  };

  return (
    <div className="overlay overlay-top" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} onKeyDown={(event) => { if (event.key === 'Escape') close(); }}>
      <div ref={dialog} className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-head">
          <div>
            <h2 id="settings-title" className="dialog-title">ずかんの設定</h2>
            <p className="dialog-lede">使い方に合わせてモードを切り替えられます。</p>
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
              <Eye size={18} /><span className="settings-option-copy"><strong>見るだけモード</strong><small>キロクを見たり、声を聞いたりできます。</small></span>
              <span className={`settings-switch${childMode === 'view' ? ' is-on' : ''}`} aria-hidden="true"><span /></span>
            </button>
            <button type="button" className={`settings-mode-option${childMode === 'add' ? ' selected' : ''}`} aria-pressed={childMode === 'add'} disabled={busy} onClick={() => onChildModeChange('add')} data-testid="setting-mode-child-add">
              <Eye size={18} /><span className="settings-option-copy"><strong>こどもモード</strong><small>見る・聞くことと、新しい声の追加ができます。写真や前の声は変えられません。</small></span>
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

        <section className="settings-section settings-install" aria-label="ホーム画面に追加">
          <h3 className="settings-section-title">アプリとして使う</h3>
          {runningStandalone ? (
            <p className="settings-installed-note" data-testid="status-running-standalone"><Check size={16} />ホーム画面から開いています。このまま使えます。</p>
          ) : (
            <button type="button" className="settings-mode-option" disabled={busy} onClick={onShowInstallGuide} data-testid="setting-install">
              <Smartphone size={18} /><span className="settings-option-copy"><strong>ホーム画面に追加する</strong><small>アイコンからすぐ開けて、キロクも残りやすくなります。追加のしかたを表示します。</small></span>
            </button>
          )}
        </section>

        <section className="settings-section settings-backup" aria-label="データのバックアップ">
          <h3 className="settings-section-title">データのバックアップ</h3>
          <p className="settings-backup-note">キロクの写真・声・カテゴリ・表示設定をJSONファイルに保存し、別の端末へ移せます。ファイルには個人のデータが含まれるため、安全な場所で保管してください。</p>
          <div className="settings-backup-actions">
            <button type="button" className="settings-mode-option" disabled={busy} onClick={() => { void exportBackup(); }} data-testid="button-export-backup">
              <Download size={18} /><span className="settings-option-copy"><strong>バックアップを書き出す</strong><small>この端末のデータをJSONで保存します。</small></span>
            </button>
            <button type="button" className="settings-mode-option" disabled={busy} onClick={() => backupInput.current?.click()} data-testid="button-import-backup">
              <Upload size={18} /><span className="settings-option-copy"><strong>バックアップを読み込む</strong><small>選んだ内容で、この端末のデータを置き換えます。</small></span>
            </button>
            <input ref={backupInput} type="file" accept="application/json,.json" className="sr-only" disabled={busy} onChange={(event) => { void restoreBackup(event.currentTarget.files?.[0]); }} data-testid="input-import-backup" />
          </div>
        </section>

        {error && <p className="form-error" role="alert" data-testid="status-settings-error">{error}</p>}
      </div>
    </div>
  );
}
