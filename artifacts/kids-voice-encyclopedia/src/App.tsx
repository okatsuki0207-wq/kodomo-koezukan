import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertCircle,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  CircleHelp,
  Eye,
  GripVertical,
  Image as ImageIcon,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Settings,
  Share2,
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
import VoiceTrimEditor from './components/VoiceTrimEditor';
import { useEditRecording } from './hooks/useEditRecording';
import { useNewKeepsakeDraft } from './hooks/useNewKeepsakeDraft';
import { VoicePlayback, VoiceShuffleBag } from './lib/voicePlayback';
import DetailDialogShell from './components/DetailDialogShell';
import StartScreen from './components/StartScreen';
import ShareDialog from './components/ShareDialog';
import SettingsDialog from './components/SettingsDialog';
import SharePasswordGate from './components/SharePasswordGate';
import ModeLockDialog from './components/ModeLockDialog';
import { useCategories } from './hooks/useCategories';
import { filterByCategory } from './lib/categories';
import { DEFAULT_GALLERY_SETTINGS, normalizeGallerySettings, orderCardsInCategory, orderCategories, sortGalleryItems, UNCATEGORIZED_CATEGORY_KEY, type GallerySettings } from './lib/gallerySettings';
import { deleteKeepsake, editKeepsake, firebaseError, saveGallerySettings, saveKeepsake, subscribeGallerySettings, subscribeKeepsakes, subscribeLiveShare, updateKeepsakeCategory, type Keepsake } from './lib/keepsakeStore';
import type { SharedBook, ShareId } from './lib/shareRepository';
import { decodeShareToken } from './lib/shareCrypto';
import { getVoices, type VoiceAsset } from './lib/voiceAssets';
import { trimLeadingSilence } from './lib/audioTrim';
import { preloadRecordingGuide } from './lib/recordingCue';
import { hasNewKeepsakeDraftContent, type NewKeepsakeDraftInput } from './lib/newKeepsakeDraft';
import { isFirebaseConfigured } from './firebaseConfig';
import './index.css';
import './components/sharing.css';

function formatStamp(timestamp: number) {
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(timestamp);
}

function readShareRoute(): { token: ShareId | null } | null {
  if (typeof window === 'undefined' || !window.location.hash.startsWith('#share=')) return null;
  const rawToken = window.location.hash.slice('#share='.length);
  return { token: decodeShareToken(rawToken) };
}

type ReorderPointerState = {
  pointerId: number;
  kind: 'category' | 'card';
  sourceId: string;
  sourceElement: HTMLElement;
  startX: number;
  startY: number;
  dragging: boolean;
  lastTargetId: string | null;
};

function swapOrderIds(ids: readonly string[], firstId: string, secondId: string) {
  const first = ids.indexOf(firstId);
  const second = ids.indexOf(secondId);
  if (first < 0 || second < 0 || first === second) return [...ids];
  const next = [...ids];
  [next[first], next[second]] = [next[second], next[first]];
  return next;
}

