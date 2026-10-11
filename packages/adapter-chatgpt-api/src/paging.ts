import { RawMessagesPageSchema } from './raw.ts';
import { ChatGptAdapterError } from './report.ts';

/**
 * What the host still has to fetch after one page: the cursor for the next older page, and the messages whose other
 * versions can be loaded. Pure: it reads a page the host already fetched and never builds URLs or sends requests.
 *
 * `before` is **inferred** to take the page's `start_cursor` (Phase 0 recorded the parameter names, not their
 * values). Verify it on the first real paged fetch; a wrong value shows up as a repeated or empty page.
 *
 * @example
 * ```ts
 * let page = newestPageJson;
 * const older = [];
 * for (let next = pageFollowUps(page); next.olderCursor; next = pageFollowUps(page)) {
 *   page = await fetchOlderPage(conversationId, next.olderCursor); // the host's own request, through the scheduler
 *   older.push(page);
 * }
 * ```
 */
export function pageFollowUps(page: unknown): { olderCursor: string | null; versionedMessageIds: string[] } {
  const r = RawMessagesPageSchema.safeParse(page);
  if (!r.success) {
    throw new ChatGptAdapterError(r.error.issues.map((i) => ({ path: i.path.map((k) => (typeof k === 'symbol' ? String(k) : k)), message: i.message })));
  }
  const { page_info, messages } = r.data;
  return {
    olderCursor: page_info.has_previous_page ? (page_info.start_cursor ?? null) : null,
    versionedMessageIds: messages.filter((m) => m.metadata?.has_versions === true).map((m) => m.id),
  };
}
