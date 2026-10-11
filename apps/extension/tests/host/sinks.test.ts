import 'fake-indexeddb/auto';
import { OutputPathError } from '@echoes/core';
import { describe, expect, it } from 'vitest';
import { IndexedDbStore } from '../../src/host/idb-store';
import { DownloadSink, FolderSink, ZipSink } from '../../src/host/sinks';
import { FakeDir, readZip } from './fakes';

const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);

function collect(): { stream: WritableStream<Uint8Array>; bytes: () => Uint8Array } {
  const chunks: Uint8Array[] = [];
  return {
    stream: new WritableStream({ write: (c) => void chunks.push(c) }),
    bytes: () => {
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) out.set(c, (o += c.length) - c.length);
      return out;
    },
  };
}

describe('FolderSink', () => {
  it('writes nested files, reads them back, and reports missing ones as undefined', async () => {
    const root = new FakeDir();
    const sink = new FolderSink(root);
    await sink.write('Chat.md', '# Chat');
    await sink.write('Chat_files/cat.jpg', new Uint8Array([1, 2]));
    await sink.write('Chat.md', '# Chat v2');
    expect(root.tree()).toEqual({ 'Chat.md': '# Chat v2', 'Chat_files/cat.jpg': '<2 bytes>' });
    expect(await sink.readText('Chat.md')).toBe('# Chat v2');
    expect(await sink.readText('manifest.json')).toBeUndefined();
    expect(await sink.readText('nope/manifest.json')).toBeUndefined();
    await expect(sink.write('../x.md', '')).rejects.toBeInstanceOf(OutputPathError);
    await sink.close();
    await expect(sink.write('late.md', '')).rejects.toThrow(/closed/);
  });
});

describe('ZipSink', () => {
  it('streams entries and writes the manifest once, last', async () => {
    const out = collect();
    const sink = new ZipSink(out.stream, new Date('2026-10-11T00:00:00Z'));
    await sink.write('manifest.json', '{"v":1}');
    await sink.write('A.md', '# A');
    await sink.write('A_files/x.bin', new Uint8Array([9, 8, 7]));
    await sink.write('manifest.json', '{"v":2}');
    await expect(sink.write('A.md', 'again')).rejects.toThrow(/already written/);
    await sink.close();
    const zip = readZip(out.bytes());
    expect([...zip.keys()]).toEqual(['A.md', 'A_files/x.bin', 'manifest.json']);
    expect(text(zip.get('A.md'))).toBe('# A');
    expect([...zip.get('A_files/x.bin')!]).toEqual([9, 8, 7]);
    expect(text(zip.get('manifest.json'))).toBe('{"v":2}');
    expect('readText' in sink).toBe(false);
  });
});

describe('DownloadSink', () => {
  it('hands over a single document as is, and several files as one zip', async () => {
    const got: [string, Blob][] = [];
    const deliver = async (n: string, b: Blob) => void got.push([n, b]);
    const one = new DownloadSink(deliver, 'Chat.zip', new Date(0));
    await one.write('Chat.md', '# Chat');
    await one.write('manifest.json', '{}');
    await one.close();
    expect(got[0]![0]).toBe('Chat.md');
    expect(await got[0]![1].text()).toBe('# Chat');

    const many = new DownloadSink(deliver, 'Chat.zip', new Date(0));
    await many.write('Chat.md', '# Chat');
    await many.write('Chat_files/cat.jpg', new Uint8Array([1]));
    await many.close();
    expect(got[1]![0]).toBe('Chat.zip');
    expect([...readZip(new Uint8Array(await got[1]![1].arrayBuffer())).keys()]).toEqual(['Chat.md', 'Chat_files/cat.jpg']);
  });
});

describe('IndexedDbStore', () => {
  it('implements the Store port: copies, sorted keys per collection, delete', async () => {
    const s = new IndexedDbStore(`test-${Math.random()}`);
    const v = { a: [1] };
    await s.put('jobs', 'b', v);
    await s.put('jobs', 'a', 1);
    await s.put('lineage', 'z', true);
    v.a.push(2);
    expect(await s.get('jobs', 'b')).toEqual({ a: [1] });
    expect(await s.keys('jobs')).toEqual(['a', 'b']);
    await s.delete('jobs', 'a');
    expect(await s.keys('jobs')).toEqual(['b']);
    expect(await s.get('jobs', 'a')).toBeUndefined();
    expect(await s.keys('lineage')).toEqual(['z']);
    s.close();
  });
});
