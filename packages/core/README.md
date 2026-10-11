# @echoes/core

The normalized conversation model, tree and turn functions, and a host-agnostic polite request scheduler for exporting
chat conversations, and the Markdown and JSON renderers. Pure TypeScript: **no network, no DOM**. Runs in browsers, Node (≥ 22.18), Deno and Bun.

Status: **0.x**, not yet published. Anything not exported from the package entry point is internal.

## What is in it

| Area | Exports | Notes |
| --- | --- | --- |
| Model | `Conversation`, `Node`, `Block`, `Resource`, `LineageRef`, zod schemas, `SCHEMA_VERSION` | A chat is a tree of nodes, never a flat list. Types are inferred from the zod schemas. |
| Validation | `parseConversation`, `safeParseConversation`, `EchoesValidationError` | Field shapes **and** tree integrity (links, reachability, active leaf). Reports every issue with a path. |
| JSON Schema | `conversationJsonSchema()`, `manifestJsonSchema()`, `@echoes/core/schemas/*.v1.schema.json` | Generated from the zod schemas; a test fails if the committed file drifts. Covers shapes only, not tree integrity. |
| Tree | `activePath`, `pathTo`, `pathThrough`, `subtree`, `leaves`, `traversals`, `versionGroups` | Deterministic: child order is `childIds` order. Iterative, so 20k-message chats are fine. |
| Versions | `namedTraversals`, `selectTraversals`, `sharedPrefix`, `treeSummary`, `renderMermaid`, `renderMarkdownBranches` | Auto names like "Turn 2 edited (v2) to Turn 5 regenerated (v1)". Excluding a version drops its subtree. `tree.json` (`echoes-tree` v1) and a Mermaid flowchart show where a chat forks. |
| Turns | `buildTurns`, `applyTurnDefinition`, `TURN_PRESETS` | Turn = a question plus the responses until the next question. Presets filter blocks; `unknown` content stays visible. |
| Markdown | `renderMarkdown`, `convertMarkdownText`, `escapeMarkdownInline`, `MARKDOWN_FLAVORS` | GitHub, Obsidian and CommonMark flavors. Tokenizer-based: LaTeX `\( \)` / `\[ \]` become `$…$` / `$$…$$` only outside code; `$` in prose is escaped. Deterministic. |
| JSON | `renderJson` | Validated Echoes JSON, pretty-printed; always parses back. |
| Search | `normalizeText`, `normalizeWithMap`, `findMatches`, `tokenize` | NFKC, case fold (incl. `ß`, final `ς`, Turkish `İ`/`ı`), combining marks dropped (Greek, Latin, Hebrew niqqud, Arabic harakat). Matches come back as ranges in the original text for highlighting. Chinese and Japanese are indexed as character pairs, the same in every browser. |
| Search index and rules | `TurnIndex`, `selectTurns`, `parseRule`, `RuleSchema`, `hasContent`, `turnText` | Fuzzy, typo-tolerant turn search (MiniSearch) over question and answer text including code and LaTeX source, serializable for a `Store`. Rules from the rule builder (position, text, content, metadata, combined with and/or/not) are plain JSON. |
| Store | `Store`, `MemoryStore`, `STORE_COLLECTIONS` | Port for Echoes' own data (job checkpoints, later the lineage log and search index): IndexedDB in the extension, SQLite in a desktop app. |
| Output | `OutputSink`, `MemorySink`, `assertSafeOutputPath`, `safeFileName`, `uniqueFileName` | Port for an export's files (folder or zip). File names are safe on Windows, macOS and Linux, never escape the export folder, and never collide by case. |
| Manifest | `planIncrementalExport`, `recordExport`, `documentFileName`, `parseManifest`, `serializeManifest`, `exportSettingsKey`, `contentFingerprint`, `isContentUnchanged` | `manifest.json` in the export folder makes re-runs incremental: a chat with the same `updatedAt`, settings and active leaf is skipped and keeps its file name. `recheckBefore` and `force` cover chats changed without a new `updatedAt`; the content fingerprint avoids rewriting unchanged files. |
| Jobs | `createExportJob`, `runExportJob`, `JobCheckpoints`, `cancelExportJob`, `retryFailed`, `jobProgress` | Resumable bulk export, one chat at a time, checkpointed after each. A stop leaves the chat pending; a cancel saved mid-run is honored. |
| Scheduler | `Scheduler`, `Transport`, `Clock`, `HttpError`, `RetriesExhaustedError`, `backoffDelay`, `parseRetryAfter` | One request at a time, ~1/s plus jitter, honors `Retry-After`, backs off 2s→60s, **pauses** on 401 or a bot challenge until the host calls `resume()`. |

