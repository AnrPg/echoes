import { describe, expect, it } from 'vitest';
import { MAX_LOG_ENTRIES, appendLog, checkEntry, notesEntry } from '../../src/pages/export/activity';

describe('activity log', () => {
  it('appends entries with the chat they were about, and keeps earlier ones when the chat changes', () => {
    let log = appendLog([], { level: 'info', title: 'Exporting this chat' }, 'Chat: Recipes', 1);
    log = appendLog(log, { level: 'ok', title: 'Done' }, 'Chat: Songs', 2);
    expect(log.map((e) => [e.id, e.context, e.title])).toEqual([
      [1, 'Chat: Recipes', 'Exporting this chat'],
      [2, 'Chat: Songs', 'Done'],
    ]);
  });

  it('stays bounded', () => {
    let log = appendLog([], { level: 'info', title: 'x' }, 'c', 0);
    for (let i = 0; i < MAX_LOG_ENTRIES + 5; i++) log = appendLog(log, { level: 'info', title: String(i) }, 'c', i);
    expect(log).toHaveLength(MAX_LOG_ENTRIES);
    expect(log.at(-1)!.title).toBe(String(MAX_LOG_ENTRIES + 4));
  });

  it('turns warnings and checks into readable entries', () => {
    expect(notesEntry('PDF ready', [])).toEqual({ level: 'ok', title: 'PDF ready' });
    expect(notesEntry('PDF', ['a: x', 'a: x']).lines).toEqual([{ text: 'x (2 times)' }]);
    const c = checkEntry({ ok: true, checks: [{ name: 'Chat', ok: true, detail: 'fine' }, { name: 'Projects', ok: true, skipped: true, detail: 'none' }] });
    expect(c.level).toBe('ok');
    expect(c.lines!.map((l) => l.text.slice(0, 10))).toEqual(['✓ Chat: fi', '– Projects', 'Lines mark']);
  });
});
