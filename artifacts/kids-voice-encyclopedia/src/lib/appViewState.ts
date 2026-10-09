export type AppView = 'start' | 'library';

export const APP_VIEW_STORAGE_KEY = 'kids-voice-encyclopedia:last-view';
export const APP_LAST_ACTIVE_STORAGE_KEY = 'kids-voice-encyclopedia:last-active-at';
export const APP_VIEW_RESUME_WINDOW_MS = 30 * 60 * 1000;

export function restoreAppView(
  pathname: string,
  saved: string | null,
  lastActiveAt: string | number | null = null,
  now = Date.now(),
): AppView {
  if (pathname.includes('/view/')) return 'library';
  if (saved !== 'library' || lastActiveAt === null) return 'start';
  const timestamp = typeof lastActiveAt === 'number' ? lastActiveAt : Number(lastActiveAt);
  const inactiveFor = now - timestamp;
  return Number.isFinite(timestamp) && inactiveFor >= 0 && inactiveFor < APP_VIEW_RESUME_WINDOW_MS
    ? 'library'
    : 'start';
}

export function persistAppView(view: AppView, storage?: Pick<Storage, 'setItem'>, now = Date.now()) {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    target?.setItem(APP_VIEW_STORAGE_KEY, view);
    target?.setItem(APP_LAST_ACTIVE_STORAGE_KEY, String(now));
  } catch {
    // The current tab still works when browser storage is blocked.
  }
}