## Quick start

```ts
import { parseConversation, activePath, nodesOf, buildTurns, applyTurnDefinition, TURN_PRESETS } from '@echoes/core';

const conversation = parseConversation(JSON.parse(text)); // throws EchoesValidationError listing every issue
const turns = buildTurns(nodesOf(conversation, activePath(conversation)))
  .map((t) => applyTurnDefinition(t, TURN_PRESETS.studyNotes));
```

Runnable examples, each kept honest by a test (`tests/examples.test.ts`):

```bash
node examples/tree.ts        # parse, active path, traversals, versions, turns
node examples/scheduler.ts   # injected transport, pause on 401, resume
node examples/search.ts      # normalization, matches and terms across scripts
node examples/export-job.ts  # resumable, incremental bulk export into a folder
node examples/render.ts      # Markdown flavors, one version's path, study-notes preset
```

## Hosts and ports

Core never fetches anything. A host (the extension today, a desktop app later) injects a `Transport`; the session token
is added inside the host's transport and never passes through core. Create **one** `Scheduler` per host and send every
request through it, attachment downloads included.

```ts
const scheduler = new Scheduler({ transport: (req) => fetch(req.url, req) });
scheduler.subscribe((e) => {
  if (e.type === 'paused') showBanner(e.reason === 'auth' ? 'Log in again, then press Continue' : 'Complete the check, then press Continue');
});
continueButton.onclick = () => scheduler.resume(); // only ever after a user action
```

## Rendering Markdown

```ts
import { renderMarkdown, pathThrough, TURN_PRESETS } from '@echoes/core';

const md = renderMarkdown(conversation, {
  flavor: 'obsidian',                        // 'github' (default) | 'obsidian' | 'commonmark'
  path: pathThrough(conversation, versionId), // default: the active path
  turns: TURN_PRESETS.studyNotes,            // default: fullArchive
  resolveResource: (r) => savedFiles.get(r.fileId), // relative link, or undefined for a placeholder
  blockRenderers: { canvas: (block, ctx) => `<!-- canvas -->\n${ctx.renderDefault()}` },
});
```

Output: front matter (not for `commonmark`), `# Title`, then `## Turn N` with `### User` / `### Assistant`. Tool calls
and outputs sit under the assistant. Reasoning summaries go in a collapsible `<details>` (GitHub), a folded callout
(Obsidian) or a blockquote. Citations are listed as **Sources** after each answer. A fork on the path gets
"Version 2 of 3 (edited question)". Gaps flagged by the adapter (`notFetched`) and `unknown` blocks (with their raw
JSON) are always shown. Expired or vanished files are placeholders, never links.

Math and dollars, and the pitfalls behind the rules:

- `\( \)` and `\[ \]` (what ChatGPT writes) become math. Existing `$$ … $$` is kept, and existing `$x$` is kept when
  it follows Pandoc's rule (opening `$` before a non-space, closing `$` after a non-space and not before a digit), so
  math a person typed survives while `$5 and $10` stays two prices. Every other `$` is escaped.
- Delimiters are matched outside fenced, indented and HTML blocks, inline code spans (any backtick count),
  autolinks and link destinations, and never across a blank line. Block structure comes from markdown-it's CommonMark parser, so a fence
  inside a list or blockquote is recognized.
- GitHub inline math uses ``$`…`$`` because plain `$…$` lets Markdown eat `_` and `*` inside the formula.
- A `\[` written as a literal bracket with a matching `\]` becomes math. ChatGPT's own renderer does the same.

## Model notes

- `SYNTHETIC_ROOT_ID` (`echoes:root`) is the hidden root an adapter adds when its source has none it can return.
- `Node.createdAt` is optional: when a provider gives no time, Echoes leaves it out rather than inventing one.
- Siblings under one parent are versions (edits, regenerations). `pathThrough(c, versionId)` gives that version with its
  own downstream turns.
- `reasoning` blocks hold only the summaries a provider shows, never raw chain of thought.
- `unknown` blocks keep the raw payload of content an adapter could not map, so renderers can show it.
- `Node.notFetched` marks gaps the provider has but the adapter could not load: `later-messages` on the leaf of an
  older version whose later turns were not returned, `earlier-messages` on the root when older history is missing.
  Renderers should say so rather than imply the tree is complete.

## Development

```bash
pnpm test          # Vitest
pnpm typecheck     # src without DOM/Node types, then tests/examples
pnpm run schema    # regenerate schemas/*.json after changing the zod schemas
pnpm run docs      # TypeDoc → docs/api/
pnpm build         # tsc → dist/ (what gets published)
```
