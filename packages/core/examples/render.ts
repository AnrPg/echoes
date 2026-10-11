// Render an Echoes conversation as Markdown in each flavor, and convert a single text.
// Run: node examples/render.ts
import { readFileSync } from 'node:fs';
import { MARKDOWN_FLAVORS, TURN_PRESETS, convertMarkdownText, parseConversation, pathThrough, renderMarkdown } from '@echoes/core';

export function main(): string[] {
  const json = readFileSync(new URL('./sample-conversation.json', import.meta.url), 'utf8');
  const conversation = parseConversation(JSON.parse(json));
  const out: string[] = [];

  // One text: LaTeX delimiters become the flavor's math syntax, `$` in prose is escaped, code is untouched.
  const text = 'Area \\(\\pi r^2\\) costs $5; run `echo $HOME`.';
  for (const flavor of MARKDOWN_FLAVORS) out.push(`${flavor}: ${convertMarkdownText(text, flavor)}`);

  // A whole chat: the first version of the edited question with its own answer, as Obsidian study notes.
  const md = renderMarkdown(conversation, {
    flavor: 'obsidian',
    path: pathThrough(conversation, 'u2a'),
    turns: TURN_PRESETS.studyNotes,
    resolveResource: (r) => `files/${r.name ?? r.fileId}`, // where the host saved the file, or undefined
  });
  out.push(...md.split('\n').filter((l) => l.startsWith('#') || l.startsWith('_Version')));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(main().join('\n'));
