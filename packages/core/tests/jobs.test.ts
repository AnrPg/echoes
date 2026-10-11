import { describe, expect, it } from 'vitest';
import {
  JobCheckpointError,
  JobCheckpoints,
  MemoryStore,
  SchedulerCancelledError,
  STORE_COLLECTIONS,
  cancelExportJob,
  createExportJob,
  isJobFinished,
  jobProgress,
  retryFailed,
  runExportJob,
  type ExportJob,
} from '@echoes/core';

let tick = 0;
const now = () => new Date(Date.UTC(2026, 9, 11, 0, 0, tick++)).toISOString();

function setup(ids = ['c1', 'c2', 'c3']) {
  const store = new MemoryStore();
  const checkpoints = new JobCheckpoints(store);
  const job = createExportJob({ id: 'job-1', now: now(), conversations: ids.map((id) => ({ id, title: id.toUpperCase() })) });
  return { store, checkpoints, job };
}

describe('export jobs', () => {
  it('creates items in order, drops duplicate ids and marks skipped chats', () => {
    const job = createExportJob({ id: 'j', now: now(), conversations: [{ id: 'a' }, { id: 'b', skip: true }, { id: 'a' }] });
    expect(job.items.map((i) => [i.conversationId, i.status])).toEqual([['a', 'pending'], ['b', 'skipped']]);
    expect(jobProgress(job)).toEqual({ total: 2, pending: 1, done: 0, failed: 0, skipped: 1 });
  });

  it('runs every chat once, records files and failures, and checkpoints after each', async () => {
    const { checkpoints, job } = setup();
    const seen: string[] = [];
    const final = await runExportJob(job, {
      checkpoints,
      now,
      onProgress: (j) => seen.push(`${jobProgress(j).done}/${jobProgress(j).failed}`),
      exportOne: async (item) => {
        if (item.conversationId === 'c2') throw new Error('boom');
        return { files: [`${item.title}.md`] };
      },
    });
    expect(final.items.map((i) => i.status)).toEqual(['done', 'failed', 'done']);
    expect(final.items[0]!.files).toEqual(['C1.md']);
    expect(final.items[1]!.error).toBe('Error: boom');
    expect(isJobFinished(final)).toBe(true);
    expect(await checkpoints.load('job-1')).toEqual(final);
    expect(seen).toEqual(['0/0', '1/0', '1/0', '1/1', '1/1', '2/1']); // start and end of each chat
  });

  it('resumes after a stop: the interrupted chat stays pending and runs again', async () => {
    const { checkpoints, job } = setup();
    await expect(
      runExportJob(job, {
        checkpoints,
        now,
        exportOne: async (item) => {
          if (item.conversationId === 'c2') throw new SchedulerCancelledError();
          return { files: [] };
        },
      }),
    ).rejects.toBeInstanceOf(SchedulerCancelledError);

    const saved = (await checkpoints.load('job-1'))!;
    expect(saved.items.map((i) => [i.status, i.attempts])).toEqual([['done', 1], ['pending', 1], ['pending', 0]]);

    const ran: string[] = [];
    const final = await runExportJob(saved, { checkpoints, now, exportOne: async (i) => (ran.push(i.conversationId), { files: [] }) });
    expect(ran).toEqual(['c2', 'c3']);
    expect(final.items[1]!.attempts).toBe(2);
  });

  it('treats an AbortError as a stop too', async () => {
    const { checkpoints, job } = setup(['c1']);
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(runExportJob(job, { checkpoints, now, exportOne: async () => { throw abort; } })).rejects.toBe(abort);
    expect((await checkpoints.load('job-1'))!.items[0]!.status).toBe('pending');
  });

  it('a cancel saved while the job runs stops it before the next chat and is never overwritten', async () => {
    const { checkpoints, job } = setup();
    const ran: string[] = [];
    const final = await runExportJob(job, {
      checkpoints,
      now,
      exportOne: async (item, current) => {
        ran.push(item.conversationId);
        if (item.conversationId === 'c1') await cancelExportJob(current, checkpoints, now()); // the Cancel button
        return { files: [] };
      },
    });
    expect(ran).toEqual(['c1']);
    expect(final.cancelled).toBe(true);
    expect(isJobFinished(final)).toBe(true);
  });

  it('a cancel that also cancels the scheduler stays cancelled in the checkpoint', async () => {
    const { checkpoints, job } = setup();
    await expect(
      runExportJob(job, {
        checkpoints,
        now,
        exportOne: async (_item, current) => {
          await cancelExportJob(current, checkpoints, now());
          throw new SchedulerCancelledError();
        },
      }),
    ).rejects.toBeInstanceOf(SchedulerCancelledError);
    expect((await checkpoints.load('job-1'))!.cancelled).toBe(true);
  });

  it('does nothing for a cancelled job, and retryFailed reopens failed chats only', async () => {
    const { checkpoints, job } = setup(['c1', 'c2']);
    const failed: ExportJob = { ...job, items: [{ ...job.items[0]!, status: 'failed', error: 'x', attempts: 1 }, { ...job.items[1]!, status: 'done', attempts: 1 }] };
    const retried = retryFailed({ ...failed, cancelled: true }, now());
    expect(retried.cancelled).toBe(false);
    expect(retried.items[0]).toEqual({ conversationId: 'c1', title: 'C1', status: 'pending', attempts: 1 });
    expect(retried.items[1]!.status).toBe('done');
    const cancelled = await cancelExportJob(job, checkpoints, now());
    let called = false;
    await runExportJob(cancelled, { checkpoints, now, exportOne: async () => ((called = true), { files: [] }) });
    expect(called).toBe(false);
  });

  it('refuses a corrupt checkpoint instead of starting over', async () => {
    const { store, checkpoints } = setup();
    await store.put(STORE_COLLECTIONS.jobs, 'bad', { version: 9 });
    await expect(checkpoints.load('bad')).rejects.toBeInstanceOf(JobCheckpointError);
    expect(await checkpoints.load('none')).toBeUndefined();
    expect(await checkpoints.list()).toEqual(['bad']);
    await checkpoints.remove('bad');
    expect(await checkpoints.list()).toEqual([]);
  });
});
