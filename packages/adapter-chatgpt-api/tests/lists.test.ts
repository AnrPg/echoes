import { describe, expect, it } from 'vitest';
import {
  ChatGptAdapterError,
  parseChatListPage,
  parseFileDownload,
  parseNewBranch,
  parseProjectChatsPage,
  parseProjectSidebar,
} from '@echoes/adapter-chatgpt-api';

// Shapes follow the Phase 0 capture reports; ids and titles are made up.
const listItem = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Chat ${id}`,
  create_time: '2026-10-01T09:00:00.123456Z',
  update_time: '2026-10-02T09:00:00.5Z',
  current_node: null,
  mapping: null,
  gizmo_id: null,
  is_archived: false,
  memory_scope: 'global_enabled',
  ...extra,
});

describe('parseChatListPage', () => {
  it('maps items and computes the next offset from total', () => {
    const page = parseChatListPage({ items: [listItem('a'), listItem('b', { gizmo_id: 'g-p-1', title: null })], total: 3, limit: 2, offset: 0 });
    expect(page.chats).toEqual([
      { id: 'a', title: 'Chat a', createdAt: '2026-10-01T09:00:00.123Z', updatedAt: '2026-10-02T09:00:00.500Z', archived: false },
      { id: 'b', title: '', createdAt: '2026-10-01T09:00:00.123Z', updatedAt: '2026-10-02T09:00:00.500Z', projectId: 'g-p-1', archived: false },
    ]);
    expect(page.nextOffset).toBe(2);
    expect(parseChatListPage({ items: [listItem('c')], total: 3, limit: 2, offset: 2 }).nextOffset).toBeNull();
  });

  it('without total, a full page means more and a short or empty page ends', () => {
    expect(parseChatListPage({ items: [listItem('a'), listItem('b')], limit: 2, offset: 4 }).nextOffset).toBe(6);
    expect(parseChatListPage({ items: [listItem('a')], limit: 2, offset: 4 }).nextOffset).toBeNull();
    expect(parseChatListPage({ items: [], total: 10, limit: 2, offset: 4 }).nextOffset).toBeNull();
  });

  it('accepts Unix seconds too, and fails loudly on a bad date or missing field', () => {
    expect(parseChatListPage({ items: [listItem('a', { update_time: 1791664347.5 })] }).chats[0]!.updatedAt).toBe('2026-10-10T20:32:27.500Z');
    expect(() => parseChatListPage({ items: [listItem('a', { update_time: 'yesterday' })] })).toThrow(/items.*update_time.*not a date/);
    expect(() => parseChatListPage({ items: [{ title: 'x', update_time: 1 }] })).toThrow(ChatGptAdapterError);
  });
});

describe('Projects', () => {
  it('parses a Project chats page; an empty cursor ends it', () => {
    const page = parseProjectChatsPage({ cursor: 'next-1', items: [listItem('p1', { gizmo_id: 'g-p-1' })] });
    expect(page.nextCursor).toBe('next-1');
    expect(page.chats.map((c) => [c.id, c.projectId])).toEqual([['p1', 'g-p-1']]);
    expect(parseProjectChatsPage({ cursor: null, items: [] }).nextCursor).toBeNull();
    expect(parseProjectChatsPage({ items: [] }).nextCursor).toBeNull();
  });

  it('parses the sidebar: Projects with names and their first page', () => {
    const sidebar = parseProjectSidebar({
      cursor: null,
      items: [
        {
          gizmo: { files: [], gizmo: { id: 'g-p-1', gizmo_type: 'snorlax', display: { name: 'Thesis', emoji: 'folder' } } },
          conversations: { cursor: 'c2', items: [listItem('p1', { gizmo_id: 'g-p-1' })] },
        },
        { gizmo: { gizmo: { id: 'g-p-2' } } },
      ],
    });
    expect(sidebar).toEqual({
      nextCursor: null,
      projects: [
        { id: 'g-p-1', name: 'Thesis', firstPage: { nextCursor: 'c2', chats: [expect.objectContaining({ id: 'p1', projectId: 'g-p-1' })] } },
        { id: 'g-p-2', name: '', firstPage: { nextCursor: null, chats: [] } },
      ],
    });
  });
});

describe('parseNewBranch', () => {
  it('takes the fork from the request and the new chat from the response', () => {
    expect(
      parseNewBranch(
        { conversation_id: 'parent', message_id: 'fork-msg' },
        { conversation: { conversation_id: 'child', current_node: 'leaf', create_time: 1791664347.1, mapping: {} } },
      ),
    ).toEqual({ parentConversationId: 'parent', forkMessageId: 'fork-msg', childConversationId: 'child' });
    expect(() => parseNewBranch({ conversation_id: 'p' }, {})).toThrow(/newBranchRequest.*message_id/);
  });
});

describe('parseFileDownload', () => {
  it('returns the signed URL on success and reports anything else', () => {
    expect(parseFileDownload({ status: 'success', download_url: 'https://chatgpt.com/backend-api/estuary/content?id=f', file_name: 'a.jpg', file_size_bytes: 10, mime_type: null })).toEqual({
      ok: true,
      url: 'https://chatgpt.com/backend-api/estuary/content?id=f',
      fileName: 'a.jpg',
      sizeBytes: 10,
    });
    expect(parseFileDownload({ status: 'error', download_url: null })).toEqual({ ok: false, status: 'error' });
  });
});
