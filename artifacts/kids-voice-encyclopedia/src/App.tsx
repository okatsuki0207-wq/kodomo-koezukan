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
  Share2,
  Scissors,
  Settings,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import PhotoEditor from './components/PhotoEditor';
import CategoryBar from './components/CategoryBar';
import CategoryDialog from './components/CategoryDialog';
import { useLongPress } from './hooks/useLongPress';
import CategorySelect from './components/CategorySelect';
import EditCardDialog from './components/EditCardDialog';
import RecordingGuide, { RecordingCharacter } from './components/RecordingGuide';
import VoiceTrimEditor from './components/VoiceTrimEditor';
import { useEditRecording } from './hooks/useEditRecording';
import { useNewKeepsakeDraft } from './hooks/useNewKeepsakeDraft';
import { VoicePlayback, VoiceShuffleBag } from './lib/voicePlayback';
import DetailDialogShell from './components/DetailDialogShell';
import StartScreen from './components/StartScreen';
import SettingsDialog from './components/SettingsDialog';
import { useCategories } from './hooks/useCategories';
import { DEFAULT_GALLERY_SETTINGS, normalizeGallerySettings, sortGalleryItems, type GallerySettings } from './lib/gallerySettings';
import { deleteKeepsake, editKeepsake, firebaseError, saveGallerySettings, saveKeepsake, subscribeGallerySettings, subscribeKeepsakes, updateKeepsakeCategory, type Keepsake } from './lib/keepsakeStore';
import { getVoices, type VoiceAsset } from './lib/voiceAssets';
import { trimLeadingSilence } from './lib/audioTrim';
import { preloadRecordingGuide } from './lib/recordingCue';
import { hasNewKeepsakeDraftContent, type NewKeepsakeDraftInput } from './lib/newKeepsakeDraft';
import { APP_VIEW_STORAGE_KEY, persistAppView, restoreAppView, type AppView } from './lib/appViewState';
import { isFirebaseConfigured } from './firebaseConfig';
import './index.css';

function formatStamp(timestamp: number) {
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(timestamp);
}

const READ_ONLY_MODE_STORAGE_KEY = 'kids-voice-encyclopedia:read-only-mode';

