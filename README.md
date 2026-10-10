# Echoes

Local-only tools for exporting chat conversations (ChatGPT first) into faithful Markdown, PDF, HTML and resource
bundles, with branch tracking and conversation-tree reconstruction. Scope, architecture and phases: see the Build Plan.

**Current phase: v1 core, foundations.** Phase 0 (passive API inspector) is done and its findings are in
[docs/phase-0.md](docs/phase-0.md#findings); one open question (Q5) still blocks the API conversation fetch. Status: [docs/v1.md](docs/v1.md).

API-first: every capability lands as a typed, tested, documented function in a public package; the extension is one
client of it.

## Layout

```text
packages/
  core/        @echoes/core: normalized model + zod/JSON Schema, tree and turn functions, polite request scheduler
               Pure TypeScript, no network, no DOM. See packages/core/README.md
apps/
  extension/   Chrome MV3 extension (today: the Phase 0 inspector). See docs/phase-0.md
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

## Extension notes

Content scripts use the `.iife.ts` suffix: CRXJS otherwise loads them through an async `import()` loader, so the fetch
hook would install *after* ChatGPT's first requests and our chunks would be exposed as web-accessible resources.
`apps/extension/src/inspect/` is Phase 0 only.
