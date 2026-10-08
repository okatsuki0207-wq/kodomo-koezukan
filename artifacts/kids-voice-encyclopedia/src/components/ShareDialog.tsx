import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, Eye, LockKeyhole, Share2, X } from 'lucide-react';
import type { Category } from '../lib/categories';
import type { GallerySettings } from '../lib/gallerySettings';
import type { Keepsake } from '../lib/keepsakeRepository';
import { firebaseError, getOrCreateLiveShare, listPasswordShares, revokePasswordShare } from '../lib/keepsakeStore';
import { ShareOperationError, type ShareOperationStage } from '../lib/shareRepository';
import { createShareUrl } from '../lib/shareCrypto';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Props = {
  items: readonly Keepsake[];
  categories: readonly Category[];
  settings: GallerySettings;
  onClose: () => void;
};

type LinkState = { ownerUid: string; shareId: string; url: string };
type ShareOwnerAndId = Pick<LinkState, 'ownerUid' | 'shareId'>;

function shareLink(share: ShareOwnerAndId): LinkState {
  return {
    ...share,
    url: createShareUrl(share.ownerUid, share.shareId, window.location.href),
  };
}

function userError(caught: unknown, fallback: string) {
  const operation = caught instanceof ShareOperationError ? caught : null;
  const cause = operation?.originalError ?? caught;
  const message = cause instanceof Error ? cause.message : '';
  const name = cause instanceof Error ? cause.name : '';
  const code = typeof cause === 'object' && cause !== null && 'code' in cause
    && typeof cause.code === 'string' ? cause.code : '';
  const isFirebaseError = name === 'FirebaseError' || /^(firestore|storage|auth)\//u.test(code)
    || /^(Firebase|FirebaseError):|\((firestore|storage)\//u.test(message);

  if (operation) {
    console.error('Live share operation failed', { stage: operation.stage, code, name });
    if (code.includes('permission-denied') || code.includes('unauthorized')) {
      return permissionError(operation.stage);
    }
    if (code.includes('unauthenticated') || code.includes('operation-not-allowed')
      || code.includes('configuration-not-found')) {
      return 'Firebaseの匿名ログインが使えません。Firebase ConsoleでAuthenticationの「匿名」を有効にしてから、もう一度お試しください。';
    }
    if (code.includes('network') || code.includes('unavailable') || code.includes('deadline-exceeded')) {
      return 'Firebaseに接続できませんでした。通信を確認して、もう一度お試しください。';
    }
    if (isFirebaseError) return stageError(operation.stage);
    if (/^[ぁ-んァ-ヶ一-龠]/u.test(message)) return message;
    return stageError(operation.stage);
  }

  if (isFirebaseError) return firebaseError(cause);
  return /^[ぁ-んァ-ヶ一-龠]/u.test(message) ? message : fallback;
}

function permissionError(stage: ShareOperationStage) {
  if (stage === 'lookup') {
    return '共有リンクの読み取りがFirestoreに拒否されました。Firebase Consoleで最新のFirestoreルールを公開してから、もう一度お試しください。';
  }
  if (stage === 'create') {
    return '共有リンクの登録がFirestoreに拒否されました。Firebase Consoleで最新のFirestoreルールを公開し、匿名ログインが有効か確認してください。';
  }
  return '共有カード情報の保存がFirestoreに拒否されました。Firebase Consoleで最新のFirestoreルールを公開してから、もう一度お試しください。';
}

function stageError(stage: ShareOperationStage) {
  if (stage === 'lookup') return '共有リンクを確認できませんでした。通信とFirebaseの設定を確認して、もう一度お試しください。';
  if (stage === 'create') return 'Firebaseに共有リンクを登録できませんでした。Firestoreの設定を確認して、もう一度お試しください。';
  return '共有するカード情報をFirebaseに保存できませんでした。Firestoreの設定を確認して、もう一度お試しください。';
}

export default function ShareDialog({ items, categories, settings, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<LinkState | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const linkInput = useRef<HTMLInputElement>(null);
  useDialogFocus(dialog, '[data-testid="button-share-encyclopedia"]', () => { if (!busy) onClose(); });

  useEffect(() => {
    let cancelled = false;
    void listPasswordShares().then((values) => {
      if (cancelled) return;
      const existing = values.find((share) => share.active && share.mode === 'live');
      if (existing) setLink(shareLink(existing));
    })
      .catch((caught) => {
        if (!cancelled) {
          setLookupFailed(true);
          setError(userError(caught, '共有リンクを確認できませんでした。通信を確認してもう一度お試しください。'));
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    setBusy(true);
    try {
      const ready = await getOrCreateLiveShare(items, categories, settings);
      setLink(shareLink(ready));
      setNotice('この共有リンクを、別の端末から最新のずかんを見るときに使えます。');
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

  const revoke = async (shareId: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await revokePasswordShare(shareId);
      setRevokeTarget(null);
      if (link?.shareId === shareId) setLink(null);
      setNotice('この共有リンクを停止しました。相手が保存した内容や控えた写真・声のURLは回収できません。');
    } catch (caught) {
      setError(userError(caught, '共有を停止できませんでした。'));
    } finally { setBusy(false); }
  };

  const retryLookup = () => {
    if (busy || loading) return;
    setLoading(true);
    setLookupFailed(false);
    setError('');
    void listPasswordShares().then((values) => {
      const existing = values.find((share) => share.active && share.mode === 'live');
      setLink(existing ? shareLink(existing) : null);
    }).catch((caught) => {
      setLookupFailed(true);
      setError(userError(caught, '共有リンクを確認できませんでした。通信を確認してもう一度お試しください。'));
    }).finally(() => setLoading(false));
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
          <button type="submit" className="share-primary" disabled={busy || loading || lookupFailed}>
            {loading ? '共有リンクを確認しています…' : busy ? '共有リンクを準備しています…' : '共有リンクを表示する'}
          </button>
        </form>}

        {link && <section className="share-created" aria-live="polite">
          <p className="share-success"><Check size={17} /> いつもの共有リンク</p>
          <label htmlFor="created-share-url">共有リンク</label>
          <div className="share-copy-row">
            <input ref={linkInput} id="created-share-url" className="share-url-input" readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="share-secondary" onClick={() => void copy(link)} aria-label="共有リンクをコピー">
              {copiedId === link.shareId ? <Check size={17} /> : <Copy size={17} />}
              {copiedId === link.shareId ? 'コピー済み' : 'コピー'}
            </button>
          </div>
          <p className="share-hint">リンクを知っている人は閲覧できます。家族など、見せたい相手だけに伝えてください。</p>
          <button type="button" className="share-text-button" disabled={busy} onClick={() => setRevokeTarget(link.shareId)}>この共有リンクを停止する</button>
        </section>}

        {revokeTarget && <div className="share-revoke-confirm" role="alert">
          <p>このリンクからは開けなくなります。すでに保存された写真・声や、相手が控えた個別URLは回収できません。</p>
          <div><button type="button" className="share-danger" disabled={busy} onClick={() => void revoke(revokeTarget)}>{busy ? '停止しています…' : '共有を停止する'}</button><button type="button" className="share-secondary" disabled={busy} onClick={() => setRevokeTarget(null)}>もどる</button></div>
        </div>}
        {lookupFailed && <button type="button" className="share-text-button" disabled={loading || busy} onClick={retryLookup}>共有リンクを再確認する</button>}
        {error && <p className="share-error" role="alert">{error}</p>}
        {notice && <p className="share-notice" role="status">{notice}</p>}
      </div>
    </div>
  );
}
