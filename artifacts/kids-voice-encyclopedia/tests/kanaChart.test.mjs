import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_KANA, displayKana, groupItemsByKana, kanaOfName, toKatakana } from '../src/lib/kanaChart.ts';

test('kana chart has the standard 46 characters', () => {
  assert.equal(ALL_KANA.length, 46);
  assert.equal(new Set(ALL_KANA).size, 46);
});

test('names map to their leading kana', () => {
  assert.equal(kanaOfName('あいす'), 'あ');
  assert.equal(kanaOfName('ぞう'), 'そ');
  assert.equal(kanaOfName('パトカー'), 'は');
  assert.equal(kanaOfName('がっこう'), 'か');
  assert.equal(kanaOfName('っぽい'), 'つ');
  assert.equal(kanaOfName('ゃーん'), 'や');
  assert.equal(kanaOfName('わに'), 'わ');
  assert.equal(kanaOfName('ほん'), 'ほ');
  assert.equal(kanaOfName('ん'), 'ん');
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
  assert.equal(kanaOfName('ヲタ芸'), 'を');
});

test('items group by kana with dakuten folded into seion rows', () => {
  const items = [
    { itemName: 'あめ' }, { itemName: 'アイス' }, { itemName: 'ぞう' },
    { itemName: 'さくら' }, { itemName: 'ABC' },
  ];
  const grouped = groupItemsByKana(items);
  assert.deepEqual(grouped.get('あ').map((item) => item.itemName), ['あめ', 'アイス']);
  assert.deepEqual(grouped.get('さ').map((item) => item.itemName), ['さくら']);
  assert.deepEqual(grouped.get('そ').map((item) => item.itemName), ['ぞう']);
  assert.equal(grouped.size, 3);
});
