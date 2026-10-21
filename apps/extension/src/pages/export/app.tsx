import type { ChatListItem } from '@echoes/adapter-chatgpt-api';
import { HTML_THEMES, MARKDOWN_FLAVORS, jobProgress, type ExportJob, type HtmlTheme, type SchedulerEvent } from '@echoes/core';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TabContext } from '../../background/routes';
import { FLAVOR_NAMES, FORMAT_NAMES, canGroupTurns, formatOf, isOneFile, primaryAction, settingsSummary, turnFiles, withFormat, type FormatChoice, type Scope } from './action-model';
import { appendLog, checkEntry, notesEntry, printedEntry, reportEntry, type LogEntry, type NewLogEntry } from './activity';
import { ActivityLog } from './activity-view';
import { HELP, optionTip, type HelpId } from './help';
import { FieldName, Help, IncrementalExportInfo } from './info';
import { listingText } from './listing';
import { defaultMergeTitle, effectiveOrder } from './merge-model';
import { MergeOrder } from './merge-order';
import { PartsPicker } from './parts';
import { TurnPicker, type PickedTurns } from './picker';
import { DEFAULT_PAGE_SETTINGS, type ChatGroup, type ExportController, type OutputTarget, type PageSettings } from './controller';

const THEME_NAMES: Record<HtmlTheme, string> = {
  chatgpt: 'Like ChatGPT',
  article: 'Article',
  notes: 'Compact notes',
  print: 'Print-friendly',
};

const FORMAT_HINTS: Record<FormatChoice, string> = {
  markdown: 'Plain text with formatting. Opens anywhere; great for notes apps like Obsidian.',
  html: 'A web page that looks good in any browser, with math, code colours and working widgets.',
  pdf: 'Echoes opens Chrome\'s print window. Set Destination to "Save as PDF", press Save and pick a folder: the PDF goes there. Nothing is saved if you cancel.',
  json: 'Everything Echoes knows about the chat, for scripts and tools. Always holds the whole chat.',
  resources: 'Only the files, code, canvases and links, in one folder per turn. No chat text.',
};

const SCOPES: { id: Scope; title: string; hint: string }[] = [
  { id: 'chat', title: 'This chat', hint: 'The whole chat open in ChatGPT' },
  { id: 'turns', title: 'Some turns', hint: 'Pick turns by hand, search or rules' },
  { id: 'many', title: 'Many chats', hint: 'Whole Projects or your whole account' },
];

