import type { Category } from './categories';

export type GalleryDisplayMode = 'ordered' | 'shuffle';
export type GallerySettings = {
  categoryOrder: string[];
  cardOrderByCategory: Record<string, string[]>;
  displayMode: GalleryDisplayMode;
  shuffleSeed: number;
};

export const UNCATEGORIZED_CATEGORY_KEY = '__uncategorized__';
export const DEFAULT_GALLERY_SETTINGS: GallerySettings = {
  categoryOrder: ['default-toys', 'default-animals', 'default-artworks'],
  cardOrderByCategory: {},
  displayMode: 'ordered',
  shuffleSeed: 0,
};

function uniqueStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string =>
    typeof entry === 'string' && entry.length > 0 && entry.length <= 128,
  ))].slice(0, limit);
}

export function normalizeGallerySettings(value: unknown): GallerySettings {
  if (!value || typeof value !== 'object') {
    return {
      ...DEFAULT_GALLERY_SETTINGS,
      categoryOrder: [...DEFAULT_GALLERY_SETTINGS.categoryOrder],
      cardOrderByCategory: {},
    };
  }
  const source = value as Record<string, unknown>;
  const rawOrders = source.cardOrderByCategory;
  const cardOrderByCategory = rawOrders && typeof rawOrders === 'object' && !Array.isArray(rawOrders)
    ? Object.fromEntries(
        Object.entries(rawOrders as Record<string, unknown>)
          .filter(([key]) => key.length > 0 && key.length <= 128)
          .slice(0, 500)
          .map(([key, ids]) => [key, uniqueStringList(ids, 10_000)]),
      )
    : {};
  const seed = source.shuffleSeed;
  return {
    categoryOrder: uniqueStringList(source.categoryOrder, 500),
    cardOrderByCategory,
    displayMode: source.displayMode === 'shuffle' ? 'shuffle' : 'ordered',
    shuffleSeed: Number.isSafeInteger(seed) && (seed as number) >= 0 && (seed as number) <= 0xffff_ffff
      ? seed as number
      : DEFAULT_GALLERY_SETTINGS.shuffleSeed,
  };
}

export function orderCategories(categories: readonly Category[], settings: GallerySettings): Category[] {
  const rank = new Map(settings.categoryOrder.map((id, index) => [id, index]));
  const sourceIndex = new Map(categories.map((category, index) => [category.id, index]));
  return [...categories].sort((left, right) =>
    (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      || (sourceIndex.get(left.id) ?? 0) - (sourceIndex.get(right.id) ?? 0),
  );
}

function orderByIds<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const remaining = new Map(items.map((item) => [item.id, item]));
  const result: T[] = [];
  for (const id of ids) {
    const item = remaining.get(id);
    if (item) {
      result.push(item);
      remaining.delete(id);
    }
  }
  result.push(...remaining.values());
  return result;
}

export function orderCardsInCategory<T extends { id: string; categoryId?: string | null }>(
  items: readonly T[],
  categoryId: string | null,
  settings: GallerySettings,
): T[] {
  const matching = items.filter((item) => (item.categoryId ?? null) === categoryId);
  const key = categoryId ?? UNCATEGORIZED_CATEGORY_KEY;
  return orderByIds(matching, settings.cardOrderByCategory[key] ?? []);
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

export function sortGalleryItems<T extends { id: string; categoryId?: string | null }>(
  items: readonly T[],
  categories: readonly Category[],
  settings: GallerySettings,
  selectedCategory: string | null,
): T[] {
  if (settings.displayMode === 'shuffle') {
    const filtered = selectedCategory === null
      ? items
      : items.filter((item) => item.categoryId === selectedCategory);
    return shuffled(filtered, settings.shuffleSeed, selectedCategory ?? 'all');
  }
  if (selectedCategory !== null) return orderCardsInCategory(items, selectedCategory, settings);

  const result: T[] = [];
  const placed = new Set<string>();
  const addGroup = (categoryId: string | null) => {
    for (const item of orderCardsInCategory(items, categoryId, settings)) {
      result.push(item);
      placed.add(item.id);
    }
  };
  const categoryIds = orderCategories(categories, settings).map((category) => category.id);
  for (const id of categoryIds) addGroup(id);
  const orphanIds = [...new Set(items
    .map((item) => item.categoryId ?? null)
    .filter((id): id is string => id !== null && !categoryIds.includes(id)))].sort();
  for (const id of orphanIds) addGroup(id);
  addGroup(null);
  for (const item of items) if (!placed.has(item.id)) result.push(item);
  return result;
}
