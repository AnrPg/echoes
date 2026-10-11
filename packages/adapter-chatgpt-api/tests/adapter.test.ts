import { describe, expect, it, beforeEach } from 'vitest';
import { activePath, pathThrough, versionGroups, type Block } from '@echoes/core';
import { ChatGptAdapterError, ROOT_ID, pageFollowUps, parseChatGptConversation } from '@echoes/adapter-chatgpt-api';
import { head, msg, older, resetClock } from './builders.ts';

beforeEach(resetClock);

const blocksOf = (r: ReturnType<typeof parseChatGptConversation>, id: string): Block[] => r.conversation.nodes[id]!.blocks;
const codes = (r: ReturnType<typeof parseChatGptConversation>) => r.warnings.map((w) => w.code);

describe('active path', () => {
  it('chains pages oldest first under a hidden root and keeps conversation fields', () => {
    const old = older([msg('u1', 'user', 'Q1'), msg('a1', 'assistant', 'A1')]);
    const r = parseChatGptConversation({
      conversation: head([msg('u2', 'user', 'Q2'), msg('a2', 'assistant', 'A2')]),
      olderPages: [old],
    });
    const c = r.conversation;
    expect(activePath(c)).toEqual([ROOT_ID, 'u1', 'a1', 'u2', 'a2']);
    expect(c.nodes[ROOT_ID]).toMatchObject({ role: 'system', hidden: true, blocks: [] });
    expect(c).toMatchObject({
      id: 'conv-1',
      title: 'Synthetic chat',
      model: 'gpt-test',
      createdAt: '2023-11-14T22:13:20.500Z',
      sourceUrl: 'https://chatgpt.com/c/conv-1',
      activeLeafId: 'a2',
    });
    expect(c.projectId).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it('builds pages in fetch order: each older page goes before the ones fetched earlier', () => {
    resetClock();
    const p3 = [msg('u1', 'user', 'Q1')];
    const p2 = [msg('u2', 'user', 'Q2')];
    const p1 = [msg('u3', 'user', 'Q3')];
    const r = parseChatGptConversation({ conversation: head(p1), olderPages: [older(p2), older(p3)] });
    expect(activePath(r.conversation)).toEqual([ROOT_ID, 'u1', 'u2', 'u3']);
  });

  it('marks the root when older history was not fetched', () => {
    const r = parseChatGptConversation({ conversation: head([msg('u1', 'user', 'Q')], { page_info: { start_cursor: 'u1', end_cursor: 'u1', has_previous_page: true, has_next_page: false } }) });
    expect(r.conversation.nodes[ROOT_ID]!.notFetched).toBe('earlier-messages');
    expect(codes(r)).toEqual(['earlier-messages-not-fetched']);
  });

  it('sets projectId only for Projects (gizmo_type snorlax)', () => {
    const p = parseChatGptConversation({ conversation: head([msg('u', 'user', 'Q')], { gizmo_id: 'g-p-1', gizmo_type: 'snorlax' }) });
    const g = parseChatGptConversation({ conversation: head([msg('u', 'user', 'Q')], { gizmo_id: 'g-1', gizmo_type: 'gpt' }) });
    expect(p.conversation.projectId).toBe('g-p-1');
    expect(g.conversation.projectId).toBeUndefined();
  });

  it('handles a chat with no messages', () => {
    const r = parseChatGptConversation({ conversation: head([]) });
    expect(r.conversation.activeLeafId).toBe(ROOT_ID);
  });

  it('warns on duplicates, parent mismatches and page order, without dropping content', () => {
    resetClock();
    const newer = [msg('u2', 'user', 'Q2')];
    const old = [msg('u1', 'user', 'Q1'), msg('a1', 'assistant', 'A1', { metadata: { parent_id: 'root-hidden' } }), msg('a1b', 'assistant', 'A1b', { metadata: { parent_id: 'u1' } })];
    const r = parseChatGptConversation({ conversation: head([...newer, msg('u1', 'user', 'again')], { current_node: 'u2' }), olderPages: [older(old)] });
    expect(codes(r)).toEqual(['parent-mismatch', 'page-order', 'duplicate-message']);
  });

  it('records the source chat of a branched chat (the fork node comes from the branch monitor)', () => {
    const r = parseChatGptConversation({
      conversation: head([msg('u', 'user', 'Q', { metadata: { branching_from_conversation_id: 'src', branching_from_conversation_title: 'Source' } })]),
    });
    expect(r.branchedFrom).toEqual({ conversationId: 'src', title: 'Source' });
    expect(r.conversation.lineage).toBeUndefined();
  });
});

describe('versions', () => {
  it('a regenerated answer on the last turn: siblings under the shared question, original first, complete', () => {
    const q = msg('q', 'user', 'Q', { metadata: { has_versions: true } });
    const variant = msg('v2', 'assistant', 'New', { metadata: { message_type: 'variant' } });
    const original = [msg('q', 'user', 'Q'), msg('ctx', 'system', 'context', { weight: 0 }), msg('v1', 'assistant', 'Old')];
    // The original was written before the variant.
    (original[1] as any).create_time = 1_600_000_000;
    (original[2] as any).create_time = 1_600_000_001;
    const r = parseChatGptConversation({ conversation: head([q, variant]), versions: { q: [original] } });
    const c = r.conversation;
    expect(c.nodes.q!.childIds).toEqual(['ctx', 'v2']);
    expect(c.nodes.ctx!.hidden).toBe(true);
    expect(pathThrough(c, 'v1')).toEqual([ROOT_ID, 'q', 'ctx', 'v1']);
    expect(c.nodes.v1!.notFetched).toBeUndefined();
    expect(versionGroups(c)).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });

  it('an edited question on an earlier turn: sibling of the edit, later turns flagged as not fetched', () => {
    const r = parseChatGptConversation({
      conversation: head([
        msg('u1', 'user', 'Q1'), msg('a1', 'assistant', 'A1'),
        msg('u2e', 'user', 'Q2 edited', { metadata: { has_versions: true } }), msg('a2e', 'assistant', 'A2 for edit'),
        msg('u3', 'user', 'Q3'), msg('a3', 'assistant', 'A3'),
      ]),
      // Inferred shape for edits: the old question has its own id, followed by its answers.
      versions: { u2e: [[msg('u2', 'user', 'Q2'), msg('a2', 'assistant', 'A2')]] },
    });
    const c = r.conversation;
    expect(c.nodes.u2!.parentId).toBe('a1');
    expect(c.nodes.a1!.childIds).toContain('u2');
    expect(c.nodes.a2!.notFetched).toBe('later-messages');
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'later-messages-not-fetched', messageId: 'a2' })]);
  });

  it('several versions in one response become several siblings', () => {
    const q = msg('q', 'user', 'Q', { metadata: { has_versions: true } });
    const r = parseChatGptConversation({
      conversation: head([q, msg('a3', 'assistant', 'third')]),
      versions: { q: [[msg('q', 'user', 'Q'), msg('a1', 'assistant', 'first')], [msg('q', 'user', 'Q'), msg('a2', 'assistant', 'second')]] },
    });
    // Builders hand out increasing times in call order: a3 was created before a1 and a2 here.
    expect(r.conversation.nodes.q!.childIds).toEqual(['a3', 'a1', 'a2']);
  });

  it('warns when versions belong to a message that is not on the path, or rejoin it', () => {
    const r = parseChatGptConversation({
      conversation: head([msg('q', 'user', 'Q'), msg('a', 'assistant', 'A')]),
      versions: { nope: [[msg('x', 'user', 'X')]], q: [[msg('q', 'user', 'Q'), msg('b', 'assistant', 'B'), msg('a', 'assistant', 'A')]] },
    });
    expect(codes(r)).toEqual(['versions-anchor-missing', 'version-rejoins-path']);
    expect(r.conversation.nodes.x).toBeUndefined();
  });
});

