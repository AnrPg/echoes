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
  /**
   * On a Project's own page (`/g/g-p-<id>[-slug]/project`, seen in the web app, unverified): that path segment. Match
   * it to a Project id with {@link projectMatches}, never by parsing the slug.
   */
  projectSegment?: string;
  /** The tab's title, which ChatGPT sets to the chat's title (inferred from the web app, not from an API). */
  title?: string;
}

export function tabContext(tab: { id?: number | undefined; url?: string | undefined; title?: string | undefined }): TabContext | undefined {
  if (tab.id === undefined || !tab.url?.startsWith('https://chatgpt.com/')) return undefined;
  const ctx: TabContext = { tabId: tab.id };
  const chatId = chatIdFromUrl(tab.url);
  if (chatId) ctx.chatId = chatId;
  else {
    const segment = projectSegmentFromUrl(tab.url);
    if (segment) ctx.projectSegment = segment;
  }
  const title = tab.title?.trim();
  if (title && title !== 'ChatGPT') ctx.title = title;
  return ctx;
}

/** The `g-p-…` path segment of a Project page URL, or undefined for any other page (a chat inside a Project too). */
export function projectSegmentFromUrl(url: string): string | undefined {
  try {
    return /^\/g\/(g-p-[A-Za-z0-9-]+)\/project\/?$/.exec(new URL(url).pathname)?.[1];
  } catch {
    return undefined;
  }
}

/** Whether a URL's Project segment names this Project id (the id, optionally followed by `-` and a slug). */
export function projectMatches(segment: string, projectId: string): boolean {
  return segment === projectId || segment.startsWith(`${projectId}-`);
}
