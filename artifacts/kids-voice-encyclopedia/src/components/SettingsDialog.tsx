import { useRef, useState } from 'react';
import { Archive, Check, Download, ListPlus, Replace, Smartphone, Upload, X } from 'lucide-react';
import type { BackupImportMode } from '../lib/localDataBackup';
import type { GalleryDensity, GalleryDisplayMode } from '../lib/gallerySettings';
import { APP_VERSION } from '../lib/version';
import { normalizeGallerySettings, type GallerySettings } from '../lib/gallerySettings';
import { isRunningStandalone } from '../lib/installGuide';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  settings: GallerySettings;
  childMode: 'normal' | 'view' | 'add';
  onChildModeChange: (mode: 'normal' | 'view' | 'add') => void;
  onManageArchive: () => void;
  onExportBackup: () => Promise<void>;
  onRestoreBackup: (file: File, mode: BackupImportMode) => Promise<string>;
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingChildMode, setPendingChildMode] = useState<'view' | 'add' | null>(null);
  const [importNotice, setImportNotice] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  useDialogFocus(dialog, '[data-testid="button-settings"]', () => { if (!busy) onClose(); });

  const close = () => { if (!busy) onClose(); };
  const saveSettings = async (next: GallerySettings) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave(normalizeGallerySettings(next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'この端末に設定を保存できませんでした。');
    } finally {
      setBusy(false);
    }
  };
  const applyDisplayMode = (mode: GalleryDisplayMode) => {
    void saveSettings({
      ...settings,
      displayMode: mode,
      shuffleSeed: mode === 'shuffle' ? nextShuffleSeed() : settings.shuffleSeed,
    });
  };
  const applyDensity = (density: GalleryDensity) => {
    void saveSettings({ ...settings, density });
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
  const restoreBackup = (file?: File) => {
    if (!file || busy) return;
    setError('');
    setImportNotice('');
    setPendingFile(file);
  };
  const cancelImport = () => {
    setPendingFile(null);
    if (backupInput.current) backupInput.current.value = '';
  };
  const runImport = async (mode: BackupImportMode) => {
    if (!pendingFile || busy) return;
    setBusy(true);
    setError('');
    try {
      const message = await onRestoreBackup(pendingFile, mode);
      setImportNotice(message);
      setPendingFile(null);
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
          <h3 className="settings-section-title">閲覧モード</h3>
          <div className="settings-segmented" role="group" aria-label="閲覧モード">
            <button type="button" className={childMode === 'normal' ? 'selected' : ''} aria-pressed={childMode === 'normal'} disabled={busy} onClick={() => onChildModeChange('normal')} data-testid="setting-mode-normal">通常</button>
            <button type="button" className={childMode === 'view' ? 'selected' : ''} aria-pressed={childMode === 'view'} disabled={busy} onClick={() => setPendingChildMode('view')} data-testid="setting-mode-child-view">見るだけ</button>
            <button type="button" className={childMode === 'add' ? 'selected' : ''} aria-pressed={childMode === 'add'} disabled={busy} onClick={() => setPendingChildMode('add')} data-testid="setting-mode-child-add">こども</button>
          </div>
          <p className="settings-mode-description">
            {childMode === 'normal' && '追加・編集・削除など、すべての操作ができます。'}
            {childMode === 'view' && 'キロクを見たり、声を聞いたりできます。'}
            {childMode === 'add' && '見る・聞くことと、新しい声の追加ができます。写真や前の声は変えられません。'}
          </p>
          <h3 className="settings-section-title">並べ方</h3>
          <div className="settings-segmented" role="group" aria-label="並べ方">
            <button type="button" className={settings.displayMode === 'ordered' ? 'selected' : ''} aria-pressed={settings.displayMode === 'ordered'} disabled={busy} onClick={() => applyDisplayMode('ordered')} data-testid="setting-sort-ordered">新しい順</button>
            <button type="button" className={settings.displayMode === 'monthly' ? 'selected' : ''} aria-pressed={settings.displayMode === 'monthly'} disabled={busy} onClick={() => applyDisplayMode('monthly')} data-testid="setting-sort-monthly">年月</button>
            <button type="button" className={settings.displayMode === 'shuffle' ? 'selected' : ''} aria-pressed={settings.displayMode === 'shuffle'} disabled={busy} onClick={() => applyDisplayMode('shuffle')} data-testid="setting-sort-shuffle">シャッフル</button>
          </div>
          <p className="settings-mode-description">
            {settings.displayMode === 'ordered' && '新しいキロクから順に並びます。'}
            {settings.displayMode === 'monthly' && '年月ごとにページが分かれ、何年何月の図鑑か一目で分かります。'}
            {settings.displayMode === 'shuffle' && '最新のキロクが先頭、ほかはランダムに並びます。'}
          </p>

          <h3 className="settings-section-title">ずかんのサイズ</h3>
          <div className="settings-segmented" role="group" aria-label="ずかんのサイズ">
            <button type="button" className={settings.density === 'big' ? 'selected' : ''} aria-pressed={settings.density === 'big'} disabled={busy} onClick={() => applyDensity('big')} data-testid="setting-density-big">おおきく</button>
            <button type="button" className={settings.density === 'medium' ? 'selected' : ''} aria-pressed={settings.density === 'medium'} disabled={busy} onClick={() => applyDensity('medium')} data-testid="setting-density-medium">ふつう</button>
            <button type="button" className={settings.density === 'small' ? 'selected' : ''} aria-pressed={settings.density === 'small'} disabled={busy} onClick={() => applyDensity('small')} data-testid="setting-density-small">ちいさく</button>
          </div>
          <p className="settings-mode-description">
            {settings.density === 'big' && '1ページに1つだけ、大きく表示します。小さいお子さま向けです。'}
            {settings.density === 'medium' && '2列で表示します。'}
            {settings.density === 'small' && '3列で、たくさんのキロクを一度に表示します。'}
          </p>

          {childMode === 'normal' && (
            <>
              <h3 className="settings-section-title">アーカイブの整理</h3>
              <div className="settings-mode-options">
                <button
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
                </button>
              </div>
            </>
          )}
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
              <Upload size={18} /><span className="settings-option-copy"><strong>バックアップを読み込む</strong><small>読み込み時に、追加するか入れ替えるか選べます。</small></span>
            </button>
            <input ref={backupInput} type="file" accept="application/json,.json" className="sr-only" disabled={busy} onChange={(event) => { restoreBackup(event.currentTarget.files?.[0]); }} data-testid="input-import-backup" />
          </div>
          {pendingFile && (
            <div className="settings-import-choice" data-testid="import-mode-choice">
              <p className="settings-backup-note">「{pendingFile.name}」を読み込みます。読み込み方を選んでください。</p>
              <div className="settings-backup-actions">
                <button type="button" className="settings-mode-option" disabled={busy} onClick={() => { void runImport('merge'); }} data-testid="button-import-merge">
                  <ListPlus size={18} /><span className="settings-option-copy"><strong>キロクを追加する</strong><small>今のキロクはそのまま残し、バックアップにある新しいキロクだけを足します。同じキロクは二重になりません。</small></span>
                </button>
                <button type="button" className="settings-mode-option" disabled={busy} onClick={() => { void runImport('replace'); }} data-testid="button-import-replace">
                  <Replace size={18} /><span className="settings-option-copy"><strong>すべて入れ替える</strong><small>この端末のキロク・カテゴリ・表示設定を、バックアップの内容に置き換えます。今のデータは消えるため、先に書き出しをおすすめします。</small></span>
                </button>
                <button type="button" className="settings-mode-option" disabled={busy} onClick={cancelImport} data-testid="button-import-cancel">
                  <X size={18} /><span className="settings-option-copy"><strong>やめる</strong><small>ファイルを読み込まずに戻ります。</small></span>
                </button>
              </div>
            </div>
          )}
          {importNotice && <p className="settings-installed-note" role="status" data-testid="status-import-result"><Check size={16} />{importNotice}</p>}
        </section>

        <p className="settings-version" data-testid="status-app-version">バージョン {APP_VERSION}</p>

        {error && <p className="form-error" role="alert" data-testid="status-settings-error">{error}</p>}
      </div>

      {pendingChildMode && (
        <div className="overlay overlay-top" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingChildMode(null); }}>
          <section className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-mode-title" data-testid="dialog-confirm-mode">
            <h2 id="confirm-mode-title" className="dialog-title">{pendingChildMode === 'view' ? '見るだけモード' : 'こどもモード'}に切り替えますか？</h2>
            <p>{pendingChildMode === 'view'
              ? 'キロクを見たり、声を聞いたりできます。追加・編集・削除はできなくなります。'
              : '見る・聞くことと、新しい声の追加ができます。写真や前の声は変えられません。'}</p>
            <div className="dialog-actions">
              <button type="button" className="record-button" onClick={() => setPendingChildMode(null)} data-testid="button-cancel-mode-switch">いいえ</button>
              <button
                type="button"
                className="save-button"
                onClick={() => { const mode = pendingChildMode; setPendingChildMode(null); onChildModeChange(mode); }}
                data-testid="button-confirm-mode-switch"
              >はい</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
