import type { ListProgress } from '../../chatgpt/client';

/** One line on how far loading the chat list has got, so a long list never looks stuck. */
export function listingText(p: ListProgress, oneProject: boolean): string {
  const chats = `${p.chats} chat${p.chats === 1 ? '' : 's'}`;
  if (oneProject) return `Found ${chats} in this Project so far…`;
  if (p.projects === 0) return `Found ${chats} so far…`;
  return `Found ${chats} so far. Projects listed: ${p.projectsDone} of ${p.projects}…`;
}
