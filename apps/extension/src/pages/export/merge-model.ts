// "All in one file" for Many chats, without the UI: the order of the chats in the merged file and its default title.

import type { ChatGroup } from './controller';

/**
 * The order the merged file will use: the user's order for chats still ticked, then newly ticked chats in list
 * order. Unticked chats drop out; ticking them again puts them at the end.
 */
export function effectiveOrder(order: readonly string[], ticked: readonly string[]): string[] {
  const on = new Set(ticked);
  const kept = order.filter((id) => on.has(id));
  const known = new Set(kept);
  return [...kept, ...ticked.filter((id) => !known.has(id))];
}

/** `order` with the item at `from` moved to `to` (indexes clamped). */
export function moveItem<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
  return next;
}

/** The merged file's default title: the Project's name when every ticked chat is in it, else a general one. */
export function defaultMergeTitle(groups: readonly ChatGroup[] | undefined, ticked: readonly string[]): string {
  const on = new Set(ticked);
  const touched = (groups ?? []).filter((g) => g.chats.some((c) => on.has(c.id)));
  return touched.length === 1 && touched[0]!.projectId ? touched[0]!.name : 'ChatGPT chats';
}
