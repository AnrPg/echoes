/**
 * File names that work on every file system an export may land on: Windows (NTFS, FAT), macOS (APFS, usually case
 * insensitive), Linux, and inside zips.
 *
 * @packageDocumentation
 */

/** Names Windows reserves for devices, with or without an extension (`CON.md` is just as bad as `CON`). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** Default limit in UTF-8 bytes. File systems allow 255; this leaves room for an extension and a " (2)" suffix. */
export const DEFAULT_FILE_NAME_BYTES = 120;

export interface SafeFileNameOptions {
  /** Maximum length in UTF-8 bytes, before any extension. Default {@link DEFAULT_FILE_NAME_BYTES}. */
  maxBytes?: number;
  /** Used when nothing usable is left. Default `untitled`. */
  fallback?: string;
}

/**
 * Turn any text (a chat title) into one safe path segment. Deterministic.
 *
 * - Unicode NFC, so the same title gives the same bytes on macOS and elsewhere.
 * - Runs of whitespace (tabs and newlines too) become one space; `/ \ : * ? " < > |` and other control characters
 *   become `-`.
 * - Leading and trailing spaces and dots are removed (Windows drops trailing ones silently, which breaks lookups).
 * - Windows device names (`CON`, `nul.txt`, `COM1`) get a `_` suffix.
 * - Cut to `maxBytes` UTF-8 bytes at a grapheme boundary, so an emoji or a letter with combining marks is never split.
 *
 * Greek, Hebrew, Arabic, CJK and emoji are kept as they are.
 *
 * @example
 * ```ts
 * safeFileName('Q3: plans / "draft"?'); // 'Q3- plans - -draft--'
 * safeFileName('CON');                  // 'CON_'
 * ```
 */
export function safeFileName(text: string, options: SafeFileNameOptions = {}): string {
  const maxBytes = options.maxBytes ?? DEFAULT_FILE_NAME_BYTES;
  const fallback = options.fallback ?? 'untitled';
  let name = text
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-');
  name = truncateUtf8(name, maxBytes);
  name = name.replace(/^[\s.]+|[\s.]+$/g, '');
  if (name === '') name = fallback;
  if (WINDOWS_RESERVED.test(name)) name = `${name}_`;
  return name;
}

/**
 * Pick a name not in `taken`, comparing case-insensitively (macOS and Windows treat `A.md` and `a.md` as one file):
 * `name.ext`, then `name (2).ext`, `name (3).ext`… Adds the chosen name to `taken`.
 *
 * @example
 * ```ts
 * const taken = new Set<string>();
 * uniqueFileName('Notes', '.md', taken); // 'Notes.md'
 * uniqueFileName('notes', '.md', taken); // 'notes (2).md'
 * ```
 */
export function uniqueFileName(base: string, extension: string, taken: Set<string>): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  let candidate = `${base}${extension}`;
  for (let n = 2; lower.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${extension}`;
  taken.add(candidate);
  return candidate;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (utf8Length(text) <= maxBytes) return text;
  let out = '';
  let used = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const n = utf8Length(segment);
    if (used + n > maxBytes) break;
    out += segment;
    used += n;
  }
  return out;
}

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}
