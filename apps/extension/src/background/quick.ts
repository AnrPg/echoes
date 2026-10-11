// The floating quick-action button on chatgpt.com, without the UI: which actions a page offers, the messages between
// the button and the service worker, and where its on/off state lives.

import { z } from 'zod';
import { chatIdFromUrl, projectSegmentFromUrl } from './routes';

/** chrome.storage.local: `false` turns the button off everywhere until switched on again on the export page. */
export const QUICK_BUTTON_KEY = 'echoes:quick-button';
/** chrome.storage.session: set when the user closed the button; it stays away until the browser restarts. */
export const QUICK_DISMISSED_KEY = 'quickButtonDismissed';

/** What the export page opens on. Matches the page's scopes; `project` is "Many chats" with this Project loaded. */
export type QuickScope = 'chat' | 'turns' | 'project';

export interface QuickAction {
  scope: QuickScope;
  label: string;
}

/** The actions for a chatgpt.com address: a chat offers the chat and its turns, a Project page its chats. */
export function quickActionsFor(url: string): QuickAction[] {
  if (chatIdFromUrl(url)) {
    return [
      { scope: 'chat', label: 'Export this chat' },
      { scope: 'turns', label: 'Pick turns to export' },
    ];
  }
  if (projectSegmentFromUrl(url)) return [{ scope: 'project', label: "Export this Project's chats" }];
  return [];
}

export const QuickMessageZ = z.discriminatedUnion('type', [
  z.object({ type: z.literal('echoes:quick-open'), scope: z.enum(['chat', 'turns', 'project']) }),
  z.object({ type: z.literal('echoes:quick-dismiss') }),
  z.object({ type: z.literal('echoes:quick-state') }),
]);
export type QuickMessage = z.infer<typeof QuickMessageZ>;

/** The answer to `echoes:quick-state`. */
export interface QuickState {
  show: boolean;
}

/** Shown unless switched off (stored `false`) or closed in this browser session. */
export function quickButtonShown(enabled: unknown, dismissed: unknown): boolean {
  return enabled !== false && dismissed !== true;
}
