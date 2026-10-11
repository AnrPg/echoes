import { describe, expect, it } from 'vitest';
import { PdfMaker, PdfStoppedError, lazyPdfPrinter, type DebuggerLike, type TabsLike } from '../../src/host/pdf-maker';

function fakes() {
  const calls: string[] = [];
  const listeners = new Set<(s: { tabId?: number }, reason: string) => void>();
  const tabs: TabsLike & { open: Set<number> } = {
    open: new Set(),
    create: async (p) => {
      calls.push(`tabs.create ${p.url} active=${p.active}`);
      tabs.open.add(7);
      return { id: 7 };
    },
    remove: async (id) => {
      calls.push(`tabs.remove ${id}`);
      tabs.open.delete(id);
    },
  };
  const dbg: DebuggerLike = {
    attach: async (t) => void calls.push(`attach ${t.tabId}`),
    detach: async (t) => void calls.push(`detach ${t.tabId}`),
    sendCommand: async (t, method, params) => {
      calls.push(`${method} ${t.tabId}`);
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F1' } } };
      if (method === 'Page.setDocumentContent') expect(params).toMatchObject({ frameId: 'F1' });
      if (method === 'Page.printToPDF') return { data: btoa('%PDF-1.7') };
      return {};
    },
    onDetach: { addListener: (fn) => void listeners.add(fn), removeListener: (fn) => void listeners.delete(fn) },
  };
  const detachByUser = () => listeners.forEach((fn) => fn({ tabId: 7 }, 'canceled_by_user'));
  return { calls, tabs, dbg, listeners, detachByUser };
}

describe('silent PDFs', () => {
  it('opens its own blank background tab, attaches only there, prints, and cleans up', async () => {
    const f = fakes();
    const maker = await PdfMaker.open(f.dbg, f.tabs);
    const pdf = await maker.print('<!doctype html><title>x</title>');
    expect(new TextDecoder().decode(pdf)).toBe('%PDF-1.7');
    await maker.close();
    expect(f.calls).toEqual([
      'tabs.create about:blank active=false',
      'attach 7',
      'Page.enable 7',
      'Page.getFrameTree 7',
      'Page.setDocumentContent 7',
      'Runtime.evaluate 7',
      'Page.printToPDF 7',
      'detach 7',
      'tabs.remove 7',
    ]);
    expect(f.tabs.open.size).toBe(0);
    expect(f.listeners.size).toBe(0);
  });

  it('stops with a clear message when the user cancels Chrome\'s debugging bar', async () => {
    const f = fakes();
    const maker = await PdfMaker.open(f.dbg, f.tabs);
    f.detachByUser();
    await expect(maker.print('<p>')).rejects.toThrow(PdfStoppedError);
    await expect(maker.print('<p>')).rejects.toThrow(/Cancel/);
    await maker.close();
    expect(f.calls).not.toContain('detach 7'); // already detached by Chrome
    expect(f.calls.at(-1)).toBe('tabs.remove 7');
  });

  it('closes its tab when attaching fails', async () => {
    const f = fakes();
    f.dbg.attach = async () => {
      throw new Error('Cannot attach');
    };
    await expect(PdfMaker.open(f.dbg, f.tabs)).rejects.toThrow('Cannot attach');
    expect(f.tabs.open.size).toBe(0);
  });

  it('the lazy printer opens nothing unless a PDF is printed', async () => {
    let opened = 0;
    const f = fakes();
    const lazy = lazyPdfPrinter(async () => (opened++, PdfMaker.open(f.dbg, f.tabs)));
    await lazy.close();
    expect(opened).toBe(0);
    const again = lazyPdfPrinter(async () => (opened++, PdfMaker.open(f.dbg, f.tabs)));
    await again.print('<p>');
    await again.print('<p>');
    await again.close();
    expect(opened).toBe(1);
    expect(f.calls.filter((c) => c === 'tabs.remove 7')).toHaveLength(1);
  });
});
