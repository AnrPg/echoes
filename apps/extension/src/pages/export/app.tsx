import type { ChatListItem } from '@echoes/adapter-chatgpt-api';
import { HTML_THEMES, MARKDOWN_FLAVORS, jobProgress, type ExportJob, type HtmlTheme, type SchedulerEvent } from '@echoes/core';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TabContext } from '../../background/routes';
import { appendLog, checkEntry, notesEntry, reportEntry, type LogEntry, type NewLogEntry } from './activity';
import { ActivityLog } from './activity-view';
import { IncludeSelect } from './include';
import { IncrementalExportInfo } from './info';
import { listingText } from './listing';
import { TurnPicker } from './picker';
import { DEFAULT_PAGE_SETTINGS, type ChatGroup, type ExportController, type OutputTarget, type PageSettings } from './controller';

const THEME_NAMES: Record<HtmlTheme, string> = {
  chatgpt: 'Like ChatGPT',
  article: 'Article',
  notes: 'Compact notes',
  print: 'Print-friendly',
};

type Busy = { what: string; chatId?: string | undefined; chatTitle?: string | undefined } | undefined;

export function App({ controller, initialChatId }: { controller: ExportController; initialChatId: string | undefined }) {
  // The chat open in the ChatGPT tab, followed live: every action of "This chat" uses it.
  const [ctx, setCtx] = useState<TabContext | undefined>(undefined);
  const [ctxKnown, setCtxKnown] = useState(false);
  const chatId = ctxKnown ? ctx?.chatId : initialChatId;
  const [connected, setConnected] = useState<boolean | undefined>(undefined);
  const [settings, setSettings] = useState<PageSettings>(DEFAULT_PAGE_SETTINGS);
  const [busy, setBusy] = useState<Busy>(undefined);
  /** What the last export kept differently (not errors: the file was saved). */
  const [log, setLog] = useState<LogEntry[]>([]);
  const logContext = useRef('');
  const [paused, setPaused] = useState<string | undefined>(undefined);
  const [groups, setGroups] = useState<ChatGroup[] | undefined>(undefined);
  const [listing, setListing] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState({ text: '', from: '', to: '' });
  const [reexportAll, setReexportAll] = useState(false);
  const [job, setJob] = useState<ExportJob | undefined>(undefined);
  const [unfinished, setUnfinished] = useState<ExportJob[]>([]);
  const [picking, setPicking] = useState(false);

  useEffect(
    () =>
      controller.watchContext((c) => {
        setCtx(c);
        setCtxKnown(true);
        setConnected(c !== undefined);
      }),
    [],
  );

  // On a Project's page, its name comes from the Project list (the tab title is not reliable for it).
  const projectSegment = ctxKnown && !chatId ? ctx?.projectSegment : undefined;
  const [projectName, setProjectName] = useState<string | undefined>(undefined);
  useEffect(() => {
    setProjectName(undefined);
    if (!projectSegment) return;
    let live = true;
    void controller
      .projectName(projectSegment)
      .then((name) => live && setProjectName(name ?? 'Unknown Project'))
      .catch(() => live && setProjectName('Unknown Project'));
    return () => {
      live = false;
    };
  }, [projectSegment]);


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

  /** What an action started now is about, for the activity log. */
  const here = chatId ? `Chat: ${ctx?.title ?? 'Untitled chat'}` : projectSegment ? `Project: ${projectName ?? 'loading name'}` : 'No chat open';

  /** Add to the activity log, labelled with what the running action is about (or what is open now). */
  function addLog(entry: NewLogEntry, context = logContext.current || here) {
    setLog((l) => appendLog(l, entry, context, Date.now()));
  }

  /** Run one action at a time. `context` labels its log entries; by default, the chat or Project open when it started. */
  async function guard(what: string, fn: () => Promise<void>, context = here) {
    setBusy({ what, chatId, chatTitle: ctx?.title });
    logContext.current = context;
    addLog({ level: 'info', title: what }, context);
    try {
      await fn();
    } catch (e) {
      addLog({ level: 'error', title: `${what} failed: ${e instanceof Error ? e.message : String(e)}` }, context);
    } finally {
      logContext.current = '';
      setBusy(undefined);
      setUnfinished(await controller.unfinishedJobs());
    }
  }

  function load(oneProject: boolean) {
    const segment = oneProject ? projectSegment : undefined;
    const what = segment ? "Loading this Project's chats" : 'Loading your chats and Projects';
    return guard(what, async () => {
      setListing(undefined);
      try {
        const g = await controller.listGroups((p) => setListing(listingText(p, segment !== undefined)), segment);
        setGroups(g);
        setSelected(new Set(g.flatMap((x) => x.chats.map((c) => c.id))));
        const n = g.reduce((sum, x) => sum + x.chats.length, 0);
        addLog({ level: 'ok', title: `Listed ${n} chat${n === 1 ? '' : 's'}${segment ? '' : ` in ${g.length - 1} Projects and outside them`}` });
      } finally {
        setListing(undefined);
      }
    }, segment ? here : 'All chats and Projects');
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

      <div class={`current${chatId || projectSegment ? '' : ' none'}`} role="status" aria-live="polite">
        {chatId ? (
          <>
            <span class="muted small">Chat open in ChatGPT</span>
            <strong>{ctx?.title ?? 'Untitled chat'}</strong>
            <span class="muted small">Everything under "This chat" uses this chat, and follows you when you open another one.</span>
          </>
        ) : projectSegment ? (
          <>
            <span class="muted small">Project open in ChatGPT</span>
            <strong>{projectName ?? 'Loading the Project name…'}</strong>
            <span class="muted small">Open one of its chats to export it alone; Bulk export below lists this Project's chats.</span>
          </>
        ) : (
          <>
            <strong>No chat open</strong>
            <span class="muted small">Open a chat in the ChatGPT tab to export it; bulk export works from any page.</span>
          </>
        )}
        {busy?.chatId && busy.chatId !== chatId && (
          <span class="warn small">
            Still finishing "{busy.what}" on {busy.chatTitle ? `"${busy.chatTitle}"` : 'the chat that was open when you started'}.
          </span>
        )}
      </div>

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

      <section>
        <h2>Settings</h2>
        <div class="grid">
          <label>
            Format{' '}
            <select value={settings.format} onChange={(e) => update({ format: (e.target as HTMLSelectElement).value as PageSettings['format'] })}>
              <option value="markdown">Markdown</option>
              <option value="html">HTML</option>
              <option value="json">Echoes JSON</option>
              <option value="resources">Resources only (files, code, links by turn)</option>
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
          <label title="Also used for Save as PDF">
            Look{' '}
            <select disabled={settings.format !== 'html'} value={settings.theme} onChange={(e) => update({ theme: (e.target as HTMLSelectElement).value as PageSettings['theme'] })}>
              {HTML_THEMES.map((t) => (
                <option value={t}>{THEME_NAMES[t]}</option>
              ))}
            </select>
          </label>
          <div class="field">
            Include <IncludeSelect value={settings.turns} onChange={(turns) => update({ turns })} />
          </div>
          <label title="Edited questions and regenerated answers make other versions of a chat">
            Versions{' '}
            <select value={settings.versions} onChange={(e) => update({ versions: (e.target as HTMLSelectElement).value as PageSettings['versions'] })}>
              <option value="active">Only the one shown in ChatGPT</option>
              <option value="all">All versions</option>
            </select>
          </label>
          <label>
            Other versions go{' '}
            <select disabled={settings.versions !== 'all' || settings.format === 'json' || settings.format === 'resources'} value={settings.branchOutput} onChange={(e) => update({ branchOutput: (e.target as HTMLSelectElement).value as PageSettings['branchOutput'] })}>
              <option value="sections">In the same file</option>
              <option value="files">In one file each</option>
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
        <p class="muted small">Fetches the open chat (or your newest one) the way an export would, and says whether ChatGPT's format still matches and what this chat let it test.</p>
        <button disabled={!!busy || !connected} onClick={() => guard('Checking compatibility', async () => addLog(checkEntry(await controller.selfTest(chatId))))}>
          Run check
        </button>
      </section>

      {chatId && (
        <section>
          <h2>This chat: {ctx?.title ?? 'Untitled chat'}</h2>
          <button disabled={!!busy || !connected} onClick={() => guard('Exporting this chat', async () => addLog(reportEntry(await controller.exportOne(chatId, settings))))}>
            Export this chat
          </button>{' '}
          <button
            disabled={!!busy || !connected}
            onClick={() =>
              guard('Preparing the PDF', async () => {
                const warnings = await controller.printChat(chatId, settings);
                addLog(notesEntry('PDF ready', warnings));
              })
            }
          >
            Save as PDF
          </button>
          <button disabled={!connected} onClick={() => setPicking(!picking)}>
            {picking ? 'Close turn picker' : 'Pick turns…'}
          </button>
          <p class="muted small">Save as PDF opens the print dialog; choose "Save as PDF" there. It uses the Look setting.</p>
          {picking && connected && (
            <TurnPicker
              key={chatId}
              controller={controller}
              chatId={chatId}
              settings={settings}
              busy={!!busy}
              guard={guard}
              onWarnings={(w) => addLog(notesEntry('Done', w))}
            />
          )}
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
                      if (target) addLog(reportEntry(await controller.resume(j.id, target, setJob)));
                    }, 'Bulk export')
                  }
                >
                  Resume (pick the same folder)
                </button>{' '}
                <button disabled={!!busy} onClick={() => guard('Removing an unfinished export', () => controller.forget(j.id), 'Bulk export')}>
                  Discard
                </button>
              </p>
            );
          })}
        </section>
      )}

      <section>
        <h2>Bulk export</h2>
        {projectSegment && (
          <button disabled={!!busy || !connected} onClick={() => load(true)}>
            Load this Project's chats
          </button>
        )}{' '}
        <button disabled={!!busy || !connected} onClick={() => load(false)}>
          {projectSegment ? 'Load all chats and Projects' : groups ? 'Reload chat list' : 'Load chat list'}
        </button>
        {listing && <p class="muted small">{listing}</p>}
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
                <details open={g.projectId === undefined || visible.length === 1}>
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
              <IncrementalExportInfo />
              <button
                class="primary"
                disabled={!!busy || !connected || chosen.length === 0}
                onClick={() =>
                  guard(`Exporting ${chosen.length} chats`, async () => {
                    const target = await chooseTarget();
                    if (!target) return;
                    addLog(reportEntry(await controller.exportAll(chosen, settings, target, { reexportAll }, setJob)));
                  }, 'Bulk export')
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

      <footer class="muted small">
        <a href="./inspector.html">Diagnostics</a> (capture API shapes for a bug report)
      </footer>
      <ActivityLog log={log} busy={busy?.what} onClear={() => setLog([])} />
    </main>
  );
}
