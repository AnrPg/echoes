import { z } from 'zod';
import { SchedulerCancelledError } from '../queue/scheduler.ts';
import { STORE_COLLECTIONS, type Store } from '../store/store.ts';

/**
 * Resumable export jobs. A job is the list of chats a bulk export will write, with each chat's outcome. It is
 * checkpointed to a {@link Store} after every chat, so closing the tab, a crash or a pause loses at most the chat in
 * progress, and a restart continues where it stopped.
 *
 * Everything here is host-agnostic: the host supplies the store and the function that exports one chat (fetch
 * through the scheduler, render, write to the sink).
 *
 * @packageDocumentation
 */

/** `pending`: not exported yet (or interrupted). `skipped`: unchanged since the last export (incremental). */
export const JobItemStatusSchema = z.enum(['pending', 'done', 'failed', 'skipped']);

export const JobItemSchema = z.object({
  conversationId: z.string().min(1),
  /** For progress display only. */
  title: z.string().optional(),
  status: JobItemStatusSchema,
  /** How many times exporting this chat was started. */
  attempts: z.number().int().min(0),
  /** Last error message, for the end-of-job report. */
  error: z.string().optional(),
  /** Files written for this chat, as sink paths. */
  files: z.array(z.string()).optional(),
});

export const ExportJobSchema = z.object({
  /** Checkpoint format version. */
  version: z.literal(1),
  id: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  /** Opaque export settings the host needs to resume the job the same way (format, flavor, preset, target). */
  settings: z.record(z.string(), z.unknown()),
  /** In export order. */
  items: z.array(JobItemSchema),
  cancelled: z.boolean(),
});

export type JobItemStatus = z.infer<typeof JobItemStatusSchema>;
export type JobItem = z.infer<typeof JobItemSchema>;
export type ExportJob = z.infer<typeof ExportJobSchema>;

/** Thrown when a stored checkpoint does not match the current format. Never silently replaced by a fresh job. */
export class JobCheckpointError extends Error {
  override readonly name = 'JobCheckpointError';
}

export interface NewExportJob {
  id: string;
  /** ISO time; core has no clock of its own here, so the host passes it. */
  now: string;
  conversations: readonly { id: string; title?: string; skip?: boolean }[];
  settings?: Record<string, unknown>;
}

/**
 * A new job. Duplicate conversation ids are dropped (first one wins), so a chat is never exported twice in a job.
 * `skip: true` items start as `skipped` (see `planIncrementalExport`).
 *
 * @example
 * ```ts
 * const job = createExportJob({ id: 'job-1', now: new Date().toISOString(), conversations: [{ id: 'c1' }, { id: 'c2' }] });
 * ```
 */
export function createExportJob(input: NewExportJob): ExportJob {
  const seen = new Set<string>();
  const items: JobItem[] = [];
  for (const c of input.conversations) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const item: JobItem = { conversationId: c.id, status: c.skip ? 'skipped' : 'pending', attempts: 0 };
    if (c.title !== undefined) item.title = c.title;
    items.push(item);
  }
  return ExportJobSchema.parse({
    version: 1,
    id: input.id,
    createdAt: input.now,
    updatedAt: input.now,
    settings: input.settings ?? {},
    items,
    cancelled: false,
  });
}

/** Counts per status, plus `total`. */
export interface JobProgress {
  total: number;
  pending: number;
  done: number;
  failed: number;
  skipped: number;
}

/** @example `jobProgress(job).done / jobProgress(job).total` */
export function jobProgress(job: ExportJob): JobProgress {
  const p: JobProgress = { total: job.items.length, pending: 0, done: 0, failed: 0, skipped: 0 };
  for (const item of job.items) p[item.status]++;
  return p;
}

/** A job is finished when nothing is pending or it was cancelled. Failed items do not keep it open. */
export function isJobFinished(job: ExportJob): boolean {
  return job.cancelled || job.items.every((i) => i.status !== 'pending');
}

/**
 * The same job with failed items set back to pending, for a "Retry failed" button. Attempts are kept.
 */
export function retryFailed(job: ExportJob, now: string): ExportJob {
  return {
    ...job,
    updatedAt: now,
    cancelled: false,
    items: job.items.map((i) => {
      if (i.status !== 'failed') return i;
      const { error: _error, ...rest } = i;
      return { ...rest, status: 'pending' as const };
    }),
  };
}

/** Reads and writes job checkpoints in a {@link Store} (collection `echoes:jobs`). */
export class JobCheckpoints {
  private readonly store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  async save(job: ExportJob): Promise<void> {
    await this.store.put(STORE_COLLECTIONS.jobs, job.id, ExportJobSchema.parse(job));
  }

