import type { Keepsake } from './keepsakeRepository';

export const MAX_VOICES = 5;
export const MAX_EDIT_FILES = 5;
export type VoiceAsset = { id: string; url: string; path?: string | null };
export type VoiceChange = { id: string; source: string };
export type KeepsakeEdit = {
  itemName?: string; categoryId?: string | null; photo?: string; voices?: VoiceChange[];
};
export function getVoices(item: Pick<Keepsake, 'voice' | 'voicePath' | 'voices'>): VoiceAsset[] {
  if (item.voices?.length) return item.voices;
  return item.voice ? [{ id: 'primary', url: item.voice, path: item.voicePath ?? null }] : [];
}
export function keepsakeFromData(id: string, data: Record<string, any>): Keepsake {
  return {
    id, itemName: data.itemName, photo: data.photo, voice: data.voice ?? null,
    photoPath: data.photoPath, voicePath: data.voicePath ?? null,
    categoryId: data.categoryId ?? null,
    ...(data.archived === true ? { archived: true } : {}),
    ...(data.archivedAt ? {
      archivedAt: data.archivedAt.toMillis?.() ?? data.archivedAt.getTime?.() ?? null,
    } : {}),
    ...(Array.isArray(data.voices) ? { voices: data.voices } : {}),
    createdAt: data.createdAt?.toMillis?.() ?? data.createdAt?.getTime?.() ?? Date.now(),
  };
}
