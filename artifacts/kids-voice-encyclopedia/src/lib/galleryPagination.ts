import type { GalleryDensity } from './gallerySettings';

export const STANDARD_GALLERY_PAGE_SIZE = 15;
export const COMPACT_GALLERY_PAGE_SIZE = 12;
export const COMPACT_GALLERY_MAX_HEIGHT = 760;

export function galleryPageSize(viewportHeight: number): number {
  return viewportHeight <= COMPACT_GALLERY_MAX_HEIGHT
    ? COMPACT_GALLERY_PAGE_SIZE
    : STANDARD_GALLERY_PAGE_SIZE;
}

/** 大きさ設定ごとの1ページあたりの件数。おおきくは常に1件、ふつうは2列、たくさん（3列）は従来どおり。 */
export function galleryDensityPageSize(density: GalleryDensity, viewportHeight: number): number {
  if (density === 'big') return 1;
  if (density === 'medium') return viewportHeight <= COMPACT_GALLERY_MAX_HEIGHT ? 8 : 10;
  return galleryPageSize(viewportHeight);
}

export type GalleryMonthPage<T> = { key: string; label: string; items: T[] };

function monthKeyAndLabel(timestamp: number): { key: string; label: string } {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return { key: `${year}-${String(month).padStart(2, '0')}`, label: `${year}年${month}月` };
}

/**
 * 新しい順に並んだアイテムを年月ごとにページ分けする。月が変わる位置で必ず
 * ページを切り、各ページに年月のラベルを持たせる。先頭カード（追加タイル）が
 * ある場合、その分だけ最初のページの容量が減る。
 */
export function buildMonthlyPages<T extends { createdAt?: unknown }>(
  items: readonly T[],
  pageSize: number,
  hasLeadingCard = false,
  timestampOf: (item: T) => number,
): GalleryMonthPage<T>[] {
  const size = Math.max(1, Math.trunc(pageSize));
  const pages: GalleryMonthPage<T>[] = [];
  let currentKey: string | null = null;
  let capacity = 0;
  for (const item of items) {
    const { key, label } = monthKeyAndLabel(timestampOf(item));
    if (key !== currentKey || capacity <= 0) {
      const firstEver = pages.length === 0;
      pages.push({ key, label, items: [] });
      currentKey = key;
      capacity = firstEver && hasLeadingCard ? Math.max(0, size - 1) : size;
      if (capacity <= 0) {
        // 先頭カードだけで埋まるページサイズ（おおきく=1件）のときは、
        // 次のアイテムから通常容量でページを作る。
        pages.push({ key, label, items: [] });
        capacity = size;
      }
    }
    pages[pages.length - 1].items.push(item);
    capacity--;
  }
  return pages.filter((page) => page.items.length > 0);
}

export function galleryPageCount(itemCount: number, pageSize: number, hasLeadingCard = false): number {
  const size = Math.max(1, Math.trunc(pageSize));
  const firstPageCapacity = hasLeadingCard ? Math.max(0, size - 1) : size;
  const count = Math.max(0, Math.trunc(itemCount));
  return count <= firstPageCapacity
    ? 1
    : 1 + Math.ceil((count - firstPageCapacity) / size);
}

export function clampGalleryPage(pageIndex: number, pageCount: number): number {
  return Math.max(0, Math.min(Math.trunc(pageIndex), Math.max(0, pageCount - 1)));
}

export function galleryPageItems<T>(
  items: readonly T[],
  pageIndex: number,
  pageSize: number,
  hasLeadingCard = false,
): T[] {
  const size = Math.max(1, Math.trunc(pageSize));
  const page = Math.max(0, Math.trunc(pageIndex));
  const firstPageCapacity = hasLeadingCard ? Math.max(0, size - 1) : size;
  const start = page === 0 ? 0 : firstPageCapacity + (page - 1) * size;
  const capacity = page === 0 ? firstPageCapacity : size;
  return items.slice(start, start + capacity);
}

/** Returns -1 for the previous page, 1 for the next page, or 0 for a non-horizontal gesture. */
export function gallerySwipeDelta(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold = 72,
): -1 | 0 | 1 {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY) * 1.3) return 0;
  return deltaX < 0 ? 1 : -1;
}
