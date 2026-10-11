/**
 * Stable codes for things the adapter noticed but could handle. Hosts show them in the export's error report; none of
 * them means content was dropped.
 *
 * - `earlier-messages-not-fetched`: the oldest page given still has older pages. The root is marked `notFetched`.
 * - `later-messages-not-fetched`: a version sits on an earlier turn, so the turns under it were not loaded. Its leaf
 *   is marked `notFetched`.
 * - `unknown-content-type`: a message's `content_type` (or a multimodal part) is new; kept as an `unknown` block.
 * - `content-mismatch`: a known `content_type` no longer has the expected fields; kept as an `unknown` block.
 * - `unknown-reference-type`: a citation entry of a new type; its marker is resolved if it has `alt`, else kept.
 * - `unresolved-citation-marker`: a citation marker in the text with no matching reference; left in the text.
 * - `parent-mismatch`: a message's `parent_id` names a returned message other than the one before it on the path.
 * - `duplicate-message`: the same message id appeared twice on the active path; the second copy is ignored.
 * - `versions-anchor-missing`: a versions response is keyed by a message that is not on the fetched active path.
 * - `version-rejoins-path`: a version lists a known message after new ones; that message is skipped.
 * - `page-order`: an older page has messages newer than the page after it.
 * - `layout-image-not-exported`: an answer's layout markup shows images the web app finds live (by a search query or
 *   an unresolved ref); each is shown as an "Image: …" note.
 * - `widget-not-exported`: an answer's interactive element could not be read; it is shown as a note.
 */
export type WarningCode =
  | 'earlier-messages-not-fetched'
  | 'later-messages-not-fetched'
  | 'unknown-content-type'
  | 'content-mismatch'
  | 'unknown-reference-type'
  | 'unresolved-citation-marker'
  | 'parent-mismatch'
  | 'duplicate-message'
  | 'versions-anchor-missing'
  | 'version-rejoins-path'
  | 'page-order'
  | 'layout-image-not-exported'
  | 'widget-not-exported';

export interface AdapterWarning {
  code: WarningCode;
  message: string;
  /** The ChatGPT message id the warning is about, when there is one. */
  messageId?: string;
}

/** One raw-shape problem. `path` points into the capture, e.g. `["olderPages", 0, "messages", 3, "author", "role"]`. */
export interface AdapterIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Thrown when a response no longer has the shape the adapter relies on (a renamed field, a new role, a broken
 * `current_node`). It lists every issue with its path so the self-test can say exactly what changed.
 */
export class ChatGptAdapterError extends Error {
  override readonly name = 'ChatGptAdapterError';
  readonly issues: AdapterIssue[];
  constructor(issues: AdapterIssue[]) {
    super(
      `ChatGPT response did not match the expected shape (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n` +
        issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'),
    );
    this.issues = issues;
  }
}
