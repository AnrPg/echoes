import { z } from 'zod';

/**
 * zod schemas for the ChatGPT web API responses the adapter reads, as observed in the Phase 0 captures
 * (`docs/phase-0.md`). They check only the fields the adapter uses and let every other field through, so ChatGPT
 * adding fields never breaks parsing, while a renamed or retyped field we rely on fails loudly with its path.
 *
 * This module is the only place that knows ChatGPT's raw format. Nothing it exports leaves the package except the
 * schemas themselves, which are public for hosts that want to pre-validate a response.
 *
 * @packageDocumentation
 */

const nullish = <T extends z.ZodType>(t: T) => t.nullable().optional();

/** One content-reference (citation) entry under `metadata.content_references`. */
export const RawContentReferenceSchema = z.looseObject({
  type: z.string(),
  /** The private-use marker in the text, e.g. `\ue200cite\ue202turn0search1\ue201`. */
  matched_text: nullish(z.string()),
  /** What the web app shows in place of the marker, usually a Markdown link. */
  alt: nullish(z.string()),
  items: nullish(z.array(z.looseObject({ title: nullish(z.string()), url: z.string() }))),
  sources: nullish(z.array(z.looseObject({ title: nullish(z.string()), url: z.string() }))),
});

/**
 * `data` of a `client_defined_widget` content reference. Seen in a capture (2026-10-11): `widget_type: "app_block"`,
 * `language: "html"`, `content` (the page: HTML, styles and inline scripts), `title`, `entrypoint: "index.html"`,
 * `icon_svg`, `variant: "inline"`, `bundle_version: 1`. The marker in the text is `\ue200genui\ue202{"app_block":{…}}\ue201`.
 */
export const RawWidgetDataSchema = z.looseObject({
  widget_type: z.string(),
  language: nullish(z.string()),
  content: z.string(),
  title: nullish(z.string()),
});

/** A file attached to a message (`metadata.attachments[]`). */
export const RawAttachmentSchema = z.looseObject({
  id: z.string().min(1),
  name: nullish(z.string()),
  mime_type: nullish(z.string()),
});

export const RawMessageMetadataSchema = z.looseObject({
  /** Often points at hidden messages the API does not return, so the tree is never rebuilt from it alone. */
  parent_id: nullish(z.string()),
  turn_exchange_id: nullish(z.string()),
  /** Set on the message whose other versions `conversations/:id/versions?message_id` returns. */
  has_versions: nullish(z.boolean()),
  message_type: nullish(z.string()),
  is_visually_hidden_from_conversation: nullish(z.boolean()),
  content_references: nullish(z.array(RawContentReferenceSchema)),
  attachments: nullish(z.array(RawAttachmentSchema)),
  branching_from_conversation_id: nullish(z.string()),
  branching_from_conversation_title: nullish(z.string()),
});

/** One message as the paged endpoints and the versions endpoint return it. */
export const RawMessageSchema = z.looseObject({
  id: z.string().min(1),
  author: z.looseObject({ role: z.enum(['user', 'assistant', 'tool', 'system']), name: nullish(z.string()) }),
  create_time: nullish(z.number()),
  /** Parsed per `content_type` by the block mapper; unknown types are kept as `unknown` blocks. */
  content: z.looseObject({ content_type: z.string() }),
  /** `all` for normal messages; a tool name (e.g. `web.run`) when the assistant calls a tool. */
  recipient: nullish(z.string()),
  channel: nullish(z.string()),
  /** 0 for context the chat view hides. */
  weight: nullish(z.number()),
  metadata: nullish(RawMessageMetadataSchema),
});

/** Cursors are message ids. `has_previous_page: true` means older messages exist. */
export const RawPageInfoSchema = z.looseObject({
  start_cursor: nullish(z.string()),
  end_cursor: nullish(z.string()),
  has_previous_page: z.boolean(),
  has_next_page: z.boolean(),
});

/** `GET /backend-api/conversations/:id?include_has_versions&num_turns`: the newest page of the active path. */
export const RawConversationPageSchema = z.looseObject({
  conversation_id: z.string().min(1),
  title: nullish(z.string()),
  create_time: z.number(),
  update_time: z.number(),
  /** The last message of the active path; equals `page_info.end_cursor`. */
  current_node: z.string().min(1),
  default_model_slug: nullish(z.string()),
  gizmo_id: nullish(z.string()),
  /** `snorlax` marks a Project. */
  gizmo_type: nullish(z.string()),
  messages: z.array(RawMessageSchema),
  page_info: RawPageInfoSchema,
});

/** `GET /backend-api/conversations/:id/messages?before&include_has_versions&num_turns`: an older page. */
export const RawMessagesPageSchema = z.looseObject({
  messages: z.array(RawMessageSchema),
  page_info: RawPageInfoSchema,
});

/**
 * `GET /backend-api/conversations/:id/versions?message_id`: one inner array per *other* version of that turn, each
 * holding the version's own question and answers (and hidden context the paged endpoints leave out).
 */
export const RawVersionsSchema = z.array(z.array(RawMessageSchema));

export type RawMessage = z.infer<typeof RawMessageSchema>;
export type RawContentReference = z.infer<typeof RawContentReferenceSchema>;
export type RawConversationPage = z.infer<typeof RawConversationPageSchema>;
export type RawMessagesPage = z.infer<typeof RawMessagesPageSchema>;
export type RawVersions = z.infer<typeof RawVersionsSchema>;

// Per content_type payloads. A known type whose payload no longer matches becomes an `unknown` block plus a warning.

export const RawTextContentSchema = z.looseObject({ parts: z.array(z.unknown()) });
export const RawThoughtsContentSchema = z.looseObject({
  /** Only `summary` is exported (rule 10); `content` is never read. */
  thoughts: z.array(z.looseObject({ summary: nullish(z.string()) })),
});
export const RawReasoningRecapContentSchema = z.looseObject({ content: z.string() });
export const RawCodeContentSchema = z.looseObject({ language: nullish(z.string()), text: z.string() });
/** What a tool printed. Seen in an export (2026-10-11): `{ content_type: "execution_output", text }`. */
export const RawExecutionOutputContentSchema = z.looseObject({ text: z.string() });
export const RawModelEditableContextSchema = z.looseObject({ model_set_context: nullish(z.string()) });
/** A non-string part of `multimodal_text`. Only seen in send requests so far, not in stored messages. */
export const RawAssetPartSchema = z.looseObject({ content_type: z.string(), asset_pointer: nullish(z.string()) });
