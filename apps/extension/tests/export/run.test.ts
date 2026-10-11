import { JobCheckpoints, MemoryStore, parseManifest, type LineageRef } from '@echoes/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, exportChats, printableChat, resumeExport, type ChatSource, type ExportRunOptions } from '../../src/export/run';
import { FolderSink, ZipSink } from '../../src/host/sinks';
import { harness } from '../bridge/harness';
import { IMAGE_BYTES, IMAGE_CHAT_ID, PLAIN_CHAT_ID, PROJECT_CHAT_ID, state } from '../fake-chatgpt';
import { FakeDir, readZip } from '../host/fakes';

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 11, 12, 0, clock++)).toISOString();

async function setup() {
  const h = await harness();
  const chats = [...(await h.client.listChats()), ...(await h.client.listProjects()).flatMap((p) => p.chats)];
  const root = new FakeDir();
  const store = new MemoryStore();
  const opts = (): ExportRunOptions => ({ source: h.client, sink: new FolderSink(root), store, now });
  return { h, chats, root, store, opts };
}

const conversationRequests = () => state.log.filter((l) => /^\/backend-api\/conversations\/[^/?]+\?/.test(l));
const PROJECT_DOC = 'Anonymized Project chat with a regenerated last answer.md';
const PROJECT_TREE = 'Anonymized Project chat with a regenerated last answer.tree.json';
const PROJECT_BRANCH2 = 'Anonymized Project chat with a regenerated last answer (branch 2).md';

