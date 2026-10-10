// Service worker: routing only. Phase 0 just opens the inspector page.
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/inspector.html') });
});
