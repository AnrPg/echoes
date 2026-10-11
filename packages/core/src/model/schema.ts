import { z } from 'zod';
import { WidgetNodeSchema } from './widget.ts';

/**
 * The normalized Echoes model, schema version 1.
 *
 * Every adapter produces this shape and everything downstream (tree functions, turns, search, renderers, UI)
 * consumes only this shape, so a provider's raw format never leaks past its adapter. The zod schemas are the
 * single source of truth: the TypeScript types are inferred from them, and the published JSON Schema
 * (`schemas/conversation.v1.schema.json`) is generated from them.
 *
 * @packageDocumentation
 */

/** Current Echoes JSON schema version. Bumped only with a major release and a migration. */
export const SCHEMA_VERSION = 1 as const;

/**
 * Id of the hidden `system` root an adapter adds when its source has no usable root of its own (for example
 * ChatGPT's paged API). The first question hangs under it, so an edit of the first question can be its sibling.
 */
export const SYNTHETIC_ROOT_ID = 'echoes:root';

/** ISO 8601 timestamp with `Z` or an explicit offset. Adapters convert provider timestamps to this. */
const isoDateTime = z.iso.datetime({ offset: true });

/** Availability of a file at export time. Missing files are reported, never treated as an export failure. */
export const ResourceStatusSchema = z.enum(['ok', 'expired', 'sandbox-gone', 'pending']);

/** A file referenced by a message: an upload, a generated image, or a tool output file. */
export const ResourceSchema = z.object({
  fileId: z.string().min(1),
  name: z.string().optional(),
  mime: z.string().optional(),
  /**
   * Where the file can be downloaded directly, for files that live outside the provider's file store (an image the
   * provider found on the web). Files without it are downloaded through the provider, by `fileId`.
   */
  url: z.string().regex(/^https:\/\//).optional(),
  status: ResourceStatusSchema,
});

/** The web page an image was found on. */
export const ImageSourceSchema = z.object({ title: z.string().optional(), url: z.string() });

/**
 * One piece of message content. `markdown` keeps the raw Markdown including LaTeX source; conversion happens only
 * in renderers. `unknown` keeps content an adapter could not map, with its raw payload, so it is rendered visibly
 * instead of being dropped. `widget` is an interactive element: the provider's code verbatim in `source` (its language
 * named by `sourceFormat`, e.g. `chatgpt-widget`), and a code-free reading of it in `view` (see {@link WidgetNode}).
 */
export const BlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('markdown'), text: z.string() }),
  z.object({
    kind: z.literal('code'),
    lang: z.string().optional(),
    text: z.string(),
    origin: z.enum(['fence', 'tool']),
  }),
  z.object({ kind: z.literal('toolOutput'), text: z.string(), files: z.array(ResourceSchema).optional() }),
  /** Only the reasoning summaries the provider shows, never raw chain of thought. */
  z.object({ kind: z.literal('reasoning'), summary: z.string() }),
  z.object({ kind: z.literal('image'), resource: ResourceSchema, generated: z.boolean(), source: ImageSourceSchema.optional() }),
  z.object({ kind: z.literal('attachment'), resource: ResourceSchema }),
  z.object({ kind: z.literal('citation'), title: z.string().optional(), url: z.string() }),
  z.object({ kind: z.literal('canvas'), title: z.string(), text: z.string() }),
  z.object({ kind: z.literal('unknown'), contentType: z.string(), raw: z.unknown() }),
  z.object({ kind: z.literal('widget'), sourceFormat: z.string().min(1), source: z.string(), view: z.array(WidgetNodeSchema) }),
]);

export const RoleSchema = z.enum(['user', 'assistant', 'tool', 'system']);

/** Which neighbouring messages a provider has but the adapter did not fetch. See {@link NodeSchema}. */
export const NotFetchedSchema = z.enum(['later-messages', 'earlier-messages']);

/** One message in the conversation tree. Siblings (same `parentId`) are versions: edits or regenerations. */
export const NodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  /** Children in provider order. Tree functions treat this order as authoritative and never re-sort it. */
  childIds: z.array(z.string().min(1)),
  role: RoleSchema,
  /** Absent when the provider gives no time. Echoes never invents one. Siblings' times are the fork times. */
  createdAt: isoDateTime.optional(),
  blocks: z.array(BlockSchema),
  /** Context the provider hides from the chat view: memory, custom instructions, system prompts. */
  hidden: z.boolean(),
  /** Original payload, kept when the adapter could not fully parse the message. */
  raw: z.unknown().optional(),
  /**
   * Set when the provider has messages next to this node that the adapter could not fetch, so renderers can say so
   * instead of implying the tree is complete. `later-messages`: turns after this node (for example under an older
   * version) were not loaded. `earlier-messages`: history before this node was not loaded (set on the root).
   */
  notFetched: NotFetchedSchema.optional(),
});

/** How a branched chat was linked to its source. Inferred links are never presented as certain. */
export const LineageEvidenceSchema = z.enum(['recorded', 'inferred', 'api-metadata']);

export const LineageRefSchema = z.object({
  parentConversationId: z.string().min(1),
  /** Last node the child shares with the parent. */
  forkNodeId: z.string().min(1),
  childConversationId: z.string().min(1),
  detectedAt: isoDateTime,
  evidence: LineageEvidenceSchema,
  /** 1 for recorded links; the prefix-match score for inferred ones. */
  confidence: z.number().min(0).max(1),
  /** Tree of the parent at fork time. Validated structurally by {@link parseConversation}. */
  parentSnapshot: z.lazy((): z.ZodType<unknown> => ConversationShapeSchema).optional(),
});

/** Field-level shape of a conversation. Use {@link parseConversation} to also check tree integrity. */
export const ConversationShapeSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string(),
  projectId: z.string().min(1).optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  model: z.string().optional(),
  sourceUrl: z.string(),
  rootId: z.string().min(1),
  /** The leaf of the branch the user currently sees (ChatGPT calls it `current_node`). */
  activeLeafId: z.string().min(1),
  nodes: z.record(z.string(), NodeSchema),
  lineage: LineageRefSchema.optional(),
});

export type ResourceStatus = z.infer<typeof ResourceStatusSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type ImageSource = z.infer<typeof ImageSourceSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type BlockKind = Block['kind'];
export type Role = z.infer<typeof RoleSchema>;
export type NotFetched = z.infer<typeof NotFetchedSchema>;
export type Node = z.infer<typeof NodeSchema>;
export type LineageEvidence = z.infer<typeof LineageEvidenceSchema>;
/** A lineage link. `parentSnapshot`, when present, is a {@link Conversation}. */
export type LineageRef = Omit<z.infer<typeof LineageRefSchema>, 'parentSnapshot'> & { parentSnapshot?: Conversation };
/** One chat as a tree of {@link Node}s. Never a flat list. */
export type Conversation = Omit<z.infer<typeof ConversationShapeSchema>, 'lineage'> & { lineage?: LineageRef };
