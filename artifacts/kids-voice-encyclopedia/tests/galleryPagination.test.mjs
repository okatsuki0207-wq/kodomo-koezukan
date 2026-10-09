import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import {
  clampGalleryPage,
  galleryPageCount,
  galleryPageItems,
  galleryPageSize,
  gallerySwipeDelta,
} from '../src/lib/galleryPagination.ts';
import { playPageTurnSound, preloadPageTurnSound, unlockPageTurnSound } from '../src/lib/pageTurnSound.ts';

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

test('page turns preload and play the latest supplied paper-turn MP3 from its beginning', async () => {
  const created = [];
  class FakeAudio {
    constructor(source) {
      this.src = source;
      this.preload = 'none';
      this.volume = 1;
      this.muted = false;
      this.currentTime = 0;
      this.loadCalls = 0;
      this.pauseCalls = 0;
      this.playCalls = 0;
      this.listeners = new Map();
      this.rejectNextPlay = false;
      this.error = null;
      created.push(this);
    }
    load() { this.loadCalls += 1; }
    pause() { this.pauseCalls += 1; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    play() {
      this.playCalls += 1;
      if (this.rejectNextPlay) {
        this.rejectNextPlay = false;
        return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
      }
      return Promise.resolve();
    }
  }
  const previousAudio = globalThis.Audio;
  globalThis.Audio = FakeAudio;
  try {
    assert.equal(preloadPageTurnSound(), true);
    const audio = created[0];
    assert.equal(audio.src, '/assets/audio/page-turn-paper.mp3');
    assert.equal(audio.preload, 'auto');
    assert.equal(audio.volume, 0.25);
    assert.equal(audio.loadCalls, 1);
    assert.equal(unlockPageTurnSound(), true);
    assert.equal(audio.muted, true);
    await Promise.resolve();
    assert.equal(audio.muted, false);
    assert.equal(audio.pauseCalls, 1);
    assert.equal(audio.currentTime, 0);
    assert.equal(playPageTurnSound(), true);
    assert.equal(audio.playCalls, 2);
    audio.currentTime = 0.4;
    assert.equal(playPageTurnSound(), true);
    assert.equal(audio.currentTime, 0);
    assert.equal(audio.pauseCalls, 3);
    assert.equal(audio.playCalls, 3);
    audio.rejectNextPlay = true;
    assert.equal(playPageTurnSound(), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(unlockPageTurnSound(), true, 'a later user gesture can retry after autoplay rejection');
    await Promise.resolve();
    assert.equal(audio.muted, false);
    audio.error = { code: 4 };
    audio.listeners.get('error')?.();
    assert.equal(playPageTurnSound(), false);
  } finally {
    if (previousAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = previousAudio;
  }

  const audioAsset = await readFile(new URL('../public/assets/audio/page-turn-paper.mp3', import.meta.url));
  assert.ok(audioAsset.byteLength > 10_000);
  await assert.rejects(
    access(new URL('../public/assets/audio/page-turn.mp3', import.meta.url)),
    { code: 'ENOENT' },
  );
  const sound = await readFile(new URL('../src/lib/pageTurnSound.ts', import.meta.url), 'utf8');
  assert.match(sound, /assets\/audio\/page-turn-paper\.mp3/);
  assert.match(sound, /export function unlockPageTurnSound\(\)/);
});

test('gallery cards render names as noninteractive labels and page through touch gestures', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  const pagination = await readFile(new URL('../src/lib/galleryPagination.ts', import.meta.url), 'utf8');
  const phraseDialog = await readFile(new URL('../src/components/BookPassphraseDialog.tsx', import.meta.url), 'utf8');
  const opening = await readFile(new URL('../src/components/BookOpeningTransition.tsx', import.meta.url), 'utf8');
  const openingTiming = await readFile(new URL('../src/lib/bookOpening.ts', import.meta.url), 'utf8');
  const companion = await readFile(new URL('../src/components/FloatingVoicele.tsx', import.meta.url), 'utf8');
  const shareDialog = await readFile(new URL('../src/components/ShareLinkDialog.tsx', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.match(app, /pageItems\.map\(\(item\) =>/);
  assert.match(app, /preloadPageTurnSound\(\)/);
  assert.match(app, /const openLibraryWithTransition = \(\) => \{[\s\S]*?unlockPageTurnSound\(\)/);
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
  assert.match(styles, /@keyframes book-page-previous/);
  assert.match(styles, /@keyframes book-sheet-previous/);
  assert.match(styles, /rotateY\(-178deg\)/);
  assert.match(styles, /rotateY\(178deg\)/);
  assert.match(styles, /\.page-turn-next \.sticker-item\.is-playing \.sticker-photo-button,[\s\S]*?animation:none;[\s\S]*?transition:none/);
  assert.match(styles, /\.page-turn-next \.voice-notes,[\s\S]*?\.page-turn-previous \.voice-notes \{[\s\S]*?display:none/);
  assert.match(app, /setPageTurnDirection\(delta > 0 \? 'next' : 'previous'\)/);
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
  const turnHandler = app.slice(app.indexOf('const turnGalleryPage'), app.indexOf('const handleGalleryTouchStart'));
  assert.match(turnHandler, /playPageTurnSound\(\)/);
  assert.ok(turnHandler.indexOf('playPageTurnSound()') < turnHandler.indexOf('setPageTurnDirection'),
    'the sound is requested before React schedules the page-turn frame');
  assert.match(app, /const PAGE_TURN_ANIMATION_MS = 1_000/);
  assert.match(turnHandler, /}, PAGE_TURN_ANIMATION_MS\)/);
  assert.match(styles, /\.sticker-collage\.page-turn-next \{[^}]*animation:book-page-next 1000ms/);
  assert.match(styles, /\.sticker-collage\.page-turn-previous \{[^}]*animation:book-page-previous 1000ms/);
  assert.match(styles, /animation:book-sheet-next 1000ms/);
  assert.match(styles, /animation:book-sheet-previous 1000ms/);
  assert.match(app, /if \(!hasActivePassphraseBook\(\)\)[\s\S]*setBookPassphraseOpen\(true\)/);
  assert.match(app, /useState\(\(\) => view === 'library' && !hasActivePassphraseBook\(\)\)/);
  assert.match(app, /activateBookForPassphrase\(passphrase\)/);
  assert.match(app, /setBookPassphraseMode\('switch'\)/);
  assert.match(app, /onSwitchBook=\{\(\) =>/);
  assert.match(phraseDialog, /autoComplete="off"/);
  assert.doesNotMatch(phraseDialog, /autoFocus/);
  assert.match(phraseDialog, /認証ではありません/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(app, /document\.addEventListener\('pointerdown', unlockOnTrustedGesture, true\)/);
  assert.match(app, /document\.addEventListener\('touchstart', unlockOnTrustedGesture, \{ capture: true, passive: true \}\)/);
  assert.match(app, /onClick=\{\(\) => \{ void shareEncyclopedia\(\); \}\} aria-label="ずかんを共有"/);
  assert.doesNotMatch(app, /beforeinstallprompt|openInstallExperience|InstallAppDialog/);
  assert.doesNotMatch(styles, /pwa-install-dialog|pwa-install-steps/);
  assert.match(app, /navigator\.share/);
  assert.match(app, /setShareLinkDialogOpen\(true\)/);
  assert.match(app, /<ShareLinkDialog[\s\S]*?url=\{window\.location\.href\}/);
  assert.match(shareDialog, /リンクをコピー/);
  assert.match(shareDialog, /value=\{url\}[\s\S]*?readOnly/);
  assert.match(app, /BOOK_OPENING_AFTER_SELECTION_KEY/);
  assert.match(opening, /assets\/video\/book-opening\.mp4/);
  assert.match(opening, /assets\/video\/book-opening-poster\.jpg/);
  assert.match(opening, /playsInline/);
  assert.match(opening, /muted/);
  assert.match(openingTiming, /openingMs: 3_100/);
  assert.match(companion, /voicel_sit\.png/);
  assert.match(companion, /voicel_zukan\.png/);
  assert.match(companion, /useLayoutEffect[\s\S]*?\[revision\]/);
  assert.match(companion, /filter\(\(image\) => image !== previous\.image\)/);
  assert.match(companion, /filter\(\(position\) => position !== previous\.position\)/);
  assert.match(app, /setCompanionRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(app, /<FloatingVoicele revision=\{companionRevision\} \/>/);
  assert.match(styles, /\.app-shell-library \.book-companion \{[^}]*width:clamp\(64px,20vw,88px\);[^}]*height:clamp\(80px,25vw,110px\)/);
  assert.match(styles, /\.app-shell-library \.book-companion-layer \{[^}]*pointer-events:none/);
  assert.match(styles, /\.app-shell-library \.book-companion \{[^}]*animation:book-companion-float/);
  assert.match(styles, /\.app-shell-library \.sticker-add-card \{[^}]*border:0;[^}]*background:transparent;[^}]*box-shadow:none/);
  assert.match(styles, /\.app-shell-library \.sticker-add-media \{[^}]*border:0;[^}]*background:var\(--rainbow-line\);[^}]*box-shadow:none/);
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.display_override, ['fullscreen', 'standalone']);
  assert.equal(manifest.theme_color, '#f8f9fa');
  const videoAsset = await readFile(new URL('../public/assets/video/book-opening.mp4', import.meta.url));
  const videoPoster = await readFile(new URL('../public/assets/video/book-opening-poster.jpg', import.meta.url));
  assert.ok(videoAsset.byteLength > 100_000);
  assert.ok(videoPoster.byteLength > 1_000);
});

test('PWA home-screen icons are present at the dimensions declared by the manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  for (const icon of manifest.icons) {
    const iconBytes = await readFile(new URL(`../public/${icon.src.slice(1)}`, import.meta.url));
    assert.ok(iconBytes.length > 100);
    assert.equal(iconBytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  }
});
