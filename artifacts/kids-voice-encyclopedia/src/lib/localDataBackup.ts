import type { Category } from './categories';
import { DEFAULT_CATEGORIES } from './categories';
import type { Keepsake } from './keepsakeRepository';
import { listKeepsakes, listCategories, listSettings, replaceImportedData } from './localKeepsakeDb';
import { getVoices, type VoiceAsset } from './voiceAssets';
import { normalizeGallerySettings, type GallerySettings } from './gallerySettings';

const FORMAT = 'kids-voice-encyclopedia-backup';
const VERSION = 1;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

type BackupMedia = { type: string; data: string };
type BackupCard = {
  id: string;
  itemName: string;
  createdAt: number;
  categoryId?: string | null;
  memo?: string;
  archived?: boolean;
  archivedAt?: number | null;
  photo: BackupMedia;
  voices: Array<{ id: string; path?: string | null; media: BackupMedia }>;
};
type BackupFile = {
  format: typeof FORMAT;
  version: typeof VERSION;
  exportedAt: string;
  cards: BackupCard[];
  categories: Category[];
  settings: GallerySettings;
};

async function encodeMedia(blob: Blob | undefined): Promise<BackupMedia> {
  if (!blob || !blob.size || blob.size >= MAX_MEDIA_BYTES) throw new Error('写真または音声データが空か、20MB以上のため書き出せません。');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return { type: blob.type || 'application/octet-stream', data: btoa(binary) };
}

function decodeMedia(value: unknown, expected: 'image' | 'audio'): Blob {
  if (!value || typeof value !== 'object') throw new Error('バックアップ内の写真・音声データが正しくありません。');
  const media = value as Partial<BackupMedia>;
  if (typeof media.type !== 'string' || !media.type.startsWith(`${expected}/`) ||
      typeof media.data !== 'string' || media.data.length > Math.ceil(MAX_MEDIA_BYTES * 4 / 3)) {
    throw new Error('バックアップ内の写真・音声形式が正しくありません。');
  }
  let binary: string;
  try { binary = atob(media.data); } catch { throw new Error('バックアップ内のデータを読み取れません。'); }
  if (!binary.length || binary.length >= MAX_MEDIA_BYTES) throw new Error('バックアップ内のファイルが空か、20MB以上です。');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: media.type });
}

export async function downloadLocalBackup() {
  const [items, categories, settings] = await Promise.all([listKeepsakes(), listCategories(), listSettings()]);
  const cards: BackupCard[] = [];
  for (const item of items) {
    const voices = [];
    for (const voice of getVoices(item)) {
      voices.push({
        id: voice.id,
        path: voice.path,
        media: await encodeMedia((voice as typeof voice & { blob?: Blob }).blob),
      });
    }
    cards.push({
      id: item.id,
      itemName: item.itemName,
      createdAt: item.createdAt,
      categoryId: item.categoryId ?? null,
      memo: item.memo ?? '',
      archived: item.archived,
      archivedAt: item.archivedAt ?? null,
      photo: await encodeMedia(item.photoBlob),
      voices,
    });
  }
  const backup: BackupFile = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    cards,
    categories,
    settings,
  };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  if (blob.size > MAX_FILE_BYTES) throw new Error('バックアップが大きすぎます（上限200MB）。写真や声を整理してから再度お試しください。');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `こどものこえずかん-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function restoreLocalBackup(file: File): Promise<GallerySettings> {
  if (file.size > MAX_FILE_BYTES) throw new Error('バックアップファイルが大きすぎます（上限200MB）。');
  let parsed: unknown;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('JSONファイルを読み取れません。'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('バックアップファイルの形式が正しくありません。');
  const source = parsed as Partial<BackupFile>;
  if (source.format !== FORMAT || source.version !== VERSION ||
      !Array.isArray(source.cards) || !Array.isArray(source.categories) || source.cards.length > 5000) {
    throw new Error('このアプリのバックアップファイルではないか、対応していない形式です。');
  }
  const categories = source.categories.filter((category): category is Category =>
    !!category && typeof category === 'object' && typeof category.id === 'string' &&
    typeof category.name === 'string' && category.name.trim().length > 0 && category.name.length <= 24,
  );
  if (categories.length !== source.categories.length) throw new Error('バックアップ内のカテゴリ情報が正しくありません。');
  const ids = new Set(categories.map((category) => category.id));
  if (ids.size !== categories.length || DEFAULT_CATEGORIES.some((category) => !ids.has(category.id))) {
    throw new Error('バックアップ内のカテゴリが重複しているか、標準カテゴリがありません。');
  }
  const cards: Keepsake[] = source.cards.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('バックアップ内のキロク情報が正しくありません。');
    const card = value as BackupCard;
    if (typeof card.id !== 'string' || !card.id || typeof card.itemName !== 'string' ||
        !card.itemName.trim() || card.itemName.length > 48 || !Number.isFinite(card.createdAt) ||
        !Array.isArray(card.voices) || card.voices.length > 5) {
      throw new Error('バックアップ内のキロク情報が正しくありません。');
    }
    return {
      id: card.id,
      itemName: card.itemName,
      photo: '',
      photoBlob: decodeMedia(card.photo, 'image'),
      voice: null,
      createdAt: card.createdAt,
      categoryId: card.categoryId ?? null,
      memo: typeof card.memo === 'string' ? card.memo : '',
      archived: card.archived === true,
      archivedAt: Number.isFinite(card.archivedAt) ? card.archivedAt : null,
      voices: card.voices.map((voice) => {
        if (!voice || typeof voice.id !== 'string' || !voice.id) throw new Error('バックアップ内の音声情報が正しくありません。');
        return { id: voice.id, url: '', path: voice.path ?? null, blob: decodeMedia(voice.media, 'audio') } as VoiceAsset;
      }),
    };
  });
  if (new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error('バックアップ内に同じキロクが複数あります。');
  if (cards.some((card) => card.categoryId && !ids.has(card.categoryId))) throw new Error('バックアップ内のキロクに存在しないカテゴリが設定されています。');
  const settings = normalizeGallerySettings(source.settings);
  await replaceImportedData(cards, categories, settings);
  return settings;
}
