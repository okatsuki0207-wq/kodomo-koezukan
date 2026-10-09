import { useLayoutEffect, useRef, useState } from 'react';

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
type GutterPosition = typeof GUTTER_POSITIONS[number];
type VoiceleAppearance = { image: typeof VOICELE_IMAGES[number]; position: GutterPosition; delay: string };

function randomChoice<T>(values: readonly T[]) {
  return values[Math.floor(Math.random() * values.length)];
}

function chooseAppearance(previous?: VoiceleAppearance): VoiceleAppearance {
  const images = previous ? VOICELE_IMAGES.filter((image) => image !== previous.image) : VOICELE_IMAGES;
  const positions = previous ? GUTTER_POSITIONS.filter((position) => position !== previous.position) : GUTTER_POSITIONS;
  return {
    image: randomChoice(images),
    position: randomChoice(positions),
    delay: `-${(Math.random() * 3).toFixed(2)}s`,
  };
}

export default function FloatingVoicele({ revision }: { revision: number }) {
  const [appearance, setAppearance] = useState(() => chooseAppearance());
  const previousRevision = useRef(revision);
  useLayoutEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    setAppearance((previous) => chooseAppearance(previous));
  }, [revision]);

  return (
    <div className="book-companion-layer" aria-hidden="true" data-testid="book-companion-layer">
      <img
        key={`${revision}-${appearance.image}-${appearance.position}`}
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
