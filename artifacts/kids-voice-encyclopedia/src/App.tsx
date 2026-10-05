import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Camera,
  Check,
  CircleHelp,
  Image as ImageIcon,
  Mic,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import './index.css';

type Keepsake = {
  id: string;
  title: string;
  photo: string;
  voice: string | null;
  createdAt: number;
};

const STORAGE_KEY = 'koe-no-zukan-keepsakes-v1';

function readKeepsakes(): Keepsake[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) =>
      item && typeof item.id === 'string' && typeof item.title === 'string',
    ) : [];
  } catch {
    return [];
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('画像を読み込めませんでした'));
    reader.onerror = () => reject(new Error('画像を読み込めませんでした'));
    reader.readAsDataURL(file);
  });
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(timestamp);
}

function App() {
  const [items, setItems] = useState<Keepsake[]>(readKeepsakes);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Keepsake | null>(null);
  const [title, setTitle] = useState('');
  const [photo, setPhoto] = useState('');
  const [voice, setVoice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [permissionError, setPermissionError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [storageIssue, setStorageIssue] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const audioParts = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) JSON.parse(raw);
    } catch {
      setStorageIssue(true);
    }
  }, []);

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
    mediaStream.current?.getTracks().forEach((track) => track.stop());
    player.current?.pause();
  }, []);

  const persist = useCallback((next: Keepsake[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setItems(next);
      setStorageIssue(false);
      return true;
    } catch {
      setStorageIssue(true);
      setError('保存できる容量が足りません。写真や録音を短くするか、カードを整理してください。');
      return false;
    }
  }, []);

  const openCreate = () => {
    setTitle('');
    setPhoto('');
    setVoice(null);
    setError('');
    setNotice('');
    setPermissionError('');
    setRecordSeconds(0);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (recording) stopRecording();
    setCreateOpen(false);
    setError('');
  };

  const onPhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('写真を選んでください。');
      return;
    }
    try {
      setPhoto(await fileToDataUrl(file));
      setError('');
      setNotice('');
    } catch {
      setError('写真を読み込めませんでした。別の写真を選んでください。');
    }
    event.currentTarget.value = '';
  };

  const startRecording = async () => {
    setPermissionError('');
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setPermissionError('このブラウザでは録音できません。写真と名前を保存して、別のブラウザで声を追加できます。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStream.current = stream;
      const recorder = new MediaRecorder(stream);
      audioParts.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioParts.current.push(event.data);
      };
      recorder.onstop = async () => {
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioParts.current, { type });
        try {
          if (blob.size > 0) {
            setVoice(await fileToDataUrl(new File([blob], 'voice-recording', { type })));
            setNotice('録音を聞いてみてください。気に入らなければ、もう一度録音できます。');
          }
        } catch {
          setError('録音を読み込めませんでした。もう一度お試しください。');
        }
        stream.getTracks().forEach((track) => track.stop());
        mediaStream.current = null;
      };
      mediaRecorder.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      timer.current = window.setInterval(() => setRecordSeconds((seconds) => seconds + 1), 1000);
    } catch (caught) {
      const denied = caught instanceof DOMException && (caught.name === 'NotAllowedError' || caught.name === 'PermissionDeniedError');
      setPermissionError(denied
        ? 'マイクが使えませんでした。端末の設定でマイクを許可すると録音できます。'
        : 'マイクにつながりませんでした。もう一度お試しください。');
    }
  };

  const stopRecording = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
    mediaRecorder.current = null;
    setRecording(false);
  };

  const togglePreview = () => {
    if (!voice) return;
    if (player.current && !player.current.paused) {
      player.current.pause();
      setPlaying(false);
      return;
    }
    const audio = new Audio(voice);
    player.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => {
      setPlaying(false);
      setError('録音を再生できませんでした。');
    };
    audio.play().then(() => setPlaying(true)).catch(() => setError('録音を再生できませんでした。'));
  };

  const saveCard = () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('名前やタイトルを入力してください。');
      return;
    }
    if (!photo) {
      setError('写真を選んでください。');
      return;
    }
    const next = [{ id: crypto.randomUUID?.() ?? `${Date.now()}`, title: cleanTitle, photo, voice, createdAt: Date.now() }, ...items];
    if (persist(next)) {
      setCreateOpen(false);
      setTitle('');
      setPhoto('');
      setVoice(null);
      setError('');
    }
  };

  const deleteCard = () => {
    if (!detail) return;
    const next = items.filter((item) => item.id !== detail.id);
    if (persist(next)) {
      setDetail(null);
      setConfirmDelete(false);
    }
  };

  const playDetailVoice = () => {
    if (!detail?.voice) return;
    if (player.current && !player.current.paused) {
      player.current.pause();
      setPlaying(false);
      return;
    }
    const audio = new Audio(detail.voice);
    player.current = audio;
    audio.onended = () => setPlaying(false);
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="こえのずかん ホーム">
          <span className="brand-mark"><BookOpen size={23} strokeWidth={1.8} /></span>
          <span><span className="brand-title">こえのずかん</span><span className="brand-sub">ちいさな声の、たからもの</span></span>
        </a>
        <div className="saved-count" data-testid="text-saved-count">しまってある声 <b className="count-number">{items.length}</b> こ</div>
      </header>

      <main className="page-main">
        <section className="intro">
          <div>
            <p className="eyebrow">かぞくの ちいさな ずかん</p>
            <h1 className="headline">いまのあなたを、<br /><em>声ごと</em>のこそう。</h1>
            <p className="intro-note">名前と写真と、今日の声。<br />家族だけの小さな図鑑をつくろう。</p>
          </div>
          <button type="button" className="add-button" onClick={openCreate} data-testid="button-create-card"><Plus size={19} /> 新しいカードをつくる</button>
        </section>

        <div className="section-top">
          <h2 className="section-label"><Sparkles size={17} /> わが家のずかん</h2>
          <span className="section-hint">写真をひらくと、声が聞けます</span>
        </div>

        {storageIssue && <div className="notice" role="alert" data-testid="status-storage-error"><AlertCircle size={16} />この端末の保存データを読み込めませんでした。ブラウザの保存領域をご確認ください。</div>}

        {items.length === 0 ? (
          <section className="empty-state" data-testid="empty-keepsakes">
            <div className="empty-illustration"><BookOpen size={46} strokeWidth={1.35} /></div>
            <h2 className="empty-title">まだ、まっさらなページ</h2>
            <p className="empty-copy">いちばん最初の一枚をつくってみよう。<br />写真と声は、この端末の中だけにしまわれます。</p>
            <button type="button" className="empty-action" onClick={openCreate} data-testid="button-empty-create">はじめのカードをつくる</button>
          </section>
        ) : (
          <section className="card-grid" aria-label="保存したカード" data-testid="grid-keepsakes">
            {items.map((item, index) => (
              <article key={item.id} className="memory-card" style={{ animationDelay: `${index * 70}ms` }} data-testid={`card-keepsake-${item.id}`}>
                <button type="button" className="photo-frame" onClick={() => { setDetail(item); setPlaying(false); setConfirmDelete(false); }} aria-label={`${item.title}の写真と声をひらく`} data-testid={`button-open-card-${item.id}`}>
                  {item.photo ? <img src={item.photo} alt={`${item.title}の写真`} /> : <span className="photo-empty"><ImageIcon size={44} /></span>}
                  {item.voice && <span className="recorded-stamp" aria-label="声の録音あり"><Radio size={17} /></span>}
                </button>
                <div className="card-copy">
                  <div><h3 className="card-title">{item.title}</h3><p className="card-date">{formatDate(item.createdAt)}</p></div>
                  <button type="button" className="listen-chip" onClick={() => { setDetail(item); setPlaying(false); setConfirmDelete(false); }} aria-label={`${item.title}をひらく`} data-testid={`button-detail-${item.id}`}>
                    {item.voice ? <><Play size={14} /> 声をきく</> : <><ImageIcon size={14} /> ひらく</>}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}

        <footer className="footer-note"><Sparkles size={14} /> 写真と声は、この端末のブラウザにだけ保存されます</footer>
      </main>

      {createOpen && (
        <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreate(); }}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <div className="dialog-head">
              <div><h2 id="create-title" className="dialog-title">新しいページをつくる</h2><p className="dialog-lede">今日のその子らしさを、ひとつずつ。</p></div>
              <button type="button" className="icon-button" onClick={closeCreate} aria-label="閉じる" data-testid="button-close-create"><X size={19} /></button>
            </div>
            <div className="form-block">
              <label className="field-label" htmlFor="keepsake-title">名前・タイトル</label>
              <input id="keepsake-title" className="title-input" value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="たとえば「はじめての、こんにちは」" maxLength={48} data-testid="input-card-title" />
            </div>
            <div className="form-block">
              <span className="field-label">写真</span>
              <input ref={photoInput} className="sr-only" type="file" accept="image/*" capture="environment" onChange={onPhotoChange} aria-label="写真を選ぶ" data-testid="input-card-photo" />
              <button type="button" className="photo-picker" onClick={() => photoInput.current?.click()} data-testid="button-select-photo">
                {photo && <img src={photo} alt="選んだ写真" />}
                <span className="picker-content">
                  {photo ? <Check size={22} /> : <Camera size={23} />}
                  <strong>{photo ? '写真をえらびなおす' : '写真をえらぶ・撮る'}</strong>
                  <span>カメラまたは写真ライブラリから</span>
                </span>
              </button>
            </div>
            <div className="form-block">
              <div className="record-panel">
                <div className="record-top">
                  <div className="record-title"><Mic size={16} /> 声をのこす <span className="record-status">{recording ? `録音中 ${formatTime(recordSeconds)}` : voice ? '録音できました' : 'あとからでも大丈夫'}</span></div>
                  {recording && <div className="recording-wave" aria-label="録音中"><i /><i /><i /><i /><i /><i /><i /></div>}
                </div>
                <div className="record-actions">
                  {recording ? (
                    <button type="button" className="record-button danger" onClick={stopRecording} data-testid="button-stop-recording"><span className="recording-dot" /> 録音をとめる</button>
                  ) : (
                    <button type="button" className="record-button primary" onClick={startRecording} data-testid="button-start-recording"><Mic size={15} /> {voice ? 'もう一度録音' : '録音する'}</button>
                  )}
                  {voice && !recording && <>
                    <button type="button" className="record-button" onClick={togglePreview} data-testid="button-preview-recording">{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? '一時停止' : '聞いてみる'}</button>
                    <button type="button" className="record-button" onClick={() => { setVoice(null); setNotice('録音を消しました。'); }} aria-label="録音を消す" data-testid="button-remove-recording"><RotateCcw size={15} /></button>
                  </>}
                </div>
              </div>
              {permissionError && <div className="notice" role="status" data-testid="status-microphone">{<CircleHelp size={16} />}{permissionError}</div>}
              {notice && !permissionError && <div className="notice neutral" role="status"><Check size={15} />{notice}</div>}
              {(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') && <div className="notice" role="status" data-testid="status-unsupported-browser"><CircleHelp size={16} />このブラウザでは録音できません。録音以外のカード機能はお使いいただけます。</div>}
              {recording && <p className="sr-only" aria-live="polite">録音中です。録音時間 {formatTime(recordSeconds)}</p>}
            </div>
            {error && <p className="form-error" role="alert" data-testid="status-form-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="cancel-button" onClick={closeCreate} data-testid="button-cancel-create">あとで</button>
              <button type="button" className="save-button" onClick={saveCard} disabled={recording} data-testid="button-save-card"><Check size={16} /> このページをしまう</button>
            </div>
          </section>
        </div>
      )}

      {detail && (
        <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { player.current?.pause(); setPlaying(false); setDetail(null); } }}>
          <section className="dialog dialog-detail" role="dialog" aria-modal="true" aria-label={`${detail.title}のページ`}>
            <button type="button" className="icon-button" style={{ position: 'absolute', zIndex: 2, right: 25, top: 25 }} onClick={() => { player.current?.pause(); setPlaying(false); setDetail(null); }} aria-label="閉じる" data-testid="button-close-detail"><X size={19} /></button>
            {detail.photo ? <img className="detail-image" src={detail.photo} alt={`${detail.title}の写真`} /> : <div className="detail-image-placeholder"><ImageIcon size={54} /></div>}
            <div className="detail-meta">
              <div><h2 className="detail-name">{detail.title}</h2><p className="detail-date">{formatDate(detail.createdAt)} にしまいました</p>{!detail.voice && <p className="detail-date">このページには、まだ声がありません</p>}</div>
              <div className="detail-actions">
                {detail.voice && <button type="button" className="record-button primary" onClick={playDetailVoice} data-testid="button-play-detail-voice">{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? 'とめる' : '声をきく'}</button>}
                <button type="button" className="plain-action" onClick={() => setConfirmDelete((value) => !value)} aria-label="このカードを削除" data-testid="button-delete-card"><Trash2 size={17} /></button>
              </div>
            </div>
            {confirmDelete && <div className="delete-confirm" role="alert"><AlertCircle size={16} />このページを削除しますか？<button type="button" onClick={deleteCard} data-testid="button-confirm-delete">削除する</button><button type="button" onClick={() => setConfirmDelete(false)} data-testid="button-cancel-delete">やめる</button></div>}
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
