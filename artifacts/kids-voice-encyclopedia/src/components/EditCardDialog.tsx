import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, Mic, Pause, Play, Plus, RotateCcw, Square, Upload, X } from 'lucide-react';
import type { Category } from '../lib/categories';
import type { Keepsake } from '../lib/keepsakeStore';
import { getVoices, MAX_VOICES, MAX_EDIT_FILES, type KeepsakeEdit, type VoiceChange } from '../lib/voiceAssets';
import { trimLeadingSilence } from '../lib/audioTrim';
import CategorySelect from './CategorySelect';
import PhotoEditor from './PhotoEditor';
import RecordingGuide from './RecordingGuide';
import VoiceTrimEditor from './VoiceTrimEditor';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { canRecord, MAX_RECORD_SECONDS, useEditRecording } from '../hooks/useEditRecording';
import './edit-media/edit-media.css';

type Props = {
  item: Keepsake;
  categories: readonly Category[];
  onSave: (base: Keepsake, changes: KeepsakeEdit, editId: string) => Promise<void>;
  describeError: (caught: unknown) => string;
  onClose: () => void;
};

type Slot = { key: string; id: string; url: string; fresh: boolean; replaced: boolean };

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function EditCardDialog({ item, categories, onSave, describeError, onClose }: Props) {
  const base = useRef(item).current; // ダイアログを開いた時点の不変な基準
  const editId = useRef(crypto.randomUUID());
  const submittedPayload = useRef<string | null>(null);
  const [name, setName] = useState(base.itemName);
  const [categoryId, setCategoryId] = useState<string | null>(base.categoryId ?? null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoSource, setPhotoSource] = useState('');
  const [slots, setSlots] = useState<Slot[]>(() =>
    getVoices(base).map((v) => ({ key: v.id, id: v.id, url: v.url, fresh: false, replaced: false })));
  const [target, setTarget] = useState<string | null>(null); // 録音/処理中のスロット
  const [processing, setProcessing] = useState(false);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [trimKey, setTrimKey] = useState<string | null>(null);
  const [trimPending, setTrimPending] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const dialog = useRef<HTMLFormElement | null>(null);
  const alive = useRef(true);
  const sessionRef = useRef(0);
  const owned = useRef(new Set<string>());
  const player = useRef<HTMLAudioElement | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const audioInput = useRef<HTMLInputElement | null>(null);
  const fileTarget = useRef<string | null>(null);
  const targetRef = useRef<string | null>(null);
  targetRef.current = target;

  const stopPlayback = useCallback(() => {
    const a = player.current;
    player.current = null;
    if (a) { a.onended = null; a.onerror = null; a.onpause = null; a.pause(); }
    setPlayingKey(null);
  }, []);

  useEffect(() => {
    const input = audioInput.current;
    const cancelled = () => {
      const key = fileTarget.current; fileTarget.current = null;
      setSlots((list) => list.filter((s) => !(s.key === key && s.fresh && !s.replaced)));
    };
    input?.addEventListener('cancel', cancelled);
    return () => input?.removeEventListener('cancel', cancelled);
  }, []);

  const applyAudio = useCallback((key: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    owned.current.add(url);
    setSlots((list) => {
      const exists = list.some((s) => s.key === key);
      if (!exists) return list;
      return list.map((s) => {
        if (s.key !== key) return s;
        if (s.url && owned.current.has(s.url)) { URL.revokeObjectURL(s.url); owned.current.delete(s.url); }
        return { ...s, url, replaced: true };
      });
    });
    setTrimKey(key);
  }, []);

  const processBlob = useCallback(async (key: string, blob: Blob, session: number) => {
    setProcessing(true); setVoiceError('');
    try {
      if (!blob.size) throw new Error('音声が空でした。');
      const trimmed = await trimLeadingSilence(blob);
      if (!alive.current || session !== sessionRef.current) return;
      applyAudio(key, trimmed);
    } catch (caught) {
      if (!alive.current || session !== sessionRef.current) return;
      setVoiceError(`音声を処理できませんでした。${caught instanceof Error ? caught.message : '別の音声でお試しください。'}`);
      // 追加スロットで未確定のものは空のまま残さない
      setSlots((list) => list.filter((s) => !(s.fresh && !s.replaced && s.key === key)));
    } finally {
      if (alive.current && session === sessionRef.current) { setProcessing(false); setTarget(null); }
    }
  }, [applyAudio]);

  const rec = useEditRecording((blob) => {
    const key = targetRef.current;
    if (key) void processBlob(key, blob, sessionRef.current);
  });

  useEffect(() => {
    alive.current = true;
    const urls = owned.current;
    return () => {
      alive.current = false;
      sessionRef.current++;
      const a = player.current;
      if (a) { a.onended = null; a.onerror = null; a.pause(); }
      player.current = null;
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  // 写真ソース用のblob URLも自分で作ったものだけ破棄
  const clearPhotoSource = () => {
    setPhotoSource((current) => { if (current.startsWith('blob:')) URL.revokeObjectURL(current); return ''; });
  };
  useEffect(() => () => { if (photoSource.startsWith('blob:')) URL.revokeObjectURL(photoSource); }, [photoSource]);

  const working = busy || rec.recording || rec.starting || processing || !!photoSource;
  const mediaLocked = working || trimPending;
  const close = () => { if (!lock.current && !photoSource) { rec.cancel(); stopPlayback(); onClose(); } };
  useDialogFocus(dialog, '[data-testid="button-edit-card"]', close);

  const onPhotoPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('写真を選んでください。'); return; }
    try { setPhotoSource(URL.createObjectURL(file)); setError(''); }
    catch { setError('写真を読み込めませんでした。別の写真を選んでください。'); }
  };

  const togglePlay = (slot: Slot) => {
    if (playingKey === slot.key) { stopPlayback(); return; }
    stopPlayback();
    const audio = new Audio(slot.url);
    player.current = audio;
    setPlayingKey(slot.key);
    const done = () => { if (player.current === audio) stopPlayback(); };
    audio.onended = done;
    audio.onpause = done;
    audio.onerror = () => { done(); if (alive.current) setVoiceError('録音を再生できませんでした。'); };
    audio.play().catch(() => { done(); if (alive.current) setVoiceError('録音を再生できませんでした。'); });
  };

  const record = async (key: string) => {
    if (mediaLocked) return;
    setTrimKey(null);
    stopPlayback(); setVoiceError(''); rec.setError('');
    setTarget(key);
    await rec.start();
  };
  useEffect(() => { if (!rec.recording && !rec.starting && !processing && target && rec.error) setTarget(null); }, [rec.recording, rec.starting, processing, target, rec.error]);

  const addSlot = (): string | null => {
    if (slots.length >= MAX_VOICES) return null;
    const key = `new-${crypto.randomUUID()}`;
    setSlots((list) => [...list, { key, id: crypto.randomUUID(), url: '', fresh: true, replaced: false }]);
    return key;
  };

  const addByRecording = () => { const key = addSlot(); if (key) void record(key); };
  const addByFile = () => { const key = addSlot(); if (key) { fileTarget.current = key; audioInput.current?.click(); } };
  const replaceByFile = (key: string) => { if (mediaLocked) return; fileTarget.current = key; audioInput.current?.click(); };

  const onAudioFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    const key = fileTarget.current;
    fileTarget.current = null;
    const dropEmpty = () => setSlots((l) => l.filter((s) => !(s.key === key && s.fresh && !s.replaced)));
    if (!file || !key) { dropEmpty(); return; }
    stopPlayback(); setVoiceError('');
    if (!file.type.startsWith('audio/')) { setVoiceError('音声ファイルを選んでください。対応していない形式です。'); dropEmpty(); return; }
    if (file.size === 0) { setVoiceError('音声ファイルが空です。'); dropEmpty(); return; }
    if (file.size >= MAX_AUDIO_BYTES) { setVoiceError('音声ファイルは20MB未満にしてください。'); dropEmpty(); return; }
    setTarget(key);
    void processBlob(key, file, sessionRef.current);
  };

  const cancelRecording = () => {
    const key = target;
    rec.cancel(); setProcessing(false); setTarget(null);
    if (key) setSlots((l) => l.filter((s) => !(s.key === key && s.fresh && !s.replaced)));
  };

  const submit = async () => {
    if (lock.current || mediaLocked) return;
    const clean = name.trim();
    if (!clean) { setError('図鑑に登録するモノの名前を入力してください。'); return; }
    const changes: KeepsakeEdit = {};
    if (clean !== base.itemName) changes.itemName = clean;
    if (categoryId !== (base.categoryId ?? null)) changes.categoryId = categoryId;
    if (photo) changes.photo = photo;
    const voices: VoiceChange[] = slots.filter((s) => s.replaced && s.url).map((s) => ({ id: s.id, source: s.url }));
    if (voices.length) changes.voices = voices;
    if (voices.length + (photo ? 1 : 0) > MAX_EDIT_FILES) {
      setError('1回の保存で変更できる写真・音声は合計5ファイルまでです。音声5件と写真を変える場合は、写真の変更を戻して音声を保存し、もう一度編集して写真を変更してください。');
      return;
    }
    if (Object.keys(changes).length === 0) { close(); return; }
    // Retry the same payload with the same receipt. If the user changes a draft
    // after a failed/ambiguous save, it is a new operation, not a replay that
    // silently ignores their new choices. Conflicting old bases fail explicitly.
    const payload = JSON.stringify(changes);
    if (submittedPayload.current !== null && submittedPayload.current !== payload) editId.current = crypto.randomUUID();
    submittedPayload.current = payload;
    lock.current = true; setBusy(true); setError('');
    try { await onSave(base, changes, editId.current); lock.current = false; if (alive.current) onClose(); }
    catch (caught) { lock.current = false; if (alive.current) { setError(describeError(caught)); setBusy(false); } }
  };

  const previewPhoto = photo ?? base.photo;
  const canAdd = slots.length < MAX_VOICES && !mediaLocked;
  const micOk = canRecord();

  return (
    <>
      <div className="overlay overlay-top" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
        <form ref={dialog} className="dialog dialog-small edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title" inert={!!photoSource} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="dialog-head">
            <div><h2 id="edit-title" className="dialog-title">カードを直す</h2><p className="dialog-lede">写真・声・名前を変えられます。保存するまで元のままです。</p></div>
            <button type="button" className="icon-button" disabled={busy} onClick={close} aria-label="閉じる" data-testid="button-close-edit"><X size={19} /></button>
          </div>
          <div className="form-block">
            <label className="field-label" htmlFor="edit-item-name">モノの名前</label>
            <input id="edit-item-name" className="title-input" value={name} disabled={busy} maxLength={48} onChange={(e) => { setName(e.currentTarget.value); setError(''); }} aria-invalid={!!error} data-testid="input-edit-name" />
          </div>
          <div className="form-block">
            <CategorySelect id="edit-category" categories={categories} value={categoryId} onChange={setCategoryId} disabled={busy} testId="select-edit-category" />
          </div>
          <div className="form-block">
            <span className="field-label">写真</span>
            <input ref={photoInput} className="sr-only" type="file" accept="image/*" tabIndex={-1} disabled={mediaLocked} onChange={onPhotoPick} aria-label="写真を選ぶ" data-testid="input-edit-photo" />
            <button type="button" className="em-photo" disabled={mediaLocked} onClick={() => photoInput.current?.click()} data-testid="button-edit-photo">
              {previewPhoto && <img src={previewPhoto} alt="現在の写真" />}
              <span className="em-photo-label"><Camera size={16} /> {photo ? '選びなおす（保存で反映）' : '写真をかえる'}</span>
            </button>
            {photo && <button type="button" className="record-button em-inline" disabled={busy} onClick={() => setPhoto(null)} data-testid="button-undo-photo"><RotateCcw size={14} /> 元の写真にもどす</button>}
          </div>
          <div className="form-block">
            <span className="field-label"><Mic size={14} /> 声（{slots.length}/{MAX_VOICES}）</span>
            <input ref={audioInput} className="sr-only" type="file" accept="audio/*" tabIndex={-1} disabled={mediaLocked} onChange={onAudioFile} aria-label="音声ファイルを選ぶ" data-testid="input-edit-audio" />
            {(rec.starting || rec.recording) && <RecordingGuide photo={previewPhoto} name={name} phase={rec.guiding ? 'guide' : rec.recording ? 'recording' : 'idle'} />}
            {slots.length === 0 && <p className="field-hint">まだ声がありません。録音するか、音声ファイルを追加できます。</p>}
            <ul className="em-voices">
              {slots.map((slot, index) => {
                const mine = target === slot.key;
                const isRec = mine && rec.recording;
                const isBusy = mine && (rec.starting || processing);
                return (
                  <li key={slot.key} className={`em-voice${slot.fresh ? ' is-new' : ''}${slot.replaced ? ' is-changed' : ''}`} data-testid={`row-voice-${index}`}>
                    <div className="em-voice-head">
                      <strong>{slot.fresh ? `追加の声 ${index + 1}` : `声 ${index + 1}`}</strong>
                      <span className="em-tag">{slot.fresh ? (slot.replaced ? '新しい声' : '準備中') : slot.replaced ? '差し替え予定' : '保存ずみ'}</span>
                    </div>
                    {isRec && (
                      <div className="em-meter" data-testid="status-recording">
                        <span className="em-meter-bar"><i style={{ transform: `scaleX(${Math.max(0.04, rec.level)})` }} /></span>
                        <span aria-live="off">録音中 {fmt(rec.seconds)} / {fmt(MAX_RECORD_SECONDS)}</span>
                      </div>
                    )}
                    {isBusy && <p className="em-note" role="status">音声を準備しています…</p>}
                    <div className="record-actions">
                      {slot.url && !mine && (
                        <button type="button" className="record-button" disabled={mediaLocked} onClick={() => { setTrimKey(null); togglePlay(slot); }} aria-label={`声${index + 1}を${playingKey === slot.key ? '止める' : '聞く'}`} data-testid={`button-play-voice-${index}`}>
                          {playingKey === slot.key ? <Pause size={14} /> : <Play size={14} />} {playingKey === slot.key ? '止める' : '聞く'}
                        </button>
                      )}
                      {isRec ? (
                        <>
                          <button type="button" className="record-button danger" onClick={rec.stop} data-testid="button-stop-edit-recording"><Square size={13} /> 録音をとめる</button>
                          <button type="button" className="record-button" onClick={cancelRecording} data-testid="button-redo-recording"><RotateCcw size={14} /> やりなおす</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="record-button" disabled={mediaLocked || !micOk} onClick={() => void record(slot.key)} data-testid={`button-record-voice-${index}`}><Mic size={14} /> {slot.url ? '録りなおす' : '録音'}</button>
                          <button type="button" className="record-button" disabled={mediaLocked} onClick={() => replaceByFile(slot.key)} data-testid={`button-upload-voice-${index}`}><Upload size={14} /> ファイル</button>
                        </>
                      )}
                      {slot.url && !mine && <button type="button" className="record-button" disabled={mediaLocked} onClick={() => { stopPlayback(); setTrimKey(slot.key); }} data-testid={`button-trim-voice-${index}`}>波形でカット</button>}
                      {isBusy && rec.starting && <button type="button" className="record-button" onClick={cancelRecording}>やめる</button>}
                    </div>
                    {trimKey === slot.key && slot.url && !working && <VoiceTrimEditor source={slot.url} disabled={busy} onPendingChange={setTrimPending} onBeforePreview={stopPlayback} onApply={(blob) => { stopPlayback(); applyAudio(slot.key, blob); }} />}
                  </li>
                );
              })}
            </ul>
            {slots.length < MAX_VOICES && (
              <div className="em-add">
                <span className="em-add-label">声を追加</span>
                <button type="button" className="record-button" disabled={!canAdd || !micOk} onClick={addByRecording} data-testid="button-add-voice-record"><Plus size={14} /><Mic size={14} /> 録音して追加</button>
                <button type="button" className="record-button" disabled={!canAdd} onClick={addByFile} data-testid="button-add-voice-file"><Plus size={14} /><Upload size={14} /> ファイルで追加</button>
              </div>
            )}
            {!micOk && <p className="notice" role="status" data-testid="status-edit-unsupported"><span>このブラウザでは録音できません。音声ファイルは使えます。</span></p>}
            {(voiceError || rec.error) && <p className="form-error" role="alert" data-testid="status-voice-error">{voiceError || rec.error}</p>}
            <p className="field-hint">録音は最大60秒。冒頭の無音を自動でカットします。ファイルは20MBまで。</p>
          </div>
          {error && <p className="form-error" role="alert" data-testid="status-edit-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="cancel-button" disabled={busy} onClick={close} data-testid="button-cancel-edit">やめる</button>
            <button type="submit" className="save-button" disabled={mediaLocked} data-testid="button-save-edit"><Check size={16} /> {busy ? '保存中…' : 'なおして保存'}</button>
          </div>
        </form>
      </div>
      {photoSource && (
        <PhotoEditor
          source={photoSource}
          onCancel={clearPhotoSource}
          onApply={(processed) => { setPhoto(processed); clearPhotoSource(); setError(''); }}
        />
      )}
    </>
  );
}
