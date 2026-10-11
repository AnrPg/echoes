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
import { APP_QUERIES, IMAGE_BYTES, IMAGE_CHAT_ID, PLAIN_CHAT_ID, PROJECT_CHAT_ID, TOKEN, respond } from '../fake-chatgpt.ts';

const dist = resolve('dist');
const fail = (m) => {
  throw new Error(m);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'echoes-')), {
  headless: true,
  // Extensions need the full Chromium build: plain `headless: true` picks Playwright's headless shell, which cannot
  // load them, and the service worker never starts.
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
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
    // Save as PDF prints a hidden frame; keep what it was given so the test can look at it.
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      set(v) { window.__printed = v; desc.set.call(this, v); },
      get() { return desc.get.call(this); },
    });
  });
  const tabId = await diag.evaluate(async () => (await chrome.tabs.query({ url: 'https://chatgpt.com/*' }))[0].id);
  await page.goto(`${base}/export.html?tab=${tabId}&chat=${PLAIN_CHAT_ID}`);

  // The Diagnostics link on the export page opens the diagnostics page (it pointed at a missing file once).
  const diagHref = await page.getByRole('link', { name: 'Diagnostics' }).evaluate((a) => a.href);
  const linked = await ctx.newPage();
  await linked.goto(diagHref);
  if ((await linked.title()) !== 'Echoes diagnostics') throw new Error(`Diagnostics link is broken: ${diagHref}`);
  await linked.close();

  // 1. Compatibility check.
  await page.getByRole('button', { name: 'Run check' }).click();
  await page.getByText('✓ Chat:').waitFor({ timeout: 15_000 });
  const checks = await page.locator('.checks').innerText();
  if (checks.includes('✗')) fail(`self-test failed:\n${checks}`);
  console.log(checks);
  if (!checks.includes('– Images and files: Not tested')) fail('the check did not say it could not test images on a plain chat');

  // The page follows the chat open in the ChatGPT tab: open another chat there and check again, without reloading.
  await app.evaluate((id) => history.pushState({}, '', `/c/${id}`), IMAGE_CHAT_ID);
  await page.waitForFunction(() => !document.querySelector('.checks'), undefined, { timeout: 10_000 }); // old result cleared
  await page.getByRole('button', { name: 'Run check' }).click();
  await page.getByText('✓ Images and files:').waitFor({ timeout: 15_000 });
  if (!(await page.locator('.checks').innerText()).includes('"Cat picture" parsed')) fail('the check did not follow the newly opened chat');
  await app.evaluate((id) => history.pushState({}, '', `/c/${id}`), PLAIN_CHAT_ID);
  await page.waitForFunction(() => !document.querySelector('.checks'), undefined, { timeout: 10_000 });

  // 2. Bulk export into a folder.
  await page.getByRole('button', { name: 'Load chat list' }).click();
  await page.getByRole('button', { name: 'Export 3 chats' }).click();
  // While the job runs, Chrome may not unload the ChatGPT tab; afterwards the tab's setting is back.
  const discardable = () => diag.evaluate(async (id) => (await chrome.tabs.get(id)).autoDiscardable, tabId);
  for (let i = 0; (await discardable()) !== false; i++) {
    if (i > 200) fail('the ChatGPT tab stayed discardable during the export');
    await new Promise((r) => setTimeout(r, 50));
  }
  await page.getByText('3 written, 0 re-checked and unchanged, 0 skipped, 0 failed').waitFor({ timeout: 30_000 });
  if ((await discardable()) !== true) fail('the ChatGPT tab was left not discardable');
  // The request queue's timers run in a worker, so a hidden export tab keeps its pace.
  if (!page.workers().some((w) => w.url().includes('timer.worker'))) fail(`no timer worker (workers: ${page.workers().map((w) => w.url())})`);
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
  // The service worker kept a snapshot of the source chat when the branch was made.
  const snapshotTitle = await diag.evaluate(
    (child) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('echoes');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('kv').objectStore('kv').get(['echoes:lineage', child]);
          get.onsuccess = () => resolve(get.result?.value?.parentSnapshot?.title ?? null);
          get.onerror = () => reject(get.error);
        };
      }),
    IMAGE_CHAT_ID,
  );
  if (snapshotTitle !== 'Plain chat') fail(`no snapshot of the source chat (got ${snapshotTitle})`);

  const readFolder = () =>
    page.evaluate(async () => {
      const out = {};
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('export');
      for await (const [name, h] of dir.entries()) if (h.kind === 'file' && name.endsWith('.html')) out[name] = await (await h.getFile()).text();
      return out;
    });

  // 3. Re-run into the same folder: nothing changed, nothing is fetched again.
  await page.getByRole('button', { name: 'Export 3 chats' }).click();
  await page.getByText('0 written, 0 re-checked and unchanged, 3 skipped, 0 failed').waitFor({ timeout: 30_000 });

  // 4. HTML with a theme: new settings, so every chat is written again, as self-contained pages.
  await page.getByLabel('Format').selectOption('html');
  await page.getByLabel('Look').selectOption('chatgpt');
  await page.getByRole('button', { name: 'Export 3 chats' }).click();
  await page.getByText('3 written, 0 re-checked and unchanged, 0 skipped, 0 failed').waitFor({ timeout: 30_000 });
  const html = await readFolder();
  if (!html['Plain chat.html']?.includes('<body class="theme-chatgpt">') || !html['Plain chat.html'].includes('<math')) fail('HTML export missing or without math');
  if (!html['Cat picture.html']?.includes('src="Cat%20picture_files/cat.jpg"')) fail('HTML export does not show the image');

  // 5. Save as PDF: the printed page embeds the image, so it needs no files next to it.
  await page.getByRole('button', { name: 'Save as PDF' }).click();
  await page.waitForFunction(() => typeof window.__printed === 'string', null, { timeout: 15_000 });
  const printed = await page.evaluate(() => window.__printed);
  if (!printed.includes('<body class="theme-chatgpt">') || !printed.includes('Just text')) fail('printed page is not the chat');
  if (await page.locator('.warn').count()) fail(`Save as PDF reported: ${await page.locator('.warn').first().innerText()}`);

  // 6. Turn picker on the Project chat (15 turns, a regenerated last answer).
  await app.evaluate((id) => history.pushState({}, '', `/g/g-p-fake/c/${id}`), PROJECT_CHAT_ID);
  await page.getByRole('heading', { name: /^This chat: / }).waitFor();
  await page.getByRole('button', { name: 'Pick turns…' }).click();
  await page.getByText('15 of 15 turns selected').waitFor({ timeout: 15_000 });
  await page.getByLabel('Search turns').fill('questoin 113'); // typo on purpose; numbers also match as prefixes
  await page.getByText('2 matches', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Select only these' }).click();
  await page.getByText('2 of 15 turns selected').waitFor();
  await page.getByLabel('Search turns').fill('');
  await page.getByRole('button', { name: 'None' }).click();
  await page.getByLabel('Turn 2', { exact: true }).click();
  await page.getByLabel('Turn 5', { exact: true }).click({ modifiers: ['Shift'] });
  await page.getByText('4 of 15 turns selected').waitFor();
  await page.locator('summary', { hasText: 'Rules' }).click();
  await page.getByLabel('Add a rule').selectOption('last');
  await page.getByText('5 turns match').waitFor();
  await page.getByRole('button', { name: 'Add', exact: true }).last().click();
  await page.getByText('9 of 15 turns selected').waitFor();

  // Preview: rendered by the export renderer, with the version switcher on the regenerated answer.
  await page.locator('.turn-row .text').last().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Turn 15').waitFor();
  const frameText = async () => (await dialog.locator('iframe').getAttribute('srcdoc')) ?? '';
  if (!(await frameText()).includes('id="turn-15"')) fail('preview does not show turn 15');
  if (!(await dialog.getByText('Answer version').count())) fail('no version switcher on the regenerated answer');
  await page.keyboard.press('ArrowLeft');
  await dialog
    .getByText('Turn 14')
    .waitFor({ timeout: 5_000 })
    .catch(async () => {
      const focused = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200));
      fail(`ArrowLeft did not move the preview to turn 14 (focus: ${focused})`);
    });
  await page.keyboard.press('Escape');
  if (await page.getByRole('dialog').count()) fail('preview did not close');

  // Export the 9 picked turns as HTML (the Format chosen above).
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export 9 turns' }).click()]);
  const picked = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
  const shown = [...picked.matchAll(/id="turn-(\d+)"/g)].map((m) => Number(m[1]));
  if (shown.join() !== '2,3,4,5,11,12,13,14,15') fail(`exported turns ${shown.join()}`);

  // 7. Diagnostics captured shapes, never the token or chat text.
  const captured = await diag.evaluate(async () => (await chrome.storage.local.get('phase0:state'))['phase0:state']);
  if (!captured || Object.keys(captured.endpoints).length < 3) fail('diagnostics captured nothing');
  const dump = JSON.stringify(captured);
  if (dump.includes('test-token') || dump.includes('Here is a cat')) fail('token or chat text leaked into diagnostics');

  console.log('SMOKE OK');
} finally {
  await ctx.close();
}
