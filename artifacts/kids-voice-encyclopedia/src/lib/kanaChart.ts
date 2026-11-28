/**
 * 五十音表（子ども向け・横書き）の並びと、キロク名の頭文字から
 * 対応するかなを求める対応表。清音・濁音・拗音はページを分ける。
 * 小さい文字で始まる名前は大きい文字に寄せて判定する。
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

/** 濁音・半濁音の表（清音とは分けて別ページに表示する）。 */
export const DAKUTEN_ROWS: string[][] = [
  ['が', 'ぎ', 'ぐ', 'げ', 'ご'],
  ['ざ', 'じ', 'ず', 'ぜ', 'ぞ'],
  ['だ', 'ぢ', 'づ', 'で', 'ど'],
  ['ば', 'び', 'ぶ', 'べ', 'ぼ'],
  ['ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ'],
];
export const ALL_DAKUTEN: string[] = DAKUTEN_ROWS.flat();

/** 拗音の表（小さい「ゃゅょ」との組み合わせ）。 */
export const YOON_ROWS: string[][] = [
  ['きゃ', 'きゅ', 'きょ'],
  ['しゃ', 'しゅ', 'しょ'],
  ['ちゃ', 'ちゅ', 'ちょ'],
  ['にゃ', 'にゅ', 'にょ'],
  ['ひゃ', 'ひゅ', 'ひょ'],
  ['みゃ', 'みゅ', 'みょ'],
  ['りゃ', 'りゅ', 'りょ'],
  ['ぎゃ', 'ぎゅ', 'ぎょ'],
  ['じゃ', 'じゅ', 'じょ'],
  ['ぢゃ', 'ぢゅ', 'ぢょ'],
  ['びゃ', 'びゅ', 'びょ'],
  ['ぴゃ', 'ぴゅ', 'ぴょ'],
];
export const ALL_YOON: string[] = YOON_ROWS.flat();

/** 言葉の先頭に来ないため、カードが当てはまらない文字。最初から埋まった状態で表示する。 */
export const NON_INITIAL_KANA: string[] = ['を', 'ん'];

const KANA_SET = new Set([...ALL_KANA, ...ALL_DAKUTEN]);
const YOON_SET = new Set(ALL_YOON);
const YOON_BASES = new Set(['き', 'し', 'ち', 'に', 'ひ', 'み', 'り', 'ぎ', 'じ', 'ぢ', 'び', 'ぴ']);
const SMALL_YOON = new Set(['ゃ', 'ゅ', 'ょ']);

const SMALL_TO_FULL: Record<string, string> = {
  'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
  'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'っ': 'つ', 'ゎ': 'わ',
  'ゕ': 'か', 'ゖ': 'け', 'ゐ': 'い', 'ゑ': 'え', 'ゔ': 'う',
};

function toHiragana(char: string): string {
  const code = char.charCodeAt(0);
  // カタカナ（ァ〜ヶ）をひらがなへ。
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char;
}

/** 名前の頭文字から五十音表のかなを求める。対応しない場合は null。 */
export function kanaOfName(name: string): string | null {
  const chars = [...(name ?? '').trim()];
  if (!chars.length) return null;
  const first = toHiragana(chars[0]);
  // 拗音（きゃ・じゃ など）は2文字で1つのセルに対応する。
  if (chars.length > 1 && YOON_BASES.has(first) && SMALL_YOON.has(toHiragana(chars[1]))) {
    const combo = first + toHiragana(chars[1]);
    if (YOON_SET.has(combo)) return combo;
  }
  const single = SMALL_TO_FULL[first] ?? first;
  return KANA_SET.has(single) ? single : null;
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
