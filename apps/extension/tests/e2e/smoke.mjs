// Real-browser smoke test for the Phase 0 build: loads dist/ as an unpacked extension,
// serves a FAKE chatgpt.com page via request interception (no traffic reaches OpenAI),
// and checks that the main-world hook captured the page's requests into storage.
// Run: pnpm smoke:setup (once), then pnpm smoke
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dist = resolve('dist');
let ctx;
try {
  ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'cgx-')), {
    channel: 'chromium',
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
} catch (e) {
  if (String(e).includes("Executable doesn't exist")) {
    console.error('Playwright Chromium is not installed. Run `pnpm smoke:setup` once, then `pnpm smoke`.');
    process.exit(1);
  }
  throw e;
}
try {
  await ctx.route('https://chatgpt.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>fake</title><script>
        fetch('/backend-api/demo/3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b?limit=2', { headers: { Authorization: 'Bearer SECRET' } })
          .then(r => r.json()).then(j => { document.title = 'page-read:' + j.kind; });
        fetch('/backend-api/stream', { method: 'POST', body: JSON.stringify({ action: 'next' }) }).then(r => r.text());
      </script>` });
    }
    if (url.pathname.startsWith('/backend-api/demo/')) return route.fulfill({ contentType: 'application/json', body: '{"kind":"demo","text":"private words"}' });
    if (url.pathname === '/backend-api/stream') return route.fulfill({ contentType: 'text/event-stream', body: 'event: delta\ndata: {"v":1}\n\ndata: [DONE]\n\n' });
    return route.fulfill({ status: 404, body: '' });
  });

  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;

  const page = await ctx.newPage();
  await page.goto('https://chatgpt.com/');
  await page.waitForFunction(() => document.title.startsWith('page-read:'));
  if ((await page.title()) !== 'page-read:demo') throw new Error('page could not read its own response');

  const inspector = await ctx.newPage();
  await inspector.goto(`chrome-extension://${extId}/src/pages/inspector.html`);
  // waitForFunction treats a returned Promise as truthy, so poll explicitly.
  let state = null;
  for (let i = 0; i < 40 && !state; i++) {
    state = await inspector.evaluate(async () => {
      const s = (await chrome.storage.local.get('phase0:state'))['phase0:state'];
      return s && Object.keys(s.endpoints).length >= 2 ? s : null;
    });
    if (!state) await inspector.waitForTimeout(250);
  }
  if (!state) throw new Error('nothing captured within 10 s');
  const keys = Object.keys(state.endpoints).sort();
  console.log('endpoints:', keys);
  const json = JSON.stringify(state);
  if (json.includes('SECRET') || json.includes('private words')) throw new Error('secret or content leaked into capture');
  if (!keys.includes('GET chatgpt.com/backend-api/demo/:id?limit')) throw new Error('GET not captured');
  const stream = state.endpoints['POST chatgpt.com/backend-api/stream'];
  if (!stream?.sse?.sawDone) throw new Error('SSE not summarized');
  await inspector.reload();
  await inspector.locator('#endpoints details').first().waitFor({ timeout: 5_000 });
  console.log('SMOKE OK');
} finally {
  await ctx.close();
}
