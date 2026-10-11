// Builds a committable adapter fixture from a raw inspector capture (*.PRIVATE.json), keeping the structure and
// replacing every piece of free text.
//
//   pnpm --filter @echoes/adapter-chatgpt-api fixture <capture.PRIVATE.json> <out.json> [title]
//
// What survives: message ids (the inspector already replaced them), roles, content types, recipients, channels,
// weights, turn ids, parent ids, has_versions, page_info, model slugs, citation markers, and the order and relative
// timing of everything. What is replaced: all text, titles, URLs, summaries and memory. Timestamps are shifted so
// the chat starts at 2023-11-14. Metadata the adapter does not read is dropped.
//
// The script refuses to write if any original free-text string of 6+ characters still appears in the output.
import { readFileSync, writeFileSync } from 'node:fs';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };
interface CaptureItem { t: number; endpoint: string; body: Json }

const [input, output, title = 'Anonymized conversation'] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: anonymize-capture.ts <capture.PRIVATE.json> <out.json> [title]');
  process.exit(1);
}

const capture = JSON.parse(readFileSync(input, 'utf8')) as { items: CaptureItem[] };
const items = [...capture.items].sort((a, b) => a.t - b.t);
const pick = (re: RegExp) => items.filter((i) => re.test(i.endpoint));
const heads = pick(/\/backend-api\/conversations\/:id\?/);
const older = pick(/\/backend-api\/conversations\/:id\/messages\?/);
const versions = pick(/\/backend-api\/conversations\/:id\/versions\?/);
if (heads.length !== 1) throw new Error(`expected one conversations/:id response, found ${heads.length}`);

const MARKER = /\ue200[^\ue200\ue201]*\ue201/g;
const IS_MARKER = /^\ue200[^\ue200\ue201]*\ue201$/;
const KEEP_MESSAGE_KEYS = ['id', 'author', 'create_time', 'update_time', 'content', 'recipient', 'channel', 'weight', 'status', 'end_turn', 'metadata'];
const KEEP_METADATA_KEYS = ['parent_id', 'turn_exchange_id', 'message_type', 'has_versions', 'is_visually_hidden_from_conversation', 'model_slug'];
const KEEP_HEAD_KEYS = ['conversation_id', 'create_time', 'update_time', 'current_node', 'default_model_slug', 'gizmo_id', 'gizmo_type', 'is_archived', 'page_info'];

const head = heads[0]!.body as Obj;
const shift = Math.floor(head.create_time as number) - 1_700_000_000;
const time = (v: Json) => (typeof v === 'number' ? Math.round((v - shift) * 1000) / 1000 : v);
const sources = new Map<string, number>();
const source = (url: string) => {
  if (!sources.has(url)) sources.set(url, sources.size + 1);
  const k = sources.get(url)!;
  return { title: `Source ${k}`, url: `https://example.com/source-${k}`, attribution: 'example.com' };
};
let counter = 0;

function message(m: Obj): Obj {
  const out: Obj = {};
  for (const k of KEEP_MESSAGE_KEYS) if (k in m) out[k] = m[k]!;
  out.create_time = time(m.create_time ?? null);
  out.update_time = time(m.update_time ?? null);
  const author = m.author as Obj;
  out.author = { role: author.role!, name: author.name === 'web.run' ? 'web.run' : null, metadata: {} };
  const md = (m.metadata ?? {}) as Obj;
  const meta: Obj = {};
  for (const k of KEEP_METADATA_KEYS) if (k in md) meta[k] = md[k]!;
  const { content, text } = scrubContent(m.content as Obj, author.role as string);
  out.content = content;
  if (Array.isArray(md.content_references)) meta.content_references = md.content_references.map((r) => reference(r as Obj, text));
  if (Array.isArray(md.attachments)) {
    meta.attachments = md.attachments.map((a, i) => ({ id: (a as Obj).id!, name: `attachment-${i + 1}`, mime_type: (a as Obj).mime_type ?? null }));
  }
  out.metadata = meta;
  return out;
}

