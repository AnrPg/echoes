import { describe, expect, it } from 'vitest';
import { classifyString, isIdLike, mayKeepLiteral } from '../../src/inspect/strings';
import { templateUrl } from '../../src/inspect/url';

describe('classifyString', () => {
  it.each([
    ['', 'empty'],
    ['3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b', 'uuid'],
    ['2026-10-10T18:31:02.123Z', 'date'],
    ['https://example.com/a?sig=x', 'url'],
    ['someone@example.org', 'email'],
    ['file-AbCdEf1234567890', 'id'],
    ['multimodal_text', 'token'],
    ['text/event-stream', 'token'],
    ['Hello there, how are you?', 'text'],
    ['Γεια σου', 'text'],
  ])('%j → %s', (s, cls) => expect(classifyString(s)).toBe(cls));

  it('treats pure words as non-ids even when long', () => {
    expect(isIdLike('finished_successfully')).toBe(false);
    expect(isIdLike('g-p-0123456789abcdef')).toBe(true);
  });
});

describe('mayKeepLiteral', () => {
  it('keeps machine tokens but never under content keys', () => {
    expect(mayKeepLiteral('content_type', 'text')).toBe(true);
    expect(mayKeepLiteral('parts', 'yes')).toBe(false);
    expect(mayKeepLiteral('Title', 'hello')).toBe(false);
    expect(mayKeepLiteral('role', 'Some Sentence.')).toBe(false);
  });
});

describe('templateUrl', () => {
  it('replaces ids and numbers, keeps only query names', () => {
    const u = templateUrl('/backend-api/x/3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b/items/42?offset=0&limit=28&sig=SECRET&limit=1');
    expect(u).toEqual({ host: 'chatgpt.com', path: '/backend-api/x/:id/items/:n', query: ['limit', 'offset', 'sig'] });
    expect(JSON.stringify(u)).not.toContain('SECRET');
  });
  it('handles absolute URLs on other hosts and percent-encoding', () => {
    expect(templateUrl('https://files.example.net/f/file%2DAbCdEf1234567890/download')?.path).toBe('/f/:id/download');
  });
  it('returns null for unparsable input', () => {
    expect(templateUrl('http://[bad', 'not a base')).toBeNull();
  });
});
