import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CATEGORIES, type Category } from '../lib/categories';
import { createCategory, firebaseError, subscribeCategories } from '../lib/keepsakeStore';

export function useCategories(connectionAttempt: number) {
  const [categories, setCategories] = useState<Category[]>([...DEFAULT_CATEGORIES]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setError('カテゴリの読み込みが完了しませんでした。通信とFirestoreの設定を確認し、再接続してください。');
      }
    }, 20_000);
    const fail = (caught: unknown) => {
      if (cancelled) return;
      window.clearTimeout(timer);
      setError(firebaseError(caught));
      setLoading(false);
    };
    subscribeCategories((next) => {
      if (cancelled) return;
      window.clearTimeout(timer);
      setCategories((local) => {
        // 反映前にローカルで追加したカテゴリはスナップショットに入るまで維持。
        const ids = new Set(next.map((c) => c.id));
        return [...next, ...local.filter((c) => !ids.has(c.id) && c.createdAt === -1)];
      });
       setError(''); setLoading(false);
    }, fail).then((stop) => { if (cancelled) stop(); else unsubscribe = stop; }).catch(fail);
    return () => { cancelled = true; window.clearTimeout(timer); unsubscribe?.(); };
  }, [connectionAttempt]);

  const create = useCallback(async (name: string): Promise<Category> => {
    const made = await createCategory(name);
    setCategories((list) => list.some((c) => c.id === made.id) ? list : [...list, { ...made, createdAt: -1 }]);
    return made;
  }, []);

  const describeError = useCallback((caught: unknown) => firebaseError(caught), []);

  return { categories, loading, error, create, describeError };
}
