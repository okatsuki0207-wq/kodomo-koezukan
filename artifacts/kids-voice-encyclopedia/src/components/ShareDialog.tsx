import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, Eye, Link2, LockKeyhole, Share2, Trash2, X } from 'lucide-react';
import type { Category } from '../lib/categories';
import type { Keepsake } from '../lib/keepsakeRepository';
import { createLiveShare, firebaseError, listPasswordShares, revokePasswordShare } from '../lib/keepsakeStore';
import { createShareUrl } from '../lib/shareCrypto';
import type { ShareSummary } from '../lib/shareRepository';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  items: readonly Keepsake[];
  categories: readonly Category[];
  onClose: () => void;
};

type LinkState = { ownerUid: string; shareId: string; url: string };

function formatDate(time: number) {
  if (!time) return '作成日時を確認できません';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(time);
}

function userError(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : '';
  if (/^(Firebase|FirebaseError):|\((firestore|storage)\//u.test(message)) return firebaseError(caught);
  return /^[ぁ-んァ-ヶ一-龠]/u.test(message) ? message : fallback;
}

export default function ShareDialog({ items, categories, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [link, setLink] = useState<LinkState | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const linkInput = useRef<HTMLInputElement>(null);
  useDialogFocus(dialog, '[data-testid="button-share-encyclopedia"]', () => { if (!busy) onClose(); });

  const refresh = async () => {
    const values = await listPasswordShares();
    setShares(values);
  };
  useEffect(() => {
    let cancelled = false;
    void listPasswordShares().then((values) => { if (!cancelled) setShares(values); })
      .catch((caught) => { if (!cancelled) setError(userError(caught, '共有一覧を読み込めませんでした。')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    setBusy(true);
    try {
      const created = await createLiveShare(items, categories);
      const url = createShareUrl(created.ownerUid, created.shareId, window.location.href);
      setLink({ ...created, url });
      await refresh();
      setNotice('共有リンクを作りました。リンクを知っている人は、別の端末からも最新のずかんを見られます。');
    } catch (caught) {
      setError(userError(caught, '共有リンクを作れませんでした。'));
    } finally { setBusy(false); }
  };

  const copy = async (share: LinkState, fallbackInput?: HTMLInputElement | null) => {
    setError('');
    try {
      await navigator.clipboard.writeText(share.url);
      setCopiedId(share.shareId);
      window.setTimeout(() => setCopiedId(''), 1800);
    } catch {
      const input = fallbackInput ?? linkInput.current;
      if (input) {
        input.select();
        setError('リンクを選択しました。コピーして共有してください。');
      } else {
        setError('この端末ではコピーできません。共有リンクを長押ししてコピーしてください。');
      }
    }
  };

  const shareLink = (share: ShareSummary): LinkState => {
    const url = createShareUrl(share.ownerUid, share.shareId, window.location.href);
    return { ownerUid: share.ownerUid, shareId: share.shareId, url };
  };

  const revoke = async (shareId: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await revokePasswordShare(shareId);
      setRevokeTarget(null);
      if (link?.shareId === shareId) setLink(null);
      await refresh();
      setNotice('この共有リンクを停止しました。相手が保存した内容や控えた写真・声のURLは回収できません。');
    } catch (caught) {
      setError(userError(caught, '共有を停止できませんでした。'));
      await refresh().catch(() => {});
    } finally { setBusy(false); }
  };

  return (
    <div className="overlay share-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialog} className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" tabIndex={-1}>
        <div className="share-dialog-head">
          <div className="share-icon"><Share2 size={21} /></div>
          <div className="share-title-wrap"><h2 id="share-title">ずかんを共有する</h2><p>リンクから最新のずかんを見られます</p></div>
          <button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="閉じる"><X size={19} /></button>
        </div>

        <div className="share-safety-note">
          <LockKeyhole size={18} />
          <p>試作中の共有です。リンクを知っている人は、パスワードなしで写真と声を見聞きできます。写真・録音ファイルは複製せず元のファイルを参照し、表示内容は最新状態に同期します。相手が控えた写真・声のURLや保存したデータは、共有を止めても回収できません。</p>
        </div>

        {!link && <form className="share-form" onSubmit={(event) => void create(event)}>
          <p className="share-count"><Eye size={15} /> 共有するキロク {items.length}件・声を含む写真と録音</p>
          <button type="submit" className="share-primary" disabled={busy}>{busy ? '共有リンクを準備しています…' : '共有リンクを作る'}</button>
        </form>}

        {link && <section className="share-created" aria-live="polite">
          <p className="share-success"><Check size={17} /> 共有リンクを作りました</p>
          <label htmlFor="created-share-url">共有リンク</label>
          <div className="share-copy-row">
            <input ref={linkInput} id="created-share-url" className="share-url-input" readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="share-secondary" onClick={() => void copy(link)} aria-label="共有リンクをコピー">
              {copiedId === link.shareId ? <Check size={17} /> : <Copy size={17} />}
              {copiedId === link.shareId ? 'コピー済み' : 'コピー'}
            </button>
          </div>
          <p className="share-hint">リンクを知っている人は閲覧できます。家族など、見せたい相手だけに伝えてください。</p>
          <button type="button" className="share-text-button" onClick={() => setLink(null)}>別の共有リンクを作る</button>
        </section>}

        <section className="share-list" aria-labelledby="share-list-heading">
          <h3 id="share-list-heading"><Link2 size={16} /> いまの共有リンク</h3>
          {loading ? <p className="share-muted" role="status">確認しています…</p> : shares.length === 0
            ? <p className="share-muted">まだ共有リンクはありません。</p>
            : shares.map((share) => {
              const current = shareLink(share);
              return <div className={`share-row${share.active ? '' : ' is-inactive'}`} key={share.shareId}>
                <div className="share-row-info">
                  <strong>{share.active ? '共有中' : '停止済み・削除待ち'}</strong>
                  <span>{formatDate(share.createdAt)}</span>
                <input className="share-url-input" readOnly value={current.url} aria-label="共有リンク" onFocus={(event) => event.currentTarget.select()} />
                </div>
                <button type="button" className="share-icon-action" disabled={busy || !share.active} onClick={(event) => void copy(current, event.currentTarget.parentElement?.querySelector('input'))} aria-label="リンクをコピー">
                  {copiedId === share.shareId ? <Check size={17} /> : <Copy size={17} />}
                </button>
                {share.active
                  ? <button type="button" className="share-icon-action danger" disabled={busy} onClick={() => setRevokeTarget(share.shareId)} aria-label="共有を停止"><Trash2 size={17} /></button>
                  : <button type="button" className="share-icon-action danger" disabled={busy} onClick={() => void revoke(share.shareId)} aria-label="共有データの削除を続ける"><Trash2 size={17} /></button>}
              </div>;
            })}
        </section>

        {revokeTarget && <div className="share-revoke-confirm" role="alert">
          <p>このリンクからは開けなくなります。すでに保存された写真・声や、相手が控えた個別URLは回収できません。</p>
          <div><button type="button" className="share-danger" disabled={busy} onClick={() => void revoke(revokeTarget)}>{busy ? '停止しています…' : '共有を停止する'}</button><button type="button" className="share-secondary" disabled={busy} onClick={() => setRevokeTarget(null)}>もどる</button></div>
        </div>}
        {error && <p className="share-error" role="alert">{error}</p>}
        {notice && <p className="share-notice" role="status">{notice}</p>}
      </div>
    </div>
  );
}
