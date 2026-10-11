// The core `Store` port on IndexedDB (Dexie), in the extension's own origin: job checkpoints, the branch lineage
// log and the search index survive browser restarts and never touch chatgpt.com's storage.

import Dexie, { type Table } from 'dexie';
import type { Store } from '@echoes/core';

interface Row {
  collection: string;
  key: string;
  value: unknown;
}

class EchoesDb extends Dexie {
  kv!: Table<Row, [string, string]>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ kv: '[collection+key], collection' });
  }
}

export class IndexedDbStore implements Store {
  readonly #db: EchoesDb;

  constructor(name = 'echoes') {
    this.#db = new EchoesDb(name);
  }

  async get(collection: string, key: string): Promise<unknown> {
    return (await this.#db.kv.get([collection, key]))?.value;
  }

  async put(collection: string, key: string, value: unknown): Promise<void> {
    // Values are plain JSON in every Store; copying here keeps IndexedDB from storing class instances or functions.
    await this.#db.kv.put({ collection, key, value: JSON.parse(JSON.stringify(value)) as unknown });
  }

  async delete(collection: string, key: string): Promise<void> {
    await this.#db.kv.delete([collection, key]);
  }

  async keys(collection: string): Promise<string[]> {
    const rows = await this.#db.kv.where('collection').equals(collection).primaryKeys();
    return rows.map(([, key]) => key).sort();
  }

  close(): void {
    this.#db.close();
  }
}
