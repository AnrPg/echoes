import type { DirectoryHandleLike } from '../../src/host/sinks';

/** In-memory stand-in for FileSystemDirectoryHandle, with the same NotFoundError behaviour. */
export class FakeDir implements DirectoryHandleLike {
  dirs = new Map<string, FakeDir>();
  files = new Map<string, string | Uint8Array>();
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!o?.create) throw Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' });
      this.dirs.set(name, (d = new FakeDir()));
    }
    return d;
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    if (!this.files.has(name) && !o?.create) throw Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' });
    return {
      getFile: async () => ({ text: async () => String(this.files.get(name)) }),
      createWritable: async () => ({ write: async (d: string | Uint8Array) => void this.files.set(name, d), close: async () => undefined }),
    };
  }
  /** Every file as path → text, for assertions. */
  tree(prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [n, d] of this.files) out[prefix + n] = typeof d === 'string' ? d : `<${d.length} bytes>`;
    for (const [n, d] of this.dirs) Object.assign(out, d.tree(`${prefix}${n}/`));
    return out;
  }
}

/** Read a stored (uncompressed) zip: name → bytes. Enough of the format to check what client-zip wrote. */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('bad central directory');
    const size = v.getUint32(p + 20, true);
    const n = v.getUint16(p + 28, true);
    const e = v.getUint16(p + 30, true);
    const c = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + n));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.set(name, bytes.subarray(start, start + size));
    p += 46 + n + e + c;
  }
  return out;
}

