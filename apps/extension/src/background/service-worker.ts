// Service worker: routing only. Long jobs never run here (MV3 stops idle workers); they run in the export page.
// 1. The toolbar button opens (or focuses) the export page, passing the ChatGPT tab and the open chat; the page then
//    follows that tab's open chat by itself.
// 2. The floating button on chatgpt.com asks to open the page, to hide itself for the session, or whether to show.
// 3. Branch-monitor messages from chatgpt.com tabs are written to the lineage log, with a snapshot of the source chat.

import { Scheduler } from '@echoes/core';
import { BridgeLink, bridgeTransport } from '../bridge/link';
import { BranchMessageZ } from '../bridge/messages';
import { BRIDGE_PORT } from '../bridge/protocol';
import { ChatGptClient, type BridgeResponse } from '../chatgpt/client';
import { loadChat } from '../export/load';
import { IndexedDbStore } from '../host/idb-store';
import { recordBranch, snapshotParent } from '../host/lineage';
import { QUICK_BUTTON_KEY, QUICK_DISMISSED_KEY, QuickMessageZ, quickButtonShown, type QuickScope, type QuickState } from './quick';
import { chatIdFromUrl, exportPageUrl } from './routes';

const EXPORT_PAGE = 'src/pages/export.html';
const store = new IndexedDbStore();

chrome.action.onClicked.addListener((tab) => void openExportPage(tab));

/**
 * Open (or focus) the export page for `tab`. `scope` comes from the floating button: the page opens on it, or an open
 * page switches to it.
 */
async function openExportPage(tab: chrome.tabs.Tab, scope?: QuickScope): Promise<void> {
  const onChatGpt = tab.url?.startsWith('https://chatgpt.com/') === true;
  const url = chrome.runtime.getURL(exportPageUrl(EXPORT_PAGE, onChatGpt ? tab.id : undefined, onChatGpt ? chatIdFromUrl(tab.url!) : undefined, scope));
  // One export page at a time: one request queue for the whole extension. A running export keeps its page, so a
  // second click only focuses it.
  // Found among the extension's own open pages, so one opened another way (a bookmark, a restored tab) counts too.
  const pages = await chrome.runtime.getContexts({ contextTypes: ['TAB' as chrome.runtime.ContextType] }).catch(() => []);
  const page = pages.find((c) => c.documentUrl?.startsWith(chrome.runtime.getURL(EXPORT_PAGE)));
  const pageTab = page?.tabId;
  const existing = pageTab === undefined || pageTab < 0 ? undefined : await chrome.tabs.get(pageTab).catch(() => undefined);
  if (existing?.id !== undefined) {
    // Clicked from a ChatGPT tab: the page follows that tab from now on (it may be another tab than before).
    if (onChatGpt && tab.id !== undefined) await chrome.runtime.sendMessage({ type: 'echoes:bind', tabId: tab.id }).catch(() => undefined);
    if (scope) await chrome.runtime.sendMessage({ type: 'echoes:scope', scope }).catch(() => undefined);
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url, ...(onChatGpt ? { index: tab.index + 1 } : {}) });
}

// The floating button on chatgpt.com: open the export page on an action, close the button for this browser session,
// and say whether to show it.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.url?.startsWith('https://chatgpt.com/') || !sender.tab) return;
  const m = QuickMessageZ.safeParse(message);
  if (!m.success) return;
  const tab = sender.tab;
  void (async () => {
    if (m.data.type === 'echoes:quick-open') await openExportPage(tab, m.data.scope);
    else if (m.data.type === 'echoes:quick-dismiss') await chrome.storage.session.set({ [QUICK_DISMISSED_KEY]: true });
    const local = await chrome.storage.local.get(QUICK_BUTTON_KEY);
    const session = await chrome.storage.session.get(QUICK_DISMISSED_KEY);
    reply({ show: quickButtonShown(local[QUICK_BUTTON_KEY], session[QUICK_DISMISSED_KEY]) } satisfies QuickState);
  })().catch(() => reply({ show: false } satisfies QuickState));
  return true; // answers asynchronously
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.url?.startsWith('https://chatgpt.com/')) return;
  const m = BranchMessageZ.safeParse(message);
  if (!m.success) return;
  const tabId = sender.tab?.id;
  void (async () => {
    const ref = await recordBranch(store, m.data);
    // Snapshot the source chat now, through the same tab: one chat, fetched politely, right after the user's own
    // action. This is the only fetch the service worker makes; exports run in the export page.
    if (tabId === undefined) return;
    const link = new BridgeLink(() => chrome.tabs.connect(tabId, { name: BRIDGE_PORT }));
    try {
      const client = new ChatGptClient({ origin: 'https://chatgpt.com', scheduler: new Scheduler<BridgeResponse>({ transport: bridgeTransport(link) }), learned: () => link.learned() });
      await snapshotParent(store, ref, async (id) => (await loadChat(id, { source: client })).conversation);
    } finally {
      link.close();
    }
  })().catch((e) => console.warn('[echoes] could not record a branch', e));
});
