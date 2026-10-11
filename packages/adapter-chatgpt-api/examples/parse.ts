// Parse the raw responses of one ChatGPT chat (as the extension fetched them) into an Echoes tree.
// Run: node examples/parse.ts
import { readFileSync } from 'node:fs';
import { activePath, buildTurns, nodesOf, pathThrough, versionGroups } from '@echoes/core';
import { pageFollowUps, parseChatGptConversation, type ChatGptConversationCapture } from '@echoes/adapter-chatgpt-api';

export function main(): string[] {
  const capture: ChatGptConversationCapture = JSON.parse(
    readFileSync(new URL('../fixtures/project-chat-regenerated.json', import.meta.url), 'utf8'),
  );
  const out: string[] = [];

  // What the host would fetch next after the newest page: an older page, and the versions of flagged messages.
  const next = pageFollowUps(capture.conversation);
  out.push(`older page to fetch: ${next.olderCursor ? 'yes' : 'no'}; messages with versions: ${next.versionedMessageIds.length}`);

  // Throws ChatGptAdapterError (with paths) if a response changed shape; content it can't map stays as unknown blocks.
  const { conversation, warnings } = parseChatGptConversation(capture);
  const path = activePath(conversation);
  out.push(`nodes: ${Object.keys(conversation.nodes).length}, active path: ${path.length}, turns: ${buildTurns(nodesOf(conversation, path)).length}`);

  for (const g of versionGroups(conversation)) {
    out.push(`versions of one answer: ${g.nodeIds.length} (showing ${g.activeIndex + 1}/${g.nodeIds.length})`);
    const original = pathThrough(conversation, g.nodeIds[0]!);
    out.push(`original version path: ${original.length - path.indexOf(g.parentId) - 1} messages after the question`);
  }
  for (const w of warnings) out.push(`warning ${w.code}: ${w.message}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(main().join('\n'));
