import type { Block, Resource } from '@echoes/core';
import type { z } from 'zod';
import { WIDGET_SOURCE_FORMAT, mapWidgetText, splitLayoutMarkup, type LayoutResolver, type TagPosition, type WebLink } from './markup.ts';
import {
  RawAssetPartSchema,
  RawCodeContentSchema,
  RawExecutionOutputContentSchema,
  RawGenuiComponentSchema,
  RawGenuiResultSchema,
  RawModelEditableContextSchema,
  RawReasoningRecapContentSchema,
  RawTextContentSchema,
  RawWidgetDataSchema,
  RawThoughtsContentSchema,
  type RawContentReference,
  type RawMessage,
} from './raw.ts';
import type { AdapterWarning } from './report.ts';

/** `sourceFormat` of a ChatGPT widget app: the HTML page (with scripts) from its reference's `data.content`. */
export const APP_SOURCE_FORMAT = 'chatgpt-app-block';

/** What a tool message holds when ChatGPT withheld its output (web search results; capture of 2026-10-11). */
const REDACTED_TOOL_OUTPUT = 'The output of this plugin was redacted.';

/** Citation markers ChatGPT puts in the text: `\ue200` … `\ue201`, fields separated by `\ue202`. */

const CITATION_MARKER = /\ue200[^\ue200\ue201]*\ue201/g;

/** Reference types seen in Phase 0. Others still resolve their markers but raise a warning. */
const KNOWN_REFERENCE_TYPES = new Set(['grouped_webpages', 'sources_footnote', 'hidden', 'client_defined_widget']);

type Warn = (w: AdapterWarning) => void;

/**
 * Map one raw message's content to Echoes blocks.
 *
 * - `text`: one `markdown` block per non-empty part (user, assistant, system); a `toolOutput` block for tool messages;
 *   a `code` block (origin `tool`) when the assistant addresses a tool. Citation markers are replaced by the
 *   reference's `alt` (what the web app shows), and each cited URL becomes one `citation` block after the text.
 *   An assistant's layout markup (`<box>`, `<AsyncImage>`) becomes plain Markdown, see `markup.ts`; the images the
 *   web app found for it (`metadata.genui_components`) become `image` blocks with their source page, and each
 *   interactive widget (template or app) a `widget` block.
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
        if (role === 'tool') {
          // The web app hides a web search's results and keeps only this placeholder; it says nothing, so it is skipped.
          if (part.trim() !== REDACTED_TOOL_OUTPUT) blocks.push({ kind: 'toolOutput', text: part });
        }
        else if (toTool) blocks.push({ kind: 'code', text: part, origin: 'tool' });
        else blocks.push(...textBlocks(part, msg, refs, warn));
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
          if (part !== '') blocks.push(...textBlocks(part, msg, refs, warn));
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

/**
/**
 * A text part as blocks. An assistant's layout markup is converted (see `markup.ts`): the images the web app found
 * become `image` blocks between the texts, each template widget a `widget` block, and each widget app (a
 * `client_defined_widget` reference whose marker is in the text) a `widget` block in place of its marker. Citation
 * markers are resolved last, per piece, as `genui_components` offsets refer to the raw text. Warns about what could
 * not be carried over.
 */
function textBlocks(text: string, msg: RawMessage, refs: readonly RawContentReference[], warn: Warn): Block[] {
  const resolve = (t: string) => resolveMarkers(t, refs, msg.id, warn);
  if (msg.author.role !== 'assistant') return [{ kind: 'markdown', text: resolve(text) }];
  const r = splitLayoutMarkup(text, genuiResolver(msg));
  if (r.unresolvedImages > 0) {
    warn({ code: 'layout-image-not-exported', messageId: msg.id, message: `${r.unresolvedImages} image(s) the web app finds live are shown as notes` });
  }
  if (r.unreadableWidgets > 0) {
    warn({ code: 'widget-not-exported', messageId: msg.id, message: `${r.unreadableWidgets} part(s) of interactive widgets could not be read; their code is kept` });
  }
  const apps = refs.filter((ref) => ref.type === 'client_defined_widget' && ref.matched_text && text.includes(ref.matched_text));
  return r.segments.flatMap((s): Block[] => {
    if (s.kind === 'widget') return [{ kind: 'widget', sourceFormat: WIDGET_SOURCE_FORMAT, source: resolve(s.source), view: mapWidgetText(s.view, resolve) }];
    if (s.kind === 'image') {
      const { url, alt, source, id = url } = s.image;
      const image: Block = { kind: 'image', resource: { fileId: `web:${id}`, ...(alt ? { name: alt } : {}), url, status: 'pending' }, generated: false };
      if (source) image.source = source.title ? { title: source.title, url: source.url } : { url: source.url };
      return [image];
    }
    return withApps(s.text, apps, msg.id, warn).map((p) => (typeof p === 'string' ? { kind: 'markdown', text: resolve(p) } : p));
  });
}

