/** The chat id in a chatgpt.com URL: `/c/:id`, also inside a Project or GPT (`/g/:gizmo/c/:id`). */
export function chatIdFromUrl(url: string): string | undefined {
  try {
    const m = /\/c\/([A-Za-z0-9-]+)\/?$/.exec(new URL(url).pathname);
    return m?.[1];
  } catch {
    return undefined;
  }
}

export function exportPageUrl(page: string, tabId: number | undefined, chatId: string | undefined): string {
  const q = new URLSearchParams();
  if (tabId !== undefined) q.set('tab', String(tabId));
  if (chatId) q.set('chat', chatId);
  const s = q.toString();
  return s ? `${page}?${s}` : page;
}

/** What the ChatGPT tab shows: a chat, or no chat (home, settings, a Project page). */
export interface TabContext {
  tabId: number;
  chatId?: string;
  /** The tab's title, which ChatGPT sets to the chat's title (inferred from the web app, not from an API). */
  title?: string;
}

export function tabContext(tab: { id?: number | undefined; url?: string | undefined; title?: string | undefined }): TabContext | undefined {
  if (tab.id === undefined || !tab.url?.startsWith('https://chatgpt.com/')) return undefined;
  const ctx: TabContext = { tabId: tab.id };
  const chatId = chatIdFromUrl(tab.url);
  if (chatId) ctx.chatId = chatId;
  const title = tab.title?.trim();
  if (title && title !== 'ChatGPT') ctx.title = title;
  return ctx;
}
