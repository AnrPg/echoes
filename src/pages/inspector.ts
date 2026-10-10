import { Anonymizer } from '../inspect/anonymize';
import { buildReport, renderEndpoint, renderTimeline, sortEndpoints } from '../inspect/report';
import { RAW_PREFIX, STATE_KEY, SETTINGS_KEY, clearAll, loadSettings, loadState, saveSettings } from '../inspect/storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

async function render() {
  const [state, settings] = await Promise.all([loadState(), loadSettings()]);
  $<HTMLInputElement>('raw').checked = settings.raw;
  $('rawwarn').hidden = !settings.raw;
  const eps = sortEndpoints(state);
  $('summary').textContent = `${eps.length} endpoint templates · ${state.timeline.length} timeline entries · ${state.rawIndex.length} raw bodies stored`;
  $('timeline').textContent = renderTimeline(state).slice(-400).join('\n') || '(nothing captured yet — open chatgpt.com and use it)';
  const box = $('endpoints');
  const open = new Set([...box.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset.key));
  box.replaceChildren(
    ...eps.map((e) => {
      const d = document.createElement('details');
      d.dataset.key = e.key;
      d.open = open.has(e.key);
      const s = document.createElement('summary');
      s.textContent = `${e.key}  ·  ${e.count}×`;
      const pre = document.createElement('pre');
      pre.textContent = renderEndpoint(e);
      d.append(s, pre);
      return d;
    }),
  );
}

$('report').addEventListener('click', async () => {
  download(`phase0-report-${stamp()}.md`, buildReport(await loadState()), 'text/markdown');
});

$('rawdl').addEventListener('click', async () => {
  const state = await loadState();
  const keys = state.rawIndex.map((r) => RAW_PREFIX + r.id);
  const got = keys.length ? await chrome.storage.local.get(keys) : {};
  // One anonymizer for the whole bundle so ids stay consistent across responses.
  const anon = new Anonymizer();
  const items = state.rawIndex.map((r) => ({ t: r.t, endpoint: r.key, body: anon.run(got[RAW_PREFIX + r.id]) }));
  const bundle = { anonymized: true, report: anon.report, items };
  download(`phase0-raw-anonymized-${stamp()}.json`, JSON.stringify(bundle, null, 2), 'application/json');
  if (anon.report.textStrings > 0) {
    alert(`${anon.report.textStrings} free-text strings were left as-is (keys: ${anon.report.textKeys.join(', ')}). Review them before sharing.`);
  }
});

$('clear').addEventListener('click', async () => {
  if (!confirm('Delete all captured data (aggregate and raw bodies)?')) return;
  await clearAll();
  await render();
});

$<HTMLInputElement>('raw').addEventListener('change', async (ev) => {
  await saveSettings({ raw: (ev.target as HTMLInputElement).checked });
  await render();
});

let pending: number | undefined;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(STATE_KEY in changes || SETTINGS_KEY in changes)) return;
  clearTimeout(pending);
  pending = window.setTimeout(() => void render(), 300);
});

void render();
