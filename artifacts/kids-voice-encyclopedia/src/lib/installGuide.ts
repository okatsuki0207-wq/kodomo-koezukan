export type InstallPlatform = 'ios' | 'android' | 'other';

export const INSTALL_GUIDE_DISMISSED_KEY = 'kids-voice-encyclopedia:install-guide-dismissed';

export function detectInstallPlatform(userAgent: string): InstallPlatform {
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  // iPadOS in desktop mode poses as macOS but still has touch points.
  if (/android/i.test(userAgent)) return 'android';
  return 'other';
}

export function isIosSafari(userAgent: string): boolean {
  if (detectInstallPlatform(userAgent) !== 'ios') return false;
  // Chrome/Firefox/Edge on iOS cannot add to the home screen from their own
  // menus, so the guide has to send those readers to Safari instead.
  return !/crios|fxios|edgios|opios/i.test(userAgent);
}

export function isStandaloneDisplay(matchMediaStandalone: boolean, navigatorStandalone: boolean | undefined): boolean {
  return matchMediaStandalone || navigatorStandalone === true;
}

export function loadInstallGuideDismissed(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    return target?.getItem(INSTALL_GUIDE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistInstallGuideDismissed(storage?: Pick<Storage, 'setItem'>) {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    target?.setItem(INSTALL_GUIDE_DISMISSED_KEY, '1');
  } catch {
    // The current tab still works when browser storage is blocked.
  }
}

export function currentInstallPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'other';
  if (navigator.userAgent.includes('Macintosh') && (navigator.maxTouchPoints ?? 0) > 1) return 'ios';
  return detectInstallPlatform(navigator.userAgent);
}

export function currentIsIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  return currentInstallPlatform() === 'ios' && isIosSafari(navigator.userAgent);
}

export function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const matchMediaStandalone = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
  const navigatorStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return isStandaloneDisplay(matchMediaStandalone, navigatorStandalone);
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the event so the settings/guide button can offer the install at a
    // moment the reader chooses, instead of the browser's own mini-infobar.
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
  });
}

export function canPromptInstall(): boolean {
  return deferredInstallPrompt !== null;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const promptEvent = deferredInstallPrompt;
  if (!promptEvent) return 'unavailable';
  deferredInstallPrompt = null;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}
