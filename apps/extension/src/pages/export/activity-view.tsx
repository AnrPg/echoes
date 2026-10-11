import { useEffect, useRef, useState } from 'preact/hooks';
import type { LogEntry } from './activity';

const ICON = { info: '•', ok: '✓', warn: '!', error: '✗' } as const;

/** The activity log, docked at the bottom of the page. Newest entry last; it scrolls to it unless the user scrolled up. */
export function ActivityLog({ log, busy, onClear }: { log: readonly LogEntry[]; busy?: string | undefined; onClear: () => void }) {
  const [open, setOpen] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = body.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [log.length, busy, open]);

  const last = log.at(-1);
  return (
    <aside class={`activity${open ? '' : ' closed'}`} aria-label="Activity">
      <div class="activity-bar">
        <button class="link" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} Activity
        </button>
        {!open && last && <span class={`activity-peek ${last.level}`}>{ICON[last.level]} {last.title}</span>}
        <span class="spacer" />
        {busy && <span class="muted small">{busy}…</span>}
        {open && log.length > 0 && (
          <button class="small" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {open && (
        <div
          class="activity-body"
          ref={body}
          role="log"
          aria-live="polite"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {log.length === 0 && !busy && <p class="muted small">Results of checks and exports appear here and stay, whichever chat you open next.</p>}
          {log.map((e) => (
            <div class={`entry ${e.level}`} key={e.id}>
              <span class="when">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span class="ctx" title={e.context}>
                {e.context}
              </span>
              <div class="what">
                <span class="icon">{ICON[e.level]}</span> {e.title}
                {e.lines && (
                  <ul>
                    {e.lines.map((l) => (
                      <li class={l.level ?? ''}>{l.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div class="entry info running">
              <span class="when">now</span>
              <span class="ctx" />
              <div class="what">
                <span class="icon">⋯</span> {busy}…
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
