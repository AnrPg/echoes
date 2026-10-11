// A resumable, incremental bulk export, the way a host wires it: job checkpoints in a Store, files and
// manifest.json in an OutputSink. Memory implementations stand in for IndexedDB and a real folder.
// Run: node examples/export-job.ts
import { readFileSync } from 'node:fs';
import {
  JobCheckpoints,
  MANIFEST_PATH,
  MemorySink,
  MemoryStore,
  createExportJob,
  contentFingerprint,
  documentFileName,
  emptyManifest,
  exportSettingsKey,
  isContentUnchanged,
  jobProgress,
  parseManifest,
  planIncrementalExport,
  parseConversation,
  recordExport,
  renderMarkdown,
  runExportJob,
  serializeManifest,
  type Conversation,
  type PlanOptions,
} from '@echoes/core';

const sample = parseConversation(JSON.parse(readFileSync(new URL('./sample-conversation.json', import.meta.url), 'utf8')));
const chats: Conversation[] = [sample, { ...sample, id: 'c-copy', title: sample.title }]; // same title: names must not collide

async function exportAll(sink: MemorySink, store: MemoryStore, jobId: string, options: PlanOptions = {}): Promise<string> {
  const settings = { format: 'markdown', flavor: 'github' };
  const key = exportSettingsKey(settings); // includes RENDER_FORMAT_VERSION, so an Echoes output change re-exports
  const text = await sink.readText(MANIFEST_PATH);
  let manifest = text === undefined ? emptyManifest() : parseManifest(text);
  let verified = 0;

  const plan = planIncrementalExport(manifest, chats, key, options);
  const checkpoints = new JobCheckpoints(store);
  const job = createExportJob({
    id: jobId,
    now: '2026-10-11T00:00:00Z',
    settings,
    conversations: [...plan.toExport, ...plan.unchanged.map((c) => ({ ...c, skip: true }))],
  });
  const taken = new Set<string>();
  const final = await runExportJob(job, {
    checkpoints,
    now: () => '2026-10-11T00:00:01Z',
    exportOne: async (item) => {
      const chat = chats.find((c) => c.id === item.conversationId)!; // a real host fetches it through the scheduler
      const contentHash = contentFingerprint(chat);
      const previous = manifest.conversations[chat.id];
      const record = { title: chat.title, updatedAt: chat.updatedAt, activeLeafId: chat.activeLeafId, settingsKey: key, contentHash };
      if (previous && isContentUnchanged(previous, key, contentHash)) {
        // Re-checked and identical: keep the files, only note that it was verified.
        verified++;
        manifest = recordExport(manifest, chat.id, { ...record, files: previous.files, exportedAt: '2026-11-11T00:00:00Z' });
        await sink.write(MANIFEST_PATH, serializeManifest(manifest));
        return { files: previous.files };
      }
      const file = documentFileName(manifest, chat, '.md', taken);
      await sink.write(file, renderMarkdown(chat));
      manifest = recordExport(manifest, chat.id, { ...record, files: [file], exportedAt: '2026-10-11T00:00:01Z' });
      await sink.write(MANIFEST_PATH, serializeManifest(manifest)); // after each chat, so a crash loses nothing done
      return { files: [file] };
    },
  });
  const p = jobProgress(final);
  return `${jobId}: ${p.done - verified} written, ${verified} re-checked and unchanged, ${p.skipped} skipped; files: ${[...sink.files.keys()].sort().join(', ')}`;
}

export async function main(): Promise<string[]> {
  const sink = new MemorySink();
  const store = new MemoryStore();
  return [
    await exportAll(sink, store, 'first-run'),
    await exportAll(sink, store, 'second-run'),
    // A month later: verify anything not checked since, in case a chat changed without its updatedAt moving.
    await exportAll(sink, store, 'recheck-run', { recheckBefore: '2026-11-01T00:00:00Z' }),
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) console.log((await main()).join('\n'));