const COLOR_SCHEMES: [PageSettings['colorScheme'], string][] = [
  ['auto', 'Follow system'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

type Busy = { what: string; chatId?: string | undefined; chatTitle?: string | undefined } | undefined;

export function App({ controller, initialChatId, initialScope }: { controller: ExportController; initialChatId: string | undefined; initialScope?: string | undefined }) {
  // The chat open in the ChatGPT tab, followed live: "This chat" and "Some turns" use it.
  const [ctx, setCtx] = useState<TabContext | undefined>(undefined);
  const [ctxKnown, setCtxKnown] = useState(false);
  const chatId = ctxKnown ? ctx?.chatId : initialChatId;
  const [connected, setConnected] = useState<boolean | undefined>(undefined);
  const [settings, setSettings] = useState<PageSettings>(DEFAULT_PAGE_SETTINGS);
  const [scope, setScope] = useState<Scope>(() => scopeFrom(initialScope) ?? (initialChatId ? 'chat' : 'many'));
  /** The floating button's "Export this Project's chats": load the Project's list once the page knows the Project. */
  const [loadProject, setLoadProject] = useState(initialScope === 'project');
  const [busy, setBusy] = useState<Busy>(undefined);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logContext = useRef('');
  const [paused, setPaused] = useState<string | undefined>(undefined);
  const [groups, setGroups] = useState<ChatGroup[] | undefined>(undefined);
  const [listing, setListing] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState({ text: '', from: '', to: '' });
  const [reexportAll, setReexportAll] = useState(false);
  /** "All in one file": the user's order of the ticked chats, and the file's title ('' = the default). */
  const [mergeOrder, setMergeOrder] = useState<string[]>([]);
  const [mergeTitle, setMergeTitle] = useState('');
  /** Many chats as PDFs, one print window each: running, and the Stop button's request. */
  const [printingEach, setPrintingEach] = useState(false);
  const stopPrints = useRef(false);
  const [job, setJob] = useState<ExportJob | undefined>(undefined);
  const [unfinished, setUnfinished] = useState<ExportJob[]>([]);
  const [picked, setPicked] = useState<PickedTurns | undefined>(undefined);
  const [celebrate, setCelebrate] = useState(0);
  /** Steps start collapsed; a scope asked for from ChatGPT's floating button opens step 1. */
  const [openSteps, setOpenSteps] = useState<Set<number>>(() => new Set(initialScope ? [1] : []));
  const toggleStep = (n: number) =>
    setOpenSteps((s) => {
      const next = new Set(s);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });

  useEffect(
    () =>
      controller.watchContext((c) => {
        setCtx(c);
        setCtxKnown(true);
        setConnected(c !== undefined);
      }),
    [],
  );

  // No chat open: only "Many chats" can work, so go there rather than show a button that cannot be pressed.
  useEffect(() => {
    if (ctxKnown && !chatId && scope !== 'many' && !busy) setScope('many');
  }, [ctxKnown, chatId]);

  // The floating button on chatgpt.com, with this page already open: switch to what it asked for.
  useEffect(() => {
    const onMessage = (m: unknown) => {
      const asked = typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'echoes:scope' ? (m as { scope?: unknown }).scope : undefined;
      const next = typeof asked === 'string' ? scopeFrom(asked) : undefined;
      if (!next) return;
      setScope(next);
      setOpenSteps((s) => new Set([...s, 1]));
      if (asked === 'project') setLoadProject(true);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

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

  const save = (next: PageSettings) => {
    setSettings(next);
    void controller.saveSettings(next);
  };
  const update = (patch: Partial<PageSettings>) => save({ ...settings, ...patch });

  /** What an action started now is about, for the activity log. */
  const here = chatId ? `Chat: ${ctx?.title ?? 'Untitled chat'}` : projectSegment ? `Project: ${projectName ?? 'loading name'}` : 'No chat open';

  function addLog(entry: NewLogEntry, context = logContext.current || here) {
    setLog((l) => appendLog(l, entry, context, Date.now()));
  }

  /** Run one action at a time. `context` labels its log entries; by default, the chat or Project open when it started. True when it finished without an error. */
  async function guard(what: string, fn: () => Promise<void>, context = here): Promise<boolean> {
    setBusy({ what, chatId, chatTitle: ctx?.title });
    logContext.current = context;
    addLog({ level: 'info', title: what }, context);
    try {
      await fn();
      return true;
    } catch (e) {
      addLog({ level: 'error', title: `${what} failed: ${e instanceof Error ? e.message : String(e)}` }, context);
      return false;
    } finally {
      logContext.current = '';
      setBusy(undefined);
      setUnfinished(await controller.unfinishedJobs());
    }
  }

  function load(oneProject: boolean) {
    const segment = oneProject ? projectSegment : undefined;
    const what = segment ? "Loading this Project's chats" : 'Loading your chats and Projects';
    return guard(
      what,
      async () => {
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
      },
      segment ? here : 'All chats and Projects',
    );
  }

  useEffect(() => {
    if (!loadProject || !projectSegment || !connected || busy) return;
    setLoadProject(false);
    void load(true);
  }, [loadProject, projectSegment, connected, busy]);

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
  const ordered = useMemo(() => {
    const byId = new Map(chosen.map((c) => [c.id, c]));
    return effectiveOrder(mergeOrder, chosen.map((c) => c.id)).map((id) => byId.get(id)!);
  }, [groups, selected, mergeOrder]);
  const fileTitle = mergeTitle.trim() || defaultMergeTitle(groups, chosen.map((c) => c.id));
  const oneFile = scope === 'many' && isOneFile(settings);
  const progress = job ? jobProgress(job) : undefined;
  const fmt = formatOf(settings);

  const action = primaryAction({
    scope,
    settings,
    connected: connected === true,
    busy: !!busy,
    chatOpen: !!chatId,
    pickedTurns: picked?.selection.selectedTurns?.length,
    turnFiles: turnFiles(settings, picked?.selection.selectedTurns?.length ?? 0),
    pickedChats: groups ? chosen.length : undefined,
  });

  async function runPrimary() {
    let ok = false;
    if (scope === 'chat' && chatId) {
      ok = settings.pdf
        ? await guard('Preparing the PDF', async () => addLog(printedEntry(await controller.printChat(chatId, settings))))
        : await guard('Exporting this chat', async () => addLog(reportEntry(await controller.exportOne(chatId, settings))));
    } else if (scope === 'turns' && picked) {
      const n = picked.selection.selectedTurns?.length ?? 0;
      const files = turnFiles(settings, n);
      if (settings.pdf) {
        stopPrints.current = false;
        setPrintingEach(files > 1);
        try {
          ok = await guard('Preparing the PDF', async () =>
            addLog(printedEntry(await controller.printSelection(picked.conversation, settings, picked.selection, (i, total) => total > 1 && setBusy({ what: `Print window ${i} of ${total}` }), () => stopPrints.current))),
          );
        } finally {
          setPrintingEach(false);
        }
      } else {
        ok = await guard(files > 1 ? `Exporting ${n} turns into ${files} files` : `Exporting ${n} turns`, async () => addLog(notesEntry('Done', await controller.exportSelection(picked.conversation, settings, picked.selection))));
      }
    } else if (scope === 'many' && groups && settings.pdf && !oneFile) {
      stopPrints.current = false;
      setPrintingEach(true);
      try {
        ok = await guard(
          `Printing ${chosen.length} chats`,
          async () => {
            const r = await controller.printEach(chosen, settings, (n, total, title) => setBusy({ what: `Print window ${n} of ${total}: ${title}` }), () => stopPrints.current);
            addLog({ ...printedEntry(r.warnings), title: `${r.printed} of ${chosen.length} print windows closed` });
          },
          'Bulk export',
        );
      } finally {
        setPrintingEach(false);
      }
    } else if (scope === 'many' && groups && settings.pdf) {
      ok = await guard(
        `Preparing a PDF of ${ordered.length} chats`,
        async () => addLog(printedEntry(await controller.printChats(ordered, fileTitle, settings, (done, total) => setBusy({ what: `Preparing the PDF: chat ${done} of ${total}` })))),
        'Bulk export',
      );
    } else if (scope === 'many' && groups) {
      let wrote = false;
      ok = await guard(
        `Exporting ${chosen.length} chats`,
        async () => {
          const target = await chooseTarget();
          if (!target) return; // the user closed the folder picker
          // The list may be older than the chats: list the groups involved again and export with today's dates.
          const fresh = await controller.freshen(groups, selected);
          setGroups(fresh);
          const now = fresh.flatMap((g) => g.chats).filter((c) => selected.has(c.id));
          const merge = oneFile ? { title: fileTitle, order: ordered.map((c) => c.id) } : undefined;
          addLog(reportEntry(await controller.exportAll(now, settings, target, { reexportAll, ...(merge ? { merge } : {}) }, setJob)));
          wrote = true;
        },
        'Bulk export',
      );
      ok &&= wrote;
    }
    // A PDF is saved (or not) in the browser's print window, which Echoes cannot see: no celebration for it.
    if (ok && !settings.pdf) setCelebrate((n) => n + 1);
  }

  const versionsMatter = scope !== 'turns' && fmt !== 'resources';
  const branchOutputMatters = versionsMatter && !oneFile && settings.versions === 'all' && (fmt === 'markdown' || fmt === 'html');

  return (
    <main class="shell">
      <header class="top">
        <div class="brand">
          <span class="mark" aria-hidden="true" />
          <div>
            <h1>Echoes</h1>
            <p class="tagline">Your ChatGPT chats, saved on this computer. Nothing is sent anywhere else.</p>
          </div>
        </div>
        <nav class="top-links">
          <span class={`pill-status ${connected ? 'on' : connected === false ? 'off' : ''}`}>
            <span class="dot" aria-hidden="true" /> {connected ? 'Connected to ChatGPT' : connected === false ? 'No ChatGPT tab' : 'Connecting…'}
          </span>
          <button
            class="ghost"
            disabled={!!busy || !connected}
            title={HELP.check.tip}
            onClick={() => void guard('Checking compatibility', async () => addLog(checkEntry(await controller.selfTest(chatId))))}
          >
            Check compatibility
          </button>
          <a class="ghost" href="./inspector.html" title="Capture API shapes for a bug report">
            Diagnostics
          </a>
          <PageThemeToggle />
        </nav>
      </header>

      <div class={`current${chatId || projectSegment ? '' : ' none'}`} role="status" aria-live="polite">
        {chatId ? (
          <>
            <span class="eyebrow">Open in ChatGPT</span>
            <strong>{ctx?.title ?? 'Untitled chat'}</strong>
            <span class="hint">Follows you when you open another chat.</span>
          </>
        ) : projectSegment ? (
          <>
            <span class="eyebrow">Project open in ChatGPT</span>
            <strong>{projectName ?? 'Loading the Project name…'}</strong>
            <span class="hint">Open one of its chats to export it alone, or export many of them below.</span>
          </>
        ) : (
          <>
            <span class="eyebrow">Nothing open</span>
            <strong>No chat open</strong>
            <span class="hint">Open a chat in the ChatGPT tab to export it. Many chats work from any page.</span>
          </>
        )}
        {busy?.chatId && busy.chatId !== chatId && (
          <span class="warn small">
            Still finishing "{busy.what}" on {busy.chatTitle ? `"${busy.chatTitle}"` : 'the chat that was open when you started'}.
          </span>
        )}
      </div>

      {connected === false && (
        <p class="alert">
          No ChatGPT tab is open. Open{' '}
          <a href="https://chatgpt.com/" target="_blank">
            chatgpt.com
          </a>
          , log in, then <button onClick={() => void controller.findTab().then(setConnected)}>Try again</button>
        </p>
      )}
      {paused && (
        <p class="alert">
          {paused} <button onClick={() => controller.scheduler.resume()}>Resume</button>
        </p>
      )}

      <Step n={1} title="What to export" help="scope" open={openSteps.has(1)} onToggle={() => toggleStep(1)}>
        <div class="scopes" role="radiogroup" aria-label="What to export">
          {SCOPES.map((s) => {
            const needsChat = s.id !== 'many' && !chatId;
            return (
              <button
                role="radio"
                aria-checked={scope === s.id}
                class="scope"
                disabled={needsChat || !!busy}
                title={needsChat ? 'Open a chat in the ChatGPT tab first' : optionTip('scope', s.title)}
                onClick={() => setScope(s.id)}
              >
                <span class="scope-title">{s.title}</span>
                <span class="scope-hint">{s.hint}</span>
              </button>
            );
          })}
        </div>

        {scope === 'chat' && chatId && <p class="hint panel-note">Everything in "{ctx?.title ?? 'Untitled chat'}", with the format and parts you choose below.</p>}

        {scope === 'turns' && chatId && connected && (
          <TurnPicker
            key={chatId}
            controller={controller}
            chatId={chatId}
            def={settings.turns}
            theme={settings.theme}
            guard={guard}
            onWarnings={(w) => w.length && addLog(notesEntry('Loaded', w))}
            onPicked={setPicked}
          />
        )}

        {scope === 'many' && (
          <div class="many">
            <div class="bar">
              <FieldName id="chatList" />
              {projectSegment && (
                <button class="soft" disabled={!!busy || !connected} onClick={() => load(true)}>
                  Load this Project's chats
                </button>
              )}
              <button class="soft" disabled={!!busy || !connected} onClick={() => load(false)}>
                {projectSegment ? 'Load all chats and Projects' : groups ? 'Reload chat list' : 'Load chat list'}
              </button>
              {listing && <span class="hint loading">{listing}</span>}
            </div>

            {groups && (
              <>
                <div class="filters">
                  <input type="search" placeholder="Filter by title" aria-label="Filter by title" value={filter.text} onInput={(e) => setFilter({ ...filter, text: (e.target as HTMLInputElement).value })} />
                  <label>
                    Updated from <input type="date" value={filter.from} onInput={(e) => setFilter({ ...filter, from: (e.target as HTMLInputElement).value })} />
                  </label>
                  <label>
                    to <input type="date" value={filter.to} onInput={(e) => setFilter({ ...filter, to: (e.target as HTMLInputElement).value })} />
                  </label>
                </div>
                <div class="bar selection-bar">
                  <span class="count strong">
                    {chosen.length} of {allChats.length} chats selected
                  </span>
                  <span class="buttons">
                    <button onClick={() => setMany(visible.flatMap((g) => g.chats), true)}>Select shown</button>
                    <button onClick={() => setMany(visible.flatMap((g) => g.chats), false)}>Clear shown</button>
                  </span>
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
                        <span class="group-name">{g.name}</span> <span class="hint">{g.chats.length}</span>
                      </summary>
                      {g.chats.map((c) => (
                        <label class="chat">
                          <input type="checkbox" checked={selected.has(c.id)} onChange={(e) => setMany([c], (e.target as HTMLInputElement).checked)} /> <span>{c.title || 'Untitled'}</span>
                          <span class="hint">{c.updatedAt.slice(0, 10)}</span>
                        </label>
                      ))}
                    </details>
                  ))}
                </div>
              </>
            )}

            <div class="bar">
              <label class="check" title={HELP.reexport.tip}>
                <input type="checkbox" checked={reexportAll} onChange={(e) => setReexportAll((e.target as HTMLInputElement).checked)} /> Re-export all, even unchanged chats
              </label>
              <IncrementalExportInfo />
            </div>
            <p class="hint">You pick a folder; exporting into the same folder again saves only what changed. Without folder access, Echoes saves a zip.</p>

            <details class="advanced">
              <summary>Advanced</summary>
              <div class="recheck">
                <label title={HELP.recheck.tip}>
                  Re-check chats every{' '}
                  <input type="number" class="num" min={0} max={365} value={settings.recheckDays} onChange={(e) => update({ recheckDays: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} /> days
                </label>{' '}
                <Help id="recheck" />
              </div>
            </details>

            {unfinished.length > 0 && (
              <div class="unfinished">
                <h3>Unfinished exports</h3>
                {unfinished.map((j) => {
                  const p = jobProgress(j);
                  return (
                    <p>
                      Started {new Date(j.createdAt).toLocaleString()}: {p.done + p.skipped} of {p.total} done.{' '}
                      <button
                        disabled={!!busy || !connected}
                        onClick={() =>
                          guard(
                            'Resuming',
                            async () => {
                              const target = await chooseTarget();
                              if (target) addLog(reportEntry(await controller.resume(j.id, target, setJob)));
                            },
                            'Bulk export',
                          )
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
              </div>
            )}
          </div>
        )}
      </Step>

      <Step n={2} title="Format" help="format" open={openSteps.has(2)} onToggle={() => toggleStep(2)}>
        <div class="fields">
          <div class="field">
            <FieldName id="format" />
            <select
              id="format"
              aria-label="Format"
              value={fmt}
              onChange={(e) => save(withFormat(settings, (e.target as HTMLSelectElement).value as FormatChoice))}
            >
              {(Object.keys(FORMAT_NAMES) as FormatChoice[]).map((f) => (
                <option value={f} title={optionTip('format', FORMAT_NAMES[f])}>
                  {FORMAT_NAMES[f]}
                </option>
              ))}
            </select>
          </div>
          {scope === 'many' && fmt !== 'resources' && (
            <div class="field">
              <FieldName id="layout" />
              <div class="segmented" role="radiogroup" aria-label="Files">
                <button role="radio" aria-checked={!oneFile} title={optionTip('layout', 'One file per chat')} onClick={() => update({ layout: 'separate' })}>
                  One file per chat
                </button>
                <button role="radio" aria-checked={oneFile} title={optionTip('layout', 'All in one file')} onClick={() => update({ layout: 'merged' })}>
                  All in one file
                </button>
              </div>
            </div>
          )}
          {scope === 'turns' && canGroupTurns(settings) && (
            <div class="field">
              <FieldName id="turnsPerFile" />
              <div class="segmented" role="radiogroup" aria-label="Files">
                <button role="radio" aria-checked={settings.turnsPerFile === 0} title={optionTip('turnsPerFile', 'All in one file')} onClick={() => update({ turnsPerFile: 0 })}>
                  All in one file
                </button>
                <button role="radio" aria-checked={settings.turnsPerFile > 0} title={optionTip('turnsPerFile', 'In groups')} onClick={() => settings.turnsPerFile === 0 && update({ turnsPerFile: 5 })}>
                  In groups
                </button>
              </div>
              {settings.turnsPerFile > 0 && (
                <label>
                  of{' '}
                  <input
                    type="number"
                    class="num"
                    aria-label="Turns per file"
                    min={1}
                    max={999}
                    value={settings.turnsPerFile}
                    onChange={(e) => update({ turnsPerFile: Math.min(999, Math.max(1, Math.floor(Number((e.target as HTMLInputElement).value)) || 1)) })}
                  />{' '}
                  turns per file
                </label>
              )}
            </div>
          )}
          {oneFile && (
            <div class="field">
              <FieldName id="mergeTitle" />
              <input id="merge-title" type="text" aria-label="File title" placeholder={defaultMergeTitle(groups, chosen.map((c) => c.id))} value={mergeTitle} onInput={(e) => setMergeTitle((e.target as HTMLInputElement).value)} />
            </div>
          )}
          {fmt === 'markdown' && (
            <div class="field">
              <FieldName id="flavor" />
              <select id="flavor" aria-label="Markdown style" value={settings.flavor} onChange={(e) => update({ flavor: (e.target as HTMLSelectElement).value as PageSettings['flavor'] })}>
                {MARKDOWN_FLAVORS.map((f) => (
                  <option value={f} title={optionTip('flavor', FLAVOR_NAMES[f])}>
                    {FLAVOR_NAMES[f]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(fmt === 'html' || fmt === 'pdf') && (
            <div class="field">
              <FieldName id="colours" />
              <div class="segmented" role="radiogroup" aria-label="Colours">
                {COLOR_SCHEMES.map(([v, name]) => (
                  <button role="radio" aria-checked={settings.colorScheme === v} title={optionTip('colours', name)} onClick={() => update({ colorScheme: v })}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(fmt === 'html' || fmt === 'pdf') && (
            <div class="field">
              <FieldName id="look" />
              <select id="look" aria-label="Look" value={settings.theme} onChange={(e) => update({ theme: (e.target as HTMLSelectElement).value as PageSettings['theme'] })}>
                {HTML_THEMES.map((t) => (
                  <option value={t} title={optionTip('look', THEME_NAMES[t])}>
                    {THEME_NAMES[t]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {scope === 'many' && fmt === 'pdf' && !oneFile && (
          <p class="hint">
            Chrome opens its print window once per chat, named after the chat: press Save in each. Many chats? "All in one file" needs a single Save. <Help id="pdfEach" />
          </p>
        )}
        {scope === 'turns' && canGroupTurns(settings) && settings.turnsPerFile > 0 && (
          <p class="hint">
            {groupHint(settings.turnsPerFile, picked?.selection.selectedTurns.length, fmt === 'pdf')}{' '}
            <Help id="turnsPerFile" />
          </p>
        )}
        {oneFile && <MergeOrder chats={groups ? ordered : []} onChange={setMergeOrder} onReset={() => setMergeOrder([])} />}
        <p class="hint">
          {FORMAT_HINTS[fmt]}
          {fmt === 'html' && ' Readers can copy blocks, fold turns and switch light or dark in the page.'}
          {fmt === 'pdf' && settings.colorScheme !== 'dark' && ' Prints light; pick Dark for a dark PDF.'}
        </p>
      </Step>

      <Step n={3} title="What goes in" help="parts" open={openSteps.has(3)} onToggle={() => toggleStep(3)}>
        {fmt === 'resources' ? (
          <p class="hint">Resources only saves files, code, canvases and links, so there are no turn parts to choose.</p>
        ) : (
          <>
            <FieldName id="parts" as="h3" />
            <PartsPicker value={settings.turns} onChange={(turns) => update({ turns })} controller={controller} />
          </>
        )}
        <div class="fields">
          {versionsMatter && (
            <div class="field">
              <FieldName id="versions" />
              <div class="segmented" role="radiogroup" aria-label="Versions">
                <button role="radio" aria-checked={settings.versions === 'active'} title={optionTip('versions', 'Only the one shown')} onClick={() => update({ versions: 'active' })}>
                  Only the one shown
                </button>
                <button role="radio" aria-checked={settings.versions === 'all'} title={optionTip('versions', 'All versions')} onClick={() => update({ versions: 'all' })}>
                  All versions
                </button>
              </div>
            </div>
          )}
          {branchOutputMatters && (
            <div class="field">
              <FieldName id="branchOutput" />
              <select id="branch-output" aria-label="Other versions go" value={settings.branchOutput} onChange={(e) => update({ branchOutput: (e.target as HTMLSelectElement).value as PageSettings['branchOutput'] })}>
                <option value="sections" title={optionTip('branchOutput', 'In the same file')}>
                  In the same file
                </option>
                <option value="files" title={optionTip('branchOutput', 'In one file each')}>
                  In one file each
                </option>
              </select>
            </div>
          )}
          {fmt !== 'pdf' && (
            <span class="switch-row">
              <label class="switch" title={HELP.attachments.tip}>
                <input type="checkbox" role="switch" checked={settings.attachments} onChange={(e) => update({ attachments: (e.target as HTMLInputElement).checked })} />
                <span class="track" aria-hidden="true" />
                Save uploads and images
              </label>
              <Help id="attachments" />
            </span>
          )}
        </div>
        {scope === 'turns' && <p class="hint">Versions: open a turn in the list to switch between its versions; the export follows the one shown.</p>}
      </Step>

      <Preferences controller={controller} />

      <ActivityLog log={log} busy={busy?.what} onClear={() => setLog([])}>
        <div class="dock-main">
          {busy && job && progress ? (
            <div class="dock-progress">
              <progress max={progress.total} value={progress.done + progress.failed + progress.skipped} />
              <span class="hint">
                {progress.done} exported, {progress.skipped} unchanged, {progress.failed} failed, {progress.pending} left
              </span>
            </div>
          ) : (
            <div class="dock-summary">
              <span class="summary">{settingsSummary(settings, scope, (t) => THEME_NAMES[t])}</span>
              {action.blocked && <span class="blocked">{action.blocked}</span>}
            </div>
          )}
          {busy && printingEach && (
            <button class="ghost" onClick={() => (stopPrints.current = true)}>
              {scope === 'turns' ? 'Stop after this window' : 'Stop after this chat'}
            </button>
          )}
          {busy && job && (
            <button class="ghost" onClick={() => void controller.cancel(job)}>
              {scope === 'turns' ? 'Stop after this window' : 'Stop after this chat'}
            </button>
          )}
          <button key={celebrate} class={`cta${celebrate ? ' celebrate' : ''}${busy ? ' working' : ''}`} disabled={!!action.blocked} onClick={() => void runPrimary()}>
            <span class="cta-label">{busy ? `${busy.what}…` : action.label}</span>
          </button>
        </div>
      </ActivityLog>
    </main>
  );
}

/**
 * One step of the page. Collapsed at first, so the page opens as three short lines; a step's content stays mounted
 * while collapsed (a half-picked turn selection survives), it is only hidden.
 */
function Step({ n, title, help, open, onToggle, children }: { n: number; title: string; help: HelpId; open: boolean; onToggle: () => void; children: ComponentChildren }) {
  return (
    <section class={`step${open ? ' open' : ''}`} style={{ '--i': n }} aria-labelledby={`step-${n}`}>
      <h2 class="step-head">
        <button id={`step-${n}`} class="step-toggle" aria-expanded={open} aria-controls={`step-${n}-body`} title={open ? 'Hide this step' : HELP[help].tip} onClick={onToggle}>
          <span class="num-badge" aria-hidden="true">
            {n}
          </span>
          <span class="step-word">Step {n}</span>
          <span class="step-dash" aria-hidden="true">
            –
          </span>
          {title}
          <span class="chev" aria-hidden="true" />
        </button>
        <Help id={help} />
      </h2>
      <div class="step-body" id={`step-${n}-body`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** The line under "Files" for some turns in groups: how the picked turns are split. */
function groupHint(size: number, picked: number | undefined, pdf: boolean): string {
  const unit = pdf ? 'print window' : 'file';
  if (picked === undefined) return `The picked turns in order, ${size} per ${unit}.`;
  const files = Math.ceil(picked / size);
  if (files <= 1) return `All ${picked} picked turns fit in one ${unit}.`;
  const rest = picked - (files - 1) * size;
  return `${files} ${unit}s: the first ${size} picked turns, then the next ${size}, and so on${rest < size ? `; the last holds ${rest}` : ''}.`;
}

/** A scope from the address or the floating button; `project` means Many chats. */
function scopeFrom(s: string | undefined): Scope | undefined {
  if (s === 'chat' || s === 'turns' || s === 'many') return s;
  if (s === 'project') return 'many';
  return undefined;
}

/** Settings of Echoes itself, not of an export. */
function Preferences({ controller }: { controller: ExportController }) {
  const [quick, setQuick] = useState<boolean | undefined>(undefined);
  useEffect(() => void controller.quickButton().then(setQuick), []);
  return (
    <section class="prefs" aria-label="Echoes preferences">
      <label class="switch" title={HELP.quickButton.tip}>
        <input
          type="checkbox"
          role="switch"
          checked={quick ?? true}
          disabled={quick === undefined}
          onChange={(e) => {
            const on = (e.target as HTMLInputElement).checked;
            setQuick(on);
            void controller.setQuickButton(on);
          }}
        />
        <span class="track" aria-hidden="true" />
        Floating Echoes button on ChatGPT chats and Projects
      </label>{' '}
      <Help id="quickButton" />
      <p class="hint">Quick actions from the chat itself. Its × hides it until the browser restarts; this switch turns it off or on for good.</p>
    </section>
  );
}

const PAGE_THEME_KEY = 'echoes:page-theme';
const PAGE_THEMES = ['auto', 'light', 'dark'] as const;
type PageTheme = (typeof PAGE_THEMES)[number];
const PAGE_THEME_LABEL: Record<PageTheme, string> = { auto: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };

/** This page's own light or dark look (the exports have their own Colours setting). Remembered in this browser. */
function PageThemeToggle() {
  const [theme, setTheme] = useState<PageTheme>(() => {
    try {
      const t = localStorage.getItem(PAGE_THEME_KEY);
      return PAGE_THEMES.includes(t as PageTheme) ? (t as PageTheme) : 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset['theme'];
    else document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem(PAGE_THEME_KEY, theme);
    } catch {
      // storage blocked: the choice lasts for this visit
    }
  }, [theme]);
  const next = PAGE_THEMES[(PAGE_THEMES.indexOf(theme) + 1) % PAGE_THEMES.length]!;
  return (
    <button class="ghost theme-toggle" title="Switch this page between system, light and dark" onClick={() => setTheme(next)}>
      <span class={`theme-icon ${theme}`} aria-hidden="true" /> {PAGE_THEME_LABEL[theme]}
    </button>
  );
}
