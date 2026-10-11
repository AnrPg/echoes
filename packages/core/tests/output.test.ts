import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ManifestError,
  MemorySink,
  MemoryStore,
  OutputPathError,
  assertSafeOutputPath,
  documentFileName,
  emptyManifest,
  manifestJsonSchema,
  parseManifest,
  planIncrementalExport,
  recordExport,
  safeFileName,
  serializeManifest,
  settingsKey,
  uniqueFileName,
} from '@echoes/core';

describe('MemoryStore', () => {
  it('stores copies, lists sorted keys and deletes', async () => {
    const s = new MemoryStore();
    const v = { a: [1] };
    await s.put('c', 'b', v);
    await s.put('c', 'a', 1);
    v.a.push(2);
    expect(await s.get('c', 'b')).toEqual({ a: [1] });
    expect(await s.keys('c')).toEqual(['a', 'b']);
    await s.delete('c', 'a');
    await s.delete('c', 'missing');
    expect(await s.keys('c')).toEqual(['b']);
    expect(await s.get('other', 'x')).toBeUndefined();
  });

  it('rejects values a real store could not keep', async () => {
    const s = new MemoryStore();
    await expect(s.put('c', 'k', undefined)).rejects.toThrow(/undefined/);
    await expect(s.put('c', 'k', { n: NaN })).rejects.toThrow(/NaN/);
    await expect(s.put('c', 'k', { f: () => 1 })).rejects.toThrow(/function/);
  });
});

describe('output paths and sinks', () => {
  it('accepts relative paths and rejects escapes', () => {
    expect(() => assertSafeOutputPath('chats/My chat.md')).not.toThrow();
    for (const bad of ['', '/etc/x', '../x', 'a/../b', 'a//b', 'a\\b', 'C:x', 'a/./b', 'a\u0000b']) {
      expect(() => assertSafeOutputPath(bad), bad).toThrow(OutputPathError);
    }
  });

  it('MemorySink writes, reads text back and refuses writes after close', async () => {
    const sink = new MemorySink();
    await sink.write('a.md', '# A\n');
    await sink.write('b.bin', new TextEncoder().encode('Γειά'));
    expect(await sink.readText('a.md')).toBe('# A\n');
    expect(await sink.readText('b.bin')).toBe('Γειά');
    expect(await sink.readText('none.md')).toBeUndefined();
    await expect(sink.write('../x', '')).rejects.toThrow(OutputPathError);
    await sink.close();
    await expect(sink.write('c.md', '')).rejects.toThrow(/closed/);
  });
});

describe('file names', () => {
  it('replaces unsafe characters, trims dots and spaces, guards Windows device names', () => {
    expect(safeFileName('Q3: plans / "draft"?')).toBe('Q3- plans - -draft--');
    expect(safeFileName('  ..hidden. ')).toBe('hidden');
    expect(safeFileName('CON')).toBe('CON_');
    expect(safeFileName('nul.txt')).toBe('nul.txt_');
    expect(safeFileName('a\tb\n\nc')).toBe('a b c');
    expect(safeFileName('???')).toBe('---');
    expect(safeFileName('...')).toBe('untitled');
    expect(safeFileName('Ἀθῆναι שָׁלוֹם 机器 🎉')).toBe('Ἀθῆναι שָׁלוֹם 机器 🎉');
  });

  it('normalizes to NFC and cuts at a grapheme boundary within the byte limit', () => {
    expect(safeFileName('é')).toBe('é');
    const name = safeFileName('👍🏽'.repeat(10), { maxBytes: 20 });
    expect(name).toBe('👍🏽'.repeat(2)); // each is 8 bytes, never split in half
    expect(new TextEncoder().encode(safeFileName('ά'.repeat(200))).length).toBeLessThanOrEqual(120);
  });

  it('makes names unique without regard to case', () => {
    const taken = new Set<string>();
    expect(uniqueFileName('Notes', '.md', taken)).toBe('Notes.md');
    expect(uniqueFileName('notes', '.md', taken)).toBe('notes (2).md');
    expect(uniqueFileName('NOTES', '.md', taken)).toBe('NOTES (3).md');
  });
});

describe('export manifest', () => {
  const entry = { title: 'A', updatedAt: '2026-10-01T10:00:00Z', settingsKey: 'k', files: ['A.md'] };

  it('round-trips with sorted ids and rejects broken files loudly', () => {
    const m = recordExport(recordExport(emptyManifest(), 'z', entry), 'a', { ...entry, files: ['B.md'] });
    const text = serializeManifest(m);
    expect(Object.keys(JSON.parse(text).conversations)).toEqual(['a', 'z']);
    expect(parseManifest(text)).toEqual(m);
    expect(() => parseManifest('{')).toThrow(ManifestError);
    expect(() => parseManifest('{"manifestVersion":2}')).toThrow(/manifestVersion/);
  });

  it('settingsKey ignores key order at every level', () => {
    expect(settingsKey({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: 3 } })).toBe(settingsKey({ a: { c: 3, d: [2, { x: 2, y: 1 }] }, b: 1 }));
    expect(settingsKey({ a: 1 })).not.toBe(settingsKey({ a: 2 }));
  });

  it('plans an incremental export: skip only same instant and same settings', () => {
    const m = recordExport(recordExport(emptyManifest(), 'c1', entry), 'c2', entry);
    const chats = [
      { id: 'c1', title: 'A', updatedAt: '2026-10-01T10:00:00+00:00' }, // same instant, other notation
      { id: 'c2', title: 'A', updatedAt: '2026-10-02T10:00:00Z' }, // edited since
      { id: 'c3', title: 'New', updatedAt: '2026-10-01T10:00:00Z' }, // new chat
    ];
    const plan = planIncrementalExport(m, chats, 'k');
    expect(plan.unchanged.map((c) => c.id)).toEqual(['c1']);
    expect(plan.toExport.map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(planIncrementalExport(m, chats, 'other').toExport).toHaveLength(3);
  });

  it('keeps a chat file name across re-exports and avoids other chats\' files', () => {
    const m = recordExport(recordExport(emptyManifest(), 'c1', { ...entry, files: ['Plans.md'] }), 'c2', { ...entry, files: ['Ideas.md'] });
    expect(documentFileName(m, { id: 'c1', title: 'Renamed' }, '.md', new Set())).toBe('Plans.md');
    expect(documentFileName(m, { id: 'c3', title: 'ideas' }, '.md', new Set())).toBe('ideas (2).md');
    expect(documentFileName(m, { id: 'c1', title: 'Plans' }, '.html', new Set())).toBe('Plans.html');
  });

  it('JSON Schema file matches the zod schema (run `pnpm --filter @echoes/core schema` after changing it)', () => {
    const file = JSON.parse(readFileSync(new URL('../schemas/export-manifest.v1.schema.json', import.meta.url), 'utf8'));
    expect(file).toEqual(manifestJsonSchema());
  });
});
