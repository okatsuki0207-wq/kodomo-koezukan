export const STANDARD_GALLERY_PAGE_SIZE = 18;
export const COMPACT_GALLERY_PAGE_SIZE = 15;
export const COMPACT_GALLERY_MAX_HEIGHT = 760;

export function galleryPageSize(viewportHeight: number): number {
  return viewportHeight <= COMPACT_GALLERY_MAX_HEIGHT
    ? COMPACT_GALLERY_PAGE_SIZE
    : STANDARD_GALLERY_PAGE_SIZE;
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
  threshold = 44,
): -1 | 0 | 1 {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return 0;
  return deltaX < 0 ? 1 : -1;
}
