import { describe, expect, it } from 'vitest';
import { emptyLearnedState, learn } from '../../src/bridge/protocol';
import { REMEMBERED_KEY, mergeRemembered, parseRemembered, rememberingLearned, withRemembered } from '../../src/bridge/remembered';

const ORIGIN = 'https://chatgpt.com';

function onChatPage() {
  const s = emptyLearnedState();
  learn(s, new URL(`${ORIGIN}/backend-api/conversations/x?include_has_versions=true&num_turns=12`), true);
  return s;
}

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    data,
    area: {
      get: async (k: string) => ({ [k]: data[k] }),
      set: async (v: Record<string, unknown>) => void Object.assign(data, v),
    } as unknown as chrome.storage.StorageArea,
  };
}

describe('remembered templates', () => {
  it('fills a template the reloaded tab has not seen yet, but never the session flag', () => {
    const remembered = mergeRemembered(undefined, onChatPage());
    const reloaded = emptyLearnedState(); // a Project page after a reload: no chat loaded
    const state = withRemembered(reloaded, remembered);
    expect(state.templates.conversation).toEqual([['include_has_versions', 'true'], ['num_turns', '12']]);
    expect(state.authSeen).toBe(false);
  });

  it('prefers what the tab learned now', () => {
    const now = emptyLearnedState();
    learn(now, new URL(`${ORIGIN}/backend-api/conversations/x?num_turns=20`), true);
    expect(withRemembered(now, mergeRemembered(undefined, onChatPage())).templates.conversation).toEqual([['num_turns', '20']]);
  });

  it('ignores malformed storage', () => {
    expect(parseRemembered(undefined)).toBeUndefined();
    expect(parseRemembered({ templates: 'nope' })).toBeUndefined();
  });

  it('stores what was learned and uses it after the tab forgot it', async () => {
    const storage = memoryStorage();
    await rememberingLearned(async () => onChatPage(), storage.area)();
    expect(storage.data[REMEMBERED_KEY]).toBeDefined();
    expect(JSON.stringify(storage.data[REMEMBERED_KEY])).not.toMatch(/auth/);
    const after = await rememberingLearned(async () => ({ ...emptyLearnedState(), authSeen: true }), storage.area)();
    expect(after.templates.conversation).toEqual([['include_has_versions', 'true'], ['num_turns', '12']]);
  });
});
