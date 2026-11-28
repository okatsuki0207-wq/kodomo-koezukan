export type GalleryDisplayMode = 'ordered' | 'monthly' | 'shuffle';
export type GalleryDensity = 'big' | 'medium' | 'small';
export type GallerySettings = {
  displayMode: GalleryDisplayMode;
  shuffleSeed: number;
  density: GalleryDensity;
};

export const UNCATEGORIZED_CATEGORY_KEY = '__uncategorized__';
export const DEFAULT_GALLERY_SETTINGS: GallerySettings = {
  displayMode: 'ordered',
  shuffleSeed: 0,
  density: 'medium',
};

export function normalizeGallerySettings(value: unknown): GallerySettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_GALLERY_SETTINGS };
  const source = value as Record<string, unknown>;
  const seed = source.shuffleSeed;
  return {
    displayMode: source.displayMode === 'shuffle' ? 'shuffle' : source.displayMode === 'monthly' ? 'monthly' : 'ordered',
    shuffleSeed: Number.isSafeInteger(seed) && (seed as number) >= 0 && (seed as number) <= 0xffff_ffff
      ? seed as number
      : DEFAULT_GALLERY_SETTINGS.shuffleSeed,
    density: source.density === 'big' || source.density === 'small' ? source.density : 'medium',
  };
}

function seededRandom(seed: number, scope: string): () => number {
  let state = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < scope.length; index++) {
    state = Math.imul(state ^ scope.charCodeAt(index), 16777619) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffled<T extends { id: string }>(items: readonly T[], seed: number, scope: string): T[] {
  const result = [...items].sort((left, right) => left.id.localeCompare(right.id));
  const random = seededRandom(seed, scope);
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function galleryTimestampValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toMillis' in value
      && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const result = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(result) ? result : 0;
  }
  return 0;
}

export function sortGalleryItems<T extends { id: string; categoryId?: string | null; createdAt?: unknown }>(
  items: readonly T[],
  settings: GallerySettings,
  selectedCategory: string | null,
): T[] {
  const filtered = selectedCategory === null
    ? [...items]
    : selectedCategory === UNCATEGORIZED_CATEGORY_KEY
      ? items.filter((item) => (item.categoryId ?? null) === null)
      : items.filter((item) => item.categoryId === selectedCategory);
  const newestFirst = filtered.sort((left, right) =>
    galleryTimestampValue(right.createdAt) - galleryTimestampValue(left.createdAt)
      || left.id.localeCompare(right.id),
  );
  if (settings.displayMode !== 'shuffle' || newestFirst.length < 2) return newestFirst;

  const [newest, ...remainder] = newestFirst;
  return [newest, ...shuffled(remainder, settings.shuffleSeed, selectedCategory ?? 'all')];
}
