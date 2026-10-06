export type Category = { id: string; name: string; createdAt?: number };

export const DEFAULT_CATEGORIES: readonly Category[] = [
  { id: 'default-toys', name: 'おもちゃ' },
  { id: 'default-animals', name: 'どうぶつ' },
  { id: 'default-artworks', name: 'さくひん' },
];

export function categoryNameKey(name: string): string {
  return name.normalize('NFKC').trim().toLocaleLowerCase('ja');
}

export function validateCategoryName(name: string): string {
  const clean = name.normalize('NFKC').trim();
  if (!clean) throw new Error('カテゴリの名前を入力してください。');
  if (clean.length > 24) throw new Error('カテゴリの名前は24文字以内にしてください。');
  if (categoryNameKey(clean) === 'すべて') throw new Error('「すべて」は一覧用の名前です。別の名前を入力してください。');
  if (DEFAULT_CATEGORIES.some((category) => categoryNameKey(category.name) === categoryNameKey(clean))) {
    throw new Error('そのカテゴリはすでにあります。一覧から選んでください。');
  }
  return clean;
}

/** 同じ名前の再送・別タブからの同時追加でもドキュメントが重複しない。 */
export async function categoryIdForName(name: string): Promise<string> {
  const bytes = new TextEncoder().encode(categoryNameKey(name));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `custom-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function keepsakeMetadata(itemName: string, categoryId: string | null = null) {
  const clean = itemName.trim();
  if (!clean) throw new Error('図鑑に登録するモノの名前を入力してください。');
  if (clean.length > 48) throw new Error('モノの名前は48文字以内にしてください。');
  if (categoryId !== null &&
      !DEFAULT_CATEGORIES.some((category) => category.id === categoryId) &&
      !/^custom-[a-f0-9]{64}$/.test(categoryId)) {
    throw new Error('カテゴリを選び直してください。');
  }
  // 編集ではこれ以外を書き換えない。画像・音声・作成日時を必ず維持する。
  return { itemName: clean, categoryId };
}

export function filterByCategory<T extends { categoryId?: string | null }>(items: readonly T[], categoryId: string | null): T[] {
  return categoryId === null ? [...items] : items.filter((item) => item.categoryId === categoryId);
}
