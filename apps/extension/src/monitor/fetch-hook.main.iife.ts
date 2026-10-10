// MAIN world, document_start. Observes only; see observe.ts for the guarantees.
// It has no chrome.* APIs: records go to the isolated content script via window.postMessage.

import { CHANNEL } from '../inspect/channel';
import { installObservers } from './observe';

const FLAG = Symbol.for('echoes.phase0.installed');
const w = window as unknown as Record<symbol, boolean>;

if (!w[FLAG]) {
  w[FLAG] = true;
  installObservers(
    window,
    (record) => window.postMessage({ channel: CHANNEL, record }, window.location.origin),
    { base: window.location.origin },
  );
}
