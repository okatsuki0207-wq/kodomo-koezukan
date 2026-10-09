export const STANDARD_GALLERY_PAGE_SIZE = 15;
export const COMPACT_GALLERY_PAGE_SIZE = 12;
export const COMPACT_GALLERY_MAX_HEIGHT = 700;

export function galleryPageSize(viewportHeight: number): number {
  return viewportHeight < COMPACT_GALLERY_MAX_HEIGHT
    ? COMPACT_GALLERY_PAGE_SIZE
    : STANDARD_GALLERY_PAGE_SIZE;
}

export function galleryPageCount(itemCount: number, pageSize: number): number {
  const size = Math.max(1, Math.trunc(pageSize));
  return Math.max(1, Math.ceil(Math.max(0, itemCount) / size));
}

export function clampGalleryPage(pageIndex: number, pageCount: number): number {
  return Math.max(0, Math.min(Math.trunc(pageIndex), Math.max(0, pageCount - 1)));
}

export function galleryPageItems<T>(
  items: readonly T[],
  pageIndex: number,
  pageSize: number,
): T[] {
  const size = Math.max(1, Math.trunc(pageSize));
  const start = Math.max(0, Math.trunc(pageIndex)) * size;
  return items.slice(start, start + size);
}

/** Returns -1 for the previous page, 1 for the next page, or 0 for a non-horizontal gesture. */
export function gallerySwipeDelta(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold = 44,
): -1 | 0 | 1 {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return 0;
  return deltaX < 0 ? 1 : -1;
}
