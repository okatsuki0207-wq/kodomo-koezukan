let pageTurnAudio: HTMLAudioElement | null = null;
let pageTurnSoundUnavailable = false;
let pageTurnUnlockPending = false;
let pageTurnAudioUnlocked = false;
let pageTurnPlaybackAttempt = 0;

function pageTurnAudioUrl() {
  const baseUrl = typeof import.meta.env === 'object' ? import.meta.env.BASE_URL : '/';
  return `${baseUrl}assets/audio/page-turn-paper.mp3`;
}

function getPageTurnAudio() {
  if (pageTurnSoundUnavailable) return null;
  if (pageTurnAudio) return pageTurnAudio;
  if (typeof Audio === 'undefined') return null;

  try {
    const audio = new Audio(pageTurnAudioUrl());
    audio.preload = 'auto';
    audio.volume = 0.12;
    audio.addEventListener('error', () => {
      if (audio.error?.code === 4) pageTurnSoundUnavailable = true;
      if (pageTurnAudio === audio) {
        pageTurnAudio = null;
        pageTurnUnlockPending = false;
        pageTurnAudioUnlocked = false;
      }
    }, { once: true });
    pageTurnAudio = audio;
    audio.load();
    return audio;
  } catch {
    return null;
  }
}

export function preloadPageTurnSound() {
  return getPageTurnAudio() !== null;
}

/** Uses the first explicit user action to unlock HTMLAudioElement playback on mobile browsers. */
export function unlockPageTurnSound() {
  const audio = getPageTurnAudio();
  if (!audio) return false;
  if (pageTurnAudioUnlocked) return true;
  if (pageTurnUnlockPending) return true;

  try {
    audio.muted = true;
    try {
      audio.currentTime = 0;
    } catch {
      // The audio may not have loaded metadata yet.
    }
    const playback = audio.play();
    if (playback && typeof playback.then === 'function') {
      pageTurnUnlockPending = true;
      void playback.then(() => {
        if (!pageTurnUnlockPending || pageTurnAudio !== audio) return;
        pageTurnUnlockPending = false;
        pageTurnAudioUnlocked = true;
        audio.pause();
        try {
          audio.currentTime = 0;
        } catch {
          // The audio may not have loaded metadata yet.
        }
        audio.muted = false;
      }).catch(() => {
        if (pageTurnAudio === audio && pageTurnUnlockPending) {
          pageTurnUnlockPending = false;
          pageTurnAudioUnlocked = false;
          audio.muted = false;
        }
      });
    } else {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // The audio may not have loaded metadata yet.
      }
      audio.muted = false;
      pageTurnAudioUnlocked = true;
    }
    return true;
  } catch {
    pageTurnUnlockPending = false;
    pageTurnAudioUnlocked = false;
    audio.muted = false;
    return false;
  }
}

/** Replays the supplied picture-book page sound from the beginning on every turn. */
export function playPageTurnSound() {
  const audio = getPageTurnAudio();
  if (!audio) return false;

  try {
    const attempt = ++pageTurnPlaybackAttempt;
    pageTurnUnlockPending = false;
    pageTurnAudioUnlocked = false;
    audio.muted = false;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // The media may not have metadata yet; play() will start it as soon as it is ready.
    }
    const playback = audio.play();
    if (playback && typeof playback.then === 'function') {
      void playback.then(() => {
        if (attempt === pageTurnPlaybackAttempt && pageTurnAudio === audio) {
          pageTurnAudioUnlocked = true;
        }
      }).catch((caught: unknown) => {
        if (attempt !== pageTurnPlaybackAttempt || pageTurnAudio !== audio) return;
        pageTurnAudioUnlocked = false;
        pageTurnUnlockPending = false;
        const errorName = caught instanceof Error ? caught.name : '';
        if (errorName === 'AbortError') {
          audio.pause();
          try {
            audio.currentTime = 0;
          } catch {
            // Wait for metadata before seeking on the next gesture.
          }
        }
        // The next trusted pointer/key gesture retries the unlock and playback.
      });
    } else {
      pageTurnAudioUnlocked = true;
    }
    return true;
  } catch {
    pageTurnAudioUnlocked = false;
    return false;
  }
}
