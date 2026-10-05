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
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import PhotoEditor from './components/PhotoEditor';
import './index.css';

type Keepsake = {
  id: string;
  itemName: string;
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
    return Array.isArray(parsed)
      ? parsed.flatMap((item): Keepsake[] => {
          const itemName = typeof item?.itemName === 'string' ? item.itemName : item?.title;
          if (typeof item?.id !== 'string' || typeof itemName !== 'string') return [];
          return [{
            id: item.id,
            itemName,
            photo: typeof item.photo === 'string' ? item.photo : '',
            voice: typeof item.voice === 'string' ? item.voice : null,
            createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          }];
        })
      : [];
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
  const [itemName, setItemName] = useState('');
  const [photo, setPhoto] = useState('');
  const [photoEditorSource, setPhotoEditorSource] = useState('');
  const [voice, setVoice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [permissionError, setPermissionError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [storageIssue, setStorageIssue] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const audioParts = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const activePlaybackId = useRef<string | null>(null);
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

  useEffect(() => () => {
    if (photoEditorSource.startsWith('blob:')) URL.revokeObjectURL(photoEditorSource);
  }, [photoEditorSource]);

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

  const stopPlayback = () => {
    player.current?.pause();
    player.current = null;
    activePlaybackId.current = null;
    setPlaying(false);
    setPlayingItemId(null);
  };

  const playAudio = async (source: string, playbackId: string) => {
    if (
      activePlaybackId.current === playbackId &&
      player.current &&
      !player.current.paused
    ) {
      stopPlayback();
      return;
    }

    player.current?.pause();
    const audio = new Audio(source);
    player.current = audio;
    activePlaybackId.current = playbackId;
    setPlayingItemId(playbackId === 'voice-preview' ? null : playbackId);
    setPlaying(false);
    audio.onended = () => {
      if (player.current === audio) stopPlayback();
    };
    audio.onerror = () => {
      if (player.current === audio) stopPlayback();
      setError('録音を再生できませんでした。');
    };
    try {
      await audio.play();
      if (player.current === audio) setPlaying(true);
    } catch {
      if (player.current === audio) stopPlayback();
      setError('録音を再生できませんでした。');
    }
  };

  const openDetail = (item: Keepsake) => {
    stopPlayback();
    setDetail(item);
    setConfirmDelete(false);
  };

  const playKeepsake = (item: Keepsake) => {
    if (!item.voice) {
      openDetail(item);
      return;
    }
    setError('');
    void playAudio(item.voice, item.id);
  };

  const openCreate = () => {
    setItemName('');
    setPhoto('');
    setPhotoEditorSource('');
    setVoice(null);
    setError('');
    setNotice('');
    setPermissionError('');
    setRecordSeconds(0);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (recording) stopRecording();
    stopPlayback();
    setCreateOpen(false);
    setPhotoEditorSource('');
    setError('');
  };

  const onPhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    if (!file.type.startsWith('image/')) {
      setError('写真を選んでください。');
      return;
    }
    try {
      // Keep the original file as a temporary URL, not a large base64 copy.
      setPhotoEditorSource(URL.createObjectURL(file));
      setError('');
      setNotice('');
    } catch {
      setError('写真を読み込めませんでした。別の写真を選んでください。');
    }
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
    void playAudio(voice, 'voice-preview');
  };

  const saveCard = () => {
    const cleanItemName = itemName.trim();
    if (!cleanItemName) {
      setError('図鑑に登録するモノの名前を入力してください。');
      return;
    }
    if (!photo) {
      setError('写真を選んでください。');
      return;
    }
    const next = [{ id: crypto.randomUUID?.() ?? `${Date.now()}`, itemName: cleanItemName, photo, voice, createdAt: Date.now() }, ...items];
    if (persist(next)) {
      setCreateOpen(false);
      setItemName('');
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
    void playAudio(detail.voice, detail.id);
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
            <h1 className="headline">すきなモノを、<br /><em>声ごと</em>のこそう。</h1>
            <p className="intro-note">りんごも、ライオンも、赤バスも。<br />見つけたものを声と一緒に記録しよう。</p>
          </div>
          <button type="button" className="add-button" onClick={openCreate} data-testid="button-create-card"><Plus size={19} /> 新しいカードをつくる</button>
        </section>

        <div className="section-top">
          <h2 className="section-label"><Sparkles size={17} /> わが家のずかん</h2>
          <span className="section-hint">写真で声をきく・名前で大きく見る</span>
        </div>

        {storageIssue && <div className="notice" role="alert" data-testid="status-storage-error"><AlertCircle size={16} />この端末の保存データを読み込めませんでした。ブラウザの保存領域をご確認ください。</div>}

        {items.length === 0 ? (
          <section className="empty-state" data-testid="empty-keepsakes">
            <div className="empty-illustration"><BookOpen size={46} strokeWidth={1.35} /></div>
            <h2 className="empty-title">まだ、まっさらなページ</h2>
            <p className="empty-copy">いちばん最初の一枚をつくってみよう。<br />登録するモノの写真と声を残せます。</p>
            <button type="button" className="empty-action" onClick={openCreate} data-testid="button-empty-create">はじめのカードをつくる</button>
          </section>
        ) : (
          <section className="sticker-collage" aria-label="保存した図鑑のシール" data-testid="grid-keepsakes">
            {items.map((item, index) => (
              <article key={item.id} className="sticker-item" style={{ animationDelay: `${Math.min(index, 12) * 70}ms` }} data-testid={`card-keepsake-${item.id}`}>
                <button
                  type="button"
                  className="sticker-photo-button"
                  onClick={() => playKeepsake(item)}
                  aria-label={item.voice ? `${item.itemName}の声を再生` : `${item.itemName}の写真をひらく`}
                  data-testid={`button-play-card-${item.id}`}
                >
                  {item.photo
                    ? <img className="sticker-photo" src={item.photo} alt={`${item.itemName}の写真`} data-testid={`img-sticker-${item.id}`} />
                    : <ImageIcon size={44} />}
                </button>
                <button type="button" className="sticker-name" onClick={() => openDetail(item)} aria-label={`${item.itemName}の写真を大きく表示`} data-testid={`button-detail-${item.id}`}>
                  {item.itemName}
                </button>
                <span className="sr-only" role="status">{playing && playingItemId === item.id ? `${item.itemName}の声を再生中` : ''}</span>
              </article>
            ))}
          </section>
        )}

        <footer className="footer-note"><Sparkles size={14} /> 写真と声は、この端末のブラウザにだけ保存されます</footer>
      </main>

      {createOpen && !photoEditorSource && (
        <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreate(); }}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <div className="dialog-head">
              <div><h2 id="create-title" className="dialog-title">新しいページをつくる</h2><p className="dialog-lede">図鑑に登録するモノの写真と声を残します。</p></div>
              <button type="button" className="icon-button" onClick={closeCreate} aria-label="閉じる" data-testid="button-close-create"><X size={19} /></button>
            </div>
            <div className="form-block">
              <label className="field-label" htmlFor="keepsake-item-name">モノの名前</label>
              <p className="field-hint">図鑑に登録するものの名前を入力してください。</p>
              <input id="keepsake-item-name" className="title-input" value={itemName} onChange={(event) => setItemName(event.currentTarget.value)} placeholder="りんご、ライオン、赤バス など" maxLength={48} data-testid="input-item-name" />
            </div>
            <div className="form-block">
              <span className="field-label">写真</span>
              <input ref={photoInput} className="sr-only" type="file" accept="image/*" onChange={onPhotoChange} aria-label="写真を選ぶ" data-testid="input-card-photo" />
              <button type="button" className="photo-picker" onClick={() => photoInput.current?.click()} data-testid="button-select-photo">
                {photo && <img src={photo} alt="選んだ写真" />}
                <span className="picker-content">
                  {photo ? <Check size={22} /> : <Camera size={23} />}
                  <strong>{photo ? '写真をえらびなおす' : '写真をえらぶ・撮る'}</strong>
                  <span>写真ライブラリから選ぶか、カメラで撮影できます</span>
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

      {photoEditorSource && (
        <PhotoEditor
          source={photoEditorSource}
          onCancel={() => setPhotoEditorSource('')}
          onApply={(processedPhoto) => {
            setPhoto(processedPhoto);
            setPhotoEditorSource('');
            setError('');
            setNotice('加工した写真をカードに設定しました。');
          }}
        />
      )}

      {detail && (
        <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { stopPlayback(); setDetail(null); } }}>
          <section className="dialog dialog-detail" role="dialog" aria-modal="true" aria-label={`${detail.itemName}のページ`}>
            <button type="button" className="icon-button" style={{ position: 'absolute', zIndex: 2, right: 25, top: 25 }} onClick={() => { stopPlayback(); setDetail(null); }} aria-label="閉じる" data-testid="button-close-detail"><X size={19} /></button>
            {detail.photo ? <img className="detail-image" src={detail.photo} alt={`${detail.itemName}の写真`} /> : <div className="detail-image-placeholder"><ImageIcon size={54} /></div>}
            <div className="detail-meta">
              <div><h2 className="detail-name">{detail.itemName}</h2><p className="detail-date">{formatDate(detail.createdAt)} にしまいました</p>{!detail.voice && <p className="detail-date">このページには、まだ声がありません</p>}</div>
              <div className="detail-actions">
                {detail.voice && <button type="button" className="record-button primary" onClick={playDetailVoice} data-testid="button-play-detail-voice">{playing && playingItemId === detail.id ? <Pause size={16} /> : <Play size={16} />}{playing && playingItemId === detail.id ? 'とめる' : '声をきく'}</button>}
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
