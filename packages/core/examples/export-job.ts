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
  documentFileName,
  emptyManifest,
  jobProgress,
  parseManifest,
  planIncrementalExport,
  parseConversation,
  recordExport,
  renderMarkdown,
  runExportJob,
  serializeManifest,
  settingsKey,
  type Conversation,
} from '@echoes/core';

const sample = parseConversation(JSON.parse(readFileSync(new URL('./sample-conversation.json', import.meta.url), 'utf8')));
const chats: Conversation[] = [sample, { ...sample, id: 'c-copy', title: sample.title }]; // same title: names must not collide

async function exportAll(sink: MemorySink, store: MemoryStore, jobId: string): Promise<string> {
  const settings = { format: 'markdown', flavor: 'github' };
  const key = settingsKey(settings);
  const text = await sink.readText(MANIFEST_PATH);
  let manifest = text === undefined ? emptyManifest() : parseManifest(text);

  const plan = planIncrementalExport(manifest, chats, key);
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
      const file = documentFileName(manifest, chat, '.md', taken);
      await sink.write(file, renderMarkdown(chat));
      manifest = recordExport(manifest, chat.id, { title: chat.title, updatedAt: chat.updatedAt, settingsKey: key, files: [file] });
      await sink.write(MANIFEST_PATH, serializeManifest(manifest)); // after each chat, so a crash loses nothing done
      return { files: [file] };
    },
  });
  const p = jobProgress(final);
  return `${jobId}: ${p.done} exported, ${p.skipped} unchanged; files: ${[...sink.files.keys()].sort().join(', ')}`;
}

export async function main(): Promise<string[]> {
  const sink = new MemorySink();
  const store = new MemoryStore();
  return [await exportAll(sink, store, 'first-run'), await exportAll(sink, store, 'second-run')];
}

if (import.meta.url === `file://${process.argv[1]}`) console.log((await main()).join('\n'));
