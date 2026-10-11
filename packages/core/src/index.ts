/**
 * `@echoes/core`: the normalized conversation model, tree and turn functions, the Markdown, HTML and JSON renderers,
 * and the host-agnostic request scheduler. Pure TypeScript with no network and no DOM; runs in browsers, Node, Deno and Bun.
 *
 * Stability: 0.x. Everything exported here is the public API; anything not exported is internal.
 *
 * @packageDocumentation
 */

export {
  SCHEMA_VERSION,
  SYNTHETIC_ROOT_ID,
  BlockSchema,
  ConversationShapeSchema,
  LineageEvidenceSchema,
  LineageRefSchema,
  NodeSchema,
  NotFetchedSchema,
  ImageSourceSchema,
  ResourceSchema,
  ResourceStatusSchema,
  RoleSchema,
  type Block,
  type BlockKind,
  type Conversation,
  type LineageEvidence,
  type LineageRef,
  type Node,
  type NotFetched,
  type ImageSource,
  type Resource,
  type ResourceStatus,
  type Role,
} from './model/schema.ts';
export { WidgetNodeSchema, walkWidget, widgetText, type WidgetNode, type WidgetNodeType } from './model/widget.ts';
export {
  EchoesValidationError,
  parseConversation,
  safeParseConversation,
  type ParseResult,
  type ValidationIssue,
} from './model/validate.ts';
export {
  TreeError,
  activePath,
  getNode,
  leaves,
  nodesOf,
  pathThrough,
  pathTo,
  subtree,
  traversals,
  versionGroups,
  type Traversal,
  type VersionGroup,
} from './model/tree.ts';
export { CONVERSATION_SCHEMA_ID, MANIFEST_SCHEMA_ID, conversationJsonSchema, manifestJsonSchema } from './model/json-schema.ts';
export {
  TURN_PARTS,
  TURN_PRESETS,
  applyTurnDefinition,
  buildTurns,
  matchTurnPreset,
  type Turn,
  type TurnDefinition,
  type TurnPresetName,
} from './model/turns.ts';
export { DEFAULT_BACKOFF, backoffDelay, parseRetryAfter, type BackoffOptions } from './queue/backoff.ts';
export {
  abortError,
  systemClock,
  type Clock,
  type Random,
  type SignalLike,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from './queue/ports.ts';
export {
  HttpError,
  RetriesExhaustedError,
  Scheduler,
  SchedulerCancelledError,
  isCloudflareChallenge,
  type PauseReason,
  type SchedulerEvent,
  type SchedulerOptions,
  type SchedulerState,
} from './queue/scheduler.ts';
export {
  MARKDOWN_FLAVORS,
  convertMarkdownText,
  escapeMarkdownInline,
  type MarkdownFlavor,
} from './render/markdown/text.ts';
export {
  renderMarkdown,
  renderMarkdownBranches,
  type BranchToRender,
  type BlockRenderContext,
  type BlockRenderer,
  type MarkdownRenderOptions,
} from './render/markdown/document.ts';
export { renderJson } from './render/json.ts';
export { findMatches, normalizeText, normalizeWithMap, type TextRange } from './search/normalize.ts';
export { tokenize, type Token } from './search/tokenize.ts';
export {
  namedTraversals,
  forkName,
  previewOf,
  selectTraversals,
  sharedPrefix,
  treeSummary,
  type Fork,
  type NamedTraversal,
  type TreeSummary,
  type TreeSummaryNode,
  type VersionSelection,
} from './model/versions.ts';
export { renderMermaid, type MermaidOptions } from './render/mermaid.ts';
export { renderHtml, renderHtmlBranches, type HtmlBlockRenderContext, type HtmlBlockRenderer, type HtmlRenderOptions } from './render/html/document.ts';
export { markdownToHtml, type CodeHighlighter } from './render/html/markdown.ts';
export { HTML_THEMES, themeCss, type HtmlTheme } from './render/html/themes.ts';
export { READER_CSS, READER_SCRIPT } from './render/html/reader.ts';
export { MERGED_CSS, mergeHtml, mergeJson, mergeMarkdown, mergedChatAnchor, shiftMarkdownHeadings, type MarkdownMergeOptions, type MergeOptions, type MergePart } from './render/merge.ts';
export {
  ChatSkeletonSchema,
  SKELETON_VERSION,
  chatSkeleton,
  inferLineage,
  lineageFromMetadata,
  sharedHistory,
  type ChatSkeleton,
  type InferOptions,
  type SharedHistory,
} from './model/lineage.ts';
export {
  codeExtension,
  planResources,
  renderResourceIndex,
  resourceManifest,
  resourceText,
  type FileOutcome,
  type ResourceItem,
  type ResourcePlan,
  type ResourcePlanOptions,
} from './render/resources.ts';
export {
  SEARCH_FIELDS,
  SEARCH_INDEX_VERSION,
  TurnIndex,
  turnDocId,
  turnText,
  typoBudget,
  type SearchField,
  type TurnDoc,
  type TurnHit,
  type TurnSearchOptions,
} from './search/index.ts';
export {
  ContentKindSchema,
  RuleError,
  RuleSchema,
  TextFieldSchema,
  TextModeSchema,
  hasContent,
  parseRule,
  selectTurns,
  type ContentKind,
  type Rule,
  type SelectOptions,
} from './search/rules.ts';
export { MemoryStore, STORE_COLLECTIONS, type Store } from './store/store.ts';
export { MemorySink, OutputPathError, assertSafeOutputPath, type OutputSink } from './output/sink.ts';
export { DEFAULT_FILE_NAME_BYTES, linkPath, safeFileName, slugFileName, uniqueFileName, uniqueSlugName, type SafeFileNameOptions } from './output/filenames.ts';
export {
  ExportManifestSchema,
  MANIFEST_PATH,
  ManifestEntrySchema,
  ManifestError,
  MergedEntrySchema,
  RENDER_FORMAT_VERSION,
  mergedNeedsRebuild,
  type MergedEntry,
  contentFingerprint,
  documentFileName,
  emptyManifest,
  exportSettingsKey,
  isContentUnchanged,
  parseManifest,
  planIncrementalExport,
  recordExport,
  serializeManifest,
  settingsKey,
  type ChatSummary,
  type ExportManifest,
  type ExportReason,
  type IncrementalPlan,
  type ManifestEntry,
  type PlanOptions,
} from './output/manifest.ts';
export {
  ExportJobSchema,
  JobCheckpointError,
  JobCheckpoints,
  JobItemSchema,
  JobItemStatusSchema,
  cancelExportJob,
  createExportJob,
  isJobFinished,
  jobProgress,
  retryFailed,
  runExportJob,
  type ExportJob,
  type ExportOneResult,
  type JobItem,
  type JobItemStatus,
  type JobProgress,
  type NewExportJob,
  type RunExportJobOptions,
} from './jobs/job.ts';
export { WIDGET_STATIC_LABEL, widgetToMarkdown } from './render/markdown/widget.ts';
export { WIDGET_CSS, widgetToHtml, type WidgetHtmlContext } from './render/html/widget.ts';
