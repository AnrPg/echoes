/**
 * `@echoes/core`: the normalized conversation model, tree and turn functions, and the host-agnostic request
 * scheduler. Pure TypeScript with no network and no DOM; runs in browsers, Node, Deno and Bun.
 *
 * Stability: 0.x. Everything exported here is the public API; anything not exported is internal.
 *
 * @packageDocumentation
 */

export {
  SCHEMA_VERSION,
  BlockSchema,
  ConversationShapeSchema,
  LineageEvidenceSchema,
  LineageRefSchema,
  NodeSchema,
  ResourceSchema,
  ResourceStatusSchema,
  RoleSchema,
  type Block,
  type BlockKind,
  type Conversation,
  type LineageEvidence,
  type LineageRef,
  type Node,
  type Resource,
  type ResourceStatus,
  type Role,
} from './model/schema.ts';
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
export { CONVERSATION_SCHEMA_ID, conversationJsonSchema } from './model/json-schema.ts';
export { TURN_PRESETS, applyTurnDefinition, buildTurns, type Turn, type TurnDefinition } from './model/turns.ts';
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
