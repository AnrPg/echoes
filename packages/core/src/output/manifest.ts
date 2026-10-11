import { z } from 'zod';
import { safeFileName, uniqueFileName } from './filenames.ts';

/**
 * The export manifest (`manifest.json` at the root of an export folder): which chats the folder holds, at which
 * version, in which files. It makes re-runs incremental: a chat whose `updatedAt` and export settings are unchanged
 * is skipped (see {@link planIncrementalExport} for the extra checks against a stale `updatedAt`). It is a stable, published format (`schemas/export-manifest.v1.schema.json`).
 *
 * @packageDocumentation
 */

/** Where the manifest lives inside an export. */
export const MANIFEST_PATH = 'manifest.json';

export const ManifestEntrySchema = z.object({
  title: z.string(),
  /** The chat's `updatedAt` when it was exported. */
  updatedAt: z.iso.datetime({ offset: true }),
  /** Fingerprint of the export settings used (see {@link settingsKey}); a change re-exports the chat. */
  settingsKey: z.string(),
  /** Files written for the chat, relative to the export root. The first one is the main document. */
  files: z.array(z.string().min(1)).min(1),
  /** The chat's `activeLeafId` when it was exported. A different leaf later means the chat changed. */
  activeLeafId: z.string().min(1).optional(),
  /** {@link contentFingerprint} of the exported conversation, so a re-check can tell whether anything changed. */
  contentHash: z.string().min(1).optional(),
  /** When this entry was last written or verified against the provider. Used by `recheckBefore`. */
  exportedAt: z.iso.datetime({ offset: true }).optional(),
});

export const ExportManifestSchema = z.object({
  /** Manifest format version. */
  manifestVersion: z.literal(1),
  generator: z.literal('echoes'),
  /** By conversation id. */
  conversations: z.record(z.string().min(1), ManifestEntrySchema),
});

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
export type ExportManifest = z.infer<typeof ExportManifestSchema>;

/** Thrown by {@link parseManifest} for a file that is not a valid manifest. */
export class ManifestError extends Error {
  override readonly name = 'ManifestError';
}

export function emptyManifest(): ExportManifest {
  return { manifestVersion: 1, generator: 'echoes', conversations: {} };
}

/**
 * Parse `manifest.json` text. A missing file is the caller's case (use {@link emptyManifest}); a present but
 * broken one throws, because silently starting over would re-export everything and orphan the old files.
 *
 * @throws ManifestError
 */
export function parseManifest(text: string): ExportManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ManifestError(`${MANIFEST_PATH} is not JSON: ${(e as Error).message}`);
  }
  const r = ExportManifestSchema.safeParse(json);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new ManifestError(`${MANIFEST_PATH} is not a valid Echoes manifest: ${issues}`);
  }
  return r.data;
}

/** Manifest JSON with conversations sorted by id and a trailing newline, so the same state gives the same bytes. */
export function serializeManifest(manifest: ExportManifest): string {
  const sorted = Object.fromEntries(Object.keys(manifest.conversations).sort().map((id) => [id, manifest.conversations[id]!]));
  return JSON.stringify({ ...ExportManifestSchema.parse(manifest), conversations: sorted }, null, 2) + '\n';
}

/**
 * A stable fingerprint of export settings: the JSON of `settings` with object keys sorted at every level. Two
 * settings objects with the same content give the same key whatever their key order.
 *
 * @example
 * ```ts
 * settingsKey({ format: 'markdown', flavor: 'obsidian' }) === settingsKey({ flavor: 'obsidian', format: 'markdown' }); // true
 * ```
 */
