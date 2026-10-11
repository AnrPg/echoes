// Render a conversation as Markdown in two flavors, and convert math delimiters in a single string.
// Run: node examples/markdown.ts
import { readFileSync } from 'node:fs';
import { TURN_PRESETS, convertMath, parseConversation, renderMarkdown } from '@echoes/core';

export function main(): string[] {
  const conversation = parseConversation(JSON.parse(readFileSync(new URL('./sample-conversation.json', import.meta.url), 'utf8')));
  const github = renderMarkdown(conversation); // active path, every part of each turn, YAML front matter
  const notes = renderMarkdown(conversation, { flavor: 'obsidian', turns: TURN_PRESETS.studyNotes });
  return [
    `github: ${github.split('\n').length} lines, starts with ${JSON.stringify(github.split('\n')[0])}`,
    `obsidian study notes: ${notes.includes('Tool output') ? 'with' : 'without'} tool output`,
    // Math delimiters change only outside code; a price's $ is escaped so it is not read as math.
    convertMath('Area \\(\\pi r^2\\) costs $5, but `\\(code\\)` stays'),
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(main().join('\n'));
