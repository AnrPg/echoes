# @echoes/adapter-chatgpt-api

Turns ChatGPT web API responses into the normalized Echoes conversation tree from `@echoes/core`.

**Parse-only.** It never fetches anything, never sees a session token and has no DOM. The host (the Echoes extension,
running in the user's logged-in chatgpt.com tab) fetches the responses through the core `Scheduler` and hands the JSON
bodies to this package. Runs in browsers, Node (≥ 22.18), Deno and Bun.

Status: **0.x**, not yet published. Anything not exported from the package entry point is internal.

## Usage

```ts
import { parseChatGptConversation, pageFollowUps, ChatGptAdapterError } from '@echoes/adapter-chatgpt-api';

// 1. The host fetches the newest page, then older pages and versions as pageFollowUps() says.
const next = pageFollowUps(newestPage); // { olderCursor, versionedMessageIds }

// 2. Parse everything at once.
try {
  const { conversation, warnings, branchedFrom } = parseChatGptConversation({
    conversation: newestPage,           // GET /backend-api/conversations/:id?include_has_versions&num_turns
    olderPages: [olderPage1, olderPage2], // GET …/messages?before=…, in fetch order (each older than the last)
    versions: { [messageId]: versions },  // GET …/versions?message_id=…, keyed by that message id
  });
} catch (e) {
  if (e instanceof ChatGptAdapterError) console.error(e.issues); // every changed field, with its path
}
```

Runnable example, kept honest by a test: `node examples/parse.ts`.

## What it returns

- `conversation`: a `Conversation` already checked by `parseConversation` (shapes and tree integrity).
- `warnings`: `AdapterWarning[]` with stable `code`s (see `WarningCode`). For the export's error report; nothing in
  them was dropped.
- `branchedFrom`: the source chat of a "Branch in new chat" chat. The API does not name the fork message, so this is
  not a `LineageRef`; the branch monitor records the fork node.

## How the tree is built

Phase 0 showed that the web app loads a chat as a flat, paged list of the **active path** only, plus one versions
call per turn that has other versions (`docs/phase-0.md`). So:

| Step | Rule |
| --- | --- |
| Root | A hidden system node `echoes:root` (`ROOT_ID`). The API does not return ChatGPT's own root, and the first question needs a parent so an edit of it can be a sibling. |
| Active path | Pages are joined oldest first; each message's parent is the message before it. `parent_id` is only cross-checked, because it often points at hidden messages the API leaves out. |
| Versions | Each inner array of a versions response is one other version of that turn. Messages already on the path (the shared question of a regenerated answer) are reused; new ones chain under the last shared one, or under the anchor's parent when nothing is shared (an edited question). |
| Order | Siblings are sorted by creation time, so the original is version 1 as in the web app. |
| Gaps | A version on an earlier turn has later turns the API did not return: its leaf gets `notFetched: 'later-messages'`. If the oldest page still has older pages, the root gets `notFetched: 'earlier-messages'`. |
| Hidden | `weight: 0` or `is_visually_hidden_from_conversation` → `hidden: true` (system prompts, memory). |

## Content mapping

| `content_type` | Blocks |
| --- | --- |
| `text` | `markdown` per non-empty part; `toolOutput` for tool messages; `code` (origin `tool`) when the assistant addresses a tool. Citation markers (`cite…`) are replaced by the reference's `alt`, as the web app shows them, and each cited URL becomes one `citation` block. |
| `thoughts` | `reasoning` per non-empty `summary`. The raw `content` is never read. |
| `reasoning_recap` | `reasoning` ("Worked for 19s"). |
| `code` | `code`, origin `tool` (a tool call). |
| `model_editable_context` | `markdown` with the memory text; the node is hidden. |
| `multimodal_text` | **Assumption:** text parts as `markdown`, `image_asset_pointer` parts as `image` (`generated` when not from the user), file id = the pointer without its scheme. Phase 0 saw this shape only in a send request, not in a stored message; the tests pin the assumption so a real capture that differs fails loudly. |
| `metadata.attachments` | `attachment` per file not already shown as an image. Resources start as `pending`; the download step sets their final status. |
| anything else | `unknown` with the raw content, plus an `unknown-content-type` warning. A known type with missing fields gives `unknown` plus `content-mismatch`. |

Roles, ids, `current_node` and `page_info` are structural: if they change, parsing throws `ChatGptAdapterError`.

## Fixtures

`fixtures/` holds anonymized real captures; `tests/golden/` holds their normalized output. Build a new fixture from an
inspector export (`*.PRIVATE.json`, never committed):

```bash
pnpm --filter @echoes/adapter-chatgpt-api fixture path/to/capture.PRIVATE.json fixtures/<name>.json "Title"
```

The script keeps structure (ids, roles, content types, turn ids, `has_versions`, citation markers, relative timing)
and replaces all text, titles, URLs and memory. It refuses to write if any original free-text string survives.
Review the output before committing anyway.

## Development

```bash
pnpm test        # Vitest; `pnpm test -u` updates golden files after a reviewed change
pnpm typecheck
pnpm run docs    # TypeDoc → docs/api/
pnpm build
```
