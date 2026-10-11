import { z } from 'zod';
import { safeFileName, uniqueFileName } from './filenames.ts';

/**
 * The export manifest (`manifest.json` at the root of an export folder): which chats the folder holds, at which
 * version, in which files. It makes re-runs incremental: a chat whose `updatedAt` and export settings are unchanged
 * is skipped. It is a stable, published format (`schemas/export-manifest.v1.schema.json`).
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

/** One chat as the chat list reports it, before fetching it. */
export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** Which chats an incremental export must write, and which it can skip. Both keep the input order. */
export interface IncrementalPlan {
  toExport: ChatSummary[];
  unchanged: ChatSummary[];
}

/**
 * Compare the chat list with the manifest of the previous export. A chat is unchanged only when it is in the
 * manifest with the same `updatedAt` instant and the same settings key; anything else (new chat, newer edit,
 * different settings) is exported. Times are compared as instants, so `…Z` and `…+00:00` match.
 *
 * Pitfall: this trusts `updatedAt`. If a provider ever changes a chat without bumping it, the chat is skipped; a
 * "Re-export all" option (pass `emptyManifest()`) is the escape hatch.
 *
 * @example
 * ```ts
 * const { toExport, unchanged } = planIncrementalExport(manifest, chats, settingsKey(settings));
 * ```
 */
export function planIncrementalExport(manifest: ExportManifest, chats: readonly ChatSummary[], key: string): IncrementalPlan {
  const plan: IncrementalPlan = { toExport: [], unchanged: [] };
  for (const chat of chats) {
    const entry = manifest.conversations[chat.id];
    const same = entry !== undefined && entry.settingsKey === key && Date.parse(entry.updatedAt) === Date.parse(chat.updatedAt);
    (same ? plan.unchanged : plan.toExport).push(chat);
  }
  return plan;
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
