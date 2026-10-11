// A chat list loaded earlier on the page goes stale: the user keeps chatting in ChatGPT, and an export that trusted
// the old dates would skip the chats that changed. Before each bulk export the page re-lists the groups the selection
// touches (the main list, or only the Projects involved) and exports with the dates ChatGPT reports now.

import type { ChatListItem } from '@echoes/adapter-chatgpt-api';
import type { ChatGroup } from './controller';

export interface FreshenScope {
  /** The selection includes chats outside Projects. */
  mainList: boolean;
  projectIds: string[];
}

export interface FreshLists {
  /** The main list, when it was re-listed. */
  chats?: ChatListItem[];
  projects?: { id: string; name: string; chats: ChatListItem[] }[];
}

export function scopeOf(groups: readonly ChatGroup[], selected: ReadonlySet<string>): FreshenScope {
  const scope: FreshenScope = { mainList: false, projectIds: [] };
  for (const g of groups) {
    if (!g.chats.some((c) => selected.has(c.id))) continue;
    if (g.projectId === undefined) scope.mainList = true;
    else scope.projectIds.push(g.projectId);
  }
  return scope;
}

/** The groups with re-listed ones replaced. Groups that were not re-listed are returned as they were. */
export function freshenGroups(groups: readonly ChatGroup[], fresh: FreshLists): ChatGroup[] {
  const projects = new Map((fresh.projects ?? []).map((p) => [p.id, p]));
  const inProjects = new Set(groups.flatMap((g) => (g.projectId === undefined ? [] : g.chats.map((c) => c.id))));
  for (const p of projects.values()) for (const c of p.chats) inProjects.add(c.id);
  return groups.map((g) => {
    if (g.projectId === undefined) return fresh.chats ? { ...g, chats: fresh.chats.filter((c) => !inProjects.has(c.id)) } : g;
    const p = projects.get(g.projectId);
    return p ? { ...g, name: p.name || g.name, chats: p.chats } : g;
  });
}
