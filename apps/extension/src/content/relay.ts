// Isolated-world relay between extension pages (runtime ports) and the main-world bridge (window messages).
// It holds no state of its own beyond which request ids belong to which port.

import { BranchMessageZ, BridgeReplyZ, PortRequestZ, type BranchMessage } from '../bridge/messages';
import { BRIDGE_CHANNEL, BRIDGE_PORT } from '../bridge/protocol';
import type { PortLike } from '../bridge/link';

export interface RelayWindow {
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface RelayRuntime {
  onConnect: { addListener(fn: (port: PortLike & { name: string }) => void): void };
  sendMessage(message: BranchMessage): Promise<unknown> | void;
}

export function installRelay(win: RelayWindow, runtime: RelayRuntime, origin: string): void {
  // Request ids are per port, so they are prefixed with a port number on the way to the page.
  const ports = new Map<number, PortLike>();
  let next = 0;

  runtime.onConnect.addListener((port) => {
    if (port.name !== BRIDGE_PORT) return;
    const n = ++next;
    ports.set(n, port);
    port.onDisconnect.addListener(() => ports.delete(n));
    port.onMessage.addListener((m) => {
      const r = PortRequestZ.safeParse(m);
      if (!r.success) return;
      win.postMessage({ ...r.data, id: `${n}:${r.data.id}`, channel: BRIDGE_CHANNEL, dir: 'to-page' }, origin);
    });
  });

  win.addEventListener('message', (ev) => {
    if (ev.source !== (win as unknown) || (ev.data as { channel?: unknown })?.channel !== BRIDGE_CHANNEL) return;
    const r = BridgeReplyZ.safeParse(ev.data);
    if (!r.success) return;
    const reply = r.data;
    if (reply.op === 'branch') {
      const msg = BranchMessageZ.parse({ type: 'echoes:branch', t: reply.t, request: reply.request, response: reply.response });
      void Promise.resolve(runtime.sendMessage(msg)).catch(() => undefined);
      return;
    }
    const at = reply.id.indexOf(':');
    const port = ports.get(Number(reply.id.slice(0, at)));
    if (!port) return;
    try {
      port.postMessage({ ...reply, id: reply.id.slice(at + 1) });
    } catch {
      /* the page closed its port */
    }
  });
}
