# Echoes

Local-only tools for exporting chat conversations (ChatGPT first) into faithful Markdown, PDF, HTML and resource
bundles, with branch tracking and conversation-tree reconstruction. Scope, architecture and phases: see the Build Plan.

**Current phase: v1, built and waiting for the v1 gate** (testing on real ChatGPT). Phase 0 (passive API inspector) is
done and its findings are in [docs/phase-0.md](docs/phase-0.md#findings). Status and what the gate needs:
[docs/v1.md](docs/v1.md).

API-first: every capability lands as a typed, tested, documented function in a public package; the extension is one
client of it.

## Layout

```text
packages/
  core/                  @echoes/core: model + zod/JSON Schema, tree and turns, scheduler, renderers, search,
                         manifest and resumable jobs. Pure TypeScript, no network, no DOM. See its README
  adapter-chatgpt-api/   Parses ChatGPT web API responses into the model. Parse-only. See its README
apps/
  extension/   Chrome MV3 extension: single-chat and bulk export, branch monitor, diagnostics capture
docs/          phase-0.md, v1.md
```

## Setup

Needs Node ≥ 22.18 and pnpm (`corepack enable` once, then pnpm comes from `packageManager` in package.json).

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm run docs
```

`pnpm test` runs every package's unit tests (Vitest). `pnpm build` writes core to `packages/core/dist/` and the
extension to `apps/extension/dist/`. `pnpm run docs` writes the `@echoes/core` API docs to
`packages/core/docs/api/index.html`.

Optional real-browser check against a fake chatgpt.com (downloads Playwright's Chromium once, about 150 MB):

```bash
pnpm --filter @echoes/extension smoke:setup
pnpm --filter @echoes/extension smoke
```

Load the extension: Chrome → `chrome://extensions` → Developer mode on → **Load unpacked** → pick `apps/extension/dist/`.
After every rebuild press the reload icon on the extension card, then hard-reload chatgpt.com tabs.

## Using the extension

1. Open chatgpt.com, log in, and open any chat (Echoes learns how ChatGPT loads chats from the page itself).
2. Click the Echoes toolbar button. The export page opens.
3. **Run check** fetches one chat and says whether ChatGPT's format still matches.
4. **Export this chat** downloads the open chat (a zip when it has images or uploads). **Save as PDF** opens the
   print dialog with the chat in the chosen Look; pick "Save as PDF" there. **Pick turns…** chooses turns by hand,
   by search or by rules, previews them, and exports or prints just those.
5. **Load chat list**, pick chats and Projects, **Export**, and choose a folder. Running it again into the same folder
   only exports what changed; chats are re-checked after the number of days set in Settings. Without folder access,
   Echoes writes a zip. A stopped export can be resumed from the same page.
6. Settings: Markdown, HTML, Echoes JSON, or Resources only (files, code and links by turn); the Look of HTML and PDF; which versions (edits and regenerations) to
   include and whether they go in one file or one file each. See [docs/v2.md](docs/v2.md).

## Extension notes

Content scripts use the `.iife.ts` suffix: CRXJS otherwise loads them through an async `import()` loader, so the fetch
hook would install *after* ChatGPT's first requests and our chunks would be exposed as web-accessible resources.
`apps/extension/src/inspect/` is the Phase 0 inspector, kept as opt-in diagnostics (footer link on the export page).

How requests work: the main-world script observes the web app's own requests (never changing them) and keeps the
request headers and query strings it used, in page memory only. Echoes' GET requests then run inside that tab with the
same headers, limited to a fixed list of read endpoints (`src/bridge/protocol.ts`). The session token never reaches the
extension, storage or disk.
