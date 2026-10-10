# Phase 0 — API inspection

Goal: answer the Build Plan's open questions 1–4 from real traffic, without guessing endpoint names or shapes.
Gate: each question below has an answer backed by a captured report, and 2–3 anonymized raw conversations exist for v1 fixtures.

## Capture session (≈20 min)

1. Load `dist/` (see README), open chatgpt.com, hard-reload. A small **● Mark** button appears bottom-left.
2. Before each step below press **● Mark** and type the label shown, so the report shows the requests right after it.

| Label | Do this | Answers |
| --- | --- | --- |
| `open chat` | Open an existing chat with an edited question and a regenerated answer; click the 2/3 arrows once. | conversation shape, versions |
| `branch` | On an assistant message use **Branch in new chat**. Wait until the new chat has loaded. | Q2: which request creates the branch, its body shape |
| `open branch` | Hard-reload the new branched chat, then open the source chat again. | Q1: does the API expose source chat / fork node? |
| `project` | Open a Project, scroll its chat list to the very bottom. | Q3: list endpoint + pagination params |
| `files` | Open a chat with an uploaded image/file and a generated image; open/download one of each. | Q4: how files are fetched |
| `send` | Send one short message in a throwaway chat. | streaming transport (SSE vs WebSocket) |

3. Click the extension icon → **Download report (.md)** → upload it to the project thread.

The report contains endpoint templates (`:id` instead of ids), header **names**, field names, `optional` markers and
machine-token values like `"multimodal_text"`. It never contains header values, message text, titles or ids. Skim it anyway before sharing.

## URL lifetime (Q4, manual)

Signed query values are deliberately not recorded. To measure lifetime: right-click an uploaded image → copy image
address, open it in a new tab after ~1 h and after ~24 h, and note whether it still loads.

## Raw samples for v1 fixtures (optional, personal data!)

1. In the inspector tick **Keep raw GET /backend-api bodies**, then open 2–3 chats you are fine sharing in anonymized
   form: one with math + code, one with edits/regenerations, one branched chat and its source.
2. Untick it, then **Download anonymized raw bodies (.json)**.

The anonymizer remaps ids consistently (tree links keep working), redacts emails and personal fields, and strips URL
query strings. **It does not rewrite message text or titles**: the alert lists which keys still contain free text.
Review those before uploading. **Clear capture** deletes everything stored.

## Known limits

- Requests made by XMLHttpRequest, Web Workers or Service Workers are not seen (only `window.fetch` and the
  `WebSocket` constructor in the page). If the report lacks an action you did, that itself answers part of Q2.
- WebSocket **messages** are not inspected, only the connection URL.
- Two chatgpt.com tabs capturing at once can lose updates; use one tab.
- `ms` in records is until the body was fully read (whole stream for SSE).

## Findings

From the capture of 2026-10-10 (19:44–20:47 UTC, 65 endpoint templates). Shapes only, never values. **Inferred** marks a
conclusion that was not directly observed.

| # | Question | Answer |
| --- | --- | --- |
| 1 | Source chat + fork node exposed for branched chats? | **Source chat yes, fork node no.** Messages in a branched chat carry `metadata.branching_from_conversation_id`, `_owner` and `_title`. No stored field names the fork message, so the branch monitor must record it from the `new_branch` request. |
| 2 | Endpoint + request body that creates a branch | `POST /backend-api/conversation/new_branch` with `{ conversation_id, message_id }`. Response `{ conversation: { conversation_id, mapping, current_node, gizmo_id, gizmo_type, … } }`. The first send in the new chat repeats `branching_from_conversation_id` and `branching_from_message_id`. |
| 3 | Project conversation listing + pagination | Projects are gizmos with `gizmo_type: "snorlax"`. `GET /backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo&cursor&limit&owned_only` lists projects; `GET /backend-api/gizmos/:id/conversations?cursor&limit&owned_only` → `{ cursor, items[] }`, cursor pagination (**inferred**: `cursor: null` is the last page). Items have `mapping: null`, so each chat is fetched separately. Chats outside projects: `GET /backend-api/conversations?offset&limit&order&…` (offset pagination). |
| 4 | Attachment / generated image fetch + URL lifetime | `GET /backend-api/files/download/:id` → `{ download_url, file_name, file_size_bytes, status }`, then a signed same-origin `GET /backend-api/estuary/content?…&sig&ts`, sent with the authorization header. Messages reference files by `asset_pointer` (`image_asset_pointer`) and `metadata.attachments[].id`. **Lifetime not measured yet.** **Inferred**: generated images use the same path. |
| 5 | (new) How are inactive versions and the full tree fetched? | **Answered for regenerated answers** (second capture, 21:30 UTC). Chats load in pages: newest from `GET /backend-api/conversations/:id?include_has_versions&num_turns`, older from `GET /backend-api/conversations/:id/messages?before&include_has_versions&num_turns` (`page_info` cursors are message ids; **inferred**: `before` = previous `start_cursor`, stop when `has_previous_page` is false). Other versions: `GET /backend-api/conversations/:id/versions?message_id` on a message with `metadata.has_versions: true` → `Array<Array<message>>`, one inner array per *other* version holding that version's whole turn, hidden messages included. The old singular `GET /backend-api/conversation/:id` was not called and is not used. |

Tree facts the adapter must handle (Q5 capture):

- User messages have no `parent_id`. Messages group into turns by `metadata.turn_exchange_id`; turns are ordered by
  page order and `create_time`.
- `parent_id` often points to hidden messages the endpoints don't return (up to 32 of 48 per page), so the tree is built
  per turn: a dangling `parent_id` links to the previous visible message of the same turn.
- On the active path, the current version's assistant messages have `message_type: "variant"`; others have `"next"`.
- Edits (fourth and fifth captures): an edit is sent as `POST /backend-api/f/conversation` action `"next"` with a new
  user message and a `parent_message_id`; there is no separate edit endpoint. The edited question gets
  `metadata.has_versions: true`, and `versions?message_id` on it returns every other version of that turn, edits and
  regenerations together, one inner array per version.
- A version with later turns under it: the Versions popup shows only that version's question and answer, never later
  messages (confirmed by ANR). How those later turns are fetched is unobserved, so the adapter marks such versions
  "subtree not fetched" rather than guessing an endpoint.

Other facts for the adapters:

- `content_type` values seen: `text`, `code`, `thoughts`, `reasoning_recap`, `model_editable_context`, `multimodal_text`.
  `thoughts[].summary` and `reasoning_recap` are reasoning summaries; `thoughts[].content` is not exported as reasoning
  until we know what it holds.
- Sending is `POST /backend-api/f/conversation` (SSE). Stream shapes were not captured; export does not need them.
- `POST /backend-api/conversations/batch` exists (several chats per request); check it against the throttling rule before use.
- Full analysis with report line references: the project's `notes/phase-0/findings.md`.

## Gate status

Q1–Q3 answered; Q4 answered except URL lifetime; Q5 closed for the adapter (loading, regenerations and edits
verified). Versions with later turns under them are still unobserved and are flagged, not guessed. Raw captured bodies contain real chat
text: fixtures are derived from them only after anonymization, and `*.PRIVATE.json` files are never committed.
