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

test('gallery uses five rows on short screens and six rows on taller screens', () => {
  assert.equal(galleryPageSize(568), 15);
  assert.equal(galleryPageSize(759), 15);
  assert.equal(galleryPageSize(760), 15);
  assert.equal(galleryPageSize(874), 18);
});

test('gallery reserves the first cell for creation without losing cards between pages', () => {
  const items = Array.from({ length: 36 }, (_, index) => `card-${index + 1}`);
  assert.equal(galleryPageCount(17, 18, true), 1);
  assert.equal(galleryPageCount(18, 18, true), 2);
  assert.deepEqual(galleryPageItems(items, 0, 18, true), items.slice(0, 17));
  assert.deepEqual(galleryPageItems(items, 1, 18, true), items.slice(17, 35));
  assert.deepEqual(galleryPageItems(items, 2, 18, true), ['card-36']);
});

test('gallery divides cards into bounded pages and clamps removed last pages', () => {
  const items = Array.from({ length: 31 }, (_, index) => `card-${index + 1}`);
  assert.equal(galleryPageCount(items.length, 18), 2);
  assert.deepEqual(galleryPageItems(items, 0, 18), items.slice(0, 18));
  assert.deepEqual(galleryPageItems(items, 1, 18), items.slice(18, 36));
  assert.equal(clampGalleryPage(8, 2), 1);
  assert.equal(galleryPageCount(0, 18), 1);
});

test('gallery recognizes horizontal swipes and ignores short or mostly vertical gestures', () => {
  assert.equal(gallerySwipeDelta(200, 100, 130, 110), 1);
  assert.equal(gallerySwipeDelta(130, 100, 200, 110), -1);
  assert.equal(gallerySwipeDelta(200, 100, 170, 105), 0);
  assert.equal(gallerySwipeDelta(200, 100, 120, 190), 0);
});

test('gallery cards render names as noninteractive labels and page through touch gestures', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
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
  assert.match(styles, /\.app-shell-library \.sticker-collage \{[^}]*grid-template-rows:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.app-shell-library \.sticker-collage\.is-compact \{[^}]*grid-template-rows:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.app-shell-library \.sticker-media \{[^}]*height:min\(100%,/);
  assert.match(styles, /\.app-shell-library \.sticker-photo \{[^}]*object-fit:contain/);
  assert.match(styles, /@keyframes book-page-next/);
  assert.match(styles, /background-color:#fcfbf7/);
});
