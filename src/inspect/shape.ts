// Structural "shape" of JSON values, mergeable across many observations.
// This is how Phase 0 learns field names, optionality and enum values from real
// responses without storing conversation content.

import { classifyString, isIdLike, mayKeepLiteral, type StrClass } from './strings';

export type Kind = 'null' | 'bool' | 'num' | 'str' | 'arr' | 'obj' | 'other';

export interface Shape {
  /** Number of values observed at this position. */
  n: number;
  kinds: Kind[];
  str?: { classes: StrClass[]; values: string[]; more: boolean };
  num?: { int: boolean; min: number; max: number };
  /** `present` = in how many of the `n` objects the key appeared; present < n means optional. */
  obj?: { n: number; keys: Record<string, { present: number; shape: Shape }>; truncated?: boolean };
  arr?: { maxLen: number; items?: Shape };
}

/** Object keys that are ids (e.g. the node map keyed by message uuid) collapse into one entry. */
export const ID_KEY = '<id>';
export const MAX_VALUES = 24;
export const MAX_KEYS = 400;
export const MAX_DEPTH = 48;

const uniqSorted = <T extends string>(xs: readonly T[]): T[] => [...new Set(xs)].sort();

function kindOf(v: unknown): Kind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'arr';
  switch (typeof v) {
    case 'boolean': return 'bool';
    case 'number': return 'num';
    case 'string': return 'str';
    case 'object': return 'obj';
    default: return 'other';
  }
}

export function shapeOf(value: unknown, key?: string, depth = 0): Shape {
  const kind = kindOf(value);
  const s: Shape = { n: 1, kinds: [kind] };
  if (depth >= MAX_DEPTH) return s;
  switch (kind) {
    case 'str': {
      const v = value as string;
      s.str = { classes: [classifyString(v)], values: mayKeepLiteral(key, v) ? [v] : [], more: false };
      break;
    }
    case 'num': {
      const v = value as number;
      s.num = { int: Number.isInteger(v), min: v, max: v };
      break;
    }
    case 'arr': {
      const arr = value as unknown[];
      let items: Shape | undefined;
      for (const el of arr) {
        const sh = shapeOf(el, key, depth + 1);
        items = items ? mergeShapes(items, sh) : sh;
      }
      s.arr = items ? { maxLen: arr.length, items } : { maxLen: arr.length };
      break;
    }
    case 'obj': {
      const keys: Record<string, { present: number; shape: Shape }> = {};
      let count = 0;
      let truncated = false;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const nk = isIdLike(k) ? ID_KEY : k;
        if (!(nk in keys) && count >= MAX_KEYS) {
          truncated = true;
          continue;
        }
        const sh = shapeOf(v, nk === ID_KEY ? undefined : k, depth + 1);
        const prev = keys[nk];
        if (prev) prev.shape = mergeShapes(prev.shape, sh);
        else {
          keys[nk] = { present: 1, shape: sh };
          count++;
        }
      }
      s.obj = truncated ? { n: 1, keys, truncated } : { n: 1, keys };
      break;
    }
  }
  return s;
}

export function mergeShapes(a: Shape, b: Shape): Shape {
  const out: Shape = { n: a.n + b.n, kinds: uniqSorted([...a.kinds, ...b.kinds]) };

  if (a.str || b.str) {
    const classes = uniqSorted([...(a.str?.classes ?? []), ...(b.str?.classes ?? [])]);
    const all = uniqSorted([...(a.str?.values ?? []), ...(b.str?.values ?? [])]);
    out.str = {
      classes,
      values: all.slice(0, MAX_VALUES),
      more: (a.str?.more ?? false) || (b.str?.more ?? false) || all.length > MAX_VALUES,
    };
  }
  if (a.num || b.num) {
    const xs = [a.num, b.num].filter((x): x is NonNullable<Shape['num']> => !!x);
    out.num = {
      int: xs.every((x) => x.int),
      min: Math.min(...xs.map((x) => x.min)),
      max: Math.max(...xs.map((x) => x.max)),
    };
  }
  if (a.arr || b.arr) {
    const ia = a.arr?.items;
    const ib = b.arr?.items;
    const items = ia && ib ? mergeShapes(ia, ib) : (ia ?? ib);
    const maxLen = Math.max(a.arr?.maxLen ?? 0, b.arr?.maxLen ?? 0);
    out.arr = items ? { maxLen, items } : { maxLen };
  }
  if (a.obj || b.obj) {
    const keys: Record<string, { present: number; shape: Shape }> = {};
    for (const src of [a.obj, b.obj]) {
      if (!src) continue;
      for (const [k, entry] of Object.entries(src.keys)) {
        const prev = keys[k];
        keys[k] = prev
          ? { present: prev.present + entry.present, shape: mergeShapes(prev.shape, entry.shape) }
          : { present: entry.present, shape: entry.shape };
      }
    }
    const truncated = (a.obj?.truncated ?? false) || (b.obj?.truncated ?? false);
    const n = (a.obj?.n ?? 0) + (b.obj?.n ?? 0);
    out.obj = truncated ? { n, keys, truncated } : { n, keys };
  }
  return out;
}