/** Markdown split at widget app markers: the texts around them (blank lines at the cut trimmed) and the apps' blocks. */
function withApps(text: string, apps: readonly RawContentReference[], messageId: string, warn: Warn): (string | Block)[] {
  const out: (string | Block)[] = [];
  let rest = text;
  for (;;) {
    let next: { at: number; ref: RawContentReference } | undefined;
    for (const ref of apps) {
      const at = rest.indexOf(ref.matched_text!);
      if (at >= 0 && (!next || at < next.at)) next = { at, ref };
    }
    const before = (next ? rest.slice(0, next.at) : rest).trim();
    if (before) out.push(before);
    if (!next) return out;
    out.push(widgetApp(next.ref, messageId, warn));
    rest = rest.slice(next.at + next.ref.matched_text!.length);
  }
}

/** A `client_defined_widget` reference as a `widget` block (an HTML app), or an `unknown` block if it is not one. */
function widgetApp(ref: RawContentReference, messageId: string, warn: Warn): Block {
  const data = RawWidgetDataSchema.safeParse(ref['data']);
  if (data.success && data.data.widget_type === 'app_block' && (data.data.language ?? 'html') === 'html') {
    const d = data.data;
    return { kind: 'widget', sourceFormat: APP_SOURCE_FORMAT, source: d.content, view: [{ type: 'app', title: d.title ?? '', html: d.content }] };
  }
  const type = data.success ? `${data.data.widget_type}/${data.data.language ?? ''}` : 'unreadable';
  warn({ code: 'unknown-content-type', messageId, message: `unknown widget (${type}); its raw data is kept` });
  return { kind: 'unknown', contentType: 'client_defined_widget', raw: ref };
}

const COMPONENT_TYPE: Record<string, string> = { AsyncImage: 'async_image', Cite: 'cite', Link: 'link' };

/**
 * Looks up what the web app found for a layout tag: the `genui_components` entry at the tag's offset (or, if
 * none starts there, the one with the same ordinal among its type), then its result in
 * `model_dil_v2.appData.opGenui.componentResults`. Entries that do not parse are skipped.
 */
function genuiResolver(msg: RawMessage): LayoutResolver {
  const meta = msg.metadata as Record<string, unknown> | null | undefined;
  const list = Array.isArray(meta?.['genui_components']) ? (meta['genui_components'] as unknown[]) : [];
  const components = list.flatMap((c) => {
    const r = RawGenuiComponentSchema.safeParse(c);
    return r.success ? [r.data] : [];
  });
  if (!components.length) return {};
  const dil = meta?.['model_dil_v2'] as { appData?: { opGenui?: { componentResults?: unknown } } } | undefined;
  const results = dil?.appData?.opGenui?.componentResults;
  const result = (id: string) => {
    const raw = results && typeof results === 'object' ? (results as Record<string, unknown>)[id] : undefined;
    const r = RawGenuiResultSchema.safeParse(raw);
    return r.success && r.data.status === 'resolved' ? r.data : undefined;
  };
  const find = (tag: string, at: TagPosition) => {
    const type = COMPONENT_TYPE[tag];
    const same = components.filter((c) => c.type === type).sort((a, b) => a.start_index - b.start_index);
    const c = same.find((x) => x.start_index === at.offset) ?? same[at.ordinal];
    return c && { id: c.component_resolution_id, result: result(c.component_resolution_id) };
  };
  const page = (p: { title?: string | null | undefined; url?: string | null | undefined }): WebLink | undefined =>
    p.url ? (p.title ? { url: p.url, title: p.title } : { url: p.url }) : undefined;
  return {
    image(at) {
      const c = find('AsyncImage', at);
      const img = c?.result?.state?.images?.[0];
      if (!c || !img?.content_url) return undefined;
      const source = page(img);
      return source ? { url: img.content_url, id: c.id, source } : { url: img.content_url, id: c.id };
    },
    cite(at) {
      const items = find('Cite', at)?.result?.state?.items ?? [];
      return items.flatMap((i) => {
        const p = page({ title: i.source_label ?? i.title, url: i.url });
        return p ? [p] : [];
      });
    },
    link(at) {
      const s = find('Link', at)?.result?.state;
      return s ? page(s) : undefined;
    },
  };
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
