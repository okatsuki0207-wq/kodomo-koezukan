import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Eye, LockKeyhole, Share2, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { createBookUrl, type BookId } from '../lib/bookIdentity';
import { firebaseError, getOwnerBookShareState, setOwnerBookSharing } from '../lib/keepsakeStore';

type Props = { onClose: () => void };

export default function ShareDialog({ onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [bookId, setBookId] = useState<BookId | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  useDialogFocus(dialog, '[data-testid="button-share-encyclopedia"]', () => { if (!busy) onClose(); });

  useEffect(() => {
    let cancelled = false;
    void getOwnerBookShareState().then((state) => {
      if (cancelled) return;
      setBookId(state.bookId);
      setEnabled(state.enabled);
    }).catch((caught) => {
      if (!cancelled) setError(firebaseError(caught));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const url = bookId ? createBookUrl(bookId, window.location.href) : '';
  const setSharing = async (next: boolean) => {
    if (!bookId || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await setOwnerBookSharing(next);
      setEnabled(next);
      setNotice(next
        ? 'このリンクで、別の端末から最新のずかんを見られます。'
        : '共有を停止しました。相手が控えた写真や声のURLは回収できません。');
    } catch (caught) {
      setError(firebaseError(caught));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    setError('');
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      linkInput.current?.select();
      setError('リンクを選択しました。コピーして共有してください。');
    }
  };

  return (
    <div className="overlay share-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialog} className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" tabIndex={-1}>
        <div className="share-dialog-head">
          <div className="share-icon"><Share2 size={21} /></div>
          <div className="share-title-wrap"><h2 id="share-title">ずかんを共有する</h2><p>いつものリンクから最新のずかんを見られます</p></div>
          <button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="閉じる"><X size={19} /></button>
        </div>

        <div className="share-safety-note">
          <LockKeyhole size={18} />
          <p>試作中の共有です。リンクを知っている人はパスワードなしで写真と声を見聞きできます。写真と録音は元のファイルを参照し、内容は最新状態に同期します。個別の写真・声のURLを相手が保存した場合、共有を停止しても回収できません。</p>
        </div>

        <section className="share-created" aria-live="polite">
          <p className="share-count"><Eye size={15} /> 共有状態：{loading ? '確認中…' : enabled ? 'オン' : 'オフ'}</p>
          {url && <>
            <label htmlFor="created-share-url">閲覧専用リンク</label>
            <div className="share-copy-row">
              <input ref={linkInput} id="created-share-url" className="share-url-input" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
              <button type="button" className="share-secondary" onClick={() => void copy()} aria-label="共有リンクをコピー" disabled={loading}>
                {copied ? <Check size={17} /> : <Copy size={17} />}
                {copied ? 'コピー済み' : 'コピー'}
              </button>
            </div>
            <p className="share-hint">リンクは毎回作り直されず、この図鑑で同じものを使います。</p>
          </>}
          <button
            type="button"
            className={enabled ? 'share-danger' : 'share-primary'}
            disabled={loading || busy || !bookId}
            onClick={() => void setSharing(!enabled)}
          >
            {loading ? '図鑑を確認しています…' : busy ? '設定を更新しています…' : enabled ? '共有を停止する' : '共有リンクを有効にする'}
          </button>
        </section>
        {error && <p className="share-error" role="alert">{error}</p>}
        {notice && <p className="share-notice" role="status">{notice}</p>}
      </div>
    </div>
  );
}