function loadReadOnlyMode() {
  try {
    return window.localStorage.getItem(READ_ONLY_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function App() {
  const [items, setItems] = useState<Keepsake[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gallerySettings, setGallerySettings] = useState<GallerySettings>(() => ({ ...DEFAULT_GALLERY_SETTINGS }));
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [readOnlyMode, setReadOnlyMode] = useState(loadReadOnlyMode);
  const [shareFeedback, setShareFeedback] = useState('');
  const shareFeedbackTimer = useRef<number | null>(null);
  const [view, setView] = useState<AppView>(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(APP_VIEW_STORAGE_KEY); } catch { /* private browsing can block storage */ }
    return restoreAppView(window.location.pathname, saved);
  });
  const [recordPromptId, setRecordPromptId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Keepsake | null>(null);
  const [itemName, setItemName] = useState('');
  const [photo, setPhoto] = useState('');
  const [pendingPhotoBlob, setPendingPhotoBlob] = useState<Blob | null>(null);
  const photoBeforeEditor = useRef<{ photo: string; pendingPhotoBlob: Blob | null } | null>(null);
  const [photoEditorSource, setPhotoEditorSource] = useState('');
  const [voice, setVoice] = useState<string | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [trimOpen, setTrimOpen] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState(false);
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [processingVoice, setProcessingVoice] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [cardCategory, setCardCategory] = useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [newCatInCreate, setNewCatInCreate] = useState(false);
  const [catBusy, setCatBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const localDraft = useNewKeepsakeDraft();
  const { categories, create: createCategoryEntry, describeError } = useCategories(0);
  const navigate = (next: AppView) => {
    setView(next);
    persistAppView(next);
  };
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setSettingsLoading(true);
    const fail = (caught: unknown) => {
      if (cancelled) return;
      console.error('図鑑の表示設定を読み込めませんでした。', caught);
      setSettingsLoading(false);
    };
    subscribeGallerySettings((next) => {
      if (cancelled) return;
      setGallerySettings(next);
      setSettingsLoading(false);
    }, fail).then((stop) => {
      if (cancelled) stop();
      else unsubscribe = stop;
    }).catch(fail);
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(READ_ONLY_MODE_STORAGE_KEY, String(readOnlyMode));
    } catch {
      // The current tab still honors the mode if browser storage is unavailable.
    }
  }, [readOnlyMode]);
  useEffect(() => () => {
    if (shareFeedbackTimer.current !== null) window.clearTimeout(shareFeedbackTimer.current);
  }, []);
  const visibleItems = sortGalleryItems(items, gallerySettings, selectedCategory);
  const categoryName = (id: string | null | undefined) => categories.find((c) => c.id === id)?.name;
  const recordingSession = useRef(0);
  const createDraftSession = useRef(0);
  const draftCancelled = useRef(false);
  const pendingId = useRef<string | null>(null);
  const mutationLock = useRef(false);
  const voiceShuffleBags = useRef(new Map<string, VoiceShuffleBag<VoiceAsset>>());
  const photoInput = useRef<HTMLInputElement | null>(null);
  const draftSnapshot: NewKeepsakeDraftInput = {
    itemName,
    // Blob URLs expire on reload; persist the selected Blob separately.
    photo: photo && !photo.startsWith('blob:') ? photo : null,
    pendingPhotoBlob,
    voiceBlob,
    categoryId: cardCategory,
  };
  const latestDraft = useRef(draftSnapshot);
  latestDraft.current = draftSnapshot;
  useEffect(() => {
    let active = true;
    const session = ++createDraftSession.current;
    void localDraft.load().then((draft) => {
      if (!active || session !== createDraftSession.current || !draft || !hasNewKeepsakeDraftContent(draft)) return;
      const pending = draft.pendingPhotoBlob;
      const storedPhoto = draft.photo && !draft.photo.startsWith('blob:') ? draft.photo : '';
      preloadRecordingGuide();
      setItemName(draft.itemName);
      setCardCategory(draft.categoryId);
      setPhoto(pending ? URL.createObjectURL(pending) : storedPhoto);
      setPendingPhotoBlob(pending);
      setVoiceBlob(draft.voiceBlob);
      setVoice(draft.voiceBlob ? URL.createObjectURL(draft.voiceBlob) : null);
      setDraftLoading(false);
      setDraftReady(true);
      setCreateOpen(true);
    });
    return () => { active = false; };
  }, [localDraft.load]);
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
          setVoiceBlob(trimmed);
          setTrimOpen(false);
          setNotice('声を録音しました。このままキロクをしまえます。');
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
    const currentIds = new Set(items.map((item) => item.id));
    for (const id of voiceShuffleBags.current.keys()) {
      if (!currentIds.has(id)) voiceShuffleBags.current.delete(id);
    }
    for (const item of items) {
      const voices = getVoices(item);
      if (!voices.length) continue;
      let bag = voiceShuffleBags.current.get(item.id);
      if (!bag) {
        bag = new VoiceShuffleBag((candidate) => candidate.id);
        voiceShuffleBags.current.set(item.id, bag);
      }
      bag.prepare(voices);
    }
  }, [items]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        console.warn('Firebaseのキロク読み込みがタイムアウトしました。');
      }
    }, 20_000);
    const fail = (caught: unknown) => {
      window.clearTimeout(timer);
      if (!cancelled) {
        console.error('Firebaseのキロク読み込みに失敗しました。', firebaseError(caught));
        setLoading(false);
      }
    };
    void subscribeKeepsakes((next) => {
      window.clearTimeout(timer);
      if (!cancelled) {
        setItems(next);
        setDetail((current) => current ? next.find((item) => item.id === current.id) ?? null : null);
        setLoading(false);
      }
    }, fail).then((stop) => { if (cancelled) stop(); else unsubscribe = stop; }).catch(fail);
    return () => { cancelled = true; window.clearTimeout(timer); unsubscribe?.(); };
  }, []);

  useEffect(() => () => {
    recordingSession.current++;
    playback.dispose();
  }, [playback]);

  useEffect(() => () => {
    if (photoEditorSource.startsWith('blob:')) URL.revokeObjectURL(photoEditorSource);
  }, [photoEditorSource]);

  useEffect(() => () => {
    if (photo.startsWith('blob:')) URL.revokeObjectURL(photo);
  }, [photo]);

  useEffect(() => () => {
    if (voice?.startsWith('blob:')) URL.revokeObjectURL(voice);
  }, [voice]);

  useEffect(() => {
    if (!createOpen || !draftReady) return;
    localDraft.saveSoon(latestDraft.current);
  }, [createOpen, draftReady, itemName, photo, pendingPhotoBlob, voiceBlob, cardCategory, localDraft.saveSoon]);

  useEffect(() => {
    if (!createOpen || !draftReady) return;
    const flush = () => { if (!draftCancelled.current) void localDraft.saveNow(latestDraft.current); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [createOpen, draftReady, localDraft.saveNow]);

  const stopPlayback = () => playback.stop();

  const longPress = useLongPress<Keepsake>((item) => {
    const current = items.find((entry) => entry.id === item.id);
    if (!mutationLock.current && current) openDetail(current);
  }, undefined, (item) => playKeepsake(item));
  const closeDetail = () => { if (mutationLock.current) return; stopPlayback(); setDetail(null); setEditOpen(false); setConfirmDelete(false); };

  const changeDetailCategory = async (categoryId: string | null) => {
    if (readOnlyMode || !detail || mutationLock.current) return;
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
    setRecordPromptId(null);
    setDetail(item);
    setEditOpen(false);
    setConfirmDelete(false);
  };

  const playKeepsake = (item: Keepsake) => {
    const voices = getVoices(item);
    if (!voices.length) {
      stopPlayback();
      setRecordPromptId(item.id);
      return;
    }
    setRecordPromptId(null);
    setError('');
    if (playback.isActive(item.id)) { playback.restart(item.id); return; }
    let bag = voiceShuffleBags.current.get(item.id);
    if (!bag) {
      bag = new VoiceShuffleBag((candidate) => candidate.id);
      voiceShuffleBags.current.set(item.id, bag);
    }
    const selected = bag.next(voices);
    if (selected) playback.play(selected.url, item.id);
  };

  const openRecordEditor = (item: Keepsake) => {
    if (readOnlyMode || busy) return;
    stopPlayback();
    setRecordPromptId(null);
    setError('');
    setDetail(item);
    setEditOpen(true);
    setConfirmDelete(false);
  };

  const openCreate = () => {
    if (readOnlyMode || busy) return;
    draftCancelled.current = false;
    preloadRecordingGuide();
    // The request starts on the create-button gesture and releases the
    // temporary stream as soon as permission is confirmed.
    void rec.prepareMicrophone();
    stopPlayback();
    pendingId.current = null;
    const session = ++createDraftSession.current;
    setItemName('');
    setCardCategory(selectedCategory);
    setPhoto('');
    setPendingPhotoBlob(null);
    photoBeforeEditor.current = null;
    setPhotoEditorSource('');
    setVoice(null);
    setVoiceBlob(null);
    setTrimOpen(false);
    setDraftReady(false);
    setDraftLoading(true);
    setError('');
    setNotice('');
    rec.setError('');
    setCreateOpen(true);
    void localDraft.load().then((draft) => {
      if (session !== createDraftSession.current) return;
      if (draft) {
        const pending = draft.pendingPhotoBlob;
        const storedPhoto = draft.photo && !draft.photo.startsWith('blob:') ? draft.photo : '';
        const restoredPhoto = pending ? URL.createObjectURL(pending) : storedPhoto;
        setItemName(draft.itemName);
        setCardCategory(draft.categoryId);
        setPhoto(restoredPhoto);
        setPendingPhotoBlob(pending);
        setVoiceBlob(draft.voiceBlob);
        setVoice(draft.voiceBlob ? URL.createObjectURL(draft.voiceBlob) : null);
      }
      setDraftReady(true);
      setDraftLoading(false);
    });
  };

  const closeCreate = () => {
    if (busy) return;
    createDraftSession.current++;
    draftCancelled.current = true;
    // Closing is an explicit cancel. pagehide/visibilitychange still flushes
    // the draft for unexpected exits, but a deliberate close discards it.
    void localDraft.clear();
    recordingSession.current++;
    rec.cancel();
    setProcessingVoice(false);
    setVoice(null);
    setVoiceBlob(null);
    setTrimOpen(false);
    stopPlayback();
    setCreateOpen(false);
    setDraftReady(false);
    setDraftLoading(false);
    setPhoto('');
    setPendingPhotoBlob(null);
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
      photoBeforeEditor.current = { photo, pendingPhotoBlob };
      setPendingPhotoBlob(file);
      setPhotoEditorSource(URL.createObjectURL(file));
      void localDraft.saveNow({ ...latestDraft.current, pendingPhotoBlob: file });
      setError('');
      setNotice('');
    } catch {
      setError('写真を読み込めませんでした。別の写真を選んでください。');
    }
  };

  const startRecording = () => {
    if (processingVoice || busy || recording || rec.micStatus === 'preparing' || rec.starting || !photo) return;
    recordingSession.current++;
    stopPlayback(); setError(''); setNotice(''); setTrimOpen(false);
    void rec.start();
  };
  const stopRecording = rec.stop;

  const saveCard = async () => {
    if (readOnlyMode || mutationLock.current || recording || processingVoice || rec.starting) return;
    const cleanItemName = itemName.trim();
    if (!cleanItemName) {
      setError('キロクの名前を入力してください。');
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
      await saveKeepsake({
        id: pendingId.current,
        itemName: cleanItemName,
        photo,
        voice,
        photoBlob: pendingPhotoBlob ?? undefined,
        voiceBlob: voiceBlob ?? undefined,
        createdAt: Date.now(),
        categoryId: cardCategory,
      });
      draftCancelled.current = true;
      const draftCleared = await localDraft.clear();
      if (!draftCleared) {
        setError('キロクは保存されましたが、この端末の下書きを消去できませんでした。保存ボタンをもう一度押して再試行してください。');
        return;
      }
      setCreateOpen(false);
      navigate('library');
      setItemName('');
      setPhoto('');
      setPendingPhotoBlob(null);
      setVoice(null);
      setVoiceBlob(null);
      setTrimOpen(false);
      setDraftReady(false);
      setError('');
      pendingId.current = null;
    } catch (caught) { setError(firebaseError(caught)); }
    finally { mutationLock.current = false; setBusy(false); }
  };

  const deleteCard = async () => {
    if (readOnlyMode || !detail || mutationLock.current) return;
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

  const showShareFeedback = (message: string) => {
    setShareFeedback(message);
    if (shareFeedbackTimer.current !== null) window.clearTimeout(shareFeedbackTimer.current);
    shareFeedbackTimer.current = window.setTimeout(() => {
      setShareFeedback('');
      shareFeedbackTimer.current = null;
    }, 2600);
  };

  const shareEncyclopedia = async () => {
    const url = window.location.href;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: 'こどもの こえずかん',
          text: 'わが家のずかんを見てね。',
          url,
        });
        return;
      }
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable');
      await navigator.clipboard.writeText(url);
      showShareFeedback('共有リンクをコピーしました。');
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') return;
      showShareFeedback('共有リンクをコピーできませんでした。');
    }
  };

  const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="app-shell">
      <header className={`topbar${view === 'library' ? ' topbar-library' : ''}`} inert={createOpen || !!detail || categoryOpen || settingsOpen}>
        <div className="topbar-row">
          <button type="button" className="brand brand-home" onClick={() => navigate('start')} aria-label="こどもの こえずかん スタート画面" data-testid="button-home">
            <span className="brand-mark"><BookOpen size={20} strokeWidth={1.8} /></span>
            <h1 className="brand-title" style={{ margin: 0 }}>こどもの こえずかん</h1>
          </button>
          <div className="topbar-actions">
            <button type="button" className="header-settings-button" onClick={() => { stopPlayback(); setSettingsOpen(true); }} disabled={settingsLoading} aria-label="設定" title="設定" data-testid="button-settings"><Settings size={17} /></button>
            <button type="button" className="header-settings-button" onClick={() => { void shareEncyclopedia(); }} aria-label="ずかんを共有" title="ずかんを共有" data-testid="button-share"><Share2 size={17} /></button>
          </div>
        </div>
        {view === 'library' && !readOnlyMode && (
          <button type="button" className="header-create" onClick={openCreate} data-testid="button-create-card"><Plus size={19} /><span>キロクする</span></button>
        )}
      </header>
      {shareFeedback && <p className="share-feedback" role="status" data-testid="status-share-feedback">{shareFeedback}</p>}

      {view === 'start' ? (
        <main className="start-main" inert={createOpen || !!detail || categoryOpen || settingsOpen}>
          <StartScreen onRecord={openCreate} showRecordAction={!readOnlyMode} onOpenEncyclopedia={() => { createDraftSession.current++; navigate('library'); }} />
        </main>
      ) : (
      <main className="page-main" inert={createOpen || !!detail || categoryOpen || settingsOpen}>
        <CategoryBar
          categories={categories}
          selected={selectedCategory}
          onSelect={(id) => { stopPlayback(); setRecordPromptId(null); setSelectedCategory(id); }}
          onNew={() => { if (!readOnlyMode) setCategoryOpen(true); }}
          showNew={!readOnlyMode}
          disabled={busy}
        />
        <div id="category-panel" role="tabpanel" aria-labelledby={`category-tab-${selectedCategory ?? 'all'}`}>
        {loading ? <p className="notice neutral" role="status">Firebase から図鑑を読み込んでいます…</p> : items.length === 0 && selectedCategory === null ? (
          <section className="empty-state" data-testid="empty-keepsakes">
            <div className="empty-illustration"><RecordingCharacter pose="sit" /></div>
            <h2 className="empty-title">まだ、まっさらなページ</h2>
            <p className="empty-copy">いちばん最初のキロクを残してみよう。<br />写真といっしょに、声も大切にしまえます。</p>
            {!readOnlyMode && <button type="button" className="empty-action" onClick={openCreate} data-testid="button-empty-create">はじめのキロクを残す</button>}
          </section>
        ) : visibleItems.length === 0 ? (
          <section className="empty-state category-empty" data-testid="empty-category">
            <div className="empty-illustration"><RecordingCharacter pose="sit" /></div>
            <h2 className="empty-title">{categoryName(selectedCategory) ?? 'このカテゴリ'}は、まだ空っぽ</h2>
            <p className="empty-copy">このページはまだ空っぽ。<br />新しいキロクを残すか、ほかのキロクのページを変えられます。</p>
            {!readOnlyMode && <button type="button" className="empty-action" onClick={openCreate} data-testid="button-category-empty-create">このページにキロクする</button>}
          </section>
        ) : (
          <section className="sticker-collage" aria-label="わが家のキロク" data-testid="grid-keepsakes">
            {visibleItems.map((item) => (
              <article
                key={item.id}
                className={`sticker-item${playing && playingItemId === item.id ? ' is-playing' : ''}`}
                data-testid={`card-keepsake-${item.id}`}
              >
                <button
                  type="button"
                  className="sticker-photo-button"
                  onClick={() => playKeepsake(item)}
                  {...longPress(item)}
                  aria-label={getVoices(item).length ? `${item.itemName}の声をきく` : readOnlyMode ? item.itemName : `${item.itemName}の録音ボタンを表示`}
                  data-testid={`button-play-card-${item.id}`}
                >
                  {item.photo
                    ? <img className="sticker-photo" src={item.photo} alt={`${item.itemName}の写真`} data-testid={`img-sticker-${item.id}`} />
                    : <ImageIcon size={44} />}
                  {playing && playingItemId === item.id && <span className="voice-notes" aria-hidden="true"><span>♪</span><span>♫</span><span>♪</span></span>}
                </button>
                {!readOnlyMode && !getVoices(item).length && recordPromptId === item.id && (
                  <button
                    type="button"
                    className="sticker-record-prompt"
                    onClick={() => openRecordEditor(item)}
                    aria-label={`${item.itemName}を録音する`}
                    title="録音する"
                    data-testid={`button-record-card-${item.id}`}
                  >
                    <Mic size={20} />
                  </button>
                )}
                <button type="button" className="sticker-name" onClick={() => openDetail(item)} aria-label={`${item.itemName}の写真を大きく表示`} data-testid={`button-detail-${item.id}`}>{item.itemName}</button>
                <span className="sr-only" role="status">{playing && playingItemId === item.id ? `${item.itemName}の声を再生中` : ''}</span>
              </article>
            ))}
          </section>
        )}

        </div>
      </main>
      )}

      {createOpen && !photoEditorSource && (
        <div className="overlay" role="presentation" inert={newCatInCreate} onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreate(); }}>
          <DetailDialogShell className="dialog create-dialog" label="新しいキロクをつくる" returnSelector='[data-testid="button-create-card"]' onClose={closeCreate}>
            <div className="dialog-head create-dialog-head">
              <div><h2 id="create-title" className="dialog-title">新しいキロクをつくる</h2></div>
              <button type="button" className="icon-button" disabled={busy} onClick={closeCreate} aria-label="閉じる" data-testid="button-close-create"><X size={19} /></button>
            </div>
            <div className="create-fields">
              <div className="form-block create-name-field">
                <label className="field-label" htmlFor="keepsake-item-name">なまえ</label>
                <input id="keepsake-item-name" className="title-input" disabled={busy || draftLoading} value={itemName} onChange={(event) => setItemName(event.currentTarget.value)} placeholder="なまえ" maxLength={48} data-testid="input-item-name" />
              </div>
              <div className="form-block create-category-field">
                <CategorySelect id="create-category" categories={categories} value={cardCategory} onChange={setCardCategory} disabled={busy || draftLoading} testId="select-card-category" onNew={() => setNewCatInCreate(true)} />
              </div>
            </div>
            <div className="create-capture">
              <input ref={photoInput} className="sr-only" type="file" accept="image/*" disabled={busy || draftLoading || recording || rec.starting || processingVoice} onChange={onPhotoChange} aria-label="写真を選ぶ" data-testid="input-card-photo" />
              <div className="photo-composition create-photo-composition">
                <button type="button" className={`photo-picker create-photo-picker${photo ? ' has-photo' : ''}`} aria-label={photo ? '写真を変更' : '写真を選ぶ・撮る'} title={photo ? '写真を変更' : '写真を選ぶ・撮る'} disabled={busy || draftLoading || recording || rec.starting || processingVoice} onClick={() => photoInput.current?.click()} data-testid="button-select-photo">
                  {photo && <img src={photo} alt={(rec.guiding || rec.starting || recording) ? '' : '選んだ写真'} aria-hidden={Boolean(rec.guiding || rec.starting || recording)} />}
                  {!photo && <Camera size={36} aria-hidden="true" />}
                </button>
                {photo && <button type="button" className="photo-change create-photo-change" aria-label="写真を変更" title="写真を変更" disabled={busy || draftLoading || recording || rec.starting || processingVoice} onClick={() => photoInput.current?.click()} data-testid="button-change-photo"><Camera size={17} /></button>}
                {(rec.guiding || rec.starting || recording) && (
                  <div className="create-recording-overlay">
                    <RecordingGuide
                      name={itemName}
                      photo={photo || undefined}
                      phase={rec.guiding || rec.starting ? 'guide' : 'recording'}
                      guideDurationMs={rec.guideDurationMs}
                      guideProgress={rec.guideProgress}
                      recordingStartSignal={recordingSession.current}
                    />
                  </div>
                )}
              </div>
              <div className="create-record-controls">
                <div className="record-actions create-record-actions">
                  {recording ? (
                    <button type="button" className="record-button primary create-icon-button recording-active" onClick={stopRecording} aria-label="録音をとめる" title="録音をとめる" data-testid="button-stop-recording"><span className="recording-dot" /><Square size={21} /></button>
                  ) : (
                    <button type="button" className="record-button primary create-icon-button" disabled={processingVoice || busy || draftLoading || rec.micStatus === 'preparing' || rec.starting || !photo} onClick={startRecording} aria-label={rec.micStatus === 'preparing' || rec.starting ? '録音の準備中' : processingVoice ? '音声を準備しています' : voice ? 'もう一度録音' : '録音する'} title={rec.micStatus === 'preparing' || rec.starting ? '録音の準備中' : processingVoice ? '音声を準備しています' : voice ? 'もう一度録音' : '録音する'} data-testid="button-start-recording"><Mic size={24} /></button>
                  )}
                  {rec.starting && <button type="button" className="record-button create-icon-button secondary-icon-button" onClick={rec.cancel} aria-label="録音を中止" title="録音を中止"><X size={19} /></button>}
                  {voice && !recording && !processingVoice && !rec.starting && <>
                    <button type="button" className="record-button create-icon-button secondary-icon-button" disabled={busy} onClick={() => playback.play(voice, 'voice-preview')} aria-label={playing && playingUrl === voice ? '声をとめる' : '声をきく'} title={playing && playingUrl === voice ? '声をとめる' : '声をきく'} data-testid="button-preview-recording">{playing && playingUrl === voice ? <Pause size={20} /> : <Play size={20} />}</button>
                    <button type="button" className="record-button create-icon-button secondary-icon-button" disabled={busy} onClick={() => { stopPlayback(); setVoice(null); setVoiceBlob(null); setTrimOpen(false); setNotice('録音を消しました。'); }} aria-label="録音を消す" title="録音を消す" data-testid="button-remove-recording"><RotateCcw size={19} /></button>
                    <button type="button" className={`record-button create-icon-button secondary-icon-button${trimOpen ? ' is-selected' : ''}`} aria-expanded={trimOpen} aria-controls="new-keepsake-waveform" disabled={busy || draftLoading} onClick={() => setTrimOpen((open) => !open)} aria-label={trimOpen ? '波形編集を閉じる' : '波形を見てカット'} title={trimOpen ? '波形編集を閉じる' : '波形を見てカット'} data-testid="button-open-waveform-trim"><Scissors size={19} /></button>
                  </>}
                </div>
                <p className="create-record-status" role="status" aria-live="polite">
                  {rec.guiding ? 'これはなーに？' : rec.starting ? '準備中' : recording ? `録音中 ${formatTime(recordSeconds)}` : voice ? '録音できました' : '声をのこそう'}
                </p>
                {rec.micStatus === 'preparing' && <p className="create-mic-hint" role="status">マイクを確認しています</p>}
                {voice && !recording && !processingVoice && !rec.starting && trimOpen && (
                  <div className="new-waveform-panel create-waveform-panel" id="new-keepsake-waveform">
                    <VoiceTrimEditor
                      source={voiceBlob ?? voice}
                      disabled={busy}
                      onBeforePreview={stopPlayback}
                      onApply={(trimmed) => {
                        stopPlayback();
                        setVoice(URL.createObjectURL(trimmed));
                        setVoiceBlob(trimmed);
                        setTrimOpen(false);
                        setNotice('声のカットを反映しました。');
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            {rec.error && <div className="notice create-inline-notice" role="status" data-testid="status-microphone"><CircleHelp size={16} />{rec.error}</div>}
            {notice && !rec.error && <div className="notice neutral create-inline-notice" role="status"><Check size={15} />{notice}</div>}
            {(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') && <div className="notice create-inline-notice" role="status" data-testid="status-unsupported-browser"><CircleHelp size={16} />このブラウザでは録音できません。</div>}
            {processingVoice && <p className="create-processing" role="status">録音の無音部分を整えています…</p>}
            {error && <p className="form-error" role="alert" data-testid="status-form-error">{error}</p>}
            <div className="dialog-actions create-dialog-actions">
              <button type="button" className="cancel-button create-icon-button secondary-icon-button" disabled={busy} onClick={closeCreate} aria-label="やめる" title="やめる" data-testid="button-cancel-create"><X size={19} /></button>
              <button type="button" className="save-button create-icon-button" onClick={saveCard} disabled={recording || rec.micStatus === 'preparing' || rec.starting || processingVoice || draftLoading || busy || !isFirebaseConfigured || loading} aria-label={busy ? 'キロクを保存しています' : 'キロクする'} title={busy ? 'キロクを保存しています' : 'キロクする'} data-testid="button-save-card"><Check size={21} /></button>
            </div>
          </DetailDialogShell>
        </div>
      )}

      {photoEditorSource && (
        <PhotoEditor
          source={photoEditorSource}
          onCancel={() => {
            const previous = photoBeforeEditor.current;
            setPhoto(previous?.photo ?? '');
            setPendingPhotoBlob(previous?.pendingPhotoBlob ?? null);
            photoBeforeEditor.current = null;
            setPhotoEditorSource('');
          }}
          onUseOriginal={() => {
            if (!pendingPhotoBlob) return;
            setPhoto(URL.createObjectURL(pendingPhotoBlob));
            photoBeforeEditor.current = null;
            setPhotoEditorSource('');
            setError('');
            setNotice('写真をそのまま使います。');
          }}
          onApply={(processedPhoto) => {
            setPhoto(processedPhoto);
            setPendingPhotoBlob(null);
            photoBeforeEditor.current = null;
            setPhotoEditorSource('');
            setError('');
            setNotice('ととのえた写真をこのキロクに使います。');
          }}
        />
      )}

      {detail && !editOpen && (
        <div className="overlay" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) closeDetail(); }}>
          <DetailDialogShell label={`${detail.itemName}のキロク`} returnSelector={`[data-testid="button-detail-${detail.id}"]`} onClose={closeDetail}>
            <button type="button" className="icon-button" disabled={busy} style={{ position: 'absolute', zIndex: 2, right: 25, top: 25 }} onClick={closeDetail} aria-label="閉じる" data-testid="button-close-detail"><X size={19} /></button>
            {detail.photo ? <img className="detail-image" src={detail.photo} alt={`${detail.itemName}の写真`} /> : <div className="detail-image-placeholder"><ImageIcon size={54} /></div>}
            <div className="detail-meta">
              <div><h2 className="detail-name">{detail.itemName}</h2><p className="detail-date" data-testid="text-detail-created-at">キロクした日時：{formatStamp(detail.createdAt)}</p><p className="detail-date" data-testid="text-detail-category">カテゴリ: {categoryName(detail.categoryId) ?? (detail.categoryId ? '読み込み中のカテゴリ' : '未分類')}</p>{!readOnlyMode && <div className="detail-category"><CategorySelect id="detail-category" categories={categories} value={detail.categoryId ?? null} onChange={(id) => void changeDetailCategory(id)} disabled={busy || catBusy} testId="select-detail-category" /></div>}{getVoices(detail).length === 0 && <p className="detail-date">このキロクには、まだ声がありません</p>}</div>
              <div className="detail-actions">
                {getVoices(detail).map((v, i, all) => { const on = playing && playingItemId === detail.id && playingUrl === v.url; return (
                  <button key={v.id} type="button" className="record-button primary" onClick={() => playDetailVoice(v.url)} data-testid={i === 0 ? 'button-play-detail-voice' : `button-play-detail-voice-${i}`}>{on ? <Pause size={16} /> : <Play size={16} />}{on ? 'とめる' : all.length > 1 ? `声${i + 1}をきく` : '声をきく'}</button>); })}
                 {!readOnlyMode && <button type="button" className="record-button" disabled={busy} onClick={() => { stopPlayback(); setEditOpen(true); }} data-testid="button-edit-card"><Pencil size={15} /> へんしゅう</button>}
                 {!readOnlyMode && <button type="button" className="plain-action" disabled={busy} onClick={() => setConfirmDelete((value) => !value)} aria-label="このキロクを削除" data-testid="button-delete-card"><Trash2 size={17} /></button>}
              </div>
            </div>
            {confirmDelete && !readOnlyMode && <div className="delete-confirm" role="alert"><AlertCircle size={16} />写真・声・このキロクを完全に削除しますか？<button type="button" disabled={busy} onClick={deleteCard} data-testid="button-confirm-delete">{busy ? '削除中…' : '削除する'}</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>やめる</button></div>}
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
            if (readOnlyMode) return;
            const saved = await editKeepsake(base, changes, editId);
            setDetail((current) => current && current.id === saved.id ? saved : current);
            setItems((list) => list.map((entry) => entry.id === saved.id ? saved : entry));
          }}
        />
      )}
      {settingsOpen && <SettingsDialog
        settings={gallerySettings}
        readOnlyMode={readOnlyMode}
        onToggleReadOnlyMode={() => setReadOnlyMode((enabled) => !enabled)}
        onClose={() => setSettingsOpen(false)}
        onSave={async (next) => {
          try {
            await saveGallerySettings(next);
            setGallerySettings(next);
          } catch (caught) {
            throw new Error(firebaseError(caught));
          }
        }}
      />}
    </div>
  );
}

export default App;
