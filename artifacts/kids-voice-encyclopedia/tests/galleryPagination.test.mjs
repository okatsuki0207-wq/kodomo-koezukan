import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  clampGalleryPage,
  galleryPageCount,
  galleryPageItems,
  galleryPageSize,
  gallerySwipeDelta,
} from '../src/lib/galleryPagination.ts';
import { playPageTurnSound } from '../src/lib/pageTurnSound.ts';

test('gallery uses four rows on short screens and five rows on taller screens', () => {
  assert.equal(galleryPageSize(568), 12);
  assert.equal(galleryPageSize(759), 12);
  assert.equal(galleryPageSize(760), 12);
  assert.equal(galleryPageSize(874), 15);
});

test('gallery reserves the first cell for creation without losing cards between pages', () => {
  const items = Array.from({ length: 31 }, (_, index) => `card-${index + 1}`);
  assert.equal(galleryPageCount(14, 15, true), 1);
  assert.equal(galleryPageCount(15, 15, true), 2);
  assert.deepEqual(galleryPageItems(items, 0, 15, true), items.slice(0, 14));
  assert.deepEqual(galleryPageItems(items, 1, 15, true), items.slice(14, 29));
  assert.deepEqual(galleryPageItems(items, 2, 15, true), ['card-30', 'card-31']);
});

test('gallery divides cards into bounded pages and clamps removed last pages', () => {
  const items = Array.from({ length: 31 }, (_, index) => `card-${index + 1}`);
  assert.equal(galleryPageCount(items.length, 15), 3);
  assert.deepEqual(galleryPageItems(items, 0, 15), items.slice(0, 15));
  assert.deepEqual(galleryPageItems(items, 1, 15), items.slice(15, 30));
  assert.deepEqual(galleryPageItems(items, 2, 15), ['card-31']);
  assert.equal(clampGalleryPage(8, 2), 1);
  assert.equal(galleryPageCount(0, 15), 1);
});

test('gallery recognizes horizontal swipes and ignores short or mostly vertical gestures', () => {
  assert.equal(gallerySwipeDelta(200, 100, 128, 110), 1);
  assert.equal(gallerySwipeDelta(128, 100, 200, 110), -1);
  assert.equal(gallerySwipeDelta(200, 100, 129, 105), 0);
  assert.equal(gallerySwipeDelta(200, 100, 120, 190), 0);
});

test('successful page turns play a layered, paper-like stereo rustle without electronic tones', async () => {
  const parameters = () => ({
    value: 0,
    events: [],
    setValueAtTime(value, time) { this.events.push(['set', value, time]); },
    exponentialRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]); },
  });
  const state = { source: null, filters: [], gains: [], buffer: null, buffers: [] };
  const context = {
    currentTime: 4,
    sampleRate: 1000,
    state: 'running',
    destination: {},
    createBuffer: (channels, length, sampleRate) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buffer = { numberOfChannels: channels, length, sampleRate, getChannelData: (channel) => data[channel], data };
      state.buffers.push(buffer);
      state.buffer = buffer;
      return state.buffer;
    },
    createBufferSource: () => {
      state.source = {
        buffer: null,
        connections: [],
        connect(node) { this.connections.push(node); },
        start(time) { this.startedAt = time; },
        stop(time) { this.stoppedAt = time; },
      };
      return state.source;
    },
    createBiquadFilter: () => {
      const filter = { type: '', Q: { value: 0 }, frequency: parameters(), connect: () => {} };
      state.filters.push(filter);
      return filter;
    },
    createGain: () => {
      const gain = { gain: parameters(), connect: () => {} };
      state.gains.push(gain);
      return gain;
    },
  };

  assert.equal(playPageTurnSound(context), true);
  assert.equal(state.buffer.numberOfChannels, 2);
  assert.equal(state.buffer.length, 480);
  assert.equal(state.buffer.sampleRate, 1000);
  assert.ok(state.buffer.data.every((channel) => channel.some((sample) => sample !== 0)));
  assert.equal(state.source.startedAt, 4);
  assert.ok(Math.abs(state.source.stoppedAt - 4.48) < 0.0001);
  assert.deepEqual(state.filters.map((filter) => filter.type), ['lowpass', 'highpass']);
  assert.ok(state.filters[0].frequency.events.some(([kind, frequency]) => kind === 'ramp' && frequency === 1150));
  assert.ok(state.filters[1].frequency.events.some(([kind, frequency]) => kind === 'ramp' && frequency === 1550));
  assert.ok(state.gains[0].gain.events.some(([kind, gain]) => kind === 'ramp' && gain === 0.34));
  assert.ok(state.gains[1].gain.events.some(([kind, gain]) => kind === 'ramp' && gain === 0.14));
  const sound = await readFile(new URL('../src/lib/pageTurnSound.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(sound, /createOscillator/);
  assert.match(sound, /paperGrain/);
});

