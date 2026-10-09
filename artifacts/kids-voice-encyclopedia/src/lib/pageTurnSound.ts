let pageTurnAudio: HTMLAudioElement | null = null;

function pageTurnAudioUrl() {
  const baseUrl = typeof import.meta.env === 'object' ? import.meta.env.BASE_URL : '/';
  return `${baseUrl}assets/audio/page-turn-paper.mp3`;
}

function getPageTurnAudio() {
  if (pageTurnAudio) return pageTurnAudio;
  if (typeof Audio === 'undefined') return null;

  try {
    pageTurnAudio = new Audio(pageTurnAudioUrl());
    pageTurnAudio.preload = 'auto';
    pageTurnAudio.volume = 0.78;
    pageTurnAudio.load();
    return pageTurnAudio;
  } catch {
    return null;
  }
}

export function preloadPageTurnSound() {
  return getPageTurnAudio() !== null;
}

/** Replays the supplied picture-book page sound from the beginning on every turn. */
export function playPageTurnSound() {
  const audio = getPageTurnAudio();
  if (!audio) return false;

  try {
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
