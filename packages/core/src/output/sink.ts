/**
 * The `OutputSink` port: where an export's files go. The extension implements it as a folder (File System Access
 * API) or a streaming zip; a desktop app as a real folder; tests use {@link MemorySink}.
 *
 * @packageDocumentation
 */

/**
 * Receives an export's files. Paths are relative, `/`-separated, and checked with {@link assertSafeOutputPath}
 * before any write, so a chat title can never escape the export folder.
 */
export interface OutputSink {
  /** Write a whole file, replacing it if it exists. */
  write(path: string, data: string | Uint8Array): Promise<void>;
  /**
   * Read a text file written by an earlier export, or `undefined` if it does not exist. Optional: a zip sink starts
   * empty every time, so it omits this and incremental export then re-exports everything.
   */
  readText?(path: string): Promise<string | undefined>;
  /** Finish the export (flush the zip, release the folder handle). No writes after this. */
  close(): Promise<void>;
}

// Available in browsers, Node, Deno and Bun; declared here because core compiles without DOM or Node types.
declare const TextDecoder: { new (): { decode(data: Uint8Array): string } };

/** Thrown for a path that is absolute, contains `..`, or has an empty or unsafe segment. */
export class OutputPathError extends Error {
  override readonly name = 'OutputPathError';
}

/**
 * Throw {@link OutputPathError} unless `path` is a safe relative path: `/`-separated, no leading `/`, no `\`, no
 * empty, `.` or `..` segments, no control characters. Sink implementations call this; file names should come from
 * `safeFileName`, which always passes.
 *
 * @example
 * ```ts
 * assertSafeOutputPath('chats/My chat.md'); // ok
 * assertSafeOutputPath('../etc/passwd');    // throws
 * ```
 */
export function assertSafeOutputPath(path: string): void {
  const fail = (why: string) => {
    throw new OutputPathError(`unsafe output path ${JSON.stringify(path)}: ${why}`);
  };
  if (path === '') fail('empty');
  if (path.startsWith('/')) fail('absolute');
  if (path.includes('\\')) fail('backslash');
  if (/[\u0000-\u001f\u007f]/.test(path)) fail('control character');
  if (/^[A-Za-z]:/.test(path)) fail('drive letter');
  for (const segment of path.split('/')) {
    if (segment === '') fail('empty segment');
    if (segment === '.' || segment === '..') fail(`"${segment}" segment`);
  }
}

/**
 * In-memory {@link OutputSink}, for tests and for hosts that build the files first and save them later.
 *
 * @example
 * ```ts
 * const sink = new MemorySink();
 * await sink.write('a.md', '# A\n');
 * sink.files.get('a.md'); // '# A\n'
 * ```
 */
export class MemorySink implements OutputSink {
  /** Every file written, by path. Seed it to simulate a folder holding an earlier export. */
  readonly files = new Map<string, string | Uint8Array>();
  private closed = false;

  async write(path: string, data: string | Uint8Array): Promise<void> {
    if (this.closed) throw new Error('MemorySink is closed');
    assertSafeOutputPath(path);
    this.files.set(path, typeof data === 'string' ? data : data.slice());
  }

  async readText(path: string): Promise<string | undefined> {
    assertSafeOutputPath(path);
    const data = this.files.get(path);
    if (data === undefined) return undefined;
    return typeof data === 'string' ? data : new TextDecoder().decode(data);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
