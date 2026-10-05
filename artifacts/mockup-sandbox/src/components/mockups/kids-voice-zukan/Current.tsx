import { Apple, BusFront, Cat, Image, Play, Sparkles } from 'lucide-react';
import './_group.css';

const sampleItems = [
  { name: 'りんご', date: '2026年10月5日', art: 'apple', icon: Apple },
  { name: 'ライオン', date: '2026年10月3日', art: 'lion', icon: Cat },
  { name: '赤バス', date: '2026年9月28日', art: 'bus', icon: BusFront },
  { name: 'お花', date: '2026年9月20日', art: 'flower', icon: Sparkles },
];

export function Current() {
  return (
    <main className="koe-preview koe-current-list">
      <div className="section-top">
        <h2 className="section-label"><Sparkles size={17} /> わが家のずかん</h2>
        <span className="section-hint">写真をひらくと、声が聞けます</span>
      </div>
      <section className="card-grid" aria-label="保存したカード">
        {sampleItems.map(({ name, date, art, icon: Icon }) => (
          <article className="memory-card" key={name}>
            <button className={`photo-frame photo-frame--${art}`} type="button" aria-label={`${name}の写真をひらく`}>
              <Icon size={72} strokeWidth={1.35} />
              <span className="recorded-stamp" aria-label="声の録音あり"><Play size={15} fill="currentColor" /></span>
            </button>
            <div className="card-copy">
              <div><h3 className="card-title">{name}</h3><p className="card-date">{date}</p></div>
              <button className="listen-chip" type="button" aria-label={`${name}の声をきく`}><Play size={14} /> 声をきく</button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
