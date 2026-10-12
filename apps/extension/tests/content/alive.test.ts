import { describe, expect, it } from 'vitest';
import { extensionAlive, quietly } from '../../src/content/alive';
import { installRelay } from '../../src/content/relay';
import { BRIDGE_CHANNEL } from '../../src/bridge/protocol';

const invalidated = () => {
  throw new Error('Extension context invalidated.');
};

describe('a content script after Echoes was reloaded', () => {
  it('knows the extension is gone', () => {
    expect(extensionAlive({ id: 'abc' })).toBe(true);
    expect(extensionAlive({})).toBe(false);
    expect(extensionAlive(undefined)).toBe(false);
    expect(extensionAlive(Object.defineProperty({}, 'id', { get: invalidated }))).toBe(false);
  });

  it('turns throws and rejections into nothing', async () => {
    await expect(quietly(invalidated)).resolves.toBeUndefined();
    await expect(quietly(() => Promise.reject(new Error('no')))).resolves.toBeUndefined();
    await expect(quietly(() => 7)).resolves.toBe(7);
  });

  it('the relay drops a branch event quietly when sending throws', () => {
    let onMessage: ((ev: MessageEvent) => void) | undefined;
    const win = { addEventListener: (_: 'message', f: (ev: MessageEvent) => void) => void (onMessage = f), postMessage: () => undefined };
    let tried = 0;
    const sendMessage = () => {
      tried++;
      return invalidated();
    };
    installRelay(win, { onConnect: { addListener: () => undefined }, sendMessage }, 'https://chatgpt.com');
    const data = { channel: BRIDGE_CHANNEL, dir: 'from-page', op: 'branch', t: 1, request: { url: '/x', method: 'POST' }, response: {} };
    expect(() => onMessage!({ source: win, data } as unknown as MessageEvent)).not.toThrow();
    expect(tried).toBe(1);
  });
});
