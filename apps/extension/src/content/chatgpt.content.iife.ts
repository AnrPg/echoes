// Isolated world. Three jobs:
// 1. Relay between Echoes' extension pages and the main-world page bridge (relay.ts).
// 2. Diagnostics capture (the Phase 0 inspector), only while it is switched on in the inspector page: receives
//    records from the main-world hook, validates them, aggregates them into chrome.storage.local, and shows a small
//    "Mark" button (Shadow DOM) to annotate the timeline.
// 3. The floating quick-action button (quick-button.ts), unless the user switched it off.

import { addMarker, applyRecord, endpointKey } from '../inspect/aggregate';
import { CHANNEL, EnvelopeZ, type CaptureRecord } from '../inspect/messages';
import { RAW_CAP, RAW_PREFIX, SETTINGS_KEY, loadSettings, loadState, saveState } from '../inspect/storage';
import { installQuickButton } from './quick-button';
import { installRelay } from './relay';

installRelay(window, chrome.runtime as unknown as Parameters<typeof installRelay>[1], window.location.origin);
installQuickButton();

let capture = false;
void loadSettings().then((s) => {
  capture = s.capture;
  if (capture) mountWhenReady();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(SETTINGS_KEY in changes)) return;
  void loadSettings().then((s) => {
    capture = s.capture;
    if (capture) mountWhenReady();
  });
});

const pending: CaptureRecord[] = [];
const markers: { label: string; t: number }[] = [];
let flushing: Promise<void> = Promise.resolve();
let timer: number | undefined;

window.addEventListener('message', (ev: MessageEvent) => {
  // Only same-window messages; the page can still forge these, so validate strictly.
  if (!capture || ev.source !== window || (ev.data as { channel?: unknown })?.channel !== CHANNEL) return;
  const parsed = EnvelopeZ.safeParse(ev.data);
  if (!parsed.success) {
    console.warn('[echoes] dropped malformed capture record', parsed.error.issues[0]);
    return;
  }
  pending.push(parsed.data.record);
  schedule();
});

function schedule() {
  if (timer !== undefined) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    // Serialize flushes inside this tab. Pitfall: two chatgpt.com tabs can still interleave
    // read-modify-write and lose an update; Phase 0 assumes one capture tab.
    flushing = flushing.then(flush).catch((e) => console.error('[echoes] flush failed', e));
  }, 1000);
}

async function flush() {
  const recs = pending.splice(0);
  const marks = markers.splice(0);
  if (!recs.length && !marks.length) return;
  const [state, settings] = await Promise.all([loadState(), loadSettings()]);
  const rawWrites: Record<string, unknown> = {};
  for (const r of recs) {
    if (r.kind === 'fetch' && r.raw !== undefined) {
      if (settings.raw && state.rawIndex.length < RAW_CAP) {
        const json = JSON.stringify(r.raw);
        const id = `${r.t}-${Math.random().toString(36).slice(2, 8)}`;
        rawWrites[RAW_PREFIX + id] = r.raw;
        state.rawIndex.push({ id, t: r.t, key: endpointKey(r), bytes: json.length });
      }
      delete r.raw; // never stored in the aggregate
    }
    applyRecord(state, r);
  }
  for (const m of marks) addMarker(state, m.label, m.t);
  await chrome.storage.local.set({ ...rawWrites });
  await saveState(state);
}

let mounted = false;
function mountWhenReady() {
  if (mounted) return;
  mounted = true;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountMarkButton, { once: true });
  else mountMarkButton();
}

function mountMarkButton() {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      button{font:12px system-ui,sans-serif;padding:6px 10px;border-radius:999px;border:1px solid #888;
        background:#fff;color:#111;cursor:pointer;opacity:.75}
      button:hover{opacity:1}
      @media (prefers-color-scheme: dark){button{background:#222;color:#eee}}
    </style>
    <button title="Add a labeled marker to the Phase 0 capture timeline">● Mark</button>`;
  root.querySelector('button')!.addEventListener('click', () => {
    const label = window.prompt('Marker label (e.g. "clicking Branch in new chat")');
    if (!label) return;
    markers.push({ label, t: Date.now() });
    schedule();
  });
  document.documentElement.appendChild(host);
}
