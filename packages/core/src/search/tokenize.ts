import { normalizeText, type TextRange } from './normalize.ts';

/** One search term: its normalized form, and where it sits in the original text. */
export interface Token extends TextRange {
  term: string;
}

/** Han, Hiragana, Katakana: scripts written without spaces, indexed as overlapping character pairs. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;
const WORD = /[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu;

/**
 * Split text into search terms, each normalized with {@link normalizeText}.
 *
 * - Words are runs of letters, digits and marks; an apostrophe inside a word keeps it whole (`don't`). Punctuation,
 *   spaces and symbols separate words. Code identifiers split at `_`, `.` and `-`, so `user_id` finds `user`.
 * - Chinese and Japanese text has no spaces, so each run of Han, Hiragana or Katakana is indexed as overlapping
 *   character pairs (`机器学习` → `机器`, `器学`, `学习`); a lone character stays one term. A two-character query
 *   then matches inside any longer word. Pairs are used instead of `Intl.Segmenter` because a segmenter's word list
 *   depends on the browser's ICU version, and search results must not differ between hosts.
 *
 * Use the same function for the text and the query.
 *
 * @example
 * ```ts
 * tokenize('Ἀθῆναι 2024: 机器学习').map((t) => t.term); // ['αθηναι', '2024', '机器', '器学', '学习']
 * ```
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD)) {
    const word = m[0];
    const start = m.index;
    if (!CJK.test(word)) {
      const term = normalizeText(word);
      if (term) out.push({ term, start, end: start + word.length });
      continue;
    }
    // Mixed runs (`GPT模型`): Latin parts stay words, CJK parts become pairs.
    let last = 0;
    for (const r of word.matchAll(CJK_RUN)) {
      if (r.index > last) pushWord(out, word.slice(last, r.index), start + last);
      pushPairs(out, r[0], start + r.index);
      last = r.index + r[0].length;
    }
    if (last < word.length) pushWord(out, word.slice(last), start + last);
  }
  return out;
}

function pushWord(out: Token[], word: string, start: number): void {
  const term = normalizeText(word);
  if (term) out.push({ term, start, end: start + word.length });
}

function pushPairs(out: Token[], run: string, start: number): void {
  const chars = [...run];
  const offsets: number[] = [];
  let o = start;
  for (const c of chars) {
    offsets.push(o);
    o += c.length;
  }
  offsets.push(o);
  if (chars.length === 1) {
    out.push({ term: normalizeText(chars[0]!), start, end: o });
    return;
  }
  for (let i = 0; i + 1 < chars.length; i++) {
    out.push({ term: normalizeText(chars[i]! + chars[i + 1]!), start: offsets[i]!, end: offsets[i + 2]! });
  }
}
