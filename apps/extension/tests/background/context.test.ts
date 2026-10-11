import { describe, expect, it } from 'vitest';
import { projectMatches, tabContext } from '../../src/background/routes';

describe('tabContext', () => {
  it('reads a plain chat and its title', () => {
    expect(tabContext({ id: 7, url: 'https://chatgpt.com/c/abc-123', title: 'Kant notes' })).toEqual({ tabId: 7, chatId: 'abc-123', title: 'Kant notes' });
  });

  it('reads a chat inside a Project or GPT', () => {
    expect(tabContext({ id: 7, url: 'https://chatgpt.com/g/g-p-6a1b-thesis/c/abc', title: 'Ch. 2' })).toEqual({ tabId: 7, chatId: 'abc', title: 'Ch. 2' });
  });

  it('has no chat on the home page or a Project page, and drops the generic title', () => {
    expect(tabContext({ id: 7, url: 'https://chatgpt.com/', title: 'ChatGPT' })).toEqual({ tabId: 7 });
    expect(tabContext({ id: 7, url: 'https://chatgpt.com/g/g-p-6a1b/project' })).toEqual({ tabId: 7, projectSegment: 'g-p-6a1b' });
  });

  it('ignores other sites and tabs without an id', () => {
    expect(tabContext({ id: 7, url: 'https://example.com/c/abc' })).toBeUndefined();
    expect(tabContext({ url: 'https://chatgpt.com/c/abc' })).toBeUndefined();
  });

  it('recognises a Project page, but not a chat inside a Project, and matches the segment to the Project id', () => {
    expect(tabContext({ id: 7, url: 'https://chatgpt.com/g/g-p-6a1b-thesis/project', title: 'ChatGPT - Thesis' })).toEqual({ tabId: 7, projectSegment: 'g-p-6a1b-thesis', title: 'ChatGPT - Thesis' });
    expect(tabContext({ id: 7, url: 'https://chatgpt.com/g/g-p-6a1b/c/abc' })!.projectSegment).toBeUndefined();
    expect(tabContext({ id: 7, url: 'https://chatgpt.com/g/g-6a1b-mygpt' })!.projectSegment).toBeUndefined();
    expect(projectMatches('g-p-6a1b-thesis', 'g-p-6a1b')).toBe(true);
    expect(projectMatches('g-p-6a1b', 'g-p-6a1b')).toBe(true);
    expect(projectMatches('g-p-6a1bc', 'g-p-6a1b')).toBe(false);
  });
});
