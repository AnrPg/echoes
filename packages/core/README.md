# @echoes/core

The normalized conversation model, tree and turn functions, and a host-agnostic polite request scheduler for exporting
chat conversations. Pure TypeScript: **no network, no DOM**. Runs in browsers, Node (≥ 22.18), Deno and Bun.

Status: **0.x**, not yet published. Anything not exported from the package entry point is internal.

## What is in it

| Area | Exports | Notes |
| --- | --- | --- |
| Model | `Conversation`, `Node`, `Block`, `Resource`, `LineageRef`, zod schemas, `SCHEMA_VERSION` | A chat is a tree of nodes, never a flat list. Types are inferred from the zod schemas. |
| Validation | `parseConversation`, `safeParseConversation`, `EchoesValidationError` | Field shapes **and** tree integrity (links, reachability, active leaf). Reports every issue with a path. |
| JSON Schema | `conversationJsonSchema()`, `@echoes/core/schemas/conversation.v1.schema.json` | Generated from the zod schemas; a test fails if the committed file drifts. Covers shapes only, not tree integrity. |
| Tree | `activePath`, `pathTo`, `pathThrough`, `subtree`, `leaves`, `traversals`, `versionGroups` | Deterministic: child order is `childIds` order. Iterative, so 20k-message chats are fine. |
| Turns | `buildTurns`, `applyTurnDefinition`, `TURN_PRESETS` | Turn = a question plus the responses until the next question. Presets filter blocks; `unknown` content stays visible. |
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

## Model notes

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