describe('bulk export to a folder', () => {
  it('writes every chat, its files, the manifest and a report', async () => {
    const { chats, root, opts } = await setup();
    const r = await exportChats(chats, DEFAULT_SETTINGS, 'job-1', opts());
    expect(r.job.items.map((i) => i.status)).toEqual(['done', 'done', 'done']);
    expect(Object.keys(root.tree()).sort()).toEqual([PROJECT_DOC, PROJECT_TREE, 'Cat picture.md', 'Cat picture_files/cat.jpg', 'Plain chat.md', 'echoes-report.json', 'manifest.json'].sort());
    const tree = root.tree();
    expect(tree['Cat picture.md']).toContain('](Cat%20picture_files/cat.jpg)');
    expect(tree['Plain chat.md']).toContain('\\$5'); // rendered by core, `$` escaped
    const manifest = parseManifest(tree['manifest.json']!);
    expect(manifest.conversations[IMAGE_CHAT_ID]).toMatchObject({ files: ['Cat picture.md', 'Cat picture_files/cat.jpg'], activeLeafId: expect.any(String), contentHash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    // The manifest keeps the list's updatedAt, the value the next run compares against.
    expect(manifest.conversations[PLAIN_CHAT_ID]!.updatedAt).toBe(chats.find((c) => c.id === PLAIN_CHAT_ID)!.updatedAt);
    expect(r.reasons).toEqual({ [IMAGE_CHAT_ID]: 'new', [PLAIN_CHAT_ID]: 'new', [PROJECT_CHAT_ID]: 'new' });
    expect(JSON.parse(tree['echoes-report.json']!).items).toHaveLength(3);
  });

  it('a second run skips unchanged chats without fetching them', async () => {
    const { chats, opts } = await setup();
    await exportChats(chats, DEFAULT_SETTINGS, 'job-1', opts());
    state.log.length = 0;
    const r = await exportChats(chats, DEFAULT_SETTINGS, 'job-2', opts());
    expect(r.job.items.map((i) => i.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(conversationRequests()).toEqual([]);
  });

  it('re-check catches a chat changed without a new updatedAt, and leaves identical chats untouched', async () => {
    const { chats, root, opts } = await setup();
    await exportChats(chats, DEFAULT_SETTINGS, 'job-1', opts());
    const before = root.tree();
    state.chats[PLAIN_CHAT_ID]!.messages[1]!.content = { content_type: 'multimodal_text', parts: ['Edited silently.'] };
    try {
      const r = await exportChats(chats, DEFAULT_SETTINGS, 'job-2', opts(), { recheckBefore: '2100-01-01T00:00:00Z' });
      expect(r.reasons).toEqual({ [IMAGE_CHAT_ID]: 'recheck', [PLAIN_CHAT_ID]: 'recheck', [PROJECT_CHAT_ID]: 'recheck' });
      expect(r.verified.sort()).toEqual([IMAGE_CHAT_ID, PROJECT_CHAT_ID].sort());
      const after = root.tree();
      expect(after['Plain chat.md']).toContain('Edited silently.');
      expect(after['Cat picture.md']).toBe(before['Cat picture.md']);
      expect(parseManifest(after['manifest.json']!).conversations[IMAGE_CHAT_ID]!.exportedAt).not.toBe(parseManifest(before['manifest.json']!).conversations[IMAGE_CHAT_ID]!.exportedAt);
    } finally {
      state.chats[PLAIN_CHAT_ID]!.messages[1]!.content = { content_type: 'multimodal_text', parts: ['Just text, $5 and \\(x^2\\).'] };
    }
  });

  it('a failing chat is reported and does not stop the others', async () => {
    const { chats, root, opts } = await setup();
    const r = await exportChats([{ id: 'gone', title: 'Deleted chat', updatedAt: '2026-10-01T00:00:00.000Z' }, ...chats], DEFAULT_SETTINGS, 'job-1', opts());
    expect(r.job.items.map((i) => [i.conversationId === 'gone', i.status])).toEqual([[true, 'failed'], [false, 'done'], [false, 'done'], [false, 'done']]);
    const report = JSON.parse(root.tree()['echoes-report.json']!);
    expect(report.items[0]).toMatchObject({ conversationId: 'gone', status: 'failed', error: expect.stringContaining('HTTP 404') });
  });

  it('a stopped export resumes where it stopped', async () => {
    const { h, chats, root, store, opts } = await setup();
    let seen = 0;
    const stopping: ExportRunOptions = {
      ...opts(),
      onProgress: (job) => {
        if (job.items.filter((i) => i.status === 'done').length === 1 && seen++ === 0) h.scheduler.cancel();
      },
    };
    await expect(exportChats(chats, DEFAULT_SETTINGS, 'job-1', stopping)).rejects.toThrow();
    const saved = (await new JobCheckpoints(store).load('job-1'))!;
    expect(saved.items.map((i) => i.status)).toEqual(['done', 'pending', 'pending']);

    const h2 = await harness(); // a fresh queue, as after reopening the export page
    const r = await resumeExport('job-1', { ...opts(), source: h2.client });
    expect(r.job.items.map((i) => i.status)).toEqual(['done', 'done', 'done']);
    expect(Object.keys(parseManifest(root.tree()['manifest.json']!).conversations)).toHaveLength(3);
  });

  it('JSON format marks saved files ok; lineage from the branch log is attached', async () => {
    const { chats, root, opts } = await setup();
    const link: LineageRef = { parentConversationId: PLAIN_CHAT_ID, forkNodeId: 'm1', childConversationId: IMAGE_CHAT_ID, detectedAt: '2026-10-10T00:00:00.000Z', evidence: 'recorded', confidence: 1 };
    await exportChats(chats.filter((c) => c.id === IMAGE_CHAT_ID), { ...DEFAULT_SETTINGS, format: 'json' }, 'job-1', {
      ...opts(),
      lineage: async (id) => (id === IMAGE_CHAT_ID ? link : undefined),
    });
    const doc = JSON.parse(root.tree()['Cat picture.json']!);
    expect(doc.lineage).toEqual(link);
    expect(JSON.stringify(doc)).toContain('"status":"ok"');
  });

  it('settings changes re-export; attachments off writes no files', async () => {
    const { chats, root, opts } = await setup();
    await exportChats(chats, { ...DEFAULT_SETTINGS, attachments: false }, 'job-1', opts());
    expect(Object.keys(root.tree())).not.toContain('Cat picture_files/cat.jpg');
    expect(root.tree()['Cat picture.md']).not.toContain('cat.jpg');
    const r = await exportChats(chats, DEFAULT_SETTINGS, 'job-2', opts());
    expect(Object.values(r.reasons)).toEqual(['settings', 'settings', 'settings']);
  });
});

describe('versions', () => {
  const project = (chats: { id: string }[]) => chats.filter((c) => c.id === PROJECT_CHAT_ID) as typeof chats & never[];

  it('active only: the shown branch, named, with the tree diagram and tree.json', async () => {
    const { chats, root, opts } = await setup();
    await exportChats(project(chats) as any, DEFAULT_SETTINGS, 'job-1', opts());
    const doc = root.tree()[PROJECT_DOC]!;
    expect(doc).toMatch(/^branch: "Turn \d+: answer version 2 of 2"$/m);
    expect(doc).toContain('## Conversation tree\n\n```mermaid\nflowchart TD');
    expect(JSON.parse(root.tree()[PROJECT_TREE]!)).toMatchObject({ format: 'echoes-tree', traversals: [{}, {}] });
  });

  it('all versions as sections: shared turns once, a section per branch', async () => {
    const { chats, root, opts } = await setup();
    await exportChats(project(chats) as any, { ...DEFAULT_SETTINGS, versions: 'all' }, 'job-1', opts());
    const doc = root.tree()[PROJECT_DOC]!;
    expect(doc).toContain('branches: 2');
    expect(doc.match(/^## Branch \d of 2\b/gm)).toHaveLength(2);
    expect(Object.keys(root.tree())).not.toContain(PROJECT_BRANCH2);
  });

  it('all versions as files: one document per branch, all in the manifest', async () => {
    const { chats, root, opts } = await setup();
    await exportChats(project(chats) as any, { ...DEFAULT_SETTINGS, versions: 'all', branchOutput: 'files' }, 'job-1', opts());
    expect(root.tree()[PROJECT_BRANCH2]).toMatch(/^branch: "Turn \d+: answer version 1 of 2"$/m);
    expect(parseManifest(root.tree()['manifest.json']!).conversations[PROJECT_CHAT_ID]!.files).toEqual([PROJECT_DOC, PROJECT_BRANCH2, PROJECT_TREE]);
  });

  it('a chat without versions gets no tree files', async () => {
    const { chats, root, opts } = await setup();
    await exportChats(chats.filter((c) => c.id === PLAIN_CHAT_ID), { ...DEFAULT_SETTINGS, versions: 'all' }, 'job-1', opts());
    expect(Object.keys(root.tree()).filter((n) => n.includes('tree'))).toEqual([]);
    expect(root.tree()['Plain chat.md']).not.toContain('branch');
  });
});

describe('HTML and PDF', () => {
  it('HTML: one self-contained page per chat, files linked, math as MathML, chosen theme', async () => {
    const { chats, root, opts } = await setup();
    await exportChats(chats, { ...DEFAULT_SETTINGS, format: 'html', theme: 'chatgpt' }, 'job-1', opts());
    const tree = root.tree();
    expect(Object.keys(tree).filter((n) => n.endsWith('.html')).sort()).toEqual([PROJECT_DOC.replace(/\.md$/, '.html'), 'Cat picture.html', 'Plain chat.html'].sort());
    expect(tree['Cat picture.html']).toContain('<img src="Cat%20picture_files/cat.jpg" alt="Generated image" loading="lazy">');
    expect(tree['Plain chat.html']).toContain('<body class="theme-chatgpt">');
    expect(tree['Plain chat.html']).toContain('Just text, $5 and');
    expect(tree['Plain chat.html']).toContain('<math');
  });

  it('HTML with all versions as files: one page per branch', async () => {
    const { chats, root, opts } = await setup();
    await exportChats(chats.filter((c) => c.id === PROJECT_CHAT_ID), { ...DEFAULT_SETTINGS, format: 'html', versions: 'all', branchOutput: 'files' }, 'job-1', opts());
    expect(Object.keys(root.tree())).toContain(PROJECT_BRANCH2.replace(/\.md$/, '.html'));
  });

  it('PDF page: images embedded as data URLs, nothing left to link', async () => {
    const { h } = await setup();
    const page = await printableChat(IMAGE_CHAT_ID, { ...DEFAULT_SETTINGS, theme: 'print' }, { source: h.client });
    expect(page.title).toBe('Cat picture');
    expect(page.html).toContain('<img src="data:image/jpeg;base64,/9j/4AECA//Z" alt="Generated image"');
    expect(page.html).toContain('<body class="theme-print">');
    expect(page.warnings).toEqual([]);
  });

  it('PDF page without attachments: images become placeholders', async () => {
    const { h } = await setup();
    const page = await printableChat(IMAGE_CHAT_ID, { ...DEFAULT_SETTINGS, attachments: false }, { source: h.client });
    expect(page.html).not.toContain('<img');
    expect(page.html).toContain('class="missing"');
  });
});

describe('resources by turn', () => {
  it('writes a folder per chat with files, code and links by turn, plus index.md and resources.json', async () => {
    const { chats, root, opts } = await setup();
    await exportChats(chats, { ...DEFAULT_SETTINGS, format: 'resources' }, 'job-1', opts());
    const tree = root.tree();
    expect(Object.keys(tree).filter((n) => n.startsWith('Cat picture/')).sort()).toEqual(['Cat picture/index.md', 'Cat picture/resources.json', 'Cat picture/turn-01/file-cat.jpg']);
    expect(tree['Cat picture/index.md']).toContain('- Generated image: [file-cat.jpg](turn-01/file-cat.jpg)');
    expect(parseManifest(tree['manifest.json']!).conversations[IMAGE_CHAT_ID]!.files[0]).toBe('Cat picture/index.md');
    expect(tree['Plain chat/index.md']).toContain('This chat has no files');
    const project = Object.keys(tree).filter((n) => n.startsWith('Anonymized Project chat'));
    expect(project.some((n) => /\/turn-\d\d\/links\.md$/.test(n))).toBe(true);
  });

  it('a second run into the same folder skips unchanged chats', async () => {
    const { chats, opts } = await setup();
    const settings = { ...DEFAULT_SETTINGS, format: 'resources' as const };
    await exportChats(chats, settings, 'job-1', opts());
    const r = await exportChats(chats, settings, 'job-2', opts());
    expect(r.job.items.map((i) => i.status)).toEqual(['skipped', 'skipped', 'skipped']);
  });
});

describe('lineage during export', () => {
  const BRANCH_ID = '00000000-0000-4000-8000-00000000b2a0';
  /** A chat made with "Branch in new chat" from the plain chat: its messages copied (new ids, same times), one more turn. */
  function addBranch(withMetadata: boolean) {
    const plain = state.chats[PLAIN_CHAT_ID]!;
    const copy = structuredClone(plain.messages).map((m, i) => ({ ...m, id: `b-${i}`, metadata: withMetadata && i === 0 ? { branching_from_conversation_id: PLAIN_CHAT_ID } : {} }));
    const t = plain.update_time + 1000;
    const more = [
      { ...copy[0]!, id: 'b-2', create_time: t, content: { content_type: 'text', parts: ['And then?'] }, metadata: {} },
      { ...copy[1]!, id: 'b-3', create_time: t + 5, content: { content_type: 'text', parts: ['Then this.'] }, metadata: {} },
    ];
    state.chats[BRANCH_ID] = { ...structuredClone(plain), conversation_id: BRANCH_ID, title: 'Branched chat', create_time: t - 10, update_time: t + 10, current_node: 'b-3', messages: [...copy, ...more], page_info: { ...plain.page_info, start_cursor: 'b-0', end_cursor: 'b-3' } };
  }
  const cleanup = () => delete state.chats[BRANCH_ID];

  it('links a branch named by ChatGPT\'s metadata to its source, finding the fork', async () => {
    addBranch(true);
    try {
      const { chats, root, opts } = await setup();
      await exportChats(chats.filter((c) => c.id === BRANCH_ID || c.id === PLAIN_CHAT_ID), DEFAULT_SETTINGS, 'job-1', opts());
      const doc = root.tree()['Branched chat.md']!;
      expect(doc).toContain(`branched_from: "${PLAIN_CHAT_ID}"`);
      expect(doc).toContain('branch_evidence: "api-metadata"');
      expect(doc).toMatch(/branched_at_message: "[^"]+0002"/); // the plain chat's answer, the last shared message
    } finally {
      cleanup();
    }
  });

  it('a source not exported yet is reported, not guessed', async () => {
    addBranch(true);
    try {
      const { chats, root, opts } = await setup();
      const r = await exportChats(chats.filter((c) => c.id === BRANCH_ID), DEFAULT_SETTINGS, 'job-1', opts());
      expect(root.tree()['Branched chat.md']).not.toContain('branched_from');
      expect(r.warnings[BRANCH_ID]!.join()).toContain('export that chat too');
    } finally {
      cleanup();
    }
  });

  it('infers a branch without metadata from the shared start, labelled inferred', async () => {
    addBranch(false);
    try {
      const { chats, root, opts } = await setup();
      await exportChats(chats.filter((c) => c.id === BRANCH_ID || c.id === PLAIN_CHAT_ID), DEFAULT_SETTINGS, 'job-1', opts());
      expect(root.tree()['Branched chat.md']).toContain('branch_evidence: "inferred"');
    } finally {
      cleanup();
    }
  });
});

describe('export to a zip', () => {
  it('streams every file, manifest last', async () => {
    const { chats, store, h } = await setup();
    const chunks: Uint8Array[] = [];
    const sink = new ZipSink(new WritableStream({ write: (c) => void chunks.push(c) }), new Date('2026-10-11T00:00:00Z'));
    await exportChats(chats, DEFAULT_SETTINGS, 'job-z', { source: h.client, sink, store, now });
    await sink.close();
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) bytes.set(c, (o += c.length) - c.length);
    const names = [...readZip(bytes).keys()];
    expect(names.slice(-2).sort()).toEqual(['echoes-report.json', 'manifest.json']);
    expect(names).toContain('Cat picture_files/cat.jpg');
  });
});

describe('images ChatGPT found on the web', () => {
  // Shaped like the recipe chat captured on 2026-10-11: the tag in the text, what the web app found in the metadata.
  const text = 'Βήμα 1\n\n<box><AsyncImage query="beef shank cut into 1.5 cm chunks" aspectRatio="1:1"/> Κόψε το κρέας.</box>';
  const message = (id: string, role: string, part: string, metadata: object = {}) => ({
    id,
    author: { role, name: null, metadata: {} },
    create_time: 1_791_730_000,
    content: { content_type: 'text', parts: [part] },
    recipient: 'all',
    weight: 1,
    metadata,
  });
  const metadata = {
    genui_components: [{ type: 'async_image', component_resolution_id: 'img-1', start_index: text.indexOf('<AsyncImage'), end_index: text.indexOf('/>') + 2 }],
    model_dil_v2: {
      appData: {
        opGenui: {
          componentResults: {
            'img-1': { componentName: 'AsyncImage', status: 'resolved', state: { images: [{ content_url: 'https://images.openai.com/static-rsc-4/abc', title: 'Beinscheiben', url: 'https://www.cooknsoul.de/beinscheiben/' }] } },
          },
        },
      },
    },
  };
  const conversation = {
    conversation_id: 'web-1',
    title: 'Web images',
    create_time: 1_791_730_000,
    update_time: 1_791_730_100,
    current_node: 'a',
    messages: [message('u', 'user', 'Δείξε μου'), message('a', 'assistant', text, metadata)],
    page_info: { start_cursor: 'u', end_cursor: 'a', has_previous_page: false, has_next_page: false },
  };
  const source = (log: string[], withUrl = true): ChatSource => ({
    fetchConversation: async () => ({ conversation }),
    downloadFile: async () => ({ ok: false, reason: 'not a ChatGPT file' }),
    ...(withUrl ? { downloadUrl: async (url: string) => (log.push(url), { ok: true as const, bytes: IMAGE_BYTES, mime: 'image/jpeg' }) } : {}),
  });
  const chat = { id: 'web-1', title: 'Web images', updatedAt: '2026-10-11T12:00:00.000Z' };

  it('saves them next to the document and links them, with their source page', async () => {
    const log: string[] = [];
    const root = new FakeDir();
    await exportChats([chat], DEFAULT_SETTINGS, 'job-web', { source: source(log), sink: new FolderSink(root), store: new MemoryStore(), now });
    const tree = root.tree();
    expect(log).toEqual(['https://images.openai.com/static-rsc-4/abc']);
    expect(Object.keys(tree)).toContain('Web images_files/beef shank cut into 1.5 cm chunks.jpg');
    expect(tree['Web images.md']).toContain(
      '![beef shank cut into 1.5 cm chunks](Web%20images_files/beef%20shank%20cut%20into%201.5%20cm%20chunks.jpg)\n*Source: [Beinscheiben](https://www.cooknsoul.de/beinscheiben/)*',
    );
  });

  it('embeds them in the PDF page', async () => {
    const page = await printableChat('web-1', DEFAULT_SETTINGS, { source: source([]) });
    expect(page.html).toContain('<img src="data:image/jpeg;base64,/9j/4AECA//Z" alt="beef shank cut into 1.5 cm chunks"');
    expect(page.warnings).toEqual([]);
  });

  it('a host that cannot download web images shows a note with the source page and says why', async () => {
    const page = await printableChat('web-1', DEFAULT_SETTINGS, { source: source([], false) });
    expect(page.html).toContain('[Image not included: beef shank cut into 1.5 cm chunks] Source: <a href="https://www.cooknsoul.de/beinscheiben/">Beinscheiben</a>');
    expect(page.warnings).toEqual(['file-unavailable: beef shank cut into 1.5 cm chunks: this host does not download web images']);
  });
});
