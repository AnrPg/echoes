import { describe, expect, it } from 'vitest';
import { BridgeLink, type PortLike } from '../../src/bridge/link';
import { BRIDGE_CHANNEL } from '../../src/bridge/protocol';

/** A port to a fake tab that answers each `state` request when told to. */
function fakeTab(name: string) {
  const ports: { sent: { id: string }[]; reply(id: string): void; disconnected: boolean }[] = [];
  const connect = (): PortLike => {
    const listeners: ((m: unknown) => void)[] = [];
    const p = {
      sent: [] as { id: string }[],
      disconnected: false,
      reply: (id: string) => listeners.forEach((l) => l({ channel: BRIDGE_CHANNEL, dir: 'from-page', id, op: 'error', message: name })),
    };
    ports.push(p);
    return {
      postMessage: (m) => void p.sent.push(m as { id: string }),
      onMessage: { addListener: (fn) => void listeners.push(fn) },
      onDisconnect: { addListener: () => undefined },
      disconnect: () => void (p.disconnected = true),
    };
  };
  return { ports, connect };
}

describe('BridgeLink.reconnect', () => {
  it('lets calls in flight finish on the old tab, then connects to the new one', async () => {
    const a = fakeTab('a');
    const b = fakeTab('b');
    let current = a;
    const link = new BridgeLink(() => current.connect());
    const first = link.learned().catch((e: Error) => e.message);
    current = b;
    link.reconnect();
    expect(a.ports[0]!.disconnected).toBe(false); // not cut off mid-call
    a.ports[0]!.reply(a.ports[0]!.sent[0]!.id);
    expect(await first).toBe('a');
    expect(a.ports[0]!.disconnected).toBe(true);
    const second = link.learned().catch((e: Error) => e.message);
    b.ports[0]!.reply(b.ports[0]!.sent[0]!.id);
    expect(await second).toBe('b');
  });

  it('switches at once when nothing is in flight', () => {
    const a = fakeTab('a');
    const b = fakeTab('b');
    let current = a;
    const link = new BridgeLink(() => current.connect());
    void link.learned().catch(() => undefined);
    a.ports[0]!.reply(a.ports[0]!.sent[0]!.id);
    current = b;
    link.reconnect();
    expect(a.ports[0]!.disconnected).toBe(true);
    void link.learned().catch(() => undefined);
    expect(b.ports).toHaveLength(1);
  });
});
