import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CATEGORIES, type Category } from '../lib/categories';
import { createCategory, firebaseError, subscribeCategories } from '../lib/keepsakeStore';

const RULES_NOTE = 'Firestoreからアクセスを拒否されました。ルールに加えて、FirebaseのプロジェクトIDと保存時と同じ匿名認証ユーザーで開いているか確認してください。';

export function useCategories(connectionAttempt: number, enabled = true) {
  const [categories, setCategories] = useState<Category[]>([...DEFAULT_CATEGORIES]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setCategories([...DEFAULT_CATEGORIES]);
      setLoading(false);
      setError('');
      setDenied(false);
      return;
    }
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
      const code = (caught as { code?: string })?.code ?? '';
      const isDenied = code.includes('permission-denied');
      setDenied(isDenied);
      setError(isDenied ? RULES_NOTE : firebaseError(caught));
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
      setError(''); setDenied(false); setLoading(false);
    }, fail).then((stop) => { if (cancelled) stop(); else unsubscribe = stop; }).catch(fail);
    return () => { cancelled = true; window.clearTimeout(timer); unsubscribe?.(); };
  }, [connectionAttempt, enabled]);

  const create = useCallback(async (name: string): Promise<Category> => {
    const made = await createCategory(name);
    setCategories((list) => list.some((c) => c.id === made.id) ? list : [...list, { ...made, createdAt: -1 }]);
    return made;
  }, []);

  const describeError = useCallback((caught: unknown) => {
    const code = (caught as { code?: string })?.code ?? '';
    return code.includes('permission-denied') ? RULES_NOTE : firebaseError(caught);
  }, []);

  return { categories, loading, error, denied, create, describeError };
}
