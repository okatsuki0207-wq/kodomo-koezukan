import { Apple, BusFront, Cat, Pause, Play, Sparkles } from 'lucide-react';
import { useState } from 'react';
import './_group.css';

const sampleItems = [
  { name: 'りんご', date: '2026年10月5日', art: 'apple', icon: Apple },
  { name: 'ライオン', date: '2026年10月3日', art: 'lion', icon: Cat },
  { name: '赤バス', date: '2026年9月28日', art: 'bus', icon: BusFront },
  { name: 'お花', date: '2026年9月20日', art: 'flower', icon: Sparkles },
];

export function Collage() {
  const [playing, setPlaying] = useState<string | null>(null);

  return (
    <main className="koe-preview koe-preview--collage">
      <p className="koe-preview__eyebrow">あつめたものの記録</p>
      <h1 className="koe-preview__title">わが家のずかん</h1>
      <p className="koe-preview__hint">写真をタップすると、そのときの声が流れます</p>
      <section className="koe-collage" aria-label="シールコラージュ風の図鑑">
        {sampleItems.map(({ name, date, art, icon: Icon }) => {
          const isPlaying = playing === name;
          return (
            <article className="koe-collage__item" key={name}>
              <button
                className={`koe-collage__picture koe-collage__picture--${art}`}
                type="button"
                onClick={() => setPlaying(isPlaying ? null : name)}
                aria-label={`${name}の声を${isPlaying ? '止める' : '再生する'}`}
              >
                <Icon size={72} strokeWidth={1.35} />
              </button>
              <div className="koe-collage__caption">
                <div><h2 className="koe-collage__name">{name}</h2><p className="koe-preview__date">{date}</p></div>
                <button
                  type="button"
                  className={`koe-collage__play${isPlaying ? ' koe-collage__play--active' : ''}`}
                  aria-label={`${name}の声を${isPlaying ? '止める' : '再生する'}`}
                  onClick={() => setPlaying(isPlaying ? null : name)}
                >
                  {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                </button>
              </div>
            </article>
          );
        })}
      </section>
      <p className="koe-collage__footer">写真と声は、この端末のブラウザに保存されます</p>
    </main>
  );
}
