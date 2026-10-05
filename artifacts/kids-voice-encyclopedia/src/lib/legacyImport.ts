import type { Keepsake } from './keepsakeStore';

/**
 * 旧データ移行専用の読み取り。LocalStorage へ書き込み・削除は行わない。
 * 通常の一覧・保存・削除はこのデータを参照せず、Firebase のみを使用する。
 */
export function readLegacyKeepsakes(): Keepsake[] {
  const raw = window.localStorage.getItem('koe-no-zukan-keepsakes-v1');
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('旧データの形式が正しくありません。元データはそのまま残っています。');
  return parsed.map((value) => {
    const itemName = value?.itemName ?? value?.title;
    if (typeof value?.id !== 'string' || !/^[\w-]+$/.test(value.id) ||
        typeof itemName !== 'string' || typeof value?.photo !== 'string' || !value.photo) {
      throw new Error('移行できない旧データがあります。元データは削除していません。');
    }
    return { id: value.id, itemName, photo: value.photo,
      voice: typeof value.voice === 'string' ? value.voice : null,
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now() };
  });
}
