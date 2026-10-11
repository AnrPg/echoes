import type { Block, Resource } from '@echoes/core';
import type { z } from 'zod';
import { convertLayoutMarkup } from './markup.ts';
import {
  RawAssetPartSchema,
  RawCodeContentSchema,
  RawExecutionOutputContentSchema,
  RawModelEditableContextSchema,
  RawReasoningRecapContentSchema,
  RawTextContentSchema,
  RawThoughtsContentSchema,
  type RawContentReference,
  type RawMessage,
} from './raw.ts';
import type { AdapterWarning } from './report.ts';

/** Citation markers ChatGPT puts in the text: `\ue200` … `\ue201`, fields separated by `\ue202`. */
const CITATION_MARKER = /\ue200[^\ue200\ue201]*\ue201/g;

/** Reference types seen in Phase 0. Others still resolve their markers but raise a warning. */
const KNOWN_REFERENCE_TYPES = new Set(['grouped_webpages', 'sources_footnote', 'hidden']);

type Warn = (w: AdapterWarning) => void;

/**
 * Map one raw message's content to Echoes blocks.
 *
 * - `text`: one `markdown` block per non-empty part (user, assistant, system); a `toolOutput` block for tool messages;
 *   a `code` block (origin `tool`) when the assistant addresses a tool. Citation markers are replaced by the
 *   reference's `alt` (what the web app shows), and each cited URL becomes one `citation` block after the text.
 *   An assistant's layout markup (`<box>`, `<AsyncImage>`, widgets) becomes plain Markdown, see `markup.ts`.
 * - `thoughts`: one `reasoning` block per non-empty `summary`. The raw `content` is never read (rule 10).
 * - `reasoning_recap`: one `reasoning` block ("Worked for 19s").
 * - `code`: a `code` block with origin `tool` (the assistant calling a tool).
 * - `execution_output`: a `toolOutput` block (what a tool printed, e.g. a shell command's output).
 * - `model_editable_context`: the memory text as `markdown`; the node is hidden.
 * - `multimodal_text`: text parts as `markdown`, image parts as `image` blocks (assumption, see README).
 * - anything else: an `unknown` block with the raw content, and a warning.
 *
 * Attachments in `metadata.attachments` that no image part already shows become `attachment` blocks at the end.
 */
