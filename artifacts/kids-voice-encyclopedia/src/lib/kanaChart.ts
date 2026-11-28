/**
 * 五十音表（子ども向け・横書き）の並びと、キロク名の頭文字から
 * 対応するかなを求める対応表。濁点・半濁点は清音に、小さい文字は
 * 大きい文字に寄せて判定する。
 */
export const KANA_ROWS: Array<Array<string | null>> = [
  ['あ', 'い', 'う', 'え', 'お'],
  ['か', 'き', 'く', 'け', 'こ'],
  ['さ', 'し', 'す', 'せ', 'そ'],
  ['た', 'ち', 'つ', 'て', 'と'],
  ['な', 'に', 'ぬ', 'ね', 'の'],
  ['は', 'ひ', 'ふ', 'へ', 'ほ'],
  ['ま', 'み', 'む', 'め', 'も'],
  ['や', null, 'ゆ', null, 'よ'],
  ['ら', 'り', 'る', 'れ', 'ろ'],
  ['わ', null, null, null, 'を'],
];
export const KANA_N = 'ん';
export const ALL_KANA: string[] = [...KANA_ROWS.flatMap((row) => row.filter((kana): kana is string => kana !== null)), KANA_N];
const KANA_SET = new Set(ALL_KANA);

const DAKUTEN_TO_SEION: Record<string, string> = {
  'が': 'か', 'ぎ': 'き', 'ぐ': 'く', 'げ': 'け', 'ご': 'こ',
  'ざ': 'さ', 'じ': 'し', 'ず': 'す', 'ぜ': 'せ', 'ぞ': 'そ',
  'だ': 'た', 'ぢ': 'ち', 'づ': 'つ', 'で': 'て', 'ど': 'と',
  'ば': 'は', 'び': 'ひ', 'ぶ': 'ふ', 'べ': 'へ', 'ぼ': 'ほ',
  'ぱ': 'は', 'ぴ': 'ひ', 'ぷ': 'ふ', 'ぺ': 'へ', 'ぽ': 'ほ',
  'ゔ': 'う',
};
const SMALL_TO_FULL: Record<string, string> = {
  'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
  'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'っ': 'つ', 'ゎ': 'わ',
  'ゕ': 'か', 'ゖ': 'け', 'ゐ': 'い', 'ゑ': 'え',
};

/** 名前の頭文字から五十音表のかなを求める。対応しない場合は null。 */
export function kanaOfName(name: string): string | null {
  const first = [...(name ?? '').trim()][0];
  if (!first) return null;
  let kana = first;
  const code = kana.charCodeAt(0);
  // カタカナ（ァ〜ヶ）をひらがなへ。
  if (code >= 0x30a1 && code <= 0x30f6) kana = String.fromCharCode(code - 0x60);
  kana = DAKUTEN_TO_SEION[kana] ?? SMALL_TO_FULL[kana] ?? kana;
  return KANA_SET.has(kana) ? kana : null;
}

export function toKatakana(kana: string): string {
  return [...kana].map((char) => {
    const code = char.charCodeAt(0);
    return code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : char;
  }).join('');
}

export function displayKana(kana: string, script: 'hiragana' | 'katakana'): string {
  return script === 'katakana' ? toKatakana(kana) : kana;
}

/** アイテムをかなごとにまとめる。対応しない名前は含まれない。 */
export function groupItemsByKana<T extends { itemName: string }>(items: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const kana = kanaOfName(item.itemName);
    if (!kana) continue;
    const list = grouped.get(kana);
    if (list) list.push(item);
    else grouped.set(kana, [item]);
  }
  return grouped;
}