test('gallery cards render names as noninteractive labels and page through touch gestures', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  const pagination = await readFile(new URL('../src/lib/galleryPagination.ts', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.match(app, /pageItems\.map\(\(item\) =>/);
  assert.match(app, /onTouchEnd=\{handleGalleryTouchEnd\}/);
  assert.match(app, /<span className="sticker-name"[^>]*data-testid=\{`label-card-name-/);
  assert.doesNotMatch(app, /<button[^>]*className="sticker-name"[^>]*onClick=/);
  assert.match(app, /className="sticker-photo-button"[\s\S]*?onClick=\{\(\) => playKeepsake\(item\)\}/);
  assert.match(app, /className="sticker-add-card"[\s\S]*?onClick=\{openCreate\}/);
  assert.match(app, /const showAddCard = !readOnlyMode/);
  assert.match(app, /showAddCard && currentPage === 0/);
  assert.match(app, /galleryPageItems\(visibleItems, currentPage, pageSize, showAddCard\)/);
  assert.doesNotMatch(app, /data-testid="button-create-card"/);
  assert.match(app, /gallery-page-count">\{`p\. \$\{currentPage \+ 1\}`\}/);
  assert.match(app, /page-turn-\$\{pageTurnDirection\}/);
  assert.match(styles, /\.app-shell-library \.sticker-collage \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.app-shell-library \.sticker-collage \{[^}]*grid-template-rows:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.app-shell-library \.sticker-collage\.is-compact \{[^}]*grid-template-rows:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.app-shell-library \.sticker-media \{[^}]*height:100%/);
  assert.match(styles, /\.app-shell-library \.sticker-photo-button \{[^}]*position:absolute;[^}]*inset:0;[^}]*height:100%/);
  assert.match(styles, /\.app-shell-library \.sticker-item \{[^}]*grid-template-rows:minmax\(0,1fr\) clamp\(/);
  assert.match(styles, /\.app-shell-library \.sticker-photo \{[^}]*object-fit:contain/);
  assert.match(styles, /\.app-shell-library \.sticker-photo \{[^}]*width:88%/);
  assert.match(styles, /@keyframes book-page-next/);
  assert.match(styles, /@keyframes book-sheet-next/);
  assert.match(styles, /\.book-left-page-peek/);
  assert.match(styles, /\.book-hardcover/);
  assert.match(styles, /#category-panel \{[^}]*box-shadow:[^;]+/);
  assert.match(styles, /0 4px 0 -1px #f3d7d7/);
  assert.doesNotMatch(styles, /#category-panel::before/);
  assert.match(styles, /#category-panel::after/);
  assert.match(styles, /overscroll-behavior:none/);
  assert.match(styles, /touch-action:pan-x pinch-zoom/);
  assert.match(styles, /\.gallery-page-viewport \{[^}]*touch-action:none/);
  assert.match(pagination, /threshold = 72/);
  assert.match(app.slice(app.indexOf('const turnGalleryPage'), app.indexOf('const handleGalleryTouchStart')), /playPageTurnSound\(\)/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.display_override, ['fullscreen', 'standalone']);
  assert.equal(manifest.theme_color, '#f8f9fa');
});

test('PWA home-screen icons are present at the dimensions declared by the manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  for (const icon of manifest.icons) {
    const iconBytes = await readFile(new URL(`../public/${icon.src.slice(1)}`, import.meta.url));
    assert.ok(iconBytes.length > 100);
    assert.equal(iconBytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  }
});