  /**
   * The stored job, or `undefined` if there is none.
   * @throws JobCheckpointError when the stored value is not a valid checkpoint.
   */
  async load(id: string): Promise<ExportJob | undefined> {
    const raw = await this.store.get(STORE_COLLECTIONS.jobs, id);
    if (raw === undefined) return undefined;
    const r = ExportJobSchema.safeParse(raw);
    if (!r.success) {
      const issues = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new JobCheckpointError(`stored job "${id}" is not a valid checkpoint: ${issues}`);
    }
    return r.data;
  }

  /** Ids of all stored jobs, sorted. */
  list(): Promise<string[]> {
    return this.store.keys(STORE_COLLECTIONS.jobs);
  }

  remove(id: string): Promise<void> {
    return this.store.delete(STORE_COLLECTIONS.jobs, id);
  }
}

/** What the host's per-chat export returns: the sink paths it wrote. */
export interface ExportOneResult {
  files: string[];
}

export interface RunExportJobOptions {
  checkpoints: JobCheckpoints;
  /**
   * Export one chat: fetch it through the scheduler, render, write to the sink. Throw to mark the chat failed and
   * move on. Throw (or let the scheduler throw) `SchedulerCancelledError`, or an `AbortError`, to stop the whole job
   * with the chat left pending.
   */
  exportOne: (item: JobItem, job: ExportJob) => Promise<ExportOneResult>;
  /** ISO time for `updatedAt`. Usually `() => new Date().toISOString()`. */
  now: () => string;
  /** Called after each checkpoint, for a progress bar. */
  onProgress?: (job: ExportJob) => void;
}

/**
 * Run a job until nothing is pending, checkpointing after every chat. Chats run one at a time, in order; politeness
 * (throttling, pausing on 401 or a bot check) is the scheduler's job inside `exportOne`, so a pause simply keeps this
 * loop waiting.
 *
 * Interrupted chats stay `pending` and are retried when the job runs again; their `attempts` count shows it.
 * Stopping (cancel or abort) checkpoints first and then rethrows, so the caller can tell a stop from a finish.
 * A job cancelled with {@link cancelExportJob} while running stops before its next chat and stays cancelled.
 *
 * @returns the final job.
 *
 * @example
 * ```ts
 * const job = (await checkpoints.load(id)) ?? createExportJob({ id, now: new Date().toISOString(), conversations });
 * await runExportJob(job, { checkpoints, now: () => new Date().toISOString(), exportOne: (item) => exportChat(item.conversationId) });
 * ```
 */
export async function runExportJob(job: ExportJob, options: RunExportJobOptions): Promise<ExportJob> {
  const { checkpoints, exportOne, now, onProgress } = options;
  let current = job;
  // A "Cancel" button saves `cancelled` through cancelExportJob while this loop runs. Every save reads it back first,
  // so the loop never overwrites the cancellation with its own copy, and stops before the next chat.
  const save = async (next: ExportJob) => {
    const cancelled = next.cancelled || (await checkpoints.load(next.id))?.cancelled === true;
    current = { ...next, cancelled };
    await checkpoints.save(current);
    onProgress?.(current);
  };
  if (current.cancelled) return current;

  for (let index = 0; index < current.items.length; index++) {
    const item = current.items[index]!;
    if (item.status !== 'pending') continue;
    if (current.cancelled) return current;

    const started: JobItem = { ...item, attempts: item.attempts + 1 };
    await save(replaceItem(current, index, started, now()));
    try {
      const { files } = await exportOne(started, current);
      const { error: _error, ...rest } = started;
      await save(replaceItem(current, index, { ...rest, status: 'done', files: [...files] }, now()));
    } catch (e) {
      if (isStop(e)) {
        await save({ ...current, updatedAt: now() }); // the chat stays pending
        throw e;
      }
      const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      await save(replaceItem(current, index, { ...started, status: 'failed', error }, now()));
    }
  }
  return current;
}

/** Mark a job cancelled and checkpoint it, for a "Cancel" button that also discards the remaining chats. */
export async function cancelExportJob(job: ExportJob, checkpoints: JobCheckpoints, now: string): Promise<ExportJob> {
  const next = { ...job, cancelled: true, updatedAt: now };
  await checkpoints.save(next);
  return next;
}

function replaceItem(job: ExportJob, index: number, item: JobItem, now: string): ExportJob {
  const items = job.items.slice();
  items[index] = item;
  return { ...job, items, updatedAt: now };
}

function isStop(e: unknown): boolean {
  return e instanceof SchedulerCancelledError || (e instanceof Error && e.name === 'AbortError');
}
