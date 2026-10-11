// MAIN world, document_start. Observes only; see observe.ts and bridge/page.ts for the guarantees.
// It has no chrome.* APIs: everything goes to the isolated content script via window.postMessage.
// 1. The page bridge: learns how the app calls the API and runs Echoes' GET requests (bridge/page.ts).
// 2. Diagnostics records for the inspector (dropped by the content script unless capture is on).

import { installBridge } from '../bridge/page';
import { CHANNEL } from '../inspect/channel';
import { installObservers } from './observe';

const FLAG = Symbol.for('echoes.phase0.installed');
const w = window as unknown as Record<symbol, boolean>;

if (!w[FLAG]) {
  w[FLAG] = true;
  installBridge(window, { origin: window.location.origin });
  installObservers(
    window,
    (record) => window.postMessage({ channel: CHANNEL, record }, window.location.origin),
    { base: window.location.origin },
  );
}
