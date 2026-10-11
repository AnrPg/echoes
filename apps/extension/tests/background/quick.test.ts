import { describe, expect, it } from 'vitest';
import { QuickMessageZ, quickActionsFor, quickButtonShown } from '../../src/background/quick';
import { exportPageUrl } from '../../src/background/routes';

describe('floating button', () => {
  it('offers the chat and its turns on a chat, also inside a Project', () => {
    for (const url of ['https://chatgpt.com/c/abc-123', 'https://chatgpt.com/g/g-p-xyz-notes/c/abc-123']) {
      expect(quickActionsFor(url).map((a) => a.scope)).toEqual(['chat', 'turns']);
    }
  });

  it("offers a Project's chats on a Project page, and nothing elsewhere", () => {
    expect(quickActionsFor('https://chatgpt.com/g/g-p-xyz-notes/project').map((a) => a.scope)).toEqual(['project']);
    expect(quickActionsFor('https://chatgpt.com/')).toEqual([]);
    expect(quickActionsFor('https://chatgpt.com/gpts')).toEqual([]);
  });

  it('shows unless switched off for good or closed for the session', () => {
    expect(quickButtonShown(undefined, undefined)).toBe(true);
    expect(quickButtonShown(true, undefined)).toBe(true);
    expect(quickButtonShown(false, undefined)).toBe(false);
    expect(quickButtonShown(true, true)).toBe(false);
  });

  it('accepts only its own messages', () => {
    expect(QuickMessageZ.safeParse({ type: 'echoes:quick-open', scope: 'turns' }).success).toBe(true);
    expect(QuickMessageZ.safeParse({ type: 'echoes:quick-open', scope: 'everything' }).success).toBe(false);
    expect(QuickMessageZ.safeParse({ type: 'echoes:bind', tabId: 1 }).success).toBe(false);
  });

  it('opens the export page on the asked scope', () => {
    expect(exportPageUrl('p.html', 7, 'abc', 'turns')).toBe('p.html?tab=7&chat=abc&scope=turns');
    expect(exportPageUrl('p.html', 7, 'abc')).toBe('p.html?tab=7&chat=abc');
  });
});
