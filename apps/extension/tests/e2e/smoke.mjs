// Real-browser smoke test of the built extension (v1 export). Loads dist/ unpacked, serves a FAKE chatgpt.com
// through request interception (tests/fake-chatgpt.ts; nothing reaches OpenAI), and drives the export page:
// compatibility check, branch monitor, bulk export into a folder, incremental re-run, and diagnostics capture.
// The folder picker cannot be clicked headlessly, so the page's picker returns a folder in the origin-private
// file system, which the test reads back.
// Run: pnpm smoke (builds first).
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { APP_QUERIES, IMAGE_BYTES, IMAGE_CHAT_ID, PLAIN_CHAT_ID, TOKEN, respond } from '../fake-chatgpt.ts';

const dist = resolve('dist');
const fail = (m) => {
  throw new Error(m);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'echoes-')), {
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
try {
  await ctx.route('https://chatgpt.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/' || url.pathname.startsWith('/c/')) {
      // The "web app": loads its data the way ChatGPT does, then the user clicks "Branch in new chat".
      const calls = Object.values(APP_QUERIES).map((q) => `fetch(${JSON.stringify(q)}, { headers: H }).then((r) => r.text())`);
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>fake</title><script>
          const H = { Authorization: ${JSON.stringify(TOKEN)}, 'oai-language': 'en-US' };
          Promise.all([${calls.join(',')}]).then(() =>
            fetch('/backend-api/conversation/new_branch', { method: 'POST', headers: { ...H, 'content-type': 'application/json' },
              body: JSON.stringify({ conversation_id: ${JSON.stringify(PLAIN_CHAT_ID)}, message_id: 'fork-message' }) }))
            .then((r) => r.json()).then(() => { document.title = 'app-ready'; });
        </script>`,
      });
    }
    const r = respond(req.url(), await req.allHeaders(), req.method());
    return route.fulfill({ status: r.status, contentType: r.contentType, body: typeof r.body === 'string' ? r.body : Buffer.from(r.body) });
  });

  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const base = `chrome-extension://${extId}/src/pages`;

  // Diagnostics capture is off by default; switch it on to check it still works and leaks nothing.
  const diag = await ctx.newPage();
  await diag.goto(`${base}/inspector.html`);
  await diag.locator('#capture').check();

  const app = await ctx.newPage();
  await app.goto(`https://chatgpt.com/c/${PLAIN_CHAT_ID}`);
  await app.waitForFunction(() => document.title === 'app-ready');

  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle('export', { create: true });
    };
  });
  const tabId = await diag.evaluate(async () => (await chrome.tabs.query({ url: 'https://chatgpt.com/*' }))[0].id);
  await page.goto(`${base}/export.html?tab=${tabId}&chat=${PLAIN_CHAT_ID}`);

  // 1. Compatibility check.
  await page.getByRole('button', { name: 'Run check' }).click();
  await page.getByText('✓ Chat:').waitFor({ timeout: 15_000 });
  const checks = await page.locator('.checks').innerText();
  if (checks.includes('✗')) fail(`self-test failed:\n${checks}`);
  console.log(checks);

  // 2. Bulk export into a folder.
  await page.getByRole('button', { name: 'Load chat list' }).click();
  await page.getByRole('button', { name: 'Export 3 chats' }).click();
  await page.getByText('3 written, 0 re-checked and unchanged, 0 skipped, 0 failed').waitFor({ timeout: 30_000 });
  const files = await page.evaluate(async () => {
    const out = {};
    const walk = async (dir, prefix) => {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'directory') await walk(h, `${prefix}${name}/`);
        else {
          const f = await h.getFile();
          out[prefix + name] = name.endsWith('.jpg') ? [...new Uint8Array(await f.arrayBuffer())] : await f.text();
        }
      }
    };
    await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('export'), '');
    return out;
  });
  const names = Object.keys(files).sort();
  console.log('files:', names);
  for (const n of ['Cat picture.md', 'Cat picture_files/cat.jpg', 'Plain chat.md', 'manifest.json', 'echoes-report.json']) {
    if (!names.includes(n)) fail(`missing ${n}`);
  }
  if (files['Cat picture_files/cat.jpg'].join() !== [...IMAGE_BYTES].join()) fail('image bytes differ');
  if (!files['Cat picture.md'].includes('branched_from: "' + PLAIN_CHAT_ID + '"')) fail('branch monitor link missing from the branched chat');
  if (!JSON.parse(files['manifest.json']).conversations[IMAGE_CHAT_ID]) fail('manifest lacks the image chat');

  // 3. Re-run into the same folder: nothing changed, nothing is fetched again.
  await page.getByRole('button', { name: 'Export 3 chats' }).click();
  await page.getByText('0 written, 0 re-checked and unchanged, 3 skipped, 0 failed').waitFor({ timeout: 30_000 });

  // 4. Diagnostics captured shapes, never the token or chat text.
  const captured = await diag.evaluate(async () => (await chrome.storage.local.get('phase0:state'))['phase0:state']);
  if (!captured || Object.keys(captured.endpoints).length < 3) fail('diagnostics captured nothing');
  const dump = JSON.stringify(captured);
  if (dump.includes('test-token') || dump.includes('Here is a cat')) fail('token or chat text leaked into diagnostics');

  console.log('SMOKE OK');
} finally {
  await ctx.close();
}
