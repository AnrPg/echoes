/**
 * The `Store` port: where a host keeps Echoes' own data (job checkpoints, the lineage log, the search index).
 * The extension backs it with IndexedDB (Dexie), a desktop app with SQLite, tests with {@link MemoryStore}.
 *
 * @packageDocumentation
 */

/**
 * A small async key-value store split into named collections. Values are plain JSON data (objects, arrays,
 * strings, numbers, booleans, null): what both IndexedDB and a SQLite text column can hold. Core validates what it
 * reads back, so an implementation only has to store and return values faithfully.
 *
 * Implementations must make each `put` durable before resolving: core checkpoints a job right after each chat, and a
 * crash right after a resolved `put` must not lose it.
 */
export interface Store {
  /** The stored value, or `undefined` when the key is absent. */
  get(collection: string, key: string): Promise<unknown>;
  /** Insert or replace. */
  put(collection: string, key: string, value: unknown): Promise<void>;
  /** Remove; a missing key is not an error. */
  delete(collection: string, key: string): Promise<void>;
  /** All keys in the collection, sorted by UTF-16 code unit order (what `Array.prototype.sort` gives). */
  keys(collection: string): Promise<string[]>;
}

/** Collection names core uses. Hosts may add their own; names starting with `echoes:` are reserved. */
export const STORE_COLLECTIONS = {
  jobs: 'echoes:jobs',
  lineage: 'echoes:lineage',
  searchIndex: 'echoes:search-index',
} as const;

/**
 * In-memory {@link Store}. Values are copied through JSON on the way in and out, like a real store, so a caller
 * that mutates an object after `put` (or a value it got from `get`) cannot change what is stored. That also makes
 * it reject what a real store could not keep, such as functions, `undefined` values, `NaN` or cycles.
 *
 * @example
 * ```ts
 * const store = new MemoryStore();
 * await store.put('notes', 'a', { text: 'hi' });
 * await store.get('notes', 'a'); // { text: 'hi' }
 * ```
 */
export class MemoryStore implements Store {
  private readonly data = new Map<string, Map<string, string>>();

  async get(collection: string, key: string): Promise<unknown> {
    const json = this.data.get(collection)?.get(key);
    return json === undefined ? undefined : JSON.parse(json);
  }

  async put(collection: string, key: string, value: unknown): Promise<void> {
    let col = this.data.get(collection);
    if (!col) this.data.set(collection, (col = new Map()));
    col.set(key, toJson(value, `${collection}/${key}`));
  }

  async delete(collection: string, key: string): Promise<void> {
    this.data.get(collection)?.delete(key);
  }

  async keys(collection: string): Promise<string[]> {
    return [...(this.data.get(collection)?.keys() ?? [])].sort();
  }
}

function toJson(value: unknown, where: string): string {
  const json = JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new TypeError(`${where}: ${v} is not storable`);
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') {
      throw new TypeError(`${where}: a ${typeof v} is not storable`);
    }
    return v;
  });
  if (json === undefined) throw new TypeError(`${where}: undefined is not storable`);
  return json;
}
