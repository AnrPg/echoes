// Service worker: routing only. Long jobs never run here (MV3 stops idle workers); they run in the export page.
// 1. The toolbar button opens (or focuses) the export page, passing the ChatGPT tab and the open chat.
// 2. Branch-monitor messages from chatgpt.com tabs are written to the lineage log.

import { BranchMessageZ } from '../bridge/messages';
import { IndexedDbStore } from '../host/idb-store';
import { recordBranch } from '../host/lineage';
import { chatIdFromUrl, exportPageUrl } from './routes';

const EXPORT_PAGE = 'src/pages/export.html';
const store = new IndexedDbStore();

chrome.action.onClicked.addListener(async (tab) => {
  const onChatGpt = tab.url?.startsWith('https://chatgpt.com/') === true;
  const url = chrome.runtime.getURL(exportPageUrl(EXPORT_PAGE, onChatGpt ? tab.id : undefined, onChatGpt ? chatIdFromUrl(tab.url!) : undefined));
  // One export page at a time: one request queue for the whole extension. A running export keeps its page, so a
  // second click only focuses it.
  const { exportTab } = (await chrome.storage.session.get('exportTab')) as { exportTab?: number };
  const existing = exportTab === undefined ? undefined : await chrome.tabs.get(exportTab).catch(() => undefined);
  if (existing?.id !== undefined && existing.url?.startsWith(chrome.runtime.getURL(EXPORT_PAGE))) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  const created = await chrome.tabs.create({ url });
  await chrome.storage.session.set({ exportTab: created.id });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.url?.startsWith('https://chatgpt.com/')) return;
  const m = BranchMessageZ.safeParse(message);
  if (!m.success) return;
  recordBranch(store, m.data).catch((e) => console.warn('[echoes] could not record a branch', e));
});