function scrubContent(c: Obj, role: string): { content: Obj; text: string } {
  const n = ++counter;
  switch (c.content_type) {
    case 'text': {
      const parts = (c.parts as Json[]).map((p) => {
        if (typeof p !== 'string' || p === '') return p;
        const markers = p.match(MARKER) ?? [];
        const base = role === 'user' ? `Question ${n}.` : role === 'tool' ? `Tool output ${n}.` : `Answer text ${n} with **bold**, \`code\` and $x^2$.`;
        return [base, ...markers.map((mk, i) => ` Claim ${i + 1} ${mk}`)].join('');
      });
      return { content: { content_type: 'text', parts }, text: parts.filter((p) => typeof p === 'string').join('') };
    }
    case 'thoughts': {
      const thoughts = (c.thoughts as Obj[]).map((t, i) => ({
        summary: t.summary ? `Thought summary ${n}.${i + 1}` : t.summary ?? null,
        // A sentinel: tests assert raw thought content never reaches the normalized model (rule 10).
        content: 'RAW THOUGHT CONTENT, NEVER EXPORTED',
        chunks: [],
        finished: t.finished ?? true,
      }));
      return { content: { content_type: 'thoughts', thoughts, source_analysis_msg_id: c.source_analysis_msg_id ?? null }, text: '' };
    }
    case 'reasoning_recap': {
      const keep = typeof c.content === 'string' && /^(Worked|Thought) for \d+ ?[a-z]+$/.test(c.content);
      return { content: { content_type: 'reasoning_recap', content: keep ? c.content! : 'Reasoning recap' }, text: '' };
    }
    case 'code':
      return { content: { content_type: 'code', language: c.language ?? null, response_format_name: null, text: `{"query":"placeholder ${n}"}` }, text: '' };
    case 'model_editable_context':
      return { content: { content_type: 'model_editable_context', model_set_context: 'Placeholder memory context.', repository: null, repo_summary: null, structured_context: null }, text: '' };
    default:
      throw new Error(`content_type "${String(c.content_type)}" has no scrubber yet; add one before using this capture`);
  }
}

function reference(r: Obj, text: string): Obj {
  const out: Obj = { type: r.type!, matched_text: r.matched_text ?? null, alt: null };
  const mt = typeof r.matched_text === 'string' ? r.matched_text : '';
  if (IS_MARKER.test(mt) || mt === ' ') {
    const at = mt === ' ' ? text.length : text.indexOf(mt);
    out.start_idx = at;
    out.end_idx = at + mt.length;
  } else {
    out.matched_text = ''; // a non-marker match would be real text
  }
  const items = Array.isArray(r.items) ? r.items.map((i) => source((i as Obj).url as string)) : undefined;
  const srcs = Array.isArray(r.sources) ? r.sources.map((i) => source((i as Obj).url as string)) : undefined;
  if (items) out.items = items;
  if (srcs) out.sources = srcs;
  if (typeof r.alt === 'string' && r.alt !== '' && items?.[0]) out.alt = `([${items[0].title}](${items[0].url}))`;
  return out;
}

function page(body: Obj, keys: string[]): Obj {
  const out: Obj = {};
  for (const k of keys) if (k in body) out[k] = body[k]!;
  out.messages = (body.messages as Obj[]).map(message);
  out.page_info = body.page_info!;
  return out;
}

const conversation = page(head, KEEP_HEAD_KEYS);
conversation.title = title;
conversation.create_time = time(head.create_time!);
conversation.update_time = time(head.update_time!);
const olderPages = older.map((o) => page(o.body as Obj, []));

// The capture records endpoint templates, not query values, so the versions call's message_id is recovered as the
// has_versions message on the path that the response shares, or the only has_versions message.
const flagged = [conversation, ...olderPages].flatMap((p) => p.messages as Obj[]).filter((m) => (m.metadata as Obj).has_versions === true);
const versionMap: Obj = {};
for (const v of versions) {
  const ids = new Set((v.body as Obj[][]).flat().map((m) => m.id));
  const anchor = flagged.find((m) => ids.has(m.id!)) ?? (flagged.length === 1 ? flagged[0] : undefined);
  if (!anchor) throw new Error('cannot tell which message a versions response belongs to');
  versionMap[anchor.id as string] = (v.body as Obj[][]).map((arr) => arr.map(message));
}

const fixture = { conversation, olderPages, versions: versionMap };
const json = JSON.stringify(fixture, null, 2) + '\n';

// Leak check: no original free-text string (6+ chars) may survive. Ids, enums, slugs and other single tokens
// (no spaces or punctuation beyond . _ -) are structural and allowed.
const STRUCTURAL = /^(id|conversation_id|current_node|parent_id|turn_exchange_id|working_turn_id|start_cursor|end_cursor|gizmo_id|role|name|content_type|recipient|channel|status|message_type|type|language|model_slug|default_model_slug|gizmo_type|reasoning_status|source_analysis_msg_id|matched_text|mime_type)$/;
const leaks: string[] = [];
const scan = (v: Json, key: string) => {
  if (typeof v === 'string') {
    if (v.length >= 6 && !STRUCTURAL.test(key) && !/^[\w.-]+$/.test(v) && !/^(Worked|Thought) for /.test(v) && json.includes(JSON.stringify(v).slice(1, -1))) leaks.push(`${key}: ${v.slice(0, 20)}…`);
  } else if (Array.isArray(v)) v.forEach((x) => scan(x, key));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scan(x, k);
};
for (const i of [...heads, ...older, ...versions]) scan(i.body, '');
if (leaks.length) {
  console.error(`refusing to write: ${leaks.length} original strings survived, e.g.\n  ${leaks.slice(0, 5).join('\n  ')}`);
  process.exit(2);
}
writeFileSync(output, json);
console.log(`wrote ${output}: ${(conversation.messages as Json[]).length} + ${olderPages.map((p) => (p.messages as Json[]).length).join(' + ')} messages, ${Object.keys(versionMap).length} versions response(s)`);
