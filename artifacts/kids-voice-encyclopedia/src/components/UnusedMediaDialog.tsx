import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { UnusedMediaReport } from '../lib/unusedMedia';
import { useDialogFocus } from '../hooks/useDialogFocus';

const labels = {
  referenced: 'カードで使用中 — 削除不可',
  active: '保存中・結果不明 — 削除不可',
  legacy: '旧形式・状態記録なし — 手動確認が必要（削除不可）',
  waiting: '終了から7日間の待機中 — 削除不可',
  eligible: '未参照・待機期間終了 — 個別確認で削除可能',
};

type Props = {
  onClose: () => void;
  inspectUnusedMedia: () => Promise<UnusedMediaReport>;
  deleteUnusedMedia: (path: string, confirmed: boolean) => Promise<void>;
  describeError: (error: unknown) => string;
};

export default function UnusedMediaDialog({ onClose, inspectUnusedMedia, deleteUnusedMedia, describeError }: Props) {
  const dialog = useRef<HTMLDivElement | null>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<UnusedMediaReport | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const close = () => { if (!lock.current) onClose(); };
  useDialogFocus(dialog, '[data-testid="button-unused-media"]', close);

  async function inspect() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setReport(null); setSelected(null); setError(''); setNotice('');
    try { setReport(await inspectUnusedMedia()); }
    catch (caught) { setError(describeError(caught)); }
    finally { lock.current = false; setBusy(false); }
  }

  async function remove() {
    if (lock.current || !selected) return;
    const path = selected;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await deleteUnusedMedia(path, true);
      setReport(null); setNotice('この1ファイルを削除しました。続ける場合は一覧を再確認してください。');
    } catch (caught) {
      setReport(null); setError(`${describeError(caught)} 再試行する場合は一覧を再確認してください。`);
    } finally { setSelected(null); lock.current = false; setBusy(false); }
  }

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') close(); }}>
      <div ref={dialog} className="dialog" role="dialog" aria-modal="true" aria-labelledby="unused-title">
        <div className="dialog-head">
          <div><h2 id="unused-title" className="dialog-title">未使用ファイルの確認</h2><p className="dialog-lede">保護者向け・この端末の利用者に属するファイルのみ</p></div>
          <button type="button" className="icon-button" disabled={busy} onClick={close} aria-label="閉じる"><X size={19} /></button>
        </div>
        <p className="field-hint">一覧の確認だけでは削除しません。保存中・結果不明・旧形式のファイルは保持します。処理終了とファイル更新から7日以上経過し、サーバー上で未参照のファイルだけを1件ずつ確認して削除できます。</p>
        <p className="field-hint">現在のバケットだけを確認します。旧バケットは走査・削除しません。写真・声の内容や共有URLは表示しません。</p>
        <button type="button" className="record-button" onClick={() => void inspect()} disabled={busy} data-testid="button-inspect-unused">{busy ? 'サーバーで確認中…' : '読み取り専用で一覧を確認'}</button>
        {report && <div className="unused-report">
          <p className="field-hint">確認時刻: {new Date(report.checkedAt).toLocaleString('ja-JP')}<br />バケット: {report.bucket}<br />
            全{report.files.length}件 / 削除可能{report.files.filter((file) => file.status === 'eligible').length}件
          </p>
          {report.files.length === 0 && <p role="status">このバケットにファイルはありません。</p>}
          <ul className="unused-files">
            {report.files.map((file) => <li key={file.path}>
              <code>{file.path}</code>
              <p>{labels[file.status]}<br />{Math.ceil(file.size / 1024)} KB · 更新: {Number.isFinite(file.updatedAt) ? new Date(file.updatedAt).toLocaleString('ja-JP') : '不明'}</p>
              {file.status === 'eligible' && <button type="button" className="cancel-button" disabled={busy}
                onClick={() => { setSelected(file.path); setError(''); }} data-testid="button-select-unused">このファイルの削除を確認</button>}
            </li>)}
          </ul>
        </div>}
        {selected && <div className="delete-confirm unused-confirm" role="alert">
          <p><code>{selected}</code><br />この1ファイルを完全に削除します。元に戻せません。削除直前に参照と保存状態を再確認します。</p>
          <button type="button" disabled={busy} onClick={() => void remove()} data-testid="button-confirm-unused-delete">この1ファイルを削除する</button>
          <button type="button" disabled={busy} onClick={() => setSelected(null)}>やめる</button>
        </div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="notice neutral" role="status">{notice}</p>}
      </div>
    </div>
  );
}
