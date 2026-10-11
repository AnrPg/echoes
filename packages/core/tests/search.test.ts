import { describe, expect, it } from 'vitest';
import { findMatches, normalizeText, normalizeWithMap, tokenize } from '@echoes/core';

const n = normalizeText;
const terms = (s: string) => tokenize(s).map((t) => t.term);
const same = (a: string, b: string) => expect(n(a)).toBe(n(b));

describe('normalizeText', () => {
  it('Greek: tonos, dialytika, breathings, case and final sigma', () => {
    expect(n('Ἀθῆναι')).toBe('αθηναι');
    same('ΟΔΟΣ', 'οδός');
    same('Οδός', 'οδοσ');
    same('προϊόν', 'ΠΡΟΙΟΝ');
    same('ς', 'σ');
  });

  it('Turkish: dotted capital İ and dotless ı match plain i', () => {
    expect(n('İSTANBUL')).toBe('istanbul');
    same('İstanbul', 'ıstanbul');
    same('DİYARBAKIR', 'diyarbakir');
  });

  it('Hebrew: niqqud and cantillation are dropped', () => {
    expect(n('שָׁלוֹם')).toBe('שלום');
    same('בְּרֵאשִׁ֖ית', 'בראשית');
  });

  it('Arabic: harakat, shadda and tatweel are dropped', () => {
    expect(n('مَرْحَبًا')).toBe('مرحبا');
    same('مُحَمَّد', 'محمد');
    same('عـــربي', 'عربي');
  });

  it('compatibility forms, ligatures and full case folds', () => {
    expect(n('ﬁle Ｓtraße ẞ x²')).toBe('file strasse ss x2');
    same('Café', 'CAFE');
    same('naïve', 'naive');
  });

  it('keeps Chinese, Japanese and Korean whole', () => {
    expect(n('机器学习')).toBe('机器学习');
    expect(n('カタカナ')).toBe('カタカナ');
    expect(n('がギ')).toBe('がギ'); // voicing marks stay: か and が are different syllables
    expect(n('한국어')).toBe('한국어'); // NFD splits Hangul; NFC puts it back
  });

  it('maps every normalized character back to its source', () => {
    const { text, map } = normalizeWithMap('éß!');
    expect(text).toBe('ess!');
    expect(map).toEqual([0, 2, 2, 3, 4]);
  });
});

describe('findMatches', () => {
  it('finds normalized matches and returns ranges in the original text', () => {
    const text = 'Η ΟΔΟΣ και η οδός';
    const ranges = findMatches(text, 'οδος');
    expect(ranges.map((r) => text.slice(r.start, r.end))).toEqual(['ΟΔΟΣ', 'οδός']);
  });

  it('includes trailing marks and whole folded characters in the range', () => {
    const text = 'Café Straße';
    expect(findMatches(text, 'café').map((r) => text.slice(r.start, r.end))).toEqual(['Café']);
    expect(findMatches(text, 'strass').map((r) => text.slice(r.start, r.end))).toEqual(['Straß']);
  });

  it('works across scripts and ignores an empty query', () => {
    expect(findMatches('Visit İstanbul', 'istanbul')).toEqual([{ start: 6, end: 14 }]);
    expect(findMatches('שָׁלוֹם עולם', 'שלום')).toEqual([{ start: 0, end: 7 }]);
    expect(findMatches('abc', '')).toEqual([]);
    expect(findMatches('aaaa', 'aa')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });
});

describe('tokenize', () => {
  it('splits words on spaces, punctuation and code separators, keeping apostrophes', () => {
    expect(terms("Don't parse user_id.value — it's 2024!")).toEqual(["don't", 'parse', 'user', 'id', 'value', "it's", '2024']);
  });

  it('normalizes each term and keeps original offsets', () => {
    const text = 'Η ΟΔΟΣ';
    const [, t] = tokenize(text);
    expect(t).toEqual({ term: 'οδοσ', start: 2, end: 6 });
    expect(text.slice(t!.start, t!.end)).toBe('ΟΔΟΣ');
  });

  it('indexes Chinese and Japanese as overlapping character pairs', () => {
    expect(terms('机器学习')).toEqual(['机器', '器学', '学习']);
    expect(terms('我')).toEqual(['我']);
    expect(terms('ひらがなカナ')).toEqual(['ひら', 'らが', 'がな', 'なカ', 'カナ']);
  });

  it('splits mixed Latin and CJK runs', () => {
    const text = 'GPT模型 and 学习';
    const tokens = tokenize(text);
    expect(tokens.map((t) => t.term)).toEqual(['gpt', '模型', 'and', '学习']);
    expect(tokens.map((t) => text.slice(t.start, t.end))).toEqual(['GPT', '模型', 'and', '学习']);
  });

  it('handles characters outside the BMP', () => {
    const text = '𠀀𠀁 ok';
    const tokens = tokenize(text);
    expect(tokens[0]).toEqual({ term: '𠀀𠀁', start: 0, end: 4 });
    expect(tokens[1]).toEqual({ term: 'ok', start: 5, end: 7 });
  });

  it('keeps Korean, Hebrew and Arabic words whole', () => {
    expect(terms('한국어 문장')).toEqual(['한국어', '문장']);
    expect(terms('שָׁלוֹם עולם')).toEqual(['שלום', 'עולם']);
    expect(terms('مَرْحَبًا بالعالم')).toEqual(['مرحبا', 'بالعالم']);
  });
});
