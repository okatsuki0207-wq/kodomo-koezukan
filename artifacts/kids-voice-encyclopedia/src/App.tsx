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
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import PhotoEditor from './components/PhotoEditor';
import CategoryBar from './components/CategoryBar';
import CategoryDialog from './components/CategoryDialog';
import { useLongPress } from './hooks/useLongPress';
import CategorySelect from './components/CategorySelect';
import EditCardDialog from './components/EditCardDialog';
import RecordingGuide from './components/RecordingGuide';
import { useEditRecording } from './hooks/useEditRecording';
import { randomVoice, VoicePlayback } from './lib/voicePlayback';
import DetailDialogShell from './components/DetailDialogShell';
import { useCategories } from './hooks/useCategories';
import { filterByCategory } from './lib/categories';
import { deleteKeepsake, editKeepsake, firebaseError, saveKeepsake, subscribeKeepsakes, updateKeepsakeCategory, type Keepsake } from './lib/keepsakeStore';
import { getVoices } from './lib/voiceAssets';
import { trimLeadingSilence } from './lib/audioTrim';
import { isFirebaseConfigured } from './firebaseConfig';
import './index.css';

function formatStamp(timestamp: number) {
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [storageIssue, setStorageIssue] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [processingVoice, setProcessingVoice] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [cardCategory, setCardCategory] = useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [newCatInCreate, setNewCatInCreate] = useState(false);
  const [catBusy, setCatBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { categories, error: categoryIssue, create: createCategoryEntry, describeError } = useCategories(connectionAttempt);
  const visibleItems = filterByCategory(items, selectedCategory);
  const categoryName = (id: string | null | undefined) => categories.find((c) => c.id === id)?.name;
  const recordingSession = useRef(0);
  const pendingId = useRef<string | null>(null);
  const mutationLock = useRef(false);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const [playback] = useState(() => new VoicePlayback({
    onChange: (state) => {
      setPlaying(state?.playing ?? false);
      setPlayingItemId(state && state.id !== 'voice-preview' ? state.id : null);
      setPlayingUrl(state?.url ?? null);
    },
    onError: () => setError('録音を再生できませんでした。'),
  }));
  const rec = useEditRecording((blob) => {
    const session = recordingSession.current;
    setProcessingVoice(true);
    void (async () => {
      try {
        const trimmed = await trimLeadingSilence(blob);
        if (session === recordingSession.current) {
          setVoice(URL.createObjectURL(trimmed));
          setNotice('声を録音しました。このままカードを保存できます。');
        }
      } catch (caught) {
        if (session === recordingSession.current) setError(caught instanceof Error ? caught.message : '録音を処理できませんでした。');
      } finally {
        if (session === recordingSession.current) setProcessingVoice(false);
      }
    })();
  });
  const recording = rec.recording;
  const recordSeconds = rec.seconds;
  useEffect(() => {
    // Round-robin warms the first voice of several visible cards before extra
    // voices; metadata-only loading bounds traffic/memory on phones.
    const voices = visibleItems.map(getVoices);
    const urls: string[] = [];
    for (let i = 0; i < 5; i++) for (const clips of voices) if (clips[i]) urls.push(clips[i].url);
    playback.warm(urls);
  }, [items, selectedCategory, playback]);

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
      if (!cancelled) {
        setItems(next);
        setDetail((current) => current ? next.find((item) => item.id === current.id) ?? null : null);
        setLoading(false); setStorageIssue('');
      }
    }, fail).then((stop) => { if (cancelled) stop(); else unsubscribe = stop; }).catch(fail);
    return () => { cancelled = true; window.clearTimeout(timer); unsubscribe?.(); };
  }, [connectionAttempt]);

  useEffect(() => () => {
    recordingSession.current++;
    playback.dispose();
  }, [playback]);

  useEffect(() => () => {
    if (photoEditorSource.startsWith('blob:')) URL.revokeObjectURL(photoEditorSource);
  }, [photoEditorSource]);

  useEffect(() => () => {
    if (voice?.startsWith('blob:')) URL.revokeObjectURL(voice);
  }, [voice]);

  const stopPlayback = () => playback.stop();

  const longPress = useLongPress<Keepsake>((item) => {
    const current = items.find((entry) => entry.id === item.id);
    if (!mutationLock.current && current) openDetail(current);
  }, undefined, (item) => playKeepsake(item));
  const closeDetail = () => { if (mutationLock.current) return; stopPlayback(); setDetail(null); setEditOpen(false); setConfirmDelete(false); };

  const changeDetailCategory = async (categoryId: string | null) => {
    if (!detail || mutationLock.current) return;
    const target = detail;
    mutationLock.current = true; setBusy(true); setCatBusy(true); setError('');
    try {
      await updateKeepsakeCategory(target.id, categoryId);
      setDetail((c) => c && c.id === target.id ? { ...c, categoryId } : c);
      setItems((list) => list.map((e) => e.id === target.id ? { ...e, categoryId } : e));
    } catch (caught) { setError(describeError(caught)); }
    finally { mutationLock.current = false; setBusy(false); setCatBusy(false); }
  };

  const openDetail = (item: Keepsake) => {
    stopPlayback();
    setError('');
    setDetail(item);
    setEditOpen(false);
    setConfirmDelete(false);
  };

  const playKeepsake = (item: Keepsake) => {
    const voices = getVoices(item);
    if (!voices.length) {
      openDetail(item);
      return;
    }
    setError('');
    if (playback.isActive(item.id)) { stopPlayback(); return; }
    const selected = randomVoice(voices);
    if (selected) playback.play(selected.url, item.id);
  };

  const openCreate = () => {
    if (busy) return;
    stopPlayback();
    pendingId.current = null;
    setItemName('');
    setCardCategory(selectedCategory);
    setPhoto('');
    setPhotoEditorSource('');
    setVoice(null);
    setError('');
    setNotice('');
    rec.setError('');
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (busy) return;
    recordingSession.current++;
    rec.cancel();
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

  const startRecording = () => {
    if (processingVoice || busy || recording || rec.starting || !photo) return;
    recordingSession.current++;
    stopPlayback(); setError(''); setNotice('');
    void rec.start();
  };
  const stopRecording = rec.stop;

  const saveCard = async () => {
    if (mutationLock.current || recording || processingVoice || rec.starting) return;
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
      await saveKeepsake({ id: pendingId.current, itemName: cleanItemName, photo, voice, createdAt: Date.now(), categoryId: cardCategory });
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

  const playDetailVoice = (url: string) => {
    if (!detail) return;
    if (playingUrl === url && playback.isActive(detail.id)) { stopPlayback(); return; }
    setError('');
    // Different detail buttons share a card ID but must switch clips.
    stopPlayback(); playback.play(url, detail.id);
  };

  const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="app-shell">
      <header className="topbar" inert={createOpen || !!detail || categoryOpen}>
        <a className="brand" href="/" aria-label="こどもの こえずかん ホーム">
          <span className="brand-mark"><BookOpen size={20} strokeWidth={1.8} /></span>
          <h1 className="brand-title" style={{ margin: 0 }}>こどもの こえずかん</h1>
        </a>
        <button type="button" className="header-create" onClick={openCreate} data-testid="button-create-card"><Plus size={18} /><span>つくる</span></button>
      </header>

      <main className="page-main" inert={createOpen || !!detail || categoryOpen}>
        <CategoryBar categories={categories} selected={selectedCategory} onSelect={(id) => { stopPlayback(); setSelectedCategory(id); }} onNew={() => setCategoryOpen(true)} disabled={busy} />
        {categoryIssue && <div className="notice" role="alert" data-testid="status-categories-load-error"><AlertCircle size={16} />{categoryIssue}
          <button type="button" className="record-button" onClick={() => setConnectionAttempt((value) => value + 1)} disabled={busy}>再接続</button>
        </div>}
        {storageIssue && <div className="notice" role="alert" data-testid="status-storage-error"><AlertCircle size={16} />{storageIssue}
          {isFirebaseConfigured && <button type="button" className="record-button" onClick={() => setConnectionAttempt((value) => value + 1)} disabled={busy}>再接続</button>}
        </div>}
        {error && !createOpen && !detail && <p className="form-error" role="alert">{error}</p>}

        <div id="category-panel" role="tabpanel" aria-labelledby={`category-tab-${selectedCategory ?? 'all'}`}>
        {loading ? <p className="notice neutral" role="status">Firebase から図鑑を読み込んでいます…</p> : items.length === 0 && selectedCategory === null ? (
          <section className="empty-state" data-testid="empty-keepsakes">
            <div className="empty-illustration"><BookOpen size={46} strokeWidth={1.35} /></div>
            <h2 className="empty-title">まだ、まっさらなページ</h2>
            <p className="empty-copy">いちばん最初の一枚をつくってみよう。<br />登録するモノの写真と声を残せます。</p>
            <button type="button" className="empty-action" onClick={openCreate} data-testid="button-empty-create">はじめのカードをつくる</button>
          </section>
        ) : visibleItems.length === 0 ? (
          <section className="empty-state category-empty" data-testid="empty-category">
            <div className="empty-illustration"><BookOpen size={46} strokeWidth={1.35} /></div>
            <h2 className="empty-title">{categoryName(selectedCategory) ?? 'このカテゴリ'}は、まだ空っぽ</h2>
            <p className="empty-copy">このカテゴリのカードはまだありません。<br />新しいカードをつくるか、ほかのカードのカテゴリを直せます。</p>
            <button type="button" className="empty-action" onClick={openCreate} data-testid="button-category-empty-create">このカテゴリにカードをつくる</button>
          </section>
        ) : (
          <section className="sticker-collage" aria-label="保存した図鑑のシール" data-testid="grid-keepsakes">
            {visibleItems.map((item) => (
              <article key={item.id} className={`sticker-item${playing && playingItemId === item.id ? ' is-playing' : ''}`} data-testid={`card-keepsake-${item.id}`}>
                <button
                  type="button"
                  className="sticker-photo-button"
                  onClick={() => playKeepsake(item)}
                  {...longPress(item)}
                  aria-label={getVoices(item).length ? `${item.itemName}の声を再生` : `${item.itemName}の写真をひらく`}
                  data-testid={`button-play-card-${item.id}`}
                >
                  {item.photo
                    ? <img className="sticker-photo" src={item.photo} alt={`${item.itemName}の写真`} data-testid={`img-sticker-${item.id}`} />
                    : <ImageIcon size={44} />}
                  {playing && playingItemId === item.id && <span className="voice-notes" aria-hidden="true"><span>♪</span><span>♫</span><span>♪</span></span>}
                </button>
                <button type="button" className="sticker-name" onClick={() => openDetail(item)} aria-label={`${item.itemName}の写真を大きく表示`} data-testid={`button-detail-${item.id}`}>
                  {item.itemName}
                </button>
                <span className="sr-only" role="status">{playing && playingItemId === item.id ? `${item.itemName}の声を再生中` : ''}</span>
              </article>
            ))}
          </section>
        )}

        </div>
        <footer className="footer-note"><Sparkles size={14} /> 写真と声はFirebaseに保存します。同じブラウザの匿名アカウントで閲覧できます。</footer>
      </main>

      {createOpen && !photoEditorSource && (
        <div className="overlay" role="presentation" inert={newCatInCreate} onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreate(); }}>
          <DetailDialogShell className="dialog" label="新しいカードをつくる" returnSelector='[data-testid="button-create-card"]' onClose={closeCreate}>
            <div className="dialog-head">
              <div><h2 id="create-title" className="dialog-title">新しいカードをつくる</h2><p className="dialog-lede">図鑑に登録するモノの写真と声を残します。</p></div>
              <button type="button" className="icon-button" disabled={busy} onClick={closeCreate} aria-label="閉じる" data-testid="button-close-create"><X size={19} /></button>
            </div>
            <div className="form-block">
              <label className="field-label" htmlFor="keepsake-item-name">モノの名前</label>
              <p className="field-hint">図鑑に登録するものの名前を入力してください。</p>
              <input id="keepsake-item-name" className="title-input" disabled={busy} value={itemName} onChange={(event) => setItemName(event.currentTarget.value)} placeholder="りんご、ライオン、赤バス など" maxLength={48} data-testid="input-item-name" />
            </div>
            <div className="form-block">
              <CategorySelect id="create-category" categories={categories} value={cardCategory} onChange={setCardCategory} disabled={busy} testId="select-card-category" onNew={() => setNewCatInCreate(true)} />
            </div>
            <div className="form-block">
              <span className="field-label">写真</span>
              <input ref={photoInput} className="sr-only" type="file" accept="image/*" disabled={busy || recording || rec.starting || processingVoice} onChange={onPhotoChange} aria-label="写真を選ぶ" data-testid="input-card-photo" />
              <button type="button" className={`photo-picker${photo ? ' has-photo' : ''}`} disabled={busy || recording || rec.starting || processingVoice} onClick={() => photoInput.current?.click()} data-testid="button-select-photo">
                {photo && <img src={photo} alt="選んだ写真" />}
                {!photo && <span className="picker-content">
                  <Camera size={23} />
                  <strong>写真をえらぶ・撮る</strong>
                  <span>写真ライブラリから選ぶか、カメラで撮影できます</span>
                </span>}
              </button>
              {photo && <button type="button" className="record-button" disabled={busy || recording || rec.starting || processingVoice} onClick={() => photoInput.current?.click()}>写真をえらびなおす</button>}
            </div>
            <div className="form-block">
              <div className="record-panel">
                <div className="record-top">
                  <div className="record-title"><Mic size={16} /> 声をのこす <span className="record-status" role="status" aria-live="polite">{rec.guiding ? 'これはなーに？' : recording ? `録音中 ${formatTime(recordSeconds)}` : voice ? '録音できました' : 'あとからでも大丈夫'}</span></div>
                  {recording && <div className="recording-wave" aria-label="録音中"><i /><i /><i /><i /><i /><i /><i /></div>}
                </div>
                {photo && <RecordingGuide photo={photo} name={itemName} phase={rec.guiding ? 'guide' : recording ? 'recording' : 'idle'} />}
                <div className="record-actions">
                  {recording ? (
                    <button type="button" className="record-button danger" onClick={stopRecording} data-testid="button-stop-recording"><span className="recording-dot" /> 録音をとめる</button>
                  ) : (
                    <button type="button" className="record-button primary" disabled={processingVoice || busy || rec.starting || !photo} onClick={startRecording} data-testid="button-start-recording"><Mic size={15} /> {rec.starting ? '録音の準備中…' : processingVoice ? '音声を準備しています…' : voice ? 'もう一度録音' : '録音する'}</button>
                  )}
                  {rec.starting && <button type="button" className="record-button" onClick={rec.cancel}>やめる</button>}
                  {voice && !recording && !processingVoice && !rec.starting && <>
                    <button type="button" className="record-button" disabled={busy} onClick={() => playback.play(voice, 'voice-preview')} data-testid="button-preview-recording">{playing && playingUrl === voice ? <Pause size={15} /> : <Play size={15} />}{playing && playingUrl === voice ? 'とめる' : '声をきく'}</button>
                    <button type="button" className="record-button" disabled={busy} onClick={() => { stopPlayback(); setVoice(null); setNotice('録音を消しました。'); }} aria-label="録音を消す" data-testid="button-remove-recording"><RotateCcw size={15} /></button>
                  </>}
                </div>
                <p className="field-hint">※録音した声は、後から図鑑カード長押しで編集できます</p>
              </div>
              {rec.error && <div className="notice" role="status" data-testid="status-microphone">{<CircleHelp size={16} />}{rec.error}</div>}
              {notice && !rec.error && <div className="notice neutral" role="status"><Check size={15} />{notice}</div>}
              {(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') && <div className="notice" role="status" data-testid="status-unsupported-browser"><CircleHelp size={16} />このブラウザでは録音できません。録音以外のカード機能はお使いいただけます。</div>}
              {recording && <p className="sr-only" aria-live="polite">録音中です。録音時間 {formatTime(recordSeconds)}</p>}
              {processingVoice && <p className="notice neutral" role="status">音声を準備しています。録音後は冒頭の無音をカットします…</p>}
              <p className="field-hint">{!photo ? '先に写真をえらぼう。' : '「これはなーに？」が終わったら話してね。'}録音は最大60秒。</p>
            </div>
            {error && <p className="form-error" role="alert" data-testid="status-form-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="cancel-button" disabled={busy} onClick={closeCreate} data-testid="button-cancel-create">あとで</button>
              <button type="button" className="save-button" onClick={saveCard} disabled={recording || rec.starting || processingVoice || busy || !isFirebaseConfigured || !!storageIssue || loading} data-testid="button-save-card"><Check size={16} /> {busy ? 'Firebaseに保存中…' : 'このカードをしまう'}</button>
            </div>
            {!isFirebaseConfigured && <p className="form-error" role="status">保存にはFirebaseの設定が必要です。src/firebaseConfig.ts をご確認ください。</p>}
          </DetailDialogShell>
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

      {detail && !editOpen && (
        <div className="overlay" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) closeDetail(); }}>
          <DetailDialogShell label={`${detail.itemName}のカード`} returnSelector={`[data-testid="button-detail-${detail.id}"]`} onClose={closeDetail}>
            <button type="button" className="icon-button" disabled={busy} style={{ position: 'absolute', zIndex: 2, right: 25, top: 25 }} onClick={closeDetail} aria-label="閉じる" data-testid="button-close-detail"><X size={19} /></button>
            {detail.photo ? <img className="detail-image" src={detail.photo} alt={`${detail.itemName}の写真`} /> : <div className="detail-image-placeholder"><ImageIcon size={54} /></div>}
            <div className="detail-meta">
              <div><h2 className="detail-name">{detail.itemName}</h2><p className="detail-date" data-testid="text-detail-created-at">登録日時：{formatStamp(detail.createdAt)}</p><p className="detail-date" data-testid="text-detail-category">カテゴリ: {categoryName(detail.categoryId) ?? (detail.categoryId ? '読み込み中のカテゴリ' : '未分類')}</p><div className="detail-category"><CategorySelect id="detail-category" categories={categories} value={detail.categoryId ?? null} onChange={(id) => void changeDetailCategory(id)} disabled={busy || catBusy} testId="select-detail-category" /></div>{getVoices(detail).length === 0 && <p className="detail-date">このカードには、まだ声がありません</p>}</div>
              <div className="detail-actions">
                {getVoices(detail).map((v, i, all) => { const on = playing && playingItemId === detail.id && playingUrl === v.url; return (
                  <button key={v.id} type="button" className="record-button primary" onClick={() => playDetailVoice(v.url)} data-testid={i === 0 ? 'button-play-detail-voice' : `button-play-detail-voice-${i}`}>{on ? <Pause size={16} /> : <Play size={16} />}{on ? 'とめる' : all.length > 1 ? `声${i + 1}をきく` : '声をきく'}</button>); })}
                <button type="button" className="record-button" disabled={busy} onClick={() => { stopPlayback(); setEditOpen(true); }} data-testid="button-edit-card"><Pencil size={15} /> へんしゅう</button>
                <button type="button" className="plain-action" disabled={busy} onClick={() => setConfirmDelete((value) => !value)} aria-label="このカードを削除" data-testid="button-delete-card"><Trash2 size={17} /></button>
              </div>
            </div>
            {confirmDelete && <div className="delete-confirm" role="alert"><AlertCircle size={16} />Firebaseから写真・音声・このカードを削除しますか？<button type="button" disabled={busy} onClick={deleteCard} data-testid="button-confirm-delete">{busy ? '削除中…' : '削除する'}</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} data-testid="button-cancel-delete">やめる</button></div>}
            {error && <p className="form-error" role="alert">{error}</p>}
          </DetailDialogShell>
        </div>
      )}
      {categoryOpen && (
        <CategoryDialog
          categories={categories}
          onCreate={createCategoryEntry}
          describeError={describeError}
          onClose={() => setCategoryOpen(false)}
          onCreated={(made) => { setSelectedCategory(made.id); setCategoryOpen(false); }}
        />
      )}
      {newCatInCreate && (
        <CategoryDialog
          categories={categories}
          onCreate={createCategoryEntry}
          describeError={describeError}
          returnSelector='[data-testid="select-card-category"]'
          onClose={() => setNewCatInCreate(false)}
          onCreated={(made) => { setCardCategory(made.id); setNewCatInCreate(false); }}
        />
      )}

      {editOpen && detail && (
        <EditCardDialog
          item={detail}
          categories={categories}
          describeError={describeError}
          onClose={() => setEditOpen(false)}
          onSave={async (base, changes, editId) => {
            const saved = await editKeepsake(base, changes, editId);
            setDetail((current) => current && current.id === saved.id ? saved : current);
            setItems((list) => list.map((entry) => entry.id === saved.id ? saved : entry));
          }}
        />
      )}
    </div>
  );
}

export default App;
