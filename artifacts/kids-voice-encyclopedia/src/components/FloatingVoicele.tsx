import { useState } from 'react';

const VOICELE_IMAGES = [
  'voicel_welcome.png',
  'voicel_stand.png',
  'voicel_listen.png',
  'voicel_record.png',
  'voicel_happy.png',
  'voicel_sleep.png',
  'voicel_think.png',
  'voicel_fly.png',
  'voicel_cheer.png',
  'voicel_surprise.png',
  'voicel_sit.png',
  'voicel_zukan.png',
] as const;

const GUTTER_POSITIONS = ['upper', 'middle', 'lower'] as const;

export default function FloatingVoicele() {
  const [appearance] = useState(() => ({
    image: VOICELE_IMAGES[Math.floor(Math.random() * VOICELE_IMAGES.length)],
    position: GUTTER_POSITIONS[Math.floor(Math.random() * GUTTER_POSITIONS.length)],
    delay: `-${(Math.random() * 3).toFixed(2)}s`,
  }));

  return (
    <div className="book-companion-layer" aria-hidden="true" data-testid="book-companion-layer">
      <img
        className={`book-companion book-companion-${appearance.position}`}
        src={`${import.meta.env.BASE_URL}character/${appearance.image}`}
        alt=""
        draggable={false}
        decoding="async"
        loading="lazy"
        style={{ animationDelay: appearance.delay }}
      />
    </div>
  );
}
