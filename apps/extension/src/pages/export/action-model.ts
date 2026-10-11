// The export page's one big button, without the UI: what it says, why it is disabled, and the one-line summary of the
// settings next to it. The page (app.tsx) only draws this.

import { MARKDOWN_FLAVORS } from '@echoes/core';
import type { PageSettings } from './controller';
import { includeSummary } from './include-model';

/** What the page exports: the open chat, some of its turns, or many chats at once. */
export type Scope = 'chat' | 'turns' | 'many';

/** The Format menu's choices: the file formats, plus PDF (printed from HTML). */
export type FormatChoice = PageSettings['format'] | 'pdf';

export const FORMAT_NAMES: Record<FormatChoice, string> = {
  markdown: 'Markdown',
  html: 'HTML',
  pdf: 'PDF',
  json: 'Echoes JSON',
  resources: 'Resources only',
};

export const FLAVOR_NAMES: Record<(typeof MARKDOWN_FLAVORS)[number], string> = { github: 'GitHub', obsidian: 'Obsidian', commonmark: 'CommonMark' };

export function formatOf(s: PageSettings): FormatChoice {
  return s.pdf ? 'pdf' : s.format;
}

/** The settings after choosing `choice` in the Format menu. PDF keeps the file format for when the user goes back. */
export function withFormat(s: PageSettings, choice: FormatChoice): PageSettings {
  return choice === 'pdf' ? { ...s, pdf: true } : { ...s, pdf: false, format: choice };
}

export interface ActionState {
  scope: Scope;
  settings: PageSettings;
  connected: boolean;
  busy: boolean;
  /** A chat is open in the ChatGPT tab. */
  chatOpen: boolean;
  /** Turns picked in the turn picker (undefined while it loads). */
  pickedTurns?: number | undefined;
  /** Chats ticked in the list (undefined before the list is loaded). */
  pickedChats?: number | undefined;
}

export interface PrimaryAction {
  label: string;
  /** Why the button cannot be pressed now, in words for the user. Undefined when it can. */
  blocked?: string;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function primaryAction(a: ActionState): PrimaryAction {
  const fmt = formatOf(a.settings);
  const as = FORMAT_NAMES[fmt];
  let label: string;
  let blocked: string | undefined;
  switch (a.scope) {
    case 'chat':
      label = fmt === 'pdf' ? 'Save this chat as PDF' : `Export this chat as ${as}`;
      if (!a.chatOpen) blocked = 'Open a chat in the ChatGPT tab first.';
      break;
    case 'turns': {
      const n = a.pickedTurns ?? 0;
      label = fmt === 'pdf' ? `Save ${plural(n, 'turn')} as PDF` : `Export ${plural(n, 'turn')} as ${as}`;
      if (!a.chatOpen) blocked = 'Open a chat in the ChatGPT tab first.';
      else if (a.pickedTurns === undefined) blocked = 'Loading the chat…';
      else if (n === 0) blocked = 'Tick at least one turn.';
      break;
    }
    case 'many': {
      const n = a.pickedChats ?? 0;
      const chats = a.pickedChats === undefined ? 'chats' : plural(n, 'chat');
      const oneFile = isOneFile(a.settings);
      if (fmt === 'pdf') label = `Save ${chats} as one PDF`;
      else if (oneFile) label = `Export ${chats} into one ${as} file`;
      else label = `Export ${chats} as ${as}`;
      if (fmt === 'pdf' && !oneFile) blocked = 'A PDF is one document: choose "All in one file" under Files, or another format.';
      else if (a.pickedChats === undefined) blocked = 'Load your chats first.';
      else if (n === 0) blocked = 'Tick at least one chat.';
      break;
    }
  }
  if (!blocked && !a.connected) blocked = 'Open chatgpt.com and log in first.';
  if (!blocked && a.busy) blocked = 'Wait for the current task to finish.';
  return blocked ? { label, blocked } : { label };
}

/** Many chats go into one file (Resources only is always a folder per chat). */
export function isOneFile(s: PageSettings): boolean {
  return s.layout === 'merged' && formatOf(s) !== 'resources';
}

/** The settings in one line, next to the button: "HTML · Like ChatGPT look · Full archive · all versions". */
export function settingsSummary(s: PageSettings, scope: Scope, themeName: (t: PageSettings['theme']) => string): string {
  const fmt = formatOf(s);
  const parts = [FORMAT_NAMES[fmt]];
  if (fmt === 'markdown') parts.push(`${FLAVOR_NAMES[s.flavor]} style`);
  if (fmt === 'html' || fmt === 'pdf') parts.push(`${themeName(s.theme)} look`);
  if ((fmt === 'html' || fmt === 'pdf') && s.colorScheme !== 'auto') parts.push(s.colorScheme === 'dark' ? 'dark' : 'light');
  if (fmt !== 'resources') parts.push(includeSummary(s.turns));
  if (scope !== 'turns') parts.push(s.versions === 'all' ? 'all versions' : 'shown version only');
  if (scope === 'many' && fmt !== 'resources') parts.push(isOneFile(s) ? 'one file' : 'a file per chat');
  return parts.join(' · ');
}
