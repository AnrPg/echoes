import type { ChatListItem } from '@echoes/adapter-chatgpt-api';
import { MARKDOWN_FLAVORS, TURN_PRESETS, jobProgress, type ExportJob, type SchedulerEvent } from '@echoes/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ExportReport } from '../../export/run';
import type { SelfTestResult } from '../../export/self-test';
import { DEFAULT_PAGE_SETTINGS, type ChatGroup, type ExportController, type OutputTarget, type PageSettings } from './controller';

const PRESET_NAMES: Record<keyof typeof TURN_PRESETS, string> = {
  fullArchive: 'Full archive',
  answersOnly: 'Answers only',
  studyNotes: 'Study notes',
};

type Busy = { what: string } | undefined;

export function App({ controller, chatId }: { controller: ExportController; chatId: string | undefined }) {
  const [connected, setConnected] = useState<boolean | undefined>(undefined);
  const [settings, setSettings] = useState<PageSettings>(DEFAULT_PAGE_SETTINGS);
  const [busy, setBusy] = useState<Busy>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [paused, setPaused] = useState<string | undefined>(undefined);
  const [check, setCheck] = useState<SelfTestResult | undefined>(undefined);
  const [groups, setGroups] = useState<ChatGroup[] | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState({ text: '', from: '', to: '' });
  const [reexportAll, setReexportAll] = useState(false);
  const [job, setJob] = useState<ExportJob | undefined>(undefined);
  const [report, setReport] = useState<ExportReport | undefined>(undefined);
  const [unfinished, setUnfinished] = useState<ExportJob[]>([]);

  useEffect(() => {
    void controller.findTab().then(setConnected);
    void controller.loadSettings().then(setSettings);
    void controller.unfinishedJobs().then(setUnfinished);
    return controller.onQueueEvent((e: SchedulerEvent) => {
      if (e.type === 'paused') {
        setPaused(e.reason === 'auth' ? 'ChatGPT logged you out. Log in again in the ChatGPT tab, then press Resume.' : 'ChatGPT is showing a security check. Complete it in the ChatGPT tab, then press Resume.');
      }
      if (e.type === 'resumed') setPaused(undefined);
    });
  }, []);

  const update = (patch: Partial<PageSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void controller.saveSettings(next);
  };

  async function guard(what: string, fn: () => Promise<void>) {
    setBusy({ what });
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
      setUnfinished(await controller.unfinishedJobs());
    }
  }

  const visible = useMemo(() => {
    if (!groups) return [];
    const text = filter.text.trim().toLowerCase();
    const from = filter.from ? Date.parse(filter.from) : -Infinity;
    const to = filter.to ? Date.parse(filter.to) + 86_400_000 : Infinity;
    return groups
      .map((g) => ({
        ...g,
        chats: g.chats.filter((c) => (!text || c.title.toLowerCase().includes(text)) && Date.parse(c.updatedAt) >= from && Date.parse(c.updatedAt) < to),
      }))
      .filter((g) => g.chats.length > 0);
  }, [groups, filter]);

  const setMany = (chats: ChatListItem[], on: boolean) => {
    const next = new Set(selected);
    for (const c of chats) on ? next.add(c.id) : next.delete(c.id);
    setSelected(next);
  };

  async function chooseTarget(): Promise<OutputTarget | undefined> {
    return (await controller.pickFolder()) ?? (await controller.zipTarget());
  }

  const allChats = groups?.flatMap((g) => g.chats) ?? [];
  const chosen = allChats.filter((c) => selected.has(c.id));
  const progress = job ? jobProgress(job) : undefined;

  return (
    <main>
      <h1>Echoes</h1>
      <p class="muted">Exports your ChatGPT chats to files on this computer. Nothing is sent anywhere else.</p>

      {connected === false && (
        <p class="warn">
          No ChatGPT tab is open. Open <a href="https://chatgpt.com/" target="_blank">chatgpt.com</a>, log in, then{' '}
          <button onClick={() => void controller.findTab().then(setConnected)}>Try again</button>
        </p>
      )}
      {paused && (
        <p class="warn">
          {paused} <button onClick={() => controller.scheduler.resume()}>Resume</button>
        </p>
      )}
      {error && <p class="warn">{error}</p>}
      {busy && <p class="muted">{busy.what}…</p>}

      <section>
        <h2>Settings</h2>
        <div class="grid">
          <label>
            Format{' '}
            <select value={settings.format} onChange={(e) => update({ format: (e.target as HTMLSelectElement).value as PageSettings['format'] })}>
              <option value="markdown">Markdown</option>
              <option value="json">Echoes JSON</option>
            </select>
          </label>
          <label>
            Markdown style{' '}
            <select disabled={settings.format !== 'markdown'} value={settings.flavor} onChange={(e) => update({ flavor: (e.target as HTMLSelectElement).value as PageSettings['flavor'] })}>
              {MARKDOWN_FLAVORS.map((f) => (
                <option value={f}>{f === 'github' ? 'GitHub' : f === 'obsidian' ? 'Obsidian' : 'CommonMark'}</option>
              ))}
            </select>
          </label>
          <label>
            Include{' '}
            <select value={settings.preset} onChange={(e) => update({ preset: (e.target as HTMLSelectElement).value as PageSettings['preset'] })}>
              {Object.entries(PRESET_NAMES).map(([k, v]) => (
                <option value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={settings.attachments} onChange={(e) => update({ attachments: (e.target as HTMLInputElement).checked })} /> Save uploads and images
          </label>
          <label title="Chats can change without their date moving. Echoes fetches chats again after this many days to make sure.">
            Re-check chats every{' '}
            <input type="number" min={0} max={365} value={settings.recheckDays} style={{ width: '4em' }} onChange={(e) => update({ recheckDays: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} /> days
          </label>
        </div>
        <p class="muted small">"Reasoning" means the summaries ChatGPT shows, never raw chain of thought.</p>
      </section>

      <section>
        <h2>Check compatibility</h2>
        <p class="muted small">Fetches one chat the way an export would and says whether ChatGPT's format still matches.</p>
        <button disabled={!!busy || !connected} onClick={() => guard('Checking', async () => setCheck(await controller.selfTest(chatId)))}>
          Run check
        </button>
        {check && (
          <ul class="checks">
            {check.checks.map((c) => (
              <li class={c.ok ? 'ok' : 'warn'}>
                <strong>{c.ok ? '✓' : '✗'} {c.name}:</strong> {c.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      {chatId && (
        <section>
          <h2>This chat</h2>
          <button disabled={!!busy || !connected} onClick={() => guard('Exporting this chat', async () => setReport(await controller.exportOne(chatId, settings)))}>
            Export this chat
          </button>
        </section>
      )}

      {unfinished.length > 0 && (
        <section>
          <h2>Unfinished exports</h2>
          {unfinished.map((j) => {
            const p = jobProgress(j);
            return (
              <p>
                Started {new Date(j.createdAt).toLocaleString()}: {p.done + p.skipped} of {p.total} done.{' '}
                <button
                  disabled={!!busy || !connected}
                  onClick={() =>
                    guard('Resuming', async () => {
                      const target = await chooseTarget();
                      if (target) setReport(await controller.resume(j.id, target, setJob));
                    })
                  }
                >
                  Resume (pick the same folder)
                </button>{' '}
                <button disabled={!!busy} onClick={() => guard('Removing', () => controller.forget(j.id))}>
                  Discard
                </button>
              </p>
            );
          })}
        </section>
      )}

      <section>
        <h2>Bulk export</h2>
        <button disabled={!!busy || !connected} onClick={() => guard('Loading your chats and Projects', async () => {
          const g = await controller.listGroups();
          setGroups(g);
          setSelected(new Set(g.flatMap((x) => x.chats.map((c) => c.id))));
        })}>
          {groups ? 'Reload chat list' : 'Load chat list'}
        </button>
        {groups && (
          <>
            <div class="bar">
              <input placeholder="Filter by title" value={filter.text} onInput={(e) => setFilter({ ...filter, text: (e.target as HTMLInputElement).value })} />
              <label>
                Updated from <input type="date" value={filter.from} onInput={(e) => setFilter({ ...filter, from: (e.target as HTMLInputElement).value })} />
              </label>
              <label>
                to <input type="date" value={filter.to} onInput={(e) => setFilter({ ...filter, to: (e.target as HTMLInputElement).value })} />
              </label>
              <button onClick={() => setMany(visible.flatMap((g) => g.chats), true)}>Select shown</button>
              <button onClick={() => setMany(visible.flatMap((g) => g.chats), false)}>Clear shown</button>
            </div>
            <div class="list">
              {visible.map((g) => (
                <details open={g.projectId === undefined}>
                  <summary>
                    <input
                      type="checkbox"
                      checked={g.chats.every((c) => selected.has(c.id))}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setMany(g.chats, (e.target as HTMLInputElement).checked)}
                    />{' '}
                    {g.name} ({g.chats.length})
                  </summary>
                  {g.chats.map((c) => (
                    <label class="chat">
                      <input type="checkbox" checked={selected.has(c.id)} onChange={(e) => setMany([c], (e.target as HTMLInputElement).checked)} /> {c.title || 'Untitled'}{' '}
                      <span class="muted small">{c.updatedAt.slice(0, 10)}</span>
                    </label>
                  ))}
                </details>
              ))}
            </div>
            <div class="bar">
              <label title="Ignore what an earlier export in the folder already has">
                <input type="checkbox" checked={reexportAll} onChange={(e) => setReexportAll((e.target as HTMLInputElement).checked)} /> Re-export all, even unchanged chats
              </label>
              <button
                class="primary"
                disabled={!!busy || !connected || chosen.length === 0}
                onClick={() =>
                  guard(`Exporting ${chosen.length} chats`, async () => {
                    const target = await chooseTarget();
                    if (!target) return;
                    setReport(await controller.exportAll(chosen, settings, target, { reexportAll }, setJob));
                  })
                }
              >
                Export {chosen.length} chats
              </button>
              {busy && job && (
                <button onClick={() => void controller.cancel(job)}>Stop after this chat</button>
              )}
            </div>
            <p class="muted small">You pick a folder; re-running into the same folder only exports what changed. Without folder access, Echoes saves a zip.</p>
          </>
        )}
        {progress && (
          <div>
            <progress max={progress.total} value={progress.done + progress.failed + progress.skipped} />{' '}
            {progress.done} exported, {progress.skipped} unchanged, {progress.failed} failed, {progress.pending} left
          </div>
        )}
      </section>

      {report && (
        <section>
          <h2>Result</h2>
          <p>
            {report.job.items.filter((i) => i.status === 'done').length - report.verified.length} written, {report.verified.length} re-checked and
            unchanged, {report.job.items.filter((i) => i.status === 'skipped').length} skipped, {report.job.items.filter((i) => i.status === 'failed').length} failed.
            Details are in echoes-report.json next to the files.
          </p>
          <ul>
            {report.job.items
              .filter((i) => i.status === 'failed' || report.warnings[i.conversationId])
              .map((i) => (
                <li class={i.status === 'failed' ? 'warn' : ''}>
                  {i.title || i.conversationId}: {i.error ?? report.warnings[i.conversationId]!.join('; ')}
                </li>
              ))}
          </ul>
        </section>
      )}

      <footer class="muted small">
        <a href="../inspector.html">Diagnostics</a> (capture API shapes for a bug report)
      </footer>
    </main>
  );
}