export function settingsKey(settings: unknown): string {
  return JSON.stringify(settings, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/**
 * Version of what Echoes writes for a chat (renderer output and file layout). Bump it when a release changes the
 * output for the same input; {@link exportSettingsKey} folds it into the settings key, so the next incremental export
 * rewrites every chat in the new format instead of leaving a folder of mixed versions.
 */
export const RENDER_FORMAT_VERSION = 1;

/** {@link settingsKey} of `settings` together with {@link RENDER_FORMAT_VERSION}. Use this one for exports. */
export function exportSettingsKey(settings: unknown): string {
  return settingsKey({ format: RENDER_FORMAT_VERSION, settings });
}

/** One chat as the chat list reports it, before fetching it. */
export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
  /** Only when the host already knows it without fetching the whole chat. A different leaf re-exports the chat. */
  activeLeafId?: string;
}

/** Why a chat is in {@link IncrementalPlan.toExport}. */
export type ExportReason = 'new' | 'updated' | 'settings' | 'leaf-changed' | 'recheck' | 'forced';

/** Which chats an incremental export must write, and which it can skip. Both keep the input order. */
export interface IncrementalPlan {
  toExport: ChatSummary[];
  unchanged: ChatSummary[];
  /** For each chat in `toExport`, the first reason that applied. */
  reasons: Record<string, ExportReason>;
}

export interface PlanOptions {
  /**
   * Re-fetch chats whose entry was last written or verified before this instant (or has no `exportedAt`), even if
   * nothing else says they changed. This catches changes a provider made without moving `updatedAt`. After fetching,
   * {@link isContentUnchanged} tells whether the files need rewriting at all.
   */
  recheckBefore?: string;
  /** Chat ids to export whatever the manifest says (a "Re-export this chat" action). */
  force?: Iterable<string>;
}

/**
 * Compare the chat list with the manifest of the previous export. A chat is unchanged only when it is in the
 * manifest with the same `updatedAt` instant, the same settings key, the same active leaf (when both sides know it),
 * and, with `recheckBefore`, a recent enough `exportedAt`. Times are compared as instants, so `…Z` and `…+00:00`
 * match.
 *
 * `updatedAt` alone is not fully trusted: a provider could change a chat (for example a regeneration that switches
 * the shown branch) without moving it. The defences, from cheapest to most thorough:
 * - {@link RENDER_FORMAT_VERSION} in the settings key re-exports everything after an Echoes output change.
 * - `activeLeafId` on the summary, when the host has it, catches a branch switch.
 * - `recheckBefore` re-fetches old entries; {@link contentFingerprint} then skips rewriting the ones that did not change.
 * - `force` re-exports chosen chats; `emptyManifest()` re-exports all of them.
 *
 * @example
 * ```ts
 * const { toExport, reasons } = planIncrementalExport(manifest, chats, exportSettingsKey(settings), {
 *   recheckBefore: new Date(Date.now() - 30 * 86_400_000).toISOString(), // verify anything older than 30 days
 * });
 * ```
 */
export function planIncrementalExport(
  manifest: ExportManifest,
  chats: readonly ChatSummary[],
  key: string,
  options: PlanOptions = {},
): IncrementalPlan {
  const plan: IncrementalPlan = { toExport: [], unchanged: [], reasons: {} };
  const forced = new Set(options.force ?? []);
  const recheck = options.recheckBefore === undefined ? undefined : Date.parse(options.recheckBefore);
  for (const chat of chats) {
    const reason = exportReason(manifest.conversations[chat.id], chat, key, forced, recheck);
    if (reason === undefined) plan.unchanged.push(chat);
    else {
      plan.toExport.push(chat);
      plan.reasons[chat.id] = reason;
    }
  }
  return plan;
}

function exportReason(
  entry: ManifestEntry | undefined,
  chat: ChatSummary,
  key: string,
  forced: ReadonlySet<string>,
  recheck: number | undefined,
): ExportReason | undefined {
  if (forced.has(chat.id)) return 'forced';
  if (entry === undefined) return 'new';
  if (entry.settingsKey !== key) return 'settings';
  if (Date.parse(entry.updatedAt) !== Date.parse(chat.updatedAt)) return 'updated';
  if (chat.activeLeafId !== undefined && entry.activeLeafId !== undefined && chat.activeLeafId !== entry.activeLeafId) return 'leaf-changed';
  if (recheck !== undefined && (entry.exportedAt === undefined || Date.parse(entry.exportedAt) < recheck)) return 'recheck';
  return undefined;
}

/**
 * A deterministic fingerprint of any JSON value (for example a parsed `Conversation`): 64-bit FNV-1a over the UTF-8
 * of its {@link settingsKey} form, as 16 hex digits. Object key order does not matter. It detects changes; it is not
 * a security hash.
 *
 * @example
 * ```ts
 * contentFingerprint(conversation); // 'a1b2c3d4e5f60718'
 * ```
 */
export function contentFingerprint(value: unknown): string {
  let h = 0xcbf29ce484222325n;
  for (const b of utf8(settingsKey(value) ?? 'undefined')) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n);
  return h.toString(16).padStart(16, '0');
}

/** UTF-8 bytes, without `TextEncoder` (core has no DOM or Node types). JSON text has no lone surrogates. */
function* utf8(text: string): Generator<number> {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) yield c;
    else if (c < 0x800) yield* [0xc0 | (c >> 6), 0x80 | (c & 63)];
    else if (c < 0x10000) yield* [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
    else yield* [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
  }
}

/**
 * After a re-fetch, whether the chat's content is the same as at its last export with the same settings, so its
 * files need not be rewritten (record the entry again with a new `exportedAt` only). False when the entry has no hash.
 */
export function isContentUnchanged(entry: ManifestEntry | undefined, key: string, hash: string): boolean {
  return entry !== undefined && entry.settingsKey === key && entry.contentHash === hash;
}

/** The manifest with one chat's export recorded (replacing any earlier entry). Inputs are not mutated. */
export function recordExport(manifest: ExportManifest, conversationId: string, entry: ManifestEntry): ExportManifest {
  return { ...manifest, conversations: { ...manifest.conversations, [conversationId]: ManifestEntrySchema.parse(entry) } };
}

/**
 * The file name for a chat's main document: its earlier name if the manifest has one (so re-exports overwrite the
 * same file even after a rename elsewhere collided with it), otherwise its safe title made unique against every file
 * the manifest already lists and the names in `taken`. Adds the result to `taken`.
 *
 * A chat renamed since the last export keeps its old file name; the new title is still in the file's front matter.
 *
 * @example
 * ```ts
 * const taken = new Set<string>();
 * documentFileName(manifest, chat, '.md', taken); // 'My chat.md', or 'My chat (2).md' if that is taken
 * ```
 */
export function documentFileName(manifest: ExportManifest, chat: { id: string; title: string }, extension: string, taken: Set<string>): string {
  const previous = manifest.conversations[chat.id]?.files[0];
  if (previous !== undefined && previous.endsWith(extension)) {
    taken.add(previous);
    return previous;
  }
  for (const [id, entry] of Object.entries(manifest.conversations)) if (id !== chat.id) for (const f of entry.files) taken.add(f);
  return uniqueFileName(safeFileName(chat.title), extension, taken);
}