describe('content', () => {
  it('maps text, thoughts, recap, tool calls and tool output; never reads raw thoughts', () => {
    const r = parseChatGptConversation({
      conversation: head([
        msg('u', 'user', 'Q'),
        msg('call', 'assistant', { content_type: 'code', language: 'json', text: '{"q":1}' }, { recipient: 'q7dr546' }),
        msg('search', 'assistant', '', { recipient: 'web.run' }),
        msg('call2', 'assistant', 'search("x")', { recipient: 'web.run' }),
        msg('out', 'tool', 'results'),
        msg('th', 'assistant', { content_type: 'thoughts', thoughts: [{ summary: 'Searched 3 sites', content: 'SECRET' }, { summary: '', content: 'SECRET2' }] }),
        msg('rc', 'assistant', { content_type: 'reasoning_recap', content: 'Worked for 19s' }),
        msg('mem', 'assistant', { content_type: 'model_editable_context', model_set_context: 'likes tea' }, { metadata: { is_visually_hidden_from_conversation: true } }),
        msg('a', 'assistant', { content_type: 'text', parts: ['Part 1', '', 'Part 2'] }),
      ]),
    });
    expect(blocksOf(r, 'call')).toEqual([{ kind: 'code', lang: 'json', text: '{"q":1}', origin: 'tool' }]);
    expect(blocksOf(r, 'search')).toEqual([]);
    expect(blocksOf(r, 'call2')).toEqual([{ kind: 'code', text: 'search("x")', origin: 'tool' }]);
    expect(blocksOf(r, 'out')).toEqual([{ kind: 'toolOutput', text: 'results' }]);
    expect(blocksOf(r, 'th')).toEqual([{ kind: 'reasoning', summary: 'Searched 3 sites' }]);
    expect(blocksOf(r, 'rc')).toEqual([{ kind: 'reasoning', summary: 'Worked for 19s' }]);
    expect(r.conversation.nodes.mem).toMatchObject({ hidden: true, blocks: [{ kind: 'markdown', text: 'likes tea' }] });
    expect(blocksOf(r, 'a')).toEqual([{ kind: 'markdown', text: 'Part 1' }, { kind: 'markdown', text: 'Part 2' }]);
    expect(JSON.stringify(r.conversation)).not.toContain('SECRET');
    expect(r.warnings).toEqual([]);
  });

  it('maps execution_output (what a tool printed) to tool output', () => {
    const r = parseChatGptConversation({
      conversation: head([
        msg('u', 'user', 'Q'),
        msg('call', 'assistant', { content_type: 'code', language: 'unknown', text: 'bash -lc ls' }, { recipient: 'container.exec' }),
        msg('out', 'tool', { content_type: 'execution_output', text: 'a.txt\nb.txt' }),
      ]),
    });
    expect(blocksOf(r, 'out')).toEqual([{ kind: 'toolOutput', text: 'a.txt\nb.txt' }]);
    expect(r.warnings).toEqual([]);
  });

  it("converts an answer's layout markup and keeps its widget's code, saying what it could not carry over", () => {
    const answer = '<box gap={2}><title>Ιδέα</title><AsyncImage query="veal stew"/>{@body const xs = make()}{#each xs as x}<checkbox>{x}</checkbox>{/each}</box>';
    const r = parseChatGptConversation({ conversation: head([msg('u', 'user', '<box>as typed</box>'), msg('a', 'assistant', answer)]) });
    expect(blocksOf(r, 'u')).toEqual([{ kind: 'markdown', text: '<box>as typed</box>' }]);
    expect(blocksOf(r, 'a')).toEqual([
      {
        kind: 'widget',
        sourceFormat: 'chatgpt-widget',
        source: answer,
        view: [
          {
            type: 'group',
            direction: 'column',
            children: [
              { type: 'markdown', text: '**Ιδέα**\n\n*[Image: veal stew]*' },
              { type: 'unsupported', text: 'Part of this widget could not be read; its code is kept in the JSON export' },
            ],
          },
        ],
      },
    ]);
    expect(codes(r)).toEqual(['layout-image-not-exported', 'widget-not-exported']);
  });

  it('keeps unknown and mismatched content as visible unknown blocks with a warning', () => {
    const future = { content_type: 'future_widget', payload: { x: 1 } };
    const broken = { content_type: 'text', text: 'parts went missing' };
    const r = parseChatGptConversation({ conversation: head([msg('u', 'user', future), msg('a', 'assistant', broken)]) });
    expect(blocksOf(r, 'u')).toEqual([{ kind: 'unknown', contentType: 'future_widget', raw: future }]);
    expect(blocksOf(r, 'a')).toEqual([{ kind: 'unknown', contentType: 'text', raw: broken }]);
    expect(codes(r)).toEqual(['unknown-content-type', 'content-mismatch']);
    expect(r.warnings[1]!.message).toContain('parts');
  });

  it('replaces citation markers with what the web app shows and lists each source once', () => {
    const cite = 'citeturn0search1';
    const mem = 'memcite';
    const stray = 'citeturn9search9';
    const r = parseChatGptConversation({
      conversation: head([
        msg('u', 'user', 'Q'),
        msg('a', 'assistant', `Fact ${cite} and again ${cite}. Remembered${mem}. Odd ${stray}`, {
          metadata: {
            content_references: [
              { type: 'grouped_webpages', matched_text: cite, alt: '([Nature](https://nature.example/a))', items: [{ title: 'Nature', url: 'https://nature.example/a' }] },
              { type: 'hidden', matched_text: mem, alt: null },
              { type: 'sources_footnote', matched_text: ' ', alt: null, sources: [{ title: 'Nature', url: 'https://nature.example/a' }, { title: null, url: 'https://b.example' }] },
            ],
          },
        }),
      ]),
    });
    expect(blocksOf(r, 'a')).toEqual([
      { kind: 'markdown', text: `Fact ([Nature](https://nature.example/a)) and again ([Nature](https://nature.example/a)). Remembered. Odd ${stray}` },
      { kind: 'citation', title: 'Nature', url: 'https://nature.example/a' },
      { kind: 'citation', url: 'https://b.example' },
    ]);
    expect(codes(r)).toEqual(['unresolved-citation-marker']);
  });

  it('maps multimodal images and attachments (assumed stored shape, see README)', () => {
    const r = parseChatGptConversation({
      conversation: head([
        msg('u', 'user', { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_abc', width: 10 }, 'What is this?'] }, {
          metadata: { attachments: [{ id: 'file_abc', name: 'photo.jpg', mime_type: 'image/jpeg' }, { id: 'file_doc', name: 'notes.pdf', mime_type: 'application/pdf' }] },
        }),
        msg('a', 'assistant', { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-gen' }, { content_type: 'audio_asset_pointer' }] }),
      ]),
    });
    expect(blocksOf(r, 'u')).toEqual([
      { kind: 'image', resource: { fileId: 'file_abc', mime: 'image/jpeg', status: 'pending' }, generated: false },
      { kind: 'markdown', text: 'What is this?' },
      { kind: 'attachment', resource: { fileId: 'file_doc', name: 'notes.pdf', mime: 'application/pdf', status: 'pending' } },
    ]);
    expect(blocksOf(r, 'a')).toEqual([
      { kind: 'image', resource: { fileId: 'file-gen', status: 'pending' }, generated: true },
      { kind: 'unknown', contentType: 'audio_asset_pointer', raw: { content_type: 'audio_asset_pointer' } },
    ]);
    expect(codes(r)).toEqual(['unknown-content-type']);
  });
});

describe('fails loudly on shape changes', () => {
  it('lists every raw-shape issue with its path', () => {
    const bad = head([msg('u', 'user', 'Q')]) as any;
    bad.messages[0].author.role = 'moderator';
    delete bad.page_info;
    const err = (() => {
      try {
        parseChatGptConversation({ conversation: bad, olderPages: [{ messages: 'nope' }] });
      } catch (e) {
        return e;
      }
    })() as ChatGptAdapterError;
    expect(err).toBeInstanceOf(ChatGptAdapterError);
    expect(err.issues.map((i) => i.path.join('.'))).toEqual([
      'conversation.messages.0.author.role',
      'conversation.page_info',
      'olderPages.0.messages',
      'olderPages.0.page_info',
    ]);
    expect(err.message).toContain('conversation.messages.0.author.role');
  });

  it('rejects a current_node that is not the end of the path', () => {
    expect(() => parseChatGptConversation({ conversation: head([msg('u', 'user', 'Q'), msg('a', 'assistant', 'A')], { current_node: 'u' }) })).toThrow(
      /current_node/,
    );
  });
});

describe('pageFollowUps', () => {
  it('returns the older cursor while older pages exist, and the messages with versions', () => {
    const page = older([msg('u1', 'user', 'Q', { metadata: { has_versions: true } }), msg('a1', 'assistant', 'A')], true);
    expect(pageFollowUps(page)).toEqual({ olderCursor: 'u1', versionedMessageIds: ['u1'] });
    expect(pageFollowUps(older([msg('u0', 'user', 'Q')], false)).olderCursor).toBeNull();
    expect(() => pageFollowUps({})).toThrow(ChatGptAdapterError);
  });
});
