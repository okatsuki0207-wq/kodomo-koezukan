import { useEffect, useRef, useState } from 'react';
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
import { deleteKeepsake, firebaseError, saveKeepsake, subscribeKeepsakes, type Keepsake } from './lib/keepsakeStore';
import { readLegacyKeepsakes } from './lib/legacyImport';
import { trimLeadingSilence } from './lib/audioTrim';
import { isFirebaseConfigured } from './firebaseConfig';
import './index.css';

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(timestamp);
}

function App() {
  const [items, setItems] = useState<Keepsake[]>([]);
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
  const [storageIssue, setStorageIssue] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [processingVoice, setProcessingVoice] = useState(false);
  const [legacyItems, setLegacyItems] = useState<Keepsake[]>([]);
  const [migrationNotice, setMigrationNotice] = useState('');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const recordingSession = useRef(0);
  const pendingId = useRef<string | null>(null);
  const mutationLock = useRef(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const activePlaybackId = useRef<string | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try { setLegacyItems(readLegacyKeepsakes()); }
    catch (caught) { setMigrationNotice(firebaseError(caught)); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    setStorageIssue('');
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setStorageIssue('Firebaseからの応答がありません。通信と設定を確認し、再接続してください。');
      }
    }, 20_000);
    const fail = (caught: unknown) => {
      window.clearTimeout(timer);
      if (!cancelled) { setStorageIssue(firebaseError(caught)); setLoading(false); }
    };
    void subscribeKeepsakes((next) => {
      window.clearTimeout(timer);
      if (!cancelled) { setItems(next); setLoading(false); setStorageIssue(''); }
    }, fail).then((stop) => { if (cancelled) stop(); else unsubscribe = stop; }).catch(fail);
    return () => { cancelled = true; window.clearTimeout(timer); unsubscribe?.(); };
  }, [connectionAttempt]);

  useEffect(() => () => {
    recordingSession.current++;
    if (timer.current) window.clearInterval(timer.current);
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
    mediaStream.current?.getTracks().forEach((track) => track.stop());
    player.current?.pause();
  }, []);

  useEffect(() => () => {
    if (photoEditorSource.startsWith('blob:')) URL.revokeObjectURL(photoEditorSource);
  }, [photoEditorSource]);

  useEffect(() => () => {
    if (voice?.startsWith('blob:')) URL.revokeObjectURL(voice);
  }, [voice]);

  const importLegacy = async () => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setMigrationNotice('旧データをFirebaseへ移しています…');
    try {
      for (const item of legacyItems) {
        await saveKeepsake(item, true);
        setLegacyItems((remaining) => remaining.filter((entry) => entry.id !== item.id));
      }
      setMigrationNotice('移行が完了しました。元の端末内データは削除していません。');
    } catch (caught) {
      setMigrationNotice(`移行を中断しました。完了分は保存済みです。再実行できます。${firebaseError(caught)}`);
    } finally { mutationLock.current = false; setBusy(false); }
  };

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
    setError('');
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
    if (busy) return;
    pendingId.current = null;
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
    if (busy) return;
    recordingSession.current++;
    if (recording) stopRecording();
    setProcessingVoice(false);
    setVoice(null);
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
    if (processingVoice || busy || recording) return;
    const session = ++recordingSession.current;
    setProcessingVoice(true);
    setPermissionError('');
    setError('');
    setNotice('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setPermissionError('このブラウザでは録音できません。写真と名前を保存して、別のブラウザで声を追加できます。');
      setProcessingVoice(false);
      return;
    }
    let acquiredStream: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      acquiredStream = stream;
      if (session !== recordingSession.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      mediaStream.current = stream;
      const recorder = new MediaRecorder(stream);
      const parts: Blob[] = [];
      stopPlayback();
      setVoice(null);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) parts.push(event.data);
      };
      recorder.onerror = () => {
        if (session !== recordingSession.current) return;
        recordingSession.current++;
        if (timer.current) window.clearInterval(timer.current);
        timer.current = null;
        if (recorder.state === 'recording') recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
        if (mediaStream.current === stream) mediaStream.current = null;
        mediaRecorder.current = null;
        setRecording(false);
        setProcessingVoice(false);
        setError('録音に失敗しました。もう一度お試しください。');
      };
      recorder.onstop = async () => {
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(parts, { type });
        // マイクは解析を待たず、録音終了直後に解放。
        stream.getTracks().forEach((track) => track.stop());
        if (mediaStream.current === stream) mediaStream.current = null;
        if (session !== recordingSession.current) return;
        setProcessingVoice(true);
        try {
          if (!blob.size) throw new Error('録音が空でした。もう一度録音してください。');
          const trimmed = await trimLeadingSilence(blob);
          if (session === recordingSession.current) {
            setVoice(URL.createObjectURL(trimmed));
            setNotice('冒頭の無音をカットしました。録音を聞いてみてください。');
          }
        } catch (caught) {
          if (session === recordingSession.current) setError(caught instanceof Error
            ? `音声の処理に失敗しました。${caught.message}`
            : '録音を処理できませんでした。もう一度お試しください。');
        } finally {
          if (session === recordingSession.current) setProcessingVoice(false);
        }
      };
      mediaRecorder.current = recorder;
      recorder.start();
      setProcessingVoice(false);
      setRecording(true);
      setRecordSeconds(0);
      let elapsed = 0;
      timer.current = window.setInterval(() => {
        elapsed++;
        setRecordSeconds(elapsed);
        if (elapsed >= 60) stopRecording();
      }, 1000);
    } catch (caught) {
      acquiredStream?.getTracks().forEach((track) => track.stop());
      if (mediaStream.current === acquiredStream) mediaStream.current = null;
      if (session !== recordingSession.current) return;
      setProcessingVoice(false);
      const denied = caught instanceof DOMException && (caught.name === 'NotAllowedError' || caught.name === 'PermissionDeniedError');
      setPermissionError(denied
        ? 'マイクが使えませんでした。端末の設定でマイクを許可すると録音できます。'
        : 'マイクにつながりませんでした。もう一度お試しください。');
    }
  };

  const stopRecording = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (mediaRecorder.current?.state === 'recording') {
      setProcessingVoice(true);
      mediaRecorder.current.stop();
    }
    mediaRecorder.current = null;
    setRecording(false);
  };

  const togglePreview = () => {
    if (!voice) return;
    void playAudio(voice, 'voice-preview');
  };

  const saveCard = async () => {
    if (mutationLock.current || recording || processingVoice) return;
    const cleanItemName = itemName.trim();
    if (!cleanItemName) {
      setError('図鑑に登録するモノの名前を入力してください。');
      return;
    }
    if (!photo) {
      setError('写真を選んでください。');
      return;
    }
    mutationLock.current = true;
    setBusy(true);
    setError('');
    pendingId.current ??= crypto.randomUUID();
    try {
      await saveKeepsake({ id: pendingId.current, itemName: cleanItemName, photo, voice, createdAt: Date.now() });
      setCreateOpen(false);
      setItemName('');
      setPhoto('');
      setVoice(null);
      setError('');
      pendingId.current = null;
    } catch (caught) { setError(firebaseError(caught)); }
    finally { mutationLock.current = false; setBusy(false); }
  };

  const deleteCard = async () => {
    if (!detail || mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError('');
    try {
      await deleteKeepsake(detail);
      stopPlayback();
      setDetail(null);
      setConfirmDelete(false);
    } catch (caught) { setError(firebaseError(caught)); }
    finally { mutationLock.current = false; setBusy(false); }
  };

  const playDetailVoice = () => {
    if (!detail?.voice) return;
    void playAudio(detail.voice, detail.id);
  };

  const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="こどもの こえずかん ホーム">
          <span className="brand-mark"><BookOpen size={23} strokeWidth={1.8} /></span>
          <span><span className="brand-title">こどもの こえずかん</span><span className="brand-sub">声で集める 世界にひとつのたからもの図鑑</span></span>
        </a>
        <div className="saved-count" data-testid="text-saved-count">しまってある声 <b className="count-number">{items.length}</b> こ</div>
      </header>

      <main className="page-main">
        <section className="intro">
          <div>
            <h1 className="headline">こどもの こえずかん</h1>
            <p className="subtitle"><span>声で集める</span>{' '}<span>世界にひとつのたからもの図鑑</span></p>
            <p className="intro-note">大好きなもの、とっておきのもの<br />見つけたものを声といっしょにキロクしよう</p>
          </div>
          <button type="button" className="add-button" onClick={openCreate} data-testid="button-create-card"><Plus size={19} /> 新しいカードをつくる</button>
        </section>

        <div className="section-top">
          <h2 className="section-label"><Sparkles size={17} /> わが家のずかん</h2>
          <span className="section-hint">写真で声をきく・名前で大きく見る</span>
        </div>

        {storageIssue && <div className="notice" role="alert" data-testid="status-storage-error"><AlertCircle size={16} />{storageIssue}
          {isFirebaseConfigured && <button type="button" className="record-button" onClick={() => setConnectionAttempt((value) => value + 1)} disabled={busy}>再接続</button>}
        </div>}
        {legacyItems.length > 0 && <div className="notice neutral" role="status">旧データが{legacyItems.length}件あります。元データを残して移行できます。
          <button type="button" className="record-button" onClick={importLegacy} disabled={busy || loading || !!storageIssue || createOpen || !!detail} data-testid="button-import-legacy">{busy ? '移行中…' : 'Firebaseへ移行'}</button>
        </div>}
        {migrationNotice && <p className="notice neutral" role="status">{migrationNotice}</p>}
        {error && !createOpen && !detail && <p className="form-error" role="alert">{error}</p>}

        {loading ? <p className="notice neutral" role="status">Firebase から図鑑を読み込んでいます…</p> : items.length === 0 ? (
          <section className="empty-state" data-testid="empty-keepsakes">
            <div className="empty-illustration"><BookOpen size={46} strokeWidth={1.35} /></div>
            <h2 className="empty-title">まだ、まっさらなページ</h2>
            <p className="empty-copy">いちばん最初の一枚をつくってみよう。<br />登録するモノの写真と声を残せます。</p>
            <button type="button" className="empty-action" onClick={openCreate} data-testid="button-empty-create">はじめのカードをつくる</button>
          </section>
        ) : (
          <section className="sticker-collage" aria-label="保存した図鑑のシール" data-testid="grid-keepsakes">
            {items.map((item) => (
              <article key={item.id} className="sticker-item" data-testid={`card-keepsake-${item.id}`}>
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

        <footer className="footer-note"><Sparkles size={14} /> 写真と声はFirebaseに保存します。同じブラウザの匿名アカウントで閲覧できます。</footer>
      </main>

      {createOpen && !photoEditorSource && (
        <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreate(); }}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <div className="dialog-head">
              <div><h2 id="create-title" className="dialog-title">新しいページをつくる</h2><p className="dialog-lede">図鑑に登録するモノの写真と声を残します。</p></div>
              <button type="button" className="icon-button" disabled={busy} onClick={closeCreate} aria-label="閉じる" data-testid="button-close-create"><X size={19} /></button>
            </div>
            <div className="form-block">
              <label className="field-label" htmlFor="keepsake-item-name">モノの名前</label>
              <p className="field-hint">図鑑に登録するものの名前を入力してください。</p>
              <input id="keepsake-item-name" className="title-input" disabled={busy} value={itemName} onChange={(event) => setItemName(event.currentTarget.value)} placeholder="りんご、ライオン、赤バス など" maxLength={48} data-testid="input-item-name" />
            </div>
            <div className="form-block">
              <span className="field-label">写真</span>
              <input ref={photoInput} className="sr-only" type="file" accept="image/*" onChange={onPhotoChange} aria-label="写真を選ぶ" data-testid="input-card-photo" />
              <button type="button" className="photo-picker" disabled={busy || recording || processingVoice} onClick={() => photoInput.current?.click()} data-testid="button-select-photo">
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
                    <button type="button" className="record-button primary" disabled={processingVoice || busy} onClick={startRecording} data-testid="button-start-recording"><Mic size={15} /> {processingVoice ? '音声を準備しています…' : voice ? 'もう一度録音' : '録音する'}</button>
                  )}
                  {voice && !recording && !processingVoice && <>
                    <button type="button" className="record-button" onClick={togglePreview} data-testid="button-preview-recording">{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? '一時停止' : '聞いてみる'}</button>
                    <button type="button" className="record-button" disabled={busy} onClick={() => { stopPlayback(); setVoice(null); setNotice('録音を消しました。'); }} aria-label="録音を消す" data-testid="button-remove-recording"><RotateCcw size={15} /></button>
                  </>}
                </div>
              </div>
              {permissionError && <div className="notice" role="status" data-testid="status-microphone">{<CircleHelp size={16} />}{permissionError}</div>}
              {notice && !permissionError && <div className="notice neutral" role="status"><Check size={15} />{notice}</div>}
              {(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') && <div className="notice" role="status" data-testid="status-unsupported-browser"><CircleHelp size={16} />このブラウザでは録音できません。録音以外のカード機能はお使いいただけます。</div>}
              {recording && <p className="sr-only" aria-live="polite">録音中です。録音時間 {formatTime(recordSeconds)}</p>}
              {processingVoice && <p className="notice neutral" role="status">音声を準備しています。録音後は冒頭の無音をカットします…</p>}
              <p className="field-hint">録音は最大60秒。冒頭の無音を自動でカットします。</p>
            </div>
            {error && <p className="form-error" role="alert" data-testid="status-form-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="cancel-button" disabled={busy} onClick={closeCreate} data-testid="button-cancel-create">あとで</button>
              <button type="button" className="save-button" onClick={saveCard} disabled={recording || processingVoice || busy || !isFirebaseConfigured || !!storageIssue || loading} data-testid="button-save-card"><Check size={16} /> {busy ? 'Firebaseに保存中…' : 'このページをしまう'}</button>
            </div>
            {!isFirebaseConfigured && <p className="form-error" role="status">保存にはFirebaseの設定が必要です。src/firebaseConfig.ts をご確認ください。</p>}
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
        <div className="overlay" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) { stopPlayback(); setDetail(null); } }}>
          <section className="dialog dialog-detail" role="dialog" aria-modal="true" aria-label={`${detail.itemName}のページ`}>
            <button type="button" className="icon-button" disabled={busy} style={{ position: 'absolute', zIndex: 2, right: 25, top: 25 }} onClick={() => { stopPlayback(); setDetail(null); }} aria-label="閉じる" data-testid="button-close-detail"><X size={19} /></button>
            {detail.photo ? <img className="detail-image" src={detail.photo} alt={`${detail.itemName}の写真`} /> : <div className="detail-image-placeholder"><ImageIcon size={54} /></div>}
            <div className="detail-meta">
              <div><h2 className="detail-name">{detail.itemName}</h2><p className="detail-date">{formatDate(detail.createdAt)} にしまいました</p>{!detail.voice && <p className="detail-date">このページには、まだ声がありません</p>}</div>
              <div className="detail-actions">
                {detail.voice && <button type="button" className="record-button primary" onClick={playDetailVoice} data-testid="button-play-detail-voice">{playing && playingItemId === detail.id ? <Pause size={16} /> : <Play size={16} />}{playing && playingItemId === detail.id ? 'とめる' : '声をきく'}</button>}
                <button type="button" className="plain-action" onClick={() => setConfirmDelete((value) => !value)} aria-label="このカードを削除" data-testid="button-delete-card"><Trash2 size={17} /></button>
              </div>
            </div>
            {confirmDelete && <div className="delete-confirm" role="alert"><AlertCircle size={16} />Firebaseから写真・音声・このページを削除しますか？<button type="button" disabled={busy} onClick={deleteCard} data-testid="button-confirm-delete">{busy ? '削除中…' : '削除する'}</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} data-testid="button-cancel-delete">やめる</button></div>}
            {error && <p className="form-error" role="alert">{error}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
