import {
  RuleError,
  TURN_PARTS,
  TURN_PRESETS,
  TurnIndex,
  activePath,
  buildTurns,
  nodesOf,
  renderHtml,
  selectTurns,
  type CodeHighlighter,
  type ContentKind,
  type Conversation,
  type Rule,
  type TurnDefinition,
  type TurnPresetName,
} from '@echoes/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getHighlighter, type TurnSelection } from '../../export/run';
import type { ExportController, PageSettings, SavedPreset } from './controller';
import { PART_LABELS, PRESET_LABELS } from './include-model';
import {
  CONDITION_LABELS,
  CONTENT_LABELS,
  branchNameOf,
  buildRule,
  invert,
  newCondition,
  selectRange,
  summarize,
  type Condition,
  type ConditionType,
} from './picker-model';

const TOGGLES = TURN_PARTS.map((k) => [k, PART_LABELS[k]] as const);

const BUILT_IN: SavedPreset[] = (Object.keys(TURN_PRESETS) as TurnPresetName[]).map((k) => ({ name: PRESET_LABELS[k], turns: TURN_PRESETS[k] }));

interface Props {
  controller: ExportController;
  chatId: string;
  settings: PageSettings;
  busy: boolean;
  guard: (what: string, fn: () => Promise<void>) => Promise<void>;
  onWarnings: (warnings: string[]) => void;
}

