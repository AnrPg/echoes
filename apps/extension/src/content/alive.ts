// After Echoes is updated or reloaded, content scripts already running in open chatgpt.com tabs keep running, but
// every chrome.runtime and chrome.storage call from them throws "Extension context invalidated". These helpers let
// them notice that and go quiet instead of filling the extension's error list.

/** False once this content script's extension was reloaded, updated or removed. */
export function extensionAlive(runtime: { id?: string } | undefined = globalThis.chrome?.runtime): boolean {
  try {
    return Boolean(runtime?.id);
  } catch {
    return false;
  }
}

/** Runs `fn`, turning a throw or a rejection into `undefined`. */
export function quietly<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return Promise.resolve(fn()).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}
