// What the bridge learned lives in the ChatGPT tab's memory and is lost on every reload. A tab that was reloaded on a
// Project page has not loaded a chat yet, so exporting from there failed with "Open any chat once". The query
// templates (parameter names and the app's values, never headers or the token) are kept in extension storage, so a
// template seen once keeps working after reloads. What the tab learned now always wins over what was remembered.

import { LearnedStateZ } from './messages';
import { emptyLearnedState, type LearnedState } from './protocol';

export const REMEMBERED_KEY = 'echoes.learnedTemplates';

/** The part of the learned state that is safe and useful to keep: query templates only. */
export type RememberedTemplates = Pick<LearnedState, 'templates' | 'chatListVariants'>;

export function rememberable(live: LearnedState): RememberedTemplates {
  return { templates: live.templates, chatListVariants: live.chatListVariants };
}

/** Live state with the gaps filled from what was remembered. `authSeen` is only ever the live value. */
export function withRemembered(live: LearnedState, remembered: RememberedTemplates | undefined): LearnedState {
  if (!remembered) return live;
  return {
    ...live,
    templates: { ...remembered.templates, ...live.templates },
    chatListVariants: live.chatListVariants.length ? live.chatListVariants : remembered.chatListVariants,
  };
}

/** Merge what the tab learned now into what was remembered, for storing. */
export function mergeRemembered(remembered: RememberedTemplates | undefined, live: LearnedState): RememberedTemplates {
  return rememberable(withRemembered(live, remembered));
}

/** Parse stored templates; anything malformed is ignored, as if nothing was remembered. */
export function parseRemembered(stored: unknown): RememberedTemplates | undefined {
  const r = LearnedStateZ.safeParse({ ...emptyLearnedState(), ...(typeof stored === 'object' && stored ? stored : {}) });
  return r.success && stored ? rememberable(r.data) : undefined;
}

/**
 * Wrap a live `learned()` so it fills gaps from extension storage and stores what is new. Storage failures never
 * break a request: the live state is used as it is.
 */
export function rememberingLearned(live: () => Promise<LearnedState>, storage: chrome.storage.StorageArea): () => Promise<LearnedState> {
  return async () => {
    const state = await live();
    let remembered: RememberedTemplates | undefined;
    try {
      remembered = parseRemembered((await storage.get(REMEMBERED_KEY))[REMEMBERED_KEY]);
      const next = mergeRemembered(remembered, state);
      if (JSON.stringify(next) !== JSON.stringify(remembered)) await storage.set({ [REMEMBERED_KEY]: next });
    } catch {
      return state;
    }
    return withRemembered(state, remembered);
  };
}