/** Pick turns of one chat by hand, by search or by rules, preview them, and export or print just those. */
export function TurnPicker({ controller, chatId, settings, busy, guard, onWarnings }: Props) {
  const [conversation, setConversation] = useState<Conversation | undefined>(undefined);
  const [path, setPath] = useState<string[]>([]);
  const [def, setDef] = useState<TurnDefinition>({ ...settings.turns });
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Condition[]>([]);
  const [combine, setCombine] = useState<'and' | 'or'>('and');
  const [preview, setPreview] = useState<number | undefined>(undefined);
  const [highlight, setHighlight] = useState<CodeHighlighter | undefined>(undefined);

  useEffect(() => {
    void controller.loadPresets().then(setPresets);
    void getHighlighter().then((h) => setHighlight(() => h));
    void guard('Loading the chat', async () => {
      const { conversation: c, warnings } = await controller.loadChat(chatId);
      setConversation(c);
      setPath(activePath(c));
      onWarnings(warnings);
    });
  }, [chatId]);

  const turns = useMemo(() => (conversation ? buildTurns(nodesOf(conversation, path)) : []), [conversation, path]);
  const order = useMemo(() => turns.filter((t) => t.index > 0).map((t) => t.index), [turns]);
  const summaries = useMemo(() => new Map(conversation ? turns.map((t) => [t.index, summarize(conversation, t)]) : []), [conversation, turns]);
  const index = useMemo(() => {
    const i = new TurnIndex();
    if (conversation) i.addTurns(conversation.id, turns);
    return i;
  }, [conversation, turns]);

  // First load selects every turn; another version keeps the picks that still exist and adds turns new to it.
  const [seen, setSeen] = useState<Set<number>>(new Set());
  useEffect(() => {
    setSelected((prev) => new Set(order.filter((t) => prev.has(t) || !seen.has(t))));
    setSeen(new Set(order));
  }, [order.join(',')]);

  const run = (rule: Rule | undefined): { hits?: Set<number>; error?: string } => {
    if (!conversation || !rule) return {};
    try {
      return { hits: new Set(selectTurns(conversation, turns, rule, { index })) };
    } catch (e) {
      return { error: e instanceof RuleError ? e.message : String(e) };
    }
  };
  const search = useMemo(() => run(query.trim() ? { kind: 'text', field: 'either', query, mode: 'fuzzy' } : undefined), [query, index]);
  const rule = buildRule(combine, rows);
  const ruled = useMemo(() => run(rule), [JSON.stringify(rule), index]);

  if (!conversation) return <p class="muted">Loading the chat…</p>;

  const click = (t: number, on: boolean, shift: boolean) => {
    setSelected(shift && anchor !== undefined ? selectRange(selected, order, anchor, t, on) : selectRange(selected, order, t, t, on));
    setAnchor(t);
  };
  const apply = (hits: Set<number> | undefined, how: 'only' | 'add' | 'remove') => {
    if (!hits) return;
    if (how === 'only') setSelected(new Set(hits));
    else if (how === 'add') setSelected(new Set([...selected, ...hits]));
    else setSelected(new Set([...selected].filter((t) => !hits.has(t))));
  };
  const setRow = (i: number, row: Condition) => setRows(rows.map((r, j) => (j === i ? row : r)));
  const picked = order.filter((t) => selected.has(t));
  const branchName = branchNameOf(conversation, path);
  const selection = (): TurnSelection => ({ path, selectedTurns: picked, turns: def, ...(branchName ? { branchName } : {}) });
  const allPresets = [...BUILT_IN, ...presets];
  const versionsHere = [...summaries.values()].some((s) => s.versions.length > 0);

  return (
    <div>
      <div class="bar">
        <strong>{conversation.title || 'Untitled chat'}</strong>
        {versionsHere && branchName && <span class="muted small">Version shown: {branchName}</span>}
      </div>

      <details>
        <summary>Parts of each turn</summary>
        <div class="bar">
          <select
            aria-label="Turn preset"
            onChange={(e) => {
              const p = allPresets.find((x) => x.name === (e.target as HTMLSelectElement).value);
              if (p) setDef({ ...p.turns });
            }}
          >
            <option value="">Load a preset…</option>
            {allPresets.map((p) => (
              <option value={p.name}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={() => {
              const name = prompt('Name for these settings')?.trim();
              if (!name || BUILT_IN.some((p) => p.name === name)) return;
              const next = [...presets.filter((p) => p.name !== name), { name, turns: def }];
              setPresets(next);
              void controller.savePresets(next);
            }}
          >
            Save as preset
          </button>
        </div>
        <div class="grid">
          {TOGGLES.map(([k, label]) => (
            <label>
              <input type="checkbox" checked={def[k]} onChange={(e) => setDef({ ...def, [k]: (e.target as HTMLInputElement).checked })} /> {label}
            </label>
          ))}
        </div>
        <p class="muted small">"Reasoning" means the summaries ChatGPT shows, never raw chain of thought.</p>
      </details>

      <div class="bar">
        <input placeholder="Search turns (typos are fine)" aria-label="Search turns" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        {search.hits && (
          <>
            <span class="count">{search.hits.size} match{search.hits.size === 1 ? '' : 'es'}</span>
            <button onClick={() => apply(search.hits, 'only')}>Select only these</button>
            <button onClick={() => apply(search.hits, 'add')}>Add</button>
          </>
        )}
      </div>

      <details>
        <summary>Rules</summary>
        <div class="bar">
          Turns matching{' '}
          <select aria-label="Combine rules" value={combine} onChange={(e) => setCombine((e.target as HTMLSelectElement).value as 'and' | 'or')}>
            <option value="and">all of</option>
            <option value="or">any of</option>
          </select>{' '}
          these rules:
        </div>
        {rows.map((row, i) => (
          <RuleRow row={row} onChange={(r) => setRow(i, r)} onRemove={() => setRows(rows.filter((_, j) => j !== i))} />
        ))}
        <div class="bar">
          <select
            aria-label="Add a rule"
            value=""
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value as ConditionType;
              if (v) setRows([...rows, newCondition(v)]);
            }}
          >
            <option value="">Add a rule…</option>
            {Object.entries(CONDITION_LABELS).map(([k, v]) => (
              <option value={k}>{v}</option>
            ))}
          </select>
          {ruled.error && <span class="warn">{ruled.error}</span>}
          {ruled.hits && (
            <>
              <span class="count">{ruled.hits.size} turns match</span>
              <button onClick={() => apply(ruled.hits, 'only')}>Select only these</button>
              <button onClick={() => apply(ruled.hits, 'add')}>Add</button>
              <button onClick={() => apply(ruled.hits, 'remove')}>Remove</button>
            </>
          )}
        </div>
      </details>

      <div class="bar">
        <span class="count">
          {picked.length} of {order.length} turns selected
        </span>
        <button onClick={() => setSelected(new Set(order))}>All</button>
        <button onClick={() => setSelected(new Set())}>None</button>
        <button onClick={() => setSelected(invert(selected, order))}>Invert</button>
        <span class="muted small">Shift-click selects a range. Click a turn to preview it.</span>
      </div>

      <div class="turns">
        {order.map((t) => {
          const s = summaries.get(t)!;
          const hit = search.hits?.has(t) || ruled.hits?.has(t);
          return (
            <div class={`turn-row${hit ? ' hit' : ''}`}>
              <input
                type="checkbox"
                aria-label={`Turn ${t}`}
                checked={selected.has(t)}
                onClick={(e) => {
                  e.preventDefault();
                  click(t, !selected.has(t), (e as MouseEvent).shiftKey);
                }}
              />
              <span class="muted">Turn {t}</span>
              <div class="text" onClick={() => setPreview(t)}>
                <div class="q">{s.question || <span class="muted">(no question)</span>}</div>
                <div class="muted small">{s.answer}</div>
                <div>
                  {s.badges.map((b) => (
                    <span class="badge">{b}</span>
                  ))}
                  {s.versions.length > 0 && <span class="badge">versions</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div class="bar">
        <button
          class="primary"
          disabled={busy || picked.length === 0}
          onClick={() => guard(`Exporting ${picked.length} turns`, async () => onWarnings(await controller.exportSelection(conversation, settings, selection())))}
        >
          Export {picked.length} turns
        </button>
        <button disabled={busy || picked.length === 0} onClick={() => guard('Preparing the PDF', async () => onWarnings(await controller.printSelection(conversation, settings, selection())))}>
          Save {picked.length} turns as PDF
        </button>
        <span class="muted small">Uses the Format and Look settings above. JSON always holds the whole chat.</span>
      </div>

      {preview !== undefined && (
        <Preview
          conversation={conversation}
          path={path}
          turn={preview}
          order={order}
          def={def}
          theme={settings.theme}
          highlight={highlight}
          included={selected.has(preview)}
          onToggle={() => click(preview, !selected.has(preview), false)}
          onMove={setPreview}
          onPath={setPath}
          onClose={() => setPreview(undefined)}
        />
      )}
    </div>
  );
}

function RuleRow({ row, onChange, onRemove }: { row: Condition; onChange: (r: Condition) => void; onRemove: () => void }) {
  const num = (v: number, set: (n: number) => void, label: string) => (
    <input type="number" min={1} aria-label={label} value={v} style={{ width: '5em' }} onInput={(e) => set(Number((e.target as HTMLInputElement).value))} />
  );
  let fields;
  switch (row.type) {
    case 'every':
      fields = (
        <>
          every {num(row.n, (n) => onChange({ ...row, n }), 'Every N')} turns from turn {num(row.start, (start) => onChange({ ...row, start }), 'Starting turn')}
        </>
      );
      break;
    case 'range':
      fields = (
        <>
          turns {num(row.from, (from) => onChange({ ...row, from }), 'From turn')} to {num(row.to, (to) => onChange({ ...row, to }), 'To turn')}
        </>
      );
      break;
    case 'first':
    case 'last':
      fields = (
        <>
          {row.type} {num(row.n, (n) => onChange({ ...row, n }), 'Number of turns')} turns
        </>
      );
      break;
    case 'text':
      fields = (
        <>
          <select aria-label="Where" value={row.field} onChange={(e) => onChange({ ...row, field: (e.target as HTMLSelectElement).value as typeof row.field })}>
            <option value="either">question or answer</option>
            <option value="question">question</option>
            <option value="answer">answer</option>
          </select>{' '}
          contains <input aria-label="Text" value={row.query} onInput={(e) => onChange({ ...row, query: (e.target as HTMLInputElement).value })} />{' '}
          <select aria-label="Match" value={row.mode} onChange={(e) => onChange({ ...row, mode: (e.target as HTMLSelectElement).value as typeof row.mode })}>
            <option value="fuzzy">allowing typos</option>
            <option value="exact">exactly</option>
            <option value="regex">as a regular expression</option>
          </select>
        </>
      );
      break;
    case 'has':
      fields = (
        <>
          has{' '}
          <select aria-label="Content" value={row.content} onChange={(e) => onChange({ ...row, content: (e.target as HTMLSelectElement).value as ContentKind })}>
            {Object.entries(CONTENT_LABELS).map(([k, v]) => (
              <option value={k}>{v}</option>
            ))}
          </select>
        </>
      );
      break;
    case 'model':
      fields = (
        <>
          model is <input aria-label="Model" value={row.model} onInput={(e) => onChange({ ...row, model: (e.target as HTMLInputElement).value })} />
        </>
      );
      break;
    case 'date':
      fields = (
        <>
          asked from <input type="date" aria-label="From date" value={row.from} onInput={(e) => onChange({ ...row, from: (e.target as HTMLInputElement).value })} /> to{' '}
          <input type="date" aria-label="To date" value={row.to} onInput={(e) => onChange({ ...row, to: (e.target as HTMLInputElement).value })} />
        </>
      );
      break;
    case 'hasVersions':
      fields = <>has other versions (edited or regenerated)</>;
      break;
  }
  return (
    <div class="rule">
      <select aria-label="Is or is not" value={row.not ? 'not' : 'is'} onChange={(e) => onChange({ ...row, not: (e.target as HTMLSelectElement).value === 'not' })}>
        <option value="is">Is</option>
        <option value="not">Is not</option>
      </select>
      {fields}
      <button aria-label="Remove rule" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

interface PreviewProps {
  conversation: Conversation;
  path: string[];
  turn: number;
  order: number[];
  def: TurnDefinition;
  theme: PageSettings['theme'];
  highlight: CodeHighlighter | undefined;
  included: boolean;
  onToggle: () => void;
  onMove: (turn: number) => void;
  onPath: (path: string[]) => void;
  onClose: () => void;
}

/** One whole turn, rendered by the export renderer itself, in an isolated frame. */
function Preview({ conversation, path, turn, order, def, theme, highlight, included, onToggle, onMove, onPath, onClose }: PreviewProps) {
  const at = order.indexOf(turn);
  const prev = order[at - 1];
  const next = order[at + 1];
  const t = buildTurns(nodesOf(conversation, path)).find((x) => x.index === turn);
  const versions = t ? summarize(conversation, t).versions : [];
  const html = useMemo(
    () => renderHtml(conversation, { path, selectedTurns: [turn], turns: def, theme, ...(highlight ? { highlight } : {}) }),
    [conversation, path, turn, def, theme, highlight],
  );

  // One listener for the dialog's lifetime, reading the latest props: re-adding it on every render (the parent passes
  // new callbacks each time) left moments with no listener, and a key pressed then was lost.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e: KeyboardEvent) => {
    const typing = (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') || e.target instanceof HTMLSelectElement;
    if (typing) return;
    if (e.key === 'Escape') onClose();
    else if ((e.key === 'ArrowLeft' || e.key === 'k') && prev !== undefined) onMove(prev);
    else if ((e.key === 'ArrowRight' || e.key === 'j') && next !== undefined) onMove(next);
    else if (e.key === ' ' || e.key === 'x') {
      e.preventDefault();
      onToggle();
    }
  };
  useLayoutEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  // Take focus from the page behind, as a modal should, so no field there (or the preview frame) keeps the keys.
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => box.current?.focus(), []);

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label={`Turn ${turn}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="overlay-box" ref={box} tabIndex={-1}>
        <div class="bar">
          <button disabled={prev === undefined} onClick={() => prev !== undefined && onMove(prev)} aria-label="Previous turn">
            ←
          </button>
          <strong>Turn {turn}</strong>
          <button disabled={next === undefined} onClick={() => next !== undefined && onMove(next)} aria-label="Next turn">
            →
          </button>
          <label>
            <input type="checkbox" checked={included} onChange={onToggle} /> Include
          </label>
          {(['question', 'answer'] as const).map((kind) => {
            const vs = versions.filter((v) => v.kind === kind);
            if (!vs.length) return null;
            return (
              <label>
                {kind === 'question' ? 'Question' : 'Answer'} version{' '}
                <select
                  value={String(vs.find((v) => v.current)?.version ?? 1)}
                  onChange={(e) => {
                    const v = vs.find((x) => String(x.version) === (e.target as HTMLSelectElement).value);
                    if (v) onPath(v.path);
                  }}
                >
                  {vs.map((v) => (
                    <option value={String(v.version)}>
                      {v.version} of {v.of}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <span class="spacer" />
          <span class="muted small">
            <kbd>←</kbd> <kbd>→</kbd> move, <kbd>Space</kbd> include, <kbd>Esc</kbd> close
          </span>
          <button onClick={onClose} aria-label="Close preview">
            ✕
          </button>
        </div>
        <iframe title={`Preview of turn ${turn}`} srcdoc={html} sandbox="" />
      </div>
    </div>
  );
}