function App() {
  const [items, setItems] = useState<Keepsake[]>([]);
  const [shareRoute] = useState(readShareRoute);
  const [sharedBook, setSharedBook] = useState<SharedBook | null>(null);
  const [shareMode, setShareMode] = useState<'loading' | 'live' | 'legacy' | 'error'>('loading');
  const [shareAccessError, setShareAccessError] = useState('');
  const [localReadOnly, setLocalReadOnly] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reorderEditMode, setReorderEditMode] = useState(false);
  const [reorderSettings, setReorderSettings] = useState<GallerySettings | null>(null);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [reorderError, setReorderError] = useState('');
  const [reorderStatus, setReorderStatus] = useState('');
  const [reorderDraggingId, setReorderDraggingId] = useState<string | null>(null);
  const [reorderOverId, setReorderOverId] = useState<string | null>(null);
  const [gallerySettings, setGallerySettings] = useState<GallerySettings>(() => ({
    ...DEFAULT_GALLERY_SETTINGS,
    categoryOrder: [...DEFAULT_GALLERY_SETTINGS.categoryOrder],
    cardOrderByCategory: {},
  }));
  const [settingsIssue, setSettingsIssue] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [view, setView] = useState<'start' | 'library'>(shareRoute ? 'library' : 'start');
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Keepsake | null>(null);
  const [itemName, setItemName] = useState('');
  const [photo, setPhoto] = useState('');
  const [pendingPhotoBlob, setPendingPhotoBlob] = useState<Blob | null>(null);
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
  const reorderPointer = useRef<ReorderPointerState | null>(null);
  const suppressClickUntil = useRef(0);
  const pendingReorderAfterUnlock = useRef(false);
  const localDraft = useNewKeepsakeDraft();
  const { categories, error: categoryIssue, create: createCategoryEntry, describeError } = useCategories(connectionAttempt, !shareRoute);
  useEffect(() => {
    if (shareRoute) {
      setSettingsLoading(false);
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setSettingsLoading(true);
    setSettingsIssue('');
    const fail = (caught: unknown) => {
      if (cancelled) return;
      const code = caught && typeof caught === 'object' && 'code' in caught
        ? (caught as { code?: string }).code
        : undefined;
      setSettingsIssue(code === 'permission-denied'
        ? 'Firestore の設定読み取りが拒否されました。firebase/firestore.rules の更新をFirebase Consoleで公開し、「再接続」を押してください。'
        : firebaseError(caught));
      setSettingsLoading(false);
    };
    subscribeGallerySettings((next) => {
      if (cancelled) return;
      setGallerySettings(next);
      setSettingsIssue('');
      setSettingsLoading(false);
    }, fail).then((stop) => {
      if (cancelled) stop();
      else unsubscribe = stop;
    }).catch(fail);
    return () => { cancelled = true; unsubscribe?.(); };
  }, [connectionAttempt, shareRoute]);
  const readOnly = !!shareRoute || localReadOnly;
  const shownItems = sharedBook?.items ?? items;
  const activeGallerySettings = sharedBook?.settings ?? gallerySettings;
  const displayedGallerySettings = reorderEditMode && reorderSettings
    ? { ...reorderSettings, displayMode: 'ordered' as const }
    : activeGallerySettings;
  const shownCategories = orderCategories(sharedBook?.categories ?? categories, displayedGallerySettings);
  const visibleItems = sortGalleryItems(filterByCategory(shownItems, selectedCategory), shownCategories, displayedGallerySettings, selectedCategory);
  const categoryName = (id: string | null | undefined) => shownCategories.find((c) => c.id === id)?.name;
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
    if (shareRoute) return;
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
  }, [localDraft.load, shareRoute]);
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
  }, [items, selectedCategory, playback, sharedBook]);

  useEffect(() => {
    const currentIds = new Set(shownItems.map((item) => item.id));
    for (const id of voiceShuffleBags.current.keys()) {
      if (!currentIds.has(id)) voiceShuffleBags.current.delete(id);
    }
    for (const item of shownItems) {
      const voices = getVoices(item);
      if (!voices.length) continue;
      let bag = voiceShuffleBags.current.get(item.id);
      if (!bag) {
        bag = new VoiceShuffleBag((candidate) => candidate.id);
        voiceShuffleBags.current.set(item.id, bag);
      }
      bag.prepare(voices);
    }
  }, [shownItems]);

  useEffect(() => {
    if (shareRoute) {
      setItems([]);
      setLoading(false);
      setStorageIssue('');
      return;
    }
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
  }, [connectionAttempt, shareRoute]);

  useEffect(() => {
    if (!shareRoute) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    setShareMode('loading');
    setShareAccessError('');
    if (!shareRoute.token) {
      setShareAccessError('共有リンクが正しくありません。リンクを送ってくれた人に確認してください。');
      setShareMode('error');
      return;
    }
    void subscribeLiveShare(
      shareRoute.token,
      (book) => {
        if (!cancelled) {
          setSharedBook(book);
          setShareMode('live');
          setSelectedCategory(null);
        }
      },
      (caught) => {
        if (!cancelled) {
          setShareAccessError(firebaseError(caught));
          setShareMode('error');
        }
      },
    ).then((stop) => {
      if (cancelled) stop?.();
      else if (stop) {
        unsubscribe = stop;
        setShareMode('live');
      } else setShareMode('legacy');
    }).catch((caught) => {
      if (cancelled) return;
      setShareAccessError(caught instanceof Error ? caught.message : '共有リンクを開けませんでした。');
      setShareMode('error');
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [shareRoute]);

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

  useEffect(() => () => {
    sharedBook?.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [sharedBook]);

  const stopPlayback = () => playback.stop();

  const beginReorderEditing = () => {
    createDraftSession.current++;
    stopPlayback();
    setSettingsOpen(false);
    setView('library');
    setSelectedCategory(null);
    setReorderSettings(normalizeGallerySettings(gallerySettings));
    setReorderError('');
    setReorderStatus('カテゴリやキロクをつかんで動かせます。');
    setReorderEditMode(true);
  };

  const finishReorderEditing = async () => {
    if (!reorderSettings || reorderSaving) return;
    setReorderSaving(true);
    setReorderError('');
    try {
      await saveGallerySettings(normalizeGallerySettings(reorderSettings));
      setGallerySettings(normalizeGallerySettings(reorderSettings));
      setReorderEditMode(false);
      setReorderSettings(null);
      setReorderStatus('');
      setReorderDraggingId(null);
      setReorderOverId(null);
    } catch (caught) {
      setReorderError(firebaseError(caught));
    } finally {
      setReorderSaving(false);
    }
  };

  const moveCategory = (sourceId: string, targetId: string) => {
    const current = reorderSettings;
    if (!current) return false;
    const ids = orderCategories(categories, current).map((category) => category.id);
    const nextIds = swapOrderIds(ids, sourceId, targetId);
    if (nextIds.every((id, index) => id === ids[index])) return false;
    setReorderSettings((value) => value ? { ...value, categoryOrder: swapOrderIds(orderCategories(categories, value).map((category) => category.id), sourceId, targetId) } : value);
    const name = categories.find((category) => category.id === sourceId)?.name ?? 'カテゴリ';
    setReorderStatus(`${name}を並べ替えました。`);
    return true;
  };

  const moveCategoryByOffset = (id: string, offset: number) => {
    const ids = orderCategories(categories, reorderSettings ?? activeGallerySettings).map((category) => category.id);
    const index = ids.indexOf(id);
    const targetId = ids[index + offset];
    if (targetId) moveCategory(id, targetId);
  };

  const moveCard = (sourceId: string, targetId: string) => {
    const source = shownItems.find((item) => item.id === sourceId);
    const target = shownItems.find((item) => item.id === targetId);
    if (!source || !target || (source.categoryId ?? null) !== (target.categoryId ?? null)) return false;
    const current = reorderSettings;
    if (!current) return false;
    const categoryId = source.categoryId ?? null;
    const ids = orderCardsInCategory(shownItems, categoryId, current).map((item) => item.id);
    const nextIds = swapOrderIds(ids, sourceId, targetId);
    if (nextIds.every((id, index) => id === ids[index])) return false;
    const key = categoryId ?? UNCATEGORIZED_CATEGORY_KEY;
    setReorderSettings((value) => value ? {
      ...value,
      cardOrderByCategory: {
        ...value.cardOrderByCategory,
        [key]: swapOrderIds(orderCardsInCategory(shownItems, categoryId, value).map((item) => item.id), sourceId, targetId),
      },
    } : value);
    setReorderStatus(`${source.itemName}を並べ替えました。`);
    return true;
  };

  const moveCardByOffset = (id: string, offset: number) => {
    const item = shownItems.find((entry) => entry.id === id);
    if (!item || !reorderSettings) return;
    const ordered = orderCardsInCategory(shownItems, item.categoryId ?? null, reorderSettings);
    const index = ordered.findIndex((entry) => entry.id === id);
    const target = ordered[index + offset];
    if (target) moveCard(id, target.id);
  };

  const handleReorderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!reorderEditMode) return;
    const source = (event.target as HTMLElement).closest<HTMLElement>('[data-reorder-kind][data-reorder-id]');
    const kind = source?.dataset.reorderKind;
    const sourceId = source?.dataset.reorderId;
    if ((kind !== 'category' && kind !== 'card') || !sourceId) return;
    reorderPointer.current = {
      pointerId: event.pointerId,
      kind,
      sourceId,
      sourceElement: source,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      lastTargetId: null,
    };
  };

  const handleReorderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = reorderPointer.current;
    if (!reorderEditMode || !gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.dragging) {
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 9) return;
      gesture.dragging = true;
      try { gesture.sourceElement.setPointerCapture(event.pointerId); } catch { /* pointer capture is an optional drag enhancement */ }
      setReorderDraggingId(gesture.sourceId);
    }
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-reorder-drop-kind][data-reorder-drop-id]');
    if (!target || target.dataset.reorderDropKind !== gesture.kind) return;
    const targetId = target.dataset.reorderDropId;
    if (!targetId || targetId === gesture.sourceId || targetId === gesture.lastTargetId) return;
    const moved = gesture.kind === 'category'
      ? moveCategory(gesture.sourceId, targetId)
      : moveCard(gesture.sourceId, targetId);
    if (moved) {
      gesture.lastTargetId = targetId;
      setReorderOverId(targetId);
    }
  };

  const handleReorderPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = reorderPointer.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.dragging) suppressClickUntil.current = performance.now() + 350;
    reorderPointer.current = null;
    setReorderDraggingId(null);
    setReorderOverId(null);
  };

  const handleReorderClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (performance.now() >= suppressClickUntil.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickUntil.current = 0;
  };

  const longPress = useLongPress<Keepsake>((item) => {
    const current = items.find((entry) => entry.id === item.id);
    if (!readOnly && !mutationLock.current && current) openDetail(current);
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
    if (readOnly) return;
    stopPlayback();
    setError('');
    setDetail(item);
    setEditOpen(false);
    setConfirmDelete(false);
  };

  const playKeepsake = (item: Keepsake) => {
    const voices = getVoices(item);
    if (!voices.length) {
      if (!readOnly) openDetail(item);
      return;
    }
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

  const openCreate = () => {
    if (busy) return;
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
    if (mutationLock.current || recording || processingVoice || rec.starting) return;
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
      setView('library');
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
  const enterReadOnly = () => {
    createDraftSession.current++;
    stopPlayback();
    setView('library');
    setLocalReadOnly(true);
    setReorderEditMode(false);
    setReorderSettings(null);
    setReorderError('');
    setDetail(null);
    setEditOpen(false);
    setCreateOpen(false);
    setPhotoEditorSource('');
    setCategoryOpen(false);
    setNewCatInCreate(false);
    setShareOpen(false);
  };
  const finishUnlock = () => {
    setUnlockOpen(false);
    if (shareRoute) {
      window.location.replace(`${window.location.pathname}${window.location.search}`);
      return;
    }
    const enterReorder = pendingReorderAfterUnlock.current;
    pendingReorderAfterUnlock.current = false;
    setLocalReadOnly(false);
    if (enterReorder) beginReorderEditing();
  };
  const chooseEditMode = () => {
    setSettingsOpen(false);
    if (readOnly) {
      pendingReorderAfterUnlock.current = true;
      setUnlockOpen(true);
      return;
    }
    beginReorderEditing();
  };
  const acceptSharedBook = (book: SharedBook) => {
    setSelectedCategory(null);
    setSharedBook(book);
    setView('library');
  };

  return (
    <div
      className={`app-shell${reorderEditMode ? ' is-reorder-mode' : ''}`}
      onPointerDownCapture={handleReorderPointerDown}
      onPointerMoveCapture={handleReorderPointerMove}
      onPointerUpCapture={handleReorderPointerEnd}
      onPointerCancelCapture={handleReorderPointerEnd}
      onClickCapture={handleReorderClickCapture}
    >
      <header className="topbar" inert={createOpen || !!detail || categoryOpen || shareOpen || settingsOpen || unlockOpen}>
        <button type="button" className="brand brand-home" onClick={() => setView('start')} disabled={readOnly || reorderEditMode} aria-label="こどもの こえずかん スタート画面" data-testid="button-home">
          <span className="brand-mark"><BookOpen size={20} strokeWidth={1.8} /></span>
          <h1 className="brand-title" style={{ margin: 0 }}>こどもの こえずかん</h1>
        </button>
        <div className="topbar-actions">
          {view === 'library' && !readOnly && !reorderEditMode && <button type="button" className="header-create" onClick={openCreate} data-testid="button-create-card"><Plus size={18} /><span>キロクする</span></button>}
          {!shareRoute && !reorderEditMode && <button type="button" className="header-settings-button" onClick={() => { stopPlayback(); setSettingsOpen(true); }} disabled={!readOnly && (settingsLoading || !!settingsIssue)} aria-label="設定" title="設定" data-testid="button-settings"><Settings size={17} /></button>}
          {!readOnly && !reorderEditMode && isFirebaseConfigured && <button type="button" className="header-share-button" onClick={() => { createDraftSession.current++; setShareOpen(true); }} aria-label="ずかんを共有する" data-testid="button-share-encyclopedia"><Share2 size={15} /><span>共有</span></button>}
        </div>
      </header>

      {reorderEditMode && (
        <aside className="reorder-complete-bar" aria-label="並び替え編集">
          <p className="reorder-instructions">カテゴリを横に、キロクを同じページの中で動かせます。</p>
          <p className="reorder-live-status" role="status" aria-live="polite">{reorderError || reorderStatus}</p>
          <button type="button" className="reorder-complete-button" onClick={() => void finishReorderEditing()} disabled={reorderSaving} data-testid="button-finish-reorder">
            <Check size={19} />{reorderSaving ? '並び順を保存しています…' : '編集を完了する'}
          </button>
        </aside>
      )}

      {shareRoute && (shareMode === 'loading' || shareMode === 'error') ? (
        <main className="share-gate-main">
          <section className="share-gate-card" aria-live="polite">
            {shareMode === 'loading'
              ? <p className="share-gate-copy" role="status">共有されたずかんを読み込んでいます…</p>
              : <p className="share-error" role="alert">{shareAccessError}</p>}
          </section>
        </main>
      ) : shareRoute && shareMode === 'legacy' && !sharedBook ? <SharePasswordGate token={shareRoute.token} onUnlocked={acceptSharedBook} /> : view === 'start' && !readOnly ? (
        <main className="start-main" inert={createOpen || !!detail || categoryOpen || shareOpen || settingsOpen || unlockOpen}>
          <StartScreen onRecord={openCreate} onOpenEncyclopedia={() => { createDraftSession.current++; setView('library'); }} />
        </main>
      ) : (
      <main className={`page-main${reorderEditMode ? ' is-reorder-mode' : ''}`} inert={createOpen || !!detail || categoryOpen || shareOpen || settingsOpen || unlockOpen}>
        <CategoryBar
          categories={shownCategories}
          selected={selectedCategory}
          onSelect={(id) => { stopPlayback(); setSelectedCategory(id); }}
          onNew={() => setCategoryOpen(true)}
          disabled={busy || reorderSaving}
          readOnly={readOnly}
          reorderMode={reorderEditMode}
          reorderOverId={reorderOverId}
          reorderDraggingId={reorderDraggingId}
          onMoveCategory={moveCategoryByOffset}
        />
        {!shareRoute && categoryIssue && <div className="notice" role="alert" data-testid="status-categories-load-error"><AlertCircle size={16} />{categoryIssue}
          <button type="button" className="record-button" onClick={() => setConnectionAttempt((value) => value + 1)} disabled={busy}>再接続</button>
        </div>}
        {!shareRoute && storageIssue && <div className="notice" role="alert" data-testid="status-storage-error"><AlertCircle size={16} />{storageIssue}
          {isFirebaseConfigured && <button type="button" className="record-button" onClick={() => setConnectionAttempt((value) => value + 1)} disabled={busy}>再接続</button>}
        </div>}
        {!shareRoute && settingsIssue && <div className="notice" role="alert" data-testid="status-gallery-settings-error"><AlertCircle size={16} /><span className="notice-message">並び替え設定を読み込めませんでした。{settingsIssue}</span>
          <button type="button" className="record-button" onClick={() => setConnectionAttempt((value) => value + 1)} disabled={busy || settingsLoading}>再接続</button>
        </div>}
        {error && !createOpen && !detail && <p className="form-error" role="alert">{error}</p>}

        <div id="category-panel" role="tabpanel" aria-labelledby={`category-tab-${selectedCategory ?? 'all'}`}>
        {!shareRoute && loading ? <p className="notice neutral" role="status">Firebase から図鑑を読み込んでいます…</p> : shownItems.length === 0 && selectedCategory === null ? (
          <section className="empty-state" data-testid="empty-keepsakes">
            <div className="empty-illustration"><BookOpen size={46} strokeWidth={1.35} /></div>
            <h2 className="empty-title">{readOnly ? 'このずかんは、まだまっさらです' : 'まだ、まっさらなページ'}</h2>
            <p className="empty-copy">{readOnly ? '共有されたキロクは、まだありません。' : <>いちばん最初のキロクを残してみよう。<br />写真といっしょに、声も大切にしまえます。</>}</p>
            {!readOnly && <button type="button" className="empty-action" onClick={openCreate} data-testid="button-empty-create">はじめのキロクを残す</button>}
          </section>
        ) : visibleItems.length === 0 ? (
          <section className="empty-state category-empty" data-testid="empty-category">
            <div className="empty-illustration"><BookOpen size={46} strokeWidth={1.35} /></div>
            <h2 className="empty-title">{categoryName(selectedCategory) ?? 'このカテゴリ'}は、まだ空っぽ</h2>
            <p className="empty-copy">{readOnly ? 'このページには、まだキロクがありません。' : <>このページはまだ空っぽ。<br />新しいキロクを残すか、ほかのキロクのページを変えられます。</>}</p>
            {!readOnly && <button type="button" className="empty-action" onClick={openCreate} data-testid="button-category-empty-create">このページにキロクする</button>}
          </section>
        ) : (
          <section className={`sticker-collage${reorderEditMode ? ' reorder-enabled' : ''}`} aria-label="わが家のキロク" data-testid="grid-keepsakes">
            {visibleItems.map((item) => (
              <article
                key={item.id}
                className={`sticker-item${playing && playingItemId === item.id ? ' is-playing' : ''}`}
                data-reorder-drop-kind={reorderEditMode ? 'card' : undefined}
                data-reorder-drop-id={reorderEditMode ? item.id : undefined}
                data-reorder-dragging={reorderDraggingId === item.id ? 'true' : undefined}
                data-reorder-over={reorderOverId === item.id ? 'true' : undefined}
                data-testid={`card-keepsake-${item.id}`}
              >
                <button
                  type="button"
                  className={`sticker-photo-button${reorderEditMode ? ' reorderable' : ''}`}
                  onClick={() => { if (!reorderEditMode) playKeepsake(item); }}
                  {...(!reorderEditMode ? longPress(item) : {})}
                  aria-label={reorderEditMode ? `${item.itemName}のキロク。並び替えはつまみを使います` : getVoices(item).length ? `${item.itemName}の声をきく` : item.itemName}
                  data-testid={`button-play-card-${item.id}`}
                >
                  {item.photo
                    ? <img className="sticker-photo" src={item.photo} alt={`${item.itemName}の写真`} data-testid={`img-sticker-${item.id}`} />
                    : <ImageIcon size={44} />}
                  {playing && playingItemId === item.id && <span className="voice-notes" aria-hidden="true"><span>♪</span><span>♫</span><span>♪</span></span>}
                </button>
                {reorderEditMode && <button
                  type="button"
                  className="sticker-reorder-handle"
                  data-reorder-kind="card"
                  data-reorder-id={item.id}
                  aria-label={`${item.itemName}を並べ替え。Altキーと上下矢印でも移動できます`}
                  onClick={(event) => event.preventDefault()}
                  onKeyDown={(event) => {
                    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                    event.preventDefault();
                    moveCardByOffset(item.id, event.key === 'ArrowDown' ? 1 : -1);
                  }}
                  data-testid={`button-reorder-card-${item.id}`}
                ><GripVertical size={17} aria-hidden="true" /></button>}
                {readOnly || reorderEditMode
                  ? <span className="sticker-name" data-testid={`text-card-name-${item.id}`}>{item.itemName}</span>
                  : <button type="button" className="sticker-name" onClick={() => openDetail(item)} aria-label={`${item.itemName}の写真を大きく表示`} data-testid={`button-detail-${item.id}`}>{item.itemName}</button>}
                <span className="sr-only" role="status">{playing && playingItemId === item.id ? `${item.itemName}の声を再生中` : ''}</span>
              </article>
            ))}
          </section>
        )}

        </div>
        <footer className="footer-note">{readOnly ? <><Eye size={14} /> 閲覧専用モード。キロクの変更はできません。</> : <><Sparkles size={14} /> 写真と声はFirebaseに保存します。同じブラウザの匿名アカウントで閲覧できます。</>}</footer>
      </main>
      )}

      {createOpen && !readOnly && !photoEditorSource && (
        <div className="overlay" role="presentation" inert={newCatInCreate} onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreate(); }}>
          <DetailDialogShell className="dialog" label="新しいキロクをつくる" returnSelector='[data-testid="button-create-card"]' onClose={closeCreate}>
            <div className="dialog-head">
              <div><h2 id="create-title" className="dialog-title">新しいキロクをつくる</h2><p className="dialog-lede">お気に入りの写真と声をいっしょに残します。</p></div>
              <button type="button" className="icon-button" disabled={busy} onClick={closeCreate} aria-label="閉じる" data-testid="button-close-create"><X size={19} /></button>
            </div>
            <div className="form-block">
              <label className="field-label" htmlFor="keepsake-item-name">なまえ</label>
              <p className="field-hint">写真のものの名前を入力してください。</p>
              <input id="keepsake-item-name" className="title-input" disabled={busy || draftLoading} value={itemName} onChange={(event) => setItemName(event.currentTarget.value)} placeholder="りんご、ライオン、赤バス など" maxLength={48} data-testid="input-item-name" />
            </div>
            <div className="form-block">
              <CategorySelect id="create-category" categories={categories} value={cardCategory} onChange={setCardCategory} disabled={busy || draftLoading} testId="select-card-category" onNew={() => setNewCatInCreate(true)} />
            </div>
            <div className="form-block">
              <span className="field-label">写真</span>
              <input ref={photoInput} className="sr-only" type="file" accept="image/*" disabled={busy || draftLoading || recording || rec.starting || processingVoice} onChange={onPhotoChange} aria-label="写真を選ぶ" data-testid="input-card-photo" />
              <div className="photo-composition">
                <button type="button" className={`photo-picker${photo ? ' has-photo' : ''}`} disabled={busy || draftLoading || recording || rec.starting || processingVoice} onClick={() => photoInput.current?.click()} data-testid="button-select-photo">
                  {photo && <img src={photo} alt="選んだ写真" />}
                  {!photo && <span className="picker-content">
                    <Camera size={23} />
                    <strong>写真をえらぶ・撮る</strong>
                    <span>写真ライブラリから選ぶか、カメラで撮影できます</span>
                  </span>}
                </button>
                {photo && <button type="button" className="photo-change" aria-label="写真を変更" disabled={busy || draftLoading || recording || rec.starting || processingVoice} onClick={() => photoInput.current?.click()}>写真を変更</button>}
              </div>
            </div>
            <div className="form-block">
              <div className="record-panel">
                <div className="record-top">
                  <div className="record-title"><Mic size={16} /> 声をのこす <span className="record-status" role="status" aria-live="polite">{rec.guiding ? 'これはなーに？' : recording ? `録音中 ${formatTime(recordSeconds)}` : voice ? '録音できました' : 'あとからでも大丈夫'}</span></div>
                  {recording && <div className="recording-wave" aria-label="録音中"><i /><i /><i /><i /><i /><i /><i /></div>}
                </div>
                <RecordingGuide
                  name={itemName}
                  photo={photo || undefined}
                  phase={rec.guiding || rec.starting ? 'guide' : recording ? 'recording' : 'idle'}
                  guideDurationMs={rec.guideDurationMs}
                  guideProgress={rec.guideProgress}
                  recordingStartSignal={recordingSession.current}
                />
                <div className="record-actions">
                  {recording ? (
                    <button type="button" className="record-button danger" onClick={stopRecording} data-testid="button-stop-recording"><span className="recording-dot" /> 録音をとめる</button>
                  ) : (
                    <button type="button" className="record-button primary" disabled={processingVoice || busy || draftLoading || rec.micStatus === 'preparing' || rec.starting || !photo} onClick={startRecording} data-testid="button-start-recording"><Mic size={15} /> {rec.micStatus === 'preparing' || rec.starting ? '録音の準備中…' : processingVoice ? '音声を準備しています…' : voice ? 'もう一度録音' : '録音する'}</button>
                  )}
                  {rec.starting && <button type="button" className="record-button" onClick={rec.cancel}>やめる</button>}
                  {voice && !recording && !processingVoice && !rec.starting && <>
                    <button type="button" className="record-button" disabled={busy} onClick={() => playback.play(voice, 'voice-preview')} data-testid="button-preview-recording">{playing && playingUrl === voice ? <Pause size={15} /> : <Play size={15} />}{playing && playingUrl === voice ? 'とめる' : '声をきく'}</button>
                    <button type="button" className="record-button" disabled={busy} onClick={() => { stopPlayback(); setVoice(null); setVoiceBlob(null); setTrimOpen(false); setNotice('録音を消しました。'); }} aria-label="録音を消す" data-testid="button-remove-recording"><RotateCcw size={15} /></button>
                  </>}
                </div>
                {rec.micStatus === 'preparing' && <p className="field-hint mic-ready" role="status">マイクを確認しています。許可を聞かれたら「許可」を選んでください。</p>}
                {voice && !recording && !processingVoice && !rec.starting && (
                  <>
                    <button type="button" className="record-button waveform-toggle" aria-expanded={trimOpen} aria-controls="new-keepsake-waveform" disabled={busy || draftLoading} onClick={() => setTrimOpen((open) => !open)} data-testid="button-open-waveform-trim">
                      <Scissors size={15} /> 波形を見てカット <ChevronDown size={14} className={trimOpen ? 'waveform-chevron is-open' : 'waveform-chevron'} />
                    </button>
                    {trimOpen && <div className="new-waveform-panel" id="new-keepsake-waveform">
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
                    </div>}
                  </>
                )}
                <p className="field-hint">※録音した声は、後から図鑑カード長押しで編集できます</p>
              </div>
              {rec.error && <div className="notice" role="status" data-testid="status-microphone">{<CircleHelp size={16} />}{rec.error}</div>}
              {rec.micStatus === 'ready' && !recording && !rec.starting && !processingVoice && <p className="field-hint mic-ready">マイクの準備ができました。</p>}
              {notice && !rec.error && <div className="notice neutral" role="status"><Check size={15} />{notice}</div>}
              {(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') && <div className="notice" role="status" data-testid="status-unsupported-browser"><CircleHelp size={16} />このブラウザでは録音できません。録音以外のカード機能はお使いいただけます。</div>}
              {recording && <p className="sr-only" aria-live="polite">録音中です。録音時間 {formatTime(recordSeconds)}</p>}
              {processingVoice && <p className="notice neutral" role="status">音声を準備しています。録音後は冒頭の無音をカットします…</p>}
              <p className="field-hint">{!photo ? '先に写真をえらぼう。' : '「これはなーに？」が終わったら話してね。'}録音は最大60秒。</p>
            </div>
            {error && <p className="form-error" role="alert" data-testid="status-form-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="cancel-button" disabled={busy} onClick={closeCreate} data-testid="button-cancel-create">やめる</button>
              <button type="button" className="save-button" onClick={saveCard} disabled={recording || rec.micStatus === 'preparing' || rec.starting || processingVoice || draftLoading || busy || !isFirebaseConfigured || !!storageIssue || loading} data-testid="button-save-card"><Check size={16} /> {busy ? 'キロクを残しています…' : 'キロクする'}</button>
            </div>
            {!isFirebaseConfigured && <p className="form-error" role="status">保存にはFirebaseの設定が必要です。src/firebaseConfig.ts をご確認ください。</p>}
          </DetailDialogShell>
        </div>
      )}

      {photoEditorSource && !readOnly && (
        <PhotoEditor
          source={photoEditorSource}
          onCancel={() => { setPendingPhotoBlob(null); setPhotoEditorSource(''); }}
          onApply={(processedPhoto) => {
            setPhoto(processedPhoto);
            setPendingPhotoBlob(null);
            setPhotoEditorSource('');
            setError('');
            setNotice('ととのえた写真をこのキロクに使います。');
          }}
        />
      )}

      {detail && !readOnly && !editOpen && (
        <div className="overlay" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) closeDetail(); }}>
          <DetailDialogShell label={`${detail.itemName}のキロク`} returnSelector={`[data-testid="button-detail-${detail.id}"]`} onClose={closeDetail}>
            <button type="button" className="icon-button" disabled={busy} style={{ position: 'absolute', zIndex: 2, right: 25, top: 25 }} onClick={closeDetail} aria-label="閉じる" data-testid="button-close-detail"><X size={19} /></button>
            {detail.photo ? <img className="detail-image" src={detail.photo} alt={`${detail.itemName}の写真`} /> : <div className="detail-image-placeholder"><ImageIcon size={54} /></div>}
            <div className="detail-meta">
              <div><h2 className="detail-name">{detail.itemName}</h2><p className="detail-date" data-testid="text-detail-created-at">キロクした日時：{formatStamp(detail.createdAt)}</p><p className="detail-date" data-testid="text-detail-category">カテゴリ: {categoryName(detail.categoryId) ?? (detail.categoryId ? '読み込み中のカテゴリ' : '未分類')}</p><div className="detail-category"><CategorySelect id="detail-category" categories={categories} value={detail.categoryId ?? null} onChange={(id) => void changeDetailCategory(id)} disabled={busy || catBusy} testId="select-detail-category" /></div>{getVoices(detail).length === 0 && <p className="detail-date">このキロクには、まだ声がありません</p>}</div>
              <div className="detail-actions">
                {getVoices(detail).map((v, i, all) => { const on = playing && playingItemId === detail.id && playingUrl === v.url; return (
                  <button key={v.id} type="button" className="record-button primary" onClick={() => playDetailVoice(v.url)} data-testid={i === 0 ? 'button-play-detail-voice' : `button-play-detail-voice-${i}`}>{on ? <Pause size={16} /> : <Play size={16} />}{on ? 'とめる' : all.length > 1 ? `声${i + 1}をきく` : '声をきく'}</button>); })}
                <button type="button" className="record-button" disabled={busy} onClick={() => { stopPlayback(); setEditOpen(true); }} data-testid="button-edit-card"><Pencil size={15} /> へんしゅう</button>
                <button type="button" className="plain-action" disabled={busy} onClick={() => setConfirmDelete((value) => !value)} aria-label="このキロクを削除" data-testid="button-delete-card"><Trash2 size={17} /></button>
              </div>
            </div>
            {confirmDelete && <div className="delete-confirm" role="alert"><AlertCircle size={16} />写真・声・このキロクを完全に削除しますか？<button type="button" disabled={busy} onClick={deleteCard} data-testid="button-confirm-delete">{busy ? '削除中…' : '削除する'}</button><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>やめる</button></div>}
            {error && <p className="form-error" role="alert">{error}</p>}
          </DetailDialogShell>
        </div>
      )}
      {categoryOpen && !readOnly && (
        <CategoryDialog
          categories={categories}
          onCreate={createCategoryEntry}
          describeError={describeError}
          onClose={() => setCategoryOpen(false)}
          onCreated={(made) => { setSelectedCategory(made.id); setCategoryOpen(false); }}
        />
      )}
      {newCatInCreate && !readOnly && (
        <CategoryDialog
          categories={categories}
          onCreate={createCategoryEntry}
          describeError={describeError}
          returnSelector='[data-testid="select-card-category"]'
          onClose={() => setNewCatInCreate(false)}
          onCreated={(made) => { setCardCategory(made.id); setNewCatInCreate(false); }}
        />
      )}

      {editOpen && detail && !readOnly && (
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
      {shareOpen && !readOnly && <ShareDialog items={items} categories={categories} settings={gallerySettings} onClose={() => setShareOpen(false)} />}
      {settingsOpen && !shareRoute && <SettingsDialog
        categories={shownCategories}
        items={shownItems}
        settings={gallerySettings}
        readOnly={readOnly}
        onClose={() => setSettingsOpen(false)}
        onChooseViewMode={enterReadOnly}
        onChooseEditMode={chooseEditMode}
        onSave={async (next) => {
          try {
            await saveGallerySettings(next);
            setGallerySettings(next);
            setSettingsIssue('');
          } catch (caught) {
            throw new Error(firebaseError(caught));
          }
        }}
      />}
      {unlockOpen && readOnly && <ModeLockDialog onClose={() => { setUnlockOpen(false); pendingReorderAfterUnlock.current = false; }} onUnlock={finishUnlock} />}
    </div>
  );
}

export default App;
