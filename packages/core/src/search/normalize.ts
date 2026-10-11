/**
 * Text normalization for search and turn rules. Pure and deterministic, the same in every host.
 *
 * Matching should ignore what a person does not type the same way twice: letter case, accents, compatibility forms
 * (full-width letters, ligatures), and spelling variants that are one letter in meaning (Greek final sigma). So the
 * query and the text both go through {@link normalizeText} before they are compared.
 *
 * @packageDocumentation
 */

/** A range in the original (not normalized) text, in UTF-16 code units, end exclusive. Ready for `slice`. */
export interface TextRange {
  start: number;
  end: number;
}

/**
 * Fold one character group the way search compares text:
 *
 * 1. NFKC: compatibility forms become plain ones (`ﬁ` → `fi`, full-width `Ａ` → `A`, `²` → `2`).
 * 2. Case fold: lower case, plus the full folds `toLowerCase` lacks (`ß`/`ẞ` → `ss`), Greek final `ς` → `σ`, and
 *    Turkish dotless `ı` → `i` (so `İstanbul`, `istanbul` and `ıstanbul` all match).
 * 3. NFD, then drop every combining mark: Greek tonos and dialytika, Latin accents, Hebrew niqqud and cantillation,
 *    Arabic harakat. Arabic tatweel (`ـ`, a stretching stroke) is dropped too. Japanese voicing marks are kept,
 *    because `か` and `が` are different syllables, not one letter with an accent.
 * 4. NFC, so scripts that NFD splits without marks (Korean Hangul) come back whole.
 *
 * Dropping marks is deliberately loose (in a few scripts, such as Devanagari vowel signs, it also merges different
 * words); it is applied to the query and the text alike, and an exact or regex rule can be used when it matters.
 */
function foldCluster(cluster: string): string {
  return cluster
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ßẞς\u0131]/g, (c) => FOLDS[c]!)
    .normalize('NFD')
    .replace(/[\p{M}\u0640]/gu, (c) => (c === '\u3099' || c === '\u309a' ? c : ''))
    .normalize('NFC');
}

const FOLDS: Record<string, string> = { 'ß': 'ss', 'ẞ': 'ss', 'ς': 'σ', '\u0131': 'i' };

/**
 * Split text into clusters: one base character with the combining marks after it. Normalizing cluster by cluster
 * keeps every output character traceable to its source, which highlighting needs.
 */
function clusters(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const re = /\P{M}\p{M}*|\p{M}+/gsu;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ text: m[0], start: m.index });
  return out;
}

/**
 * Normalize text for comparison. Apply it to both sides: `normalizeText(text).includes(normalizeText(query))`.
 *
 * @example
 * ```ts
 * normalizeText('Ἀθῆναι, ΟΔΟΣ');   // 'αθηναι, οδοσ'
 * normalizeText('İSTANBUL');        // 'istanbul'
 * normalizeText('שָׁלוֹם');          // 'שלום'
 * normalizeText('ﬁle Straße');      // 'file strasse'
 * ```
 */
export function normalizeText(text: string): string {
  return normalizeWithMap(text).text;
}

/**
 * {@link normalizeText} plus, for every character of the result, the offset of the source character it came from.
 * `map` has one extra entry at the end, equal to `text.length` of the source, so a normalized range `[a, b)` maps
 * back to `[map[a], map[b])`.
 *
 * @example
 * ```ts
 * const { text, map } = normalizeWithMap('Café!');
 * text; // 'cafe!'
 * map;  // [0, 1, 2, 3, 4, 5]
 * ```
 */
export function normalizeWithMap(source: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (const c of clusters(source)) {
    const folded = foldCluster(c.text);
    text += folded;
    for (let i = 0; i < folded.length; i++) map.push(c.start);
  }
  map.push(source.length);
  return { text, map };
}

/**
 * Every place where `query` occurs in `text` after normalization, as ranges in the original text, for highlighting
 * and for "contains" rules. Matches do not overlap; an empty query matches nothing.
 *
 * @example
 * ```ts
 * findMatches('Η ΟΔΟΣ και η οδός', 'οδος'); // [{ start: 2, end: 6 }, { start: 13, end: 17 }]
 * ```
 */
export function findMatches(text: string, query: string): TextRange[] {
  const needle = normalizeText(query);
  if (needle === '') return [];
  const { text: hay, map } = normalizeWithMap(text);
  const out: TextRange[] = [];
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
    out.push({ start: map[at]!, end: endOf(map, at + needle.length) });
  }
  return out;
}

/** The source end for a normalized end: the start of the next source cluster, past any trailing marks. */
function endOf(map: readonly number[], normEnd: number): number {
  const last = map[normEnd - 1]!;
  for (let i = normEnd; i < map.length; i++) if (map[i]! !== last) return map[i]!;
  return map.at(-1)!;
}
