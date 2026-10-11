import { describe, expect, it } from 'vitest';
import { tabContext } from '../../src/background/routes';

describe('tabContext', () => {
  it('reads a plain chat and its title', () => {
    expect(tabContext({ id: 7, url: 'https://chatgpt.com/c/abc-123', title: 'Kant notes' })).toEqual({ tabId: 7, chatId: 'abc-123', title: 'Kant notes' });
  });

  it('reads a chat inside a Project or GPT', () => {
    expect(tabContext({ id: 7, url: 'https://chatgpt.com/g/g-p-6a1b-thesis/c/abc', title: 'Ch. 2' })).toEqual({ tabId: 7, chatId: 'abc', title: 'Ch. 2' });
  });

  it('has no chat on the home page or a Project page, and drops the generic title', () => {
    expect(tabContext({ id: 7, url: 'https://chatgpt.com/', title: 'ChatGPT' })).toEqual({ tabId: 7 });
    expect(tabContext({ id: 7, url: 'https://chatgpt.com/g/g-p-6a1b/project' })).toEqual({ tabId: 7 });
  });

  it('ignores other sites and tabs without an id', () => {
    expect(tabContext({ id: 7, url: 'https://example.com/c/abc' })).toBeUndefined();
    expect(tabContext({ url: 'https://chatgpt.com/c/abc' })).toBeUndefined();
  });
});
