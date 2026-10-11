// Chrome's Memory Saver can unload ("discard") a tab the user is not looking at. A discarded ChatGPT tab cuts an
// export off, and a discarded export tab stops it. While a job runs, both tabs are marked not discardable; each
// tab's own setting comes back afterwards. Needs no permission beyond what the extension has.

/** The part of chrome.tabs this uses; tests pass a fake. */
export interface TabsApi {
  get(tabId: number): Promise<{ id?: number; autoDiscardable?: boolean }>;
  update(tabId: number, props: { autoDiscardable: boolean }): Promise<unknown>;
}

/** Mark the tabs not discardable; the returned function restores them. Never throws (a closed tab is skipped). */
export async function keepTabsAwake(tabs: TabsApi, tabIds: (number | undefined)[]): Promise<() => Promise<void>> {
  const changed: number[] = [];
  for (const id of new Set(tabIds)) {
    if (id === undefined) continue;
    try {
      const tab = await tabs.get(id);
      if (tab.autoDiscardable === false) continue; // already kept by the user or another job: leave it alone
      await tabs.update(id, { autoDiscardable: false });
      changed.push(id);
    } catch {
      // closed or not ours to change
    }
  }
  return async () => {
    for (const id of changed) await tabs.update(id, { autoDiscardable: true }).catch(() => undefined);
  };
}
