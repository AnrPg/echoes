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

| # | Question | Answer | Evidence (report section) |
| --- | --- | --- | --- |
| 1 | Source chat + fork node exposed for branched chats? | _pending_ | |
| 2 | Endpoint + request body that creates a branch | _pending_ | |
| 3 | Project conversation listing + pagination | _pending_ | |
| 4 | Attachment / generated image fetch + URL lifetime | _pending_ | |
