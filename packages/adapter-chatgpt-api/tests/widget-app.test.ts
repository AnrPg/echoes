import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_SOURCE_FORMAT, parseChatGptConversation } from '@echoes/adapter-chatgpt-api';
import { head, msg } from './builders.ts';

// A real answer with a widget app (captured 2026-10-11, ids anonymized): the text holds a `genui` marker and
// `content_references` a `client_defined_widget` entry whose `data.content` is the app's HTML and script.
const answer = () => JSON.parse(readFileSync(new URL('./fixtures/app-block.message.json', import.meta.url), 'utf8'));
const parse = (a: Record<string, unknown>) => parseChatGptConversation({ conversation: head([msg('u', 'user', 'Show me a live widget'), a]) });

describe('widget apps (client_defined_widget)', () => {
  it('become a widget block in place of their marker, with the page kept verbatim', () => {
    const raw = answer();
    const html: string = raw.metadata.content_references[0].data.content;
    const r = parse(raw);
    const blocks = r.conversation.nodes['app-answer']!.blocks;
    expect(blocks.map((b) => b.kind)).toEqual(['markdown', 'widget', 'markdown']);
    expect(blocks[0]).toEqual({
      kind: 'markdown',
      text: 'Yes — this is the kind of **live interactive widget** you can run directly inside the conversation. Change the numbers/operation and press **Run**.',
    });
    expect(blocks[1]).toEqual({ kind: 'widget', sourceFormat: APP_SOURCE_FORMAT, source: html, view: [{ type: 'app', title: 'Live Code Widget', html }] });
    expect(html).toMatch(/^<div id="live-code-demo"[\s\S]*<script>[\s\S]*<\/script>\n<\/div>$/);
    expect((blocks[2] as { text: string }).text).toMatch(/^This is a real in-chat interactive widget/);
    expect(JSON.stringify(blocks)).not.toContain('');
    expect(r.warnings).toEqual([]);
  });

  it('keeps a widget of an unknown kind as a visible unknown block, with a warning', () => {
    const raw = answer();
    raw.metadata.content_references[0].data.widget_type = 'future_widget';
    const r = parse(raw);
    const blocks = r.conversation.nodes['app-answer']!.blocks;
    expect(blocks[1]).toMatchObject({ kind: 'unknown', contentType: 'client_defined_widget' });
    expect(r.warnings.map((w) => w.code)).toEqual(['unknown-content-type']);
  });

  it('leaves the marker to the citation path when the reference is not a widget', () => {
    const raw = answer();
    raw.metadata.content_references[0].type = 'grouped_webpages';
    raw.metadata.content_references[0].alt = '';
    const blocks = parse(raw).conversation.nodes['app-answer']!.blocks;
    expect(blocks.map((b) => b.kind)).toEqual(['markdown']);
  });
});
