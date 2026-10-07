import { useCallback, useRef, useState } from 'react';
import {
  createNewKeepsakeDraftStore,
  type NewKeepsakeDraft,
  type NewKeepsakeDraftInput,
} from '../lib/newKeepsakeDraft';

export function useNewKeepsakeDraft() {
  const store = useRef(createNewKeepsakeDraftStore()).current;
  const revision = useRef(0);
  const timer = useRef<number | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  const enqueue = (operation: () => Promise<void>) => {
    const next = queue.current.catch(() => undefined).then(operation);
    queue.current = next;
    return next;
  };

  const load = useCallback(async () => {
    try {
      await queue.current.catch(() => undefined);
      const draft = await store.read();
      setStatus(draft ? 'saved' : 'idle');
      setError('');
      return draft;
    } catch {
      setStatus('error');
      setError('この端末から下書きを読み込めませんでした。');
      return null;
    }
  }, [store]);

  const persist = (input: NewKeepsakeDraftInput, currentRevision: number) => async () => {
    if (currentRevision !== revision.current) return;
    try {
      const draft: NewKeepsakeDraft = { ...input, updatedAt: Date.now() };
      await store.write(draft);
      if (currentRevision === revision.current) {
        setStatus('saved');
        setError('');
      }
    } catch {
      if (currentRevision === revision.current) {
        setStatus('error');
        setError('この端末に下書きを保存できませんでした。写真や入力内容が残らない可能性があります。');
      }
    }
  };

  const saveNow = useCallback((input: NewKeepsakeDraftInput) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const currentRevision = ++revision.current;
    setStatus('saving');
    return enqueue(persist(input, currentRevision));
  }, [store]);

  const saveSoon = useCallback((input: NewKeepsakeDraftInput) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const currentRevision = ++revision.current;
    setStatus('saving');
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void enqueue(persist(input, currentRevision));
    }, 300);
  }, [store]);

  const clear = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    ++revision.current;
    return enqueue(async () => {
      try {
        await store.clear();
        setStatus('idle');
        setError('');
      } catch {
        setStatus('error');
        setError('キロクは保存されましたが、この端末の下書きを消去できませんでした。保存ボタンをもう一度押して再試行してください。');
        throw new Error('local-draft-clear-failed');
      }
    }).then(() => true, () => false);
  }, [store]);

  return { load, saveNow, saveSoon, clear, status, error };
}
