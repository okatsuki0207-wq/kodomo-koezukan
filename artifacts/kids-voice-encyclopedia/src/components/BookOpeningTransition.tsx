import type { ActiveBookOpeningPhase } from '../lib/bookOpening';
import { useEffect, useRef, useState } from 'react';

export default function BookOpeningTransition({
  phase,
  onFinished,
}: {
  phase: ActiveBookOpeningPhase;
  onFinished: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const onFinishedRef = useRef(onFinished);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;

    if (phase !== 'opening') {
      if (phase !== 'fade') element.pause();
      return;
    }

    setVideoFailed(false);
    try {
      element.currentTime = 0;
    } catch {
      // The browser may not have decoded the first frame yet.
    }
    const playback = element.play();
    if (playback && typeof playback.catch === 'function') {
      void playback.catch(() => {
        setVideoFailed(true);
        onFinishedRef.current();
      });
    }
  }, [phase]);

  const handleVideoError = () => {
    setVideoFailed(true);
    if (phase === 'opening') onFinishedRef.current();
  };

  return (
    <div
      className="book-opening-overlay"
      data-phase={phase}
      aria-hidden="true"
      data-testid="book-opening-transition"
    >
      <div className="book-opening-light" />
      <div className="book-opening-video-stage">
        <img
          className="book-opening-video-poster"
          src={`${import.meta.env.BASE_URL}assets/video/book-opening-poster.jpg`}
          alt=""
        />
        <video
          ref={video}
          className={`book-opening-video${videoFailed ? ' is-failed' : ''}`}
          src={`${import.meta.env.BASE_URL}assets/video/book-opening.mp4`}
          poster={`${import.meta.env.BASE_URL}assets/video/book-opening-poster.jpg`}
          preload="auto"
          muted
          playsInline
          disablePictureInPicture
          onEnded={() => onFinishedRef.current()}
          onError={handleVideoError}
          data-testid="video-book-opening"
        />
      </div>
    </div>
  );
}
