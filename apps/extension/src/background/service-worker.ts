// Service worker: routing only. Long jobs never run here (MV3 stops idle workers); they run in the export page.
// 1. The toolbar button opens (or focuses) the export page, passing the ChatGPT tab and the open chat.
// 2. Branch-monitor messages from chatgpt.com tabs are written to the lineage log, with a snapshot of the source chat.

import { Scheduler } from '@echoes/core';
import { BridgeLink, bridgeTransport } from '../bridge/link';
import { BranchMessageZ } from '../bridge/messages';
import { BRIDGE_PORT } from '../bridge/protocol';
import { ChatGptClient, type BridgeResponse } from '../chatgpt/client';
import { loadChat } from '../export/load';
import { IndexedDbStore } from '../host/idb-store';
import { recordBranch, snapshotParent } from '../host/lineage';
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
