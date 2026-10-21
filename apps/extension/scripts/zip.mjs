// Packs the built extension (dist/) into release/echoes-<version>.zip, with manifest.json at the zip root, ready for
// the Chrome Web Store or for sharing. Run after `vite build`; `pnpm zip` does both.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadZip } from 'client-zip';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const outDir = join(root, 'release');

// Fixed timestamp so the same build always gives a byte-identical zip.
const lastModified = new Date('2000-01-01T00:00:00Z');

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // Hidden files (.DS_Store, .vite/) are not part of the extension and the Web Store flags them.
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

let manifest;
try {
  manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
} catch {
  console.error('No dist/manifest.json. Build the extension first: pnpm --filter @echoes/extension build');
  process.exit(1);
}
if (typeof manifest.version !== 'string' || manifest.version === '') {
  console.error('dist/manifest.json has no version.');
  process.exit(1);
}

const paths = (await listFiles(dist)).sort();
const files = await Promise.all(
  paths.map(async (path) => ({
    // Zip entry names always use forward slashes, also on Windows.
    name: relative(dist, path).split(sep).join('/'),
    input: await readFile(path),
    lastModified,
  })),
);

const zip = new Uint8Array(await downloadZip(files).arrayBuffer());
await mkdir(outDir, { recursive: true });
const outFile = join(outDir, `echoes-${manifest.version}.zip`);
await writeFile(outFile, zip);
console.log(`${relative(process.cwd(), outFile)}: ${files.length} files, ${(zip.length / 1024).toFixed(0)} KB`);
