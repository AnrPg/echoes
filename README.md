# Echoes

Local-only tools for exporting chat conversations (ChatGPT first) into faithful Markdown, PDF, HTML and resource
bundles, with branch tracking and conversation-tree reconstruction. Scope, architecture and phases: see the Build Plan.

**Current phase: v1 core, foundations.** Phase 0 (passive API inspector) is built; its capture report is still pending,
so v1 work that depends on real endpoint shapes waits for it. Status: [docs/v1.md](docs/v1.md).

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
pnpm test          # all packages (Vitest)
pnpm typecheck
pnpm build         # core → packages/core/dist, extension → apps/extension/dist
pnpm run docs      # API docs for @echoes/core → packages/core/docs/api/index.html
```

Load the extension: Chrome → `chrome://extensions` → Developer mode on → **Load unpacked** → pick `apps/extension/dist/`.
After every rebuild press the reload icon on the extension card, then hard-reload chatgpt.com tabs.

Extension-only commands run with a filter, for example `pnpm --filter @echoes/extension smoke`.

## Extension notes

Content scripts use the `.iife.ts` suffix: CRXJS otherwise loads them through an async `import()` loader, so the fetch
hook would install *after* ChatGPT's first requests and our chunks would be exposed as web-accessible resources.
`apps/extension/src/inspect/` is Phase 0 only.
