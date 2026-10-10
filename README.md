# Echoes

Local-only Chrome MV3 extension that exports ChatGPT conversations. Scope, architecture and phases: see the Build Plan.

**Current phase: 0 (API inspection).** The build is a passive inspector. It sends no requests of its own; it observes
the requests chatgpt.com already makes and records their *shapes* (endpoint templates, header names, field names,
optional fields, enum-like values), never header values or message text. Procedure and gate: [docs/phase-0.md](docs/phase-0.md).

## Build and load

```bash
npm install
npm test
npm run build
```

`npm test` runs the unit tests (Vitest), and `npm run build` writes the extension to `dist/`.

Optional real-browser check against a fake chatgpt.com (downloads Playwright's Chromium once, about 150 MB):

```bash
npm run smoke:setup
npm run smoke
```

Chrome → `chrome://extensions` → Developer mode on → **Load unpacked** → pick `dist/`.
After every rebuild press the reload icon on the extension card, then hard-reload chatgpt.com tabs.

## Layout (Phase 0 parts)

```text
src/
  monitor/   fetch-hook.main.iife.ts  MAIN world, document_start: wraps fetch/WebSocket, observe-only
             observe.ts               the observer core (unit-tested with a mock fetch)
  content/   chatgpt.content.iife.ts  isolated world: validates records (zod), aggregates into chrome.storage, "● Mark" button
  inspect/   shape, strings, url, sse, aggregate, report, anonymize, storage, messages   (Phase 0 only)
  pages/     inspector.html/.ts       the report UI (click the extension icon)
  background/service-worker.ts        routing only
tests/       inspect/ monitor/ e2e/
```

Deviations from the plan's layout: content scripts use the `.iife.ts` suffix (CRXJS otherwise loads them through an async
`import()` loader, so the fetch hook would install *after* ChatGPT's first requests and our chunks would be exposed as
web-accessible resources); `src/inspect/` is new and Phase 0 only.
