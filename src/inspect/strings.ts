// String classification for Phase 0 shape capture.
// Goal: learn field names and enum-like values WITHOUT recording user content.

export type StrClass = 'empty' | 'uuid' | 'id' | 'date' | 'url' | 'email' | 'token' | 'text';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Opaque ids: long, url-safe, containing a digit (e.g. "file-AbC123...", "g-p-6f1e..."). Pure words never match.
const OPAQUE_ID = /^(?=.*\d)[A-Za-z0-9_-]{16,}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URLISH = /^(https?|wss?|sediment|file-service):\/\//i;
// Short machine tokens such as "multimodal_text", "gpt-4o", "finished_successfully", "text/event-stream".
const TOKEN = /^[a-z][a-z0-9_.\-/:]{0,47}$/;

export function isIdLike(s: string): boolean {
  return UUID.test(s) || OPAQUE_ID.test(s);
}

export function classifyString(s: string): StrClass {
  if (s === '') return 'empty';
  if (UUID.test(s)) return 'uuid';
  if (ISO_DATE.test(s)) return 'date';
  if (URLISH.test(s)) return 'url';
  if (EMAIL.test(s)) return 'email';
  if (OPAQUE_ID.test(s)) return 'id';
  if (TOKEN.test(s)) return 'token';
  return 'text';
}

// Keys whose string values are user/content text. Their literal values are never kept,
// even when they look like tokens (a user can type "yes" or "gpt-4o").
const CONTENT_KEYS = new Set([
  'parts', 'text', 'content', 'title', 'name', 'summary', 'query', 'queries', 'prompt',
  'snippet', 'description', 'display_name', 'email', 'phone', 'username', 'user', 'caption',
  'alt', 'label', 'message', 'instructions', 'about_user_message', 'about_model_message',
  'search_query', 'filename', 'file_name', 'tag', 'tags', 'value',
]);

/** Decide whether a string literal may be kept in the shape report. */
export function mayKeepLiteral(key: string | undefined, s: string): boolean {
  if (key !== undefined && CONTENT_KEYS.has(key.toLowerCase())) return false;
  return classifyString(s) === 'token';
}
