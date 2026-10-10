import { isIdLike } from './strings';

export interface UrlTemplate {
  host: string;
  /** Path with id segments replaced: ":id" for ids, ":n" for numbers. */
  path: string;
  /** Sorted query parameter NAMES only. Values (signatures, tokens, ids) are never kept. */
  query: string[];
}

export function templateSegment(seg: string): string {
  if (seg === '') return seg;
  let decoded = seg;
  try {
    decoded = decodeURIComponent(seg);
  } catch {
    /* keep raw */
  }
  if (/^\d+$/.test(decoded)) return ':n';
  if (isIdLike(decoded)) return ':id';
  return seg;
}

export function templateUrl(input: string, base = 'https://chatgpt.com/'): UrlTemplate | null {
  let u: URL;
  try {
    u = new URL(input, base);
  } catch {
    return null;
  }
  const path = u.pathname.split('/').map(templateSegment).join('/');
  const query = [...new Set([...u.searchParams.keys()])].sort();
  return { host: u.host, path, query };
}
