import { useState, type FormEvent } from 'react';
import { BookOpen, Eye, EyeOff, LockKeyhole, Sparkles } from 'lucide-react';
import type { SharedBook, ShareId } from '../lib/shareRepository';
import { openPasswordShare } from '../lib/keepsakeStore';
import { validateSharePassword } from '../lib/shareCrypto';

type Props = {
  token: ShareId | null;
  onUnlocked: (book: SharedBook) => void;
};

export default function SharePasswordGate({ token, onUnlocked }: Props) {
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true); setError('');
    const issue = validateSharePassword(password);
    if (issue) { setError(issue); setBusy(false); return; }
    try {
      onUnlocked(await openPasswordShare(token, password));
      setPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '共有した人に確認してください。');
    } finally { setBusy(false); }
  };

  return <main className="share-gate-main">
    <section className="share-gate-card">
      <div className="share-gate-illustration"><BookOpen size={36} strokeWidth={1.5} /><Sparkles className="share-gate-sparkle" size={17} /></div>
      <p className="share-gate-eyebrow">かぞくから届いた ずかん</p>
      <h2>{token ? 'パスワードを入れてね' : 'この共有リンクを確認できません'}</h2>
      {token ? <>
        <p className="share-gate-copy">リンクを送ってくれた人から聞いた<br />パスワードを入力してください。</p>
        <form className="share-gate-form" onSubmit={(event) => void unlock(event)}>
          <label htmlFor="shared-book-password"><LockKeyhole size={17} /> パスワード</label>
          <div className="share-gate-password-row">
            <input
              id="shared-book-password"
              type={visible ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              disabled={busy}
              minLength={16}
              maxLength={128}
              required
              aria-describedby="share-password-hint"
              placeholder="パスワードを入力"
            />
            <button type="button" className="share-password-toggle" onClick={() => setVisible((value) => !value)} aria-label={visible ? 'パスワードを隠す' : 'パスワードを表示'}>
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <p id="share-password-hint" className="share-gate-hint">パスワードはこの端末に保存しません。</p>
          {error && <p className="share-error" role="alert">{error}</p>}
          <button type="submit" className="share-primary share-gate-submit" disabled={busy || !password}>{busy ? 'ずかんをひらいています…' : 'ずかんをひらく'}</button>
        </form>
        <div className="share-readonly-label"><Eye size={15} /> 閲覧専用です。写真を見たり、声をきいたりできます。</div>
      </> : <p className="share-gate-copy">リンクが途中で切れていないか、もう一度確認してください。</p>}
    </section>
  </main>;
}
