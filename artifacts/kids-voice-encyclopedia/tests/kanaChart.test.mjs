import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_DAKUTEN, ALL_KANA, ALL_YOON, NON_INITIAL_KANA, displayKana, groupItemsByKana, kanaOfName, toKatakana } from '../src/lib/kanaChart.ts';

test('kana chart has the standard 46 characters', () => {
  assert.equal(ALL_KANA.length, 46);
  assert.equal(new Set(ALL_KANA).size, 46);
});

test('dakuten and yoon charts are complete', () => {
  assert.equal(ALL_DAKUTEN.length, 25);
  assert.equal(new Set(ALL_DAKUTEN).size, 25);
  assert.equal(ALL_YOON.length, 36);
  assert.equal(new Set(ALL_YOON).size, 36);
  assert.deepEqual(NON_INITIAL_KANA, ['を', 'ん']);
});

test('names map to their leading kana', () => {
  assert.equal(kanaOfName('あいす'), 'あ');
  assert.equal(kanaOfName('ぞう'), 'ぞ');
  assert.equal(kanaOfName('パトカー'), 'ぱ');
  assert.equal(kanaOfName('がっこう'), 'が');
  assert.equal(kanaOfName('っぽい'), 'つ');
  assert.equal(kanaOfName('ゃーん'), 'や');
  assert.equal(kanaOfName('わに'), 'わ');
  assert.equal(kanaOfName('ほん'), 'ほ');
  assert.equal(kanaOfName('ん'), 'ん');
});

test('yoon names map to their two-character cell', () => {
  assert.equal(kanaOfName('きゃべつ'), 'きゃ');
  assert.equal(kanaOfName('じゃない'), 'じゃ');
  assert.equal(kanaOfName('ちょっと'), 'ちょ');
  assert.equal(kanaOfName('キャンプ'), 'きゃ');
  assert.equal(kanaOfName('しかく'), 'し');
  assert.equal(kanaOfName('じかん'), 'じ');
});

test('non-kana names do not map to the chart', () => {
  assert.equal(kanaOfName('ABC'), null);
  assert.equal(kanaOfName('象'), null);
  assert.equal(kanaOfName(''), null);
  assert.equal(kanaOfName('  '), null);
});

test('katakana conversion round-trips the chart', () => {
  assert.equal(toKatakana('あ'), 'ア');
  assert.equal(displayKana('を', 'katakana'), 'ヲ');
  assert.equal(displayKana('を', 'hiragana'), 'を');
  assert.equal(displayKana('が', 'katakana'), 'ガ');
  assert.equal(displayKana('きゃ', 'katakana'), 'キャ');
  assert.equal(kanaOfName('ヲタ芸'), 'を');
});

test('items group by kana with dakuten and yoon in their own cells', () => {
  const items = [
    { itemName: 'あめ' }, { itemName: 'アイス' }, { itemName: 'ぞう' },
    { itemName: 'さくら' }, { itemName: 'きゃべつ' }, { itemName: 'ABC' },
  ];
  const grouped = groupItemsByKana(items);
  assert.deepEqual(grouped.get('あ').map((item) => item.itemName), ['あめ', 'アイス']);
  assert.deepEqual(grouped.get('さ').map((item) => item.itemName), ['さくら']);
  assert.deepEqual(grouped.get('ぞ').map((item) => item.itemName), ['ぞう']);
  assert.deepEqual(grouped.get('きゃ').map((item) => item.itemName), ['きゃべつ']);
  assert.equal(grouped.size, 4);
});
