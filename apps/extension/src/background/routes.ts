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
