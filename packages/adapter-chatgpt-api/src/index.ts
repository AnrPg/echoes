/**
 * `@echoes/adapter-chatgpt-api`: turns ChatGPT web API responses that a host already fetched into the normalized
 * Echoes conversation tree from `@echoes/core`.
 *
 * Parse-only: no network, no DOM, no session token. Fetching chatgpt.com stays inside the extension (or another
 * host that runs in the user's logged-in page), through the core `Scheduler`.
 *
 * Stability: 0.x. Everything exported here is the public API; anything not exported is internal.
 *
 * @packageDocumentation
 */

export {
  ROOT_ID,
  parseChatGptConversation,
  type ChatGptConversationCapture,
  type ChatGptParseResult,
  type ParseOptions,
} from './conversation.ts';
export { pageFollowUps } from './paging.ts';
export {
  convertLayoutMarkup,
  splitLayoutMarkup,
  INTERACTIVE_NOTE,
  WIDGET_SOURCE_FORMAT,
  type LayoutResolver,
  type LayoutResult,
  type LayoutSegment,
  type LayoutSegments,
} from './markup.ts';
export { ChatGptAdapterError, type AdapterIssue, type AdapterWarning, type WarningCode } from './report.ts';
export {
  RawConversationPageSchema,
  RawMessageSchema,
  RawMessagesPageSchema,
  RawVersionsSchema,
} from './raw.ts';
export {
  RawChatListItemSchema,
  RawChatListPageSchema,
  RawFileDownloadSchema,
  RawNewBranchRequestSchema,
  RawNewBranchResponseSchema,
  RawProjectChatsPageSchema,
  RawProjectSidebarSchema,
  parseChatListPage,
  parseFileDownload,
  parseNewBranch,
  parseProjectChatsPage,
  parseProjectSidebar,
  type ChatListItem,
  type ChatListPage,
  type FileDownload,
  type NewBranch,
  type Project,
  type ProjectChatsPage,
  type ProjectSidebarPage,
} from './lists.ts';
