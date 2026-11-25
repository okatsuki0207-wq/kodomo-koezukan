import type { Keepsake } from './keepsakeRepository';
import { DEFAULT_CATEGORIES, categoryIdForName, keepsakeMetadata, validateCategoryId, validateCategoryName, type Category } from './categories';
import { DEFAULT_GALLERY_SETTINGS, normalizeGallerySettings, type GallerySettings } from './gallerySettings';
import * as local from './localKeepsakeDb';

export type { Keepsake } from './keepsakeRepository';

export async function subscribeKeepsakes(onChange: (items: Keepsake[]) => void, onError: (error: unknown) => void) {
  return local.subscribe(onChange, onError);
}
export async function saveKeepsake(item: Keepsake) { await local.save(item); }
export async function deleteKeepsake(item: Keepsake) { await local.remove(item); }
export async function editKeepsake(base: Keepsake, changes: Parameters<typeof local.edit>[1], _editId: string) {
  return local.edit(base, changes);
}
export async function updateKeepsakeMetadata(id: string, itemName: string, categoryId: string | null) {
  const metadata = keepsakeMetadata(itemName, categoryId);
  const items = await local.listKeepsakes();
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error('このキロクが見つかりません。');
  await local.edit(item, { itemName: metadata.itemName, categoryId });
}
export async function updateKeepsakeCategory(id: string, categoryId: string | null) {
  validateCategoryId(categoryId); await local.patchCard(id, { categoryId });
}
export async function setKeepsakeArchived(id: string, archived: boolean) {
  await local.patchCard(id, { archived, archivedAt: archived ? Date.now() : null });
}
export async function subscribeCategories(onChange: (categories: Category[]) => void, onError: (error: unknown) => void) {
  try { onChange(await local.listCategories()); return () => {}; } catch (error) { onError(error); return () => {}; }
}
export async function createCategory(name: string) {
  const clean = validateCategoryName(name);
  const id = await categoryIdForName(clean);
  const category = { id, name: clean, createdAt: Date.now() };
  await local.addCategory(category);
  return category;
}
export async function subscribeGallerySettings(onChange: (settings: GallerySettings) => void, onError: (error: unknown) => void) {
  try { onChange(await local.listSettings()); return () => {}; } catch (error) { onError(error); return () => {}; }
}
export async function saveGallerySettings(value: GallerySettings) {
  await local.saveSettings(normalizeGallerySettings(value));
}
export async function refreshVoiceDownloadUrl(_path: string): Promise<string> {
  throw new Error('音声は端末内に保存されています。編集画面を開き直してください。');
}
export async function inspectUnusedMedia(): Promise<never> { throw new Error('端末内保存では未使用のクラウドファイル整理は利用できません。'); }
export async function deleteUnusedMedia(_path: string, _confirmed: boolean): Promise<never> { throw new Error('端末内保存ではクラウドファイル削除は利用できません。'); }
export function firebaseError(error: unknown) { return error instanceof Error ? error.message : '端末内の保存処理に失敗しました。'; }
