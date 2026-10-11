import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { LogEntry } from './activity';

const ICON = { info: '•', ok: '✓', warn: '!', error: '✗' } as const;

/**
 * The dock at the bottom of the page: the one export button (passed as `children`) and the activity log above it.
 * Newest log entry last; the log scrolls to it unless the user scrolled up.
 */
export function ActivityLog({ log, busy, onClear, children }: { log: readonly LogEntry[]; busy?: string | undefined; onClear: () => void; children?: ComponentChildren }) {
  const [open, setOpen] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = body.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [log.length, busy, open]);

  const last = log.at(-1);
  return (
    <aside class={`dock activity${open ? '' : ' closed'}`} aria-label="Export and activity">
      {open && (
        <div class="activity-panel">
          <div class="activity-head">
            <span class="activity-title">Activity</span>
            <span class="spacer" />
            {log.length > 0 && (
              <button class="link small" onClick={onClear}>
                Clear
              </button>
            )}
          </div>
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
            {log.length === 0 && !busy && <p class="hint">Results of checks and exports appear here and stay, whichever chat you open next.</p>}
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
                  <span class="icon spin">◌</span> {busy}…
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div class="dock-bar">
        <button class="log-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Hide the activity log' : 'Show the activity log'}>
          <span class={`chev${open ? ' open' : ''}`} aria-hidden="true">
            ▴
          </span>{' '}
          Activity
          {!open && last && (
            <span class={`peek ${last.level}`}>
              {ICON[last.level]} {last.title}
            </span>
          )}
        </button>
        {children}
      </div>
    </aside>
  );
}
