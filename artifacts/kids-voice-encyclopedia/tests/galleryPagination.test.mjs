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
import { playPageTurnSound, preloadPageTurnSound } from '../src/lib/pageTurnSound.ts';

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

test('page turns preload and play the user-supplied MP3 from its beginning', async () => {
  const created = [];
  class FakeAudio {
    constructor(source) {
      this.src = source;
      this.preload = 'none';
      this.volume = 1;
      this.currentTime = 0;
      this.loadCalls = 0;
      this.pauseCalls = 0;
      this.playCalls = 0;
      created.push(this);
    }
    load() { this.loadCalls += 1; }
    pause() { this.pauseCalls += 1; }
    play() { this.playCalls += 1; return Promise.resolve(); }
  }
  const previousAudio = globalThis.Audio;
  globalThis.Audio = FakeAudio;
  try {
    assert.equal(preloadPageTurnSound(), true);
    const audio = created[0];
    assert.equal(audio.src, '/assets/audio/page-turn.mp3');
    assert.equal(audio.preload, 'auto');
    assert.equal(audio.loadCalls, 1);
    assert.equal(playPageTurnSound(), true);
    assert.equal(audio.playCalls, 1);
    audio.currentTime = 0.4;
    assert.equal(playPageTurnSound(), true);
    assert.equal(audio.currentTime, 0);
    assert.equal(audio.pauseCalls, 2);
    assert.equal(audio.playCalls, 2);
  } finally {
    if (previousAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = previousAudio;
  }

  const audioAsset = await readFile(new URL('../public/assets/audio/page-turn.mp3', import.meta.url));
  assert.ok(audioAsset.byteLength > 10_000);
  const sound = await readFile(new URL('../src/lib/pageTurnSound.ts', import.meta.url), 'utf8');
  assert.match(sound, /assets\/audio\/page-turn\.mp3/);
});

test('gallery cards render names as noninteractive labels and page through touch gestures', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  const pagination = await readFile(new URL('../src/lib/galleryPagination.ts', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.match(app, /pageItems\.map\(\(item\) =>/);
  assert.match(app, /preloadPageTurnSound\(\)/);
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
  assert.match(styles, /\.app-shell-library \.sticker-photo \{[^}]*width:86%;[^}]*height:86%;[^}]*padding:2%;[^}]*object-fit:contain/);
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
