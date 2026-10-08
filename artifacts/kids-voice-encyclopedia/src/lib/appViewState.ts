export type AppView = 'start' | 'library';

export const APP_VIEW_STORAGE_KEY = 'kids-voice-encyclopedia:last-view';

export function restoreAppView(pathname: string, saved: string | null): AppView {
  if (pathname.includes('/view/')) return 'library';
  return saved === 'library' ? 'library' : 'start';
}

export function persistAppView(view: AppView, storage?: Pick<Storage, 'setItem'>) {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    target?.setItem(APP_VIEW_STORAGE_KEY, view);
  } catch {
    // The current tab still works when browser storage is blocked.
  }
}