export function toBlocks(msg: RawMessage, warn: Warn): Block[] {
  const content = msg.content;
  const type = content.content_type;
  const role = msg.author.role;
  const toTool = role === 'assistant' && msg.recipient != null && msg.recipient !== 'all';
  const unknown = (): Block => ({ kind: 'unknown', contentType: type, raw: content });
  const parse = <S extends z.ZodType>(schema: S): z.infer<S> | undefined => {
    const r = schema.safeParse(content);
    if (r.success) return r.data;
    warn({
      code: 'content-mismatch',
      messageId: msg.id,
      message: `content_type "${type}" no longer matches: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    });
    return undefined;
  };

  const blocks: Block[] = [];
  const imageIds = new Set<string>();
  switch (type) {
    case 'text': {
      const c = parse(RawTextContentSchema);
      if (!c) return [unknown()];
      const refs = msg.metadata?.content_references ?? [];
      for (const part of c.parts) {
        if (typeof part !== 'string') {
          blocks.push({ kind: 'unknown', contentType: `${type}/part`, raw: part });
          warn({ code: 'unknown-content-type', messageId: msg.id, message: 'non-string part in a text message' });
          continue;
        }
        if (part === '') continue;
        if (role === 'tool') blocks.push({ kind: 'toolOutput', text: part });
        else if (toTool) blocks.push({ kind: 'code', text: part, origin: 'tool' });
        else blocks.push({ kind: 'markdown', text: layout(resolveMarkers(part, refs, msg.id, warn), role, msg.id, warn) });
      }
      blocks.push(...citations(refs, msg.id, warn));
      break;
    }
    case 'multimodal_text': {
      const c = parse(RawTextContentSchema);
      if (!c) return [unknown()];
      const refs = msg.metadata?.content_references ?? [];
      const mimes = new Map((msg.metadata?.attachments ?? []).map((a) => [a.id, a.mime_type ?? undefined]));
      for (const part of c.parts) {
        if (typeof part === 'string') {
          if (part !== '') blocks.push({ kind: 'markdown', text: layout(resolveMarkers(part, refs, msg.id, warn), role, msg.id, warn) });
          continue;
        }
        const asset = RawAssetPartSchema.safeParse(part);
        if (asset.success && asset.data.content_type === 'image_asset_pointer' && asset.data.asset_pointer) {
          const fileId = fileIdOf(asset.data.asset_pointer);
          imageIds.add(fileId);
          blocks.push({ kind: 'image', resource: resource(fileId, undefined, mimes.get(fileId)), generated: role !== 'user' });
        } else {
          const partType = asset.success ? asset.data.content_type : 'multimodal_text/part';
          blocks.push({ kind: 'unknown', contentType: partType, raw: part });
          warn({ code: 'unknown-content-type', messageId: msg.id, message: `unknown multimodal part "${partType}"` });
        }
      }
      blocks.push(...citations(refs, msg.id, warn));
      break;
    }
    case 'thoughts': {
      const c = parse(RawThoughtsContentSchema);
      if (!c) return [unknown()];
      for (const t of c.thoughts) if (t.summary) blocks.push({ kind: 'reasoning', summary: t.summary });
      break;
    }
    case 'reasoning_recap': {
      const c = parse(RawReasoningRecapContentSchema);
      if (!c) return [unknown()];
      if (c.content) blocks.push({ kind: 'reasoning', summary: c.content });
      break;
    }
    case 'code': {
      const c = parse(RawCodeContentSchema);
      if (!c) return [unknown()];
      const lang = c.language && c.language !== 'unknown' ? c.language : undefined;
      blocks.push(lang ? { kind: 'code', lang, text: c.text, origin: 'tool' } : { kind: 'code', text: c.text, origin: 'tool' });
      break;
    }
    case 'execution_output': {
      const c = parse(RawExecutionOutputContentSchema);
      if (!c) return [unknown()];
      blocks.push({ kind: 'toolOutput', text: c.text });
      break;
    }
    case 'model_editable_context': {
      const c = parse(RawModelEditableContextSchema);
      if (!c) return [unknown()];
      if (c.model_set_context) blocks.push({ kind: 'markdown', text: c.model_set_context });
      break;
    }
    default:
      warn({ code: 'unknown-content-type', messageId: msg.id, message: `unknown content_type "${type}"` });
      return [unknown()];
  }

  for (const a of msg.metadata?.attachments ?? []) {
    if (imageIds.has(a.id)) continue;
    blocks.push({ kind: 'attachment', resource: resource(a.id, a.name ?? undefined, a.mime_type ?? undefined) });
  }
  return blocks;
}

/**
 * Replace each citation marker with the matching reference's `alt` (empty when it has none, as for memory
 * citations). Matching is by marker text, not by `start_idx`, so it does not depend on the index unit.
 */
function resolveMarkers(text: string, refs: readonly RawContentReference[], messageId: string, warn: Warn): string {
  if (!text.includes('\ue200')) return text;
  const byMarker = new Map<string, string>();
  for (const r of refs) if (r.matched_text && !byMarker.has(r.matched_text)) byMarker.set(r.matched_text, r.alt ?? '');
  return text.replace(CITATION_MARKER, (marker) => {
    const alt = byMarker.get(marker);
    if (alt !== undefined) return alt;
    warn({ code: 'unresolved-citation-marker', messageId, message: `no reference for citation marker ${JSON.stringify(marker)}` });
    return marker;
  });
}

/** Convert an assistant's layout markup to Markdown, warning about what could not be carried over. */
function layout(text: string, role: string, messageId: string, warn: Warn): string {
  if (role !== 'assistant') return text;
  const r = convertLayoutMarkup(text);
  if (r.unresolvedImages > 0) {
    warn({ code: 'layout-image-not-exported', messageId, message: `${r.unresolvedImages} image(s) the web app finds live are shown as notes` });
  }
  if (r.unreadableWidgets > 0) {
    warn({ code: 'widget-not-exported', messageId, message: `${r.unreadableWidgets} interactive element(s) could not be read and are shown as notes` });
  }
  return r.markdown;
}

/** One `citation` block per distinct URL, in reference order. */
function citations(refs: readonly RawContentReference[], messageId: string, warn: Warn): Block[] {
  const out: Block[] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    if (!KNOWN_REFERENCE_TYPES.has(r.type)) {
      warn({ code: 'unknown-reference-type', messageId, message: `unknown content reference type "${r.type}"` });
    }
    for (const s of [...(r.items ?? []), ...(r.sources ?? [])]) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      out.push(s.title ? { kind: 'citation', title: s.title, url: s.url } : { kind: 'citation', url: s.url });
    }
  }
  return out;
}

/** `file-service://file-abc` or `sediment://file_abc` → the id after the scheme (assumption, see README). */
function fileIdOf(assetPointer: string): string {
  return assetPointer.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
}

function resource(fileId: string, name: string | undefined, mime: string | undefined): Resource {
  const r: Resource = { fileId, status: 'pending' };
  if (name) r.name = name;
  if (mime) r.mime = mime;
  return r;
}
