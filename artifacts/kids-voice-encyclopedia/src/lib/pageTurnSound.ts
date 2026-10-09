let pageTurnAudio: HTMLAudioElement | null = null;
let pageTurnSoundUnavailable = false;
let pageTurnUnlockPending = false;

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
    audio.volume = 0.65;
    audio.addEventListener('error', () => {
      pageTurnSoundUnavailable = true;
      if (pageTurnAudio === audio) pageTurnAudio = null;
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
  if (pageTurnUnlockPending) return true;

  try {
    audio.muted = true;
    const playback = audio.play();
    if (playback && typeof playback.then === 'function') {
      pageTurnUnlockPending = true;
      void playback.then(() => {
        if (!pageTurnUnlockPending || pageTurnAudio !== audio) return;
        pageTurnUnlockPending = false;
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
    }
    return true;
  } catch {
    pageTurnUnlockPending = false;
    audio.muted = false;
    return false;
  }
}

/** Replays the supplied picture-book page sound from the beginning on every turn. */
export function playPageTurnSound() {
  const audio = getPageTurnAudio();
  if (!audio) return false;

  try {
    pageTurnUnlockPending = false;
    audio.muted = false;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // The media may not have metadata yet; play() will start it as soon as it is ready.
    }
    const playback = audio.play();
    if (playback && typeof playback.catch === 'function') void playback.catch(() => {});
    return true;
  } catch {
    return false;
  }
}
