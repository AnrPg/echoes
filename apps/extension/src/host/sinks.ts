// Output sinks for the extension: a folder (File System Access API), a streaming zip, and a download sink for
// single-chat exports. All validate paths with core's assertSafeOutputPath.

import { downloadZip } from 'client-zip';
import { assertSafeOutputPath, type OutputSink } from '@echoes/core';

/** The parts of `FileSystemDirectoryHandle` the folder sink uses (so tests can pass a fake). */
export interface DirectoryHandleLike {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    getFile(): Promise<{ text(): Promise<string> }>;
    createWritable(): Promise<{ write(data: string | Uint8Array): Promise<void>; close(): Promise<void> }>;
  }>;
}

const isNotFound = (e: unknown) => e instanceof Error && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

/** Writes into a folder the user picked. Supports `readText`, so incremental export works. */
export class FolderSink implements OutputSink {
  readonly #root: DirectoryHandleLike;
  #closed = false;

  constructor(root: DirectoryHandleLike) {
    this.#root = root;
  }

  async #dir(segments: string[], create: boolean): Promise<DirectoryHandleLike> {
    let dir = this.#root;
    for (const s of segments) dir = await dir.getDirectoryHandle(s, { create });
    return dir;
  }

  async write(path: string, data: string | Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('the folder sink is closed');
    assertSafeOutputPath(path);
    const parts = path.split('/');
    const dir = await this.#dir(parts.slice(0, -1), true);
    const file = await dir.getFileHandle(parts.at(-1)!, { create: true });
    const w = await file.createWritable();
    try {
      await w.write(data);
    } finally {
      await w.close();
    }
  }

  async readText(path: string): Promise<string | undefined> {
    assertSafeOutputPath(path);
    const parts = path.split('/');
    try {
      const dir = await this.#dir(parts.slice(0, -1), false);
      const file = await dir.getFileHandle(parts.at(-1)!);
      return await (await file.getFile()).text();
    } catch (e) {
      if (isNotFound(e)) return undefined;
      throw e;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
  }
}

/** An async queue the zip stream pulls entries from while the export is still writing them. */
class EntryQueue<T> implements AsyncIterable<T> {
  #items: T[] = [];
  #waiting: ((r: IteratorResult<T>) => void) | undefined;
  #done = false;

  push(item: T) {
    if (this.#waiting) {
      const w = this.#waiting;
      this.#waiting = undefined;
      w({ value: item, done: false });
    } else this.#items.push(item);
  }

  end() {
    this.#done = true;
    this.#waiting?.({ value: undefined, done: true });
    this.#waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.#items.length) return Promise.resolve({ value: this.#items.shift()!, done: false });
        if (this.#done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.#waiting = resolve));
      },
    };
  }
}

type ZipEntry = { name: string; input: string | Uint8Array; lastModified: Date };

/**
 * Streams a zip into `target` while the export runs, so memory stays flat. A zip cannot be read back, so this sink
 * has no `readText`: incremental export then re-exports everything. A path written twice keeps the last version only
 * if it is written before the stream reaches it; the export never writes a path twice except `manifest.json`, which
 * this sink holds back and writes last.
 */
export class ZipSink implements OutputSink {
  readonly #queue = new EntryQueue<ZipEntry>();
  readonly #done: Promise<void>;
  readonly #held = new Map<string, string | Uint8Array>();
  readonly #names = new Set<string>();
  readonly #lastModified: Date;

  /** Paths written more than once (all but the last write is held back until close). */
  static readonly HOLD_UNTIL_CLOSE = new Set(['manifest.json', 'echoes-report.json']);

  constructor(target: WritableStream<Uint8Array>, lastModified: Date) {
    this.#lastModified = lastModified;
    this.#done = downloadZip(this.#queue).body!.pipeTo(target);
  }

  async write(path: string, data: string | Uint8Array): Promise<void> {
    assertSafeOutputPath(path);
    if (ZipSink.HOLD_UNTIL_CLOSE.has(path)) {
      this.#held.set(path, data);
      return;
    }
    if (this.#names.has(path)) throw new Error(`${path} was already written to the zip`);
    this.#names.add(path);
    this.#queue.push({ name: path, input: data, lastModified: this.#lastModified });
  }

  async close(): Promise<void> {
    for (const [name, input] of this.#held) this.#queue.push({ name, input, lastModified: this.#lastModified });
    this.#queue.end();
    await this.#done;
  }
}

/**
 * For a single-chat export: collects the files, then hands over one file as is, or several as one zip named
 * `zipName` (default: after the first document). `deliver` gets the name and bytes (the page turns them into a download).
 */
export class DownloadSink implements OutputSink {
  readonly #files = new Map<string, string | Uint8Array>();
  readonly #deliver: (name: string, data: Blob) => Promise<void>;
  readonly #lastModified: Date;
  readonly #zipName: string | undefined;

  constructor(deliver: (name: string, data: Blob) => Promise<void>, lastModified: Date, zipName?: string) {
    this.#deliver = deliver;
    this.#lastModified = lastModified;
    this.#zipName = zipName;
  }

  async write(path: string, data: string | Uint8Array): Promise<void> {
    assertSafeOutputPath(path);
    this.#files.set(path, data);
  }

  async close(): Promise<void> {
    const docs = [...this.#files].filter(([p]) => !ZipSink.HOLD_UNTIL_CLOSE.has(p));
    if (docs.length === 1 && !docs[0]![0].includes('/')) {
      const [name, data] = docs[0]!;
      await this.#deliver(name, new Blob([data as BlobPart]));
      return;
    }
    const entries = docs.map(([name, input]) => ({ name, input, lastModified: this.#lastModified }));
    // Named after the main document, or the folder everything is in (a resources export).
    const doc = docs.find(([p]) => !p.includes('/'))?.[0];
    const name = this.#zipName ?? (doc ? doc.replace(/\.[^.]+$/, '') : (docs[0]?.[0].split('/')[0] ?? 'Echoes export'));
    await this.#deliver(`${name}.zip`, await downloadZip(entries).blob());
  }
}
