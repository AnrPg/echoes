// Silent PDFs for bulk export: one PDF per chat, written into the export folder without a print window. Chrome only
// lets an extension print a page to PDF through its debugger API (Page.printToPDF), which needs the optional
// "debugger" permission and shows a "started debugging this browser" bar while attached.
//
// Safety: the debugger is attached only to a blank tab this module opens itself, never to ChatGPT or any other tab,
// and is detached (and the tab closed) as soon as the export ends. Pages are given as HTML text; nothing is loaded.

import { fromBase64 } from '../bridge/base64';

/** The permission bulk PDF needs, asked for the first time the user exports many chats as PDF files. */
export const PDF_PERMISSION = { permissions: ['debugger'] } as chrome.permissions.Permissions;

type Target = { tabId: number };

/** The parts of `chrome.debugger` used here (a fake in tests). */
export interface DebuggerLike {
  attach(target: Target, version: string): Promise<void>;
  detach(target: Target): Promise<void>;
  sendCommand(target: Target, method: string, params?: object): Promise<unknown>;
  onDetach: { addListener(fn: (source: { tabId?: number }, reason: string) => void): void; removeListener(fn: (source: { tabId?: number }, reason: string) => void): void };
}

/** The parts of `chrome.tabs` used here. */
export interface TabsLike {
  create(props: { url: string; active: boolean }): Promise<{ id?: number }>;
  remove(tabId: number): Promise<void>;
}

/** Thrown when the user stops PDF making (Cancel on Chrome's debugging bar) or the tab goes away. */
export class PdfStoppedError extends Error {
  override readonly name = 'PdfStoppedError';
}

export class PdfMaker {
  private stopped: string | undefined;
  private readonly onDetach = (source: { tabId?: number }, reason: string) => {
    if (source.tabId !== this.target.tabId) return;
    this.stopped =
      reason === 'canceled_by_user'
        ? 'PDF making was stopped: "Cancel" was pressed on Chrome\'s debugging bar. Export again to make the rest.'
        : `PDF making stopped (${reason}). Export again to make the rest.`;
  };

  private constructor(
    private readonly dbg: DebuggerLike,
    private readonly tabs: TabsLike,
    private readonly target: Target,
  ) {
    dbg.onDetach.addListener(this.onDetach);
  }

  /** Open a blank background tab and attach the debugger to it, and only to it. */
  static async open(dbg: DebuggerLike = chrome.debugger as unknown as DebuggerLike, tabs: TabsLike = chrome.tabs as unknown as TabsLike): Promise<PdfMaker> {
    const tab = await tabs.create({ url: 'about:blank', active: false });
    if (tab.id === undefined) throw new Error('could not open a tab to make PDFs in');
    const target = { tabId: tab.id };
    try {
      await dbg.attach(target, '1.3');
      await dbg.sendCommand(target, 'Page.enable');
    } catch (e) {
      await tabs.remove(tab.id).catch(() => undefined);
      throw e;
    }
    return new PdfMaker(dbg, tabs, target);
  }

  /** One HTML page (images inlined) as PDF bytes: backgrounds printed, the page's own @page size if it has one. */
  async print(html: string): Promise<Uint8Array> {
    if (this.stopped) throw new PdfStoppedError(this.stopped);
    try {
      const tree = (await this.dbg.sendCommand(this.target, 'Page.getFrameTree')) as { frameTree: { frame: { id: string } } };
      await this.dbg.sendCommand(this.target, 'Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html });
      await this.dbg.sendCommand(this.target, 'Runtime.evaluate', {
        expression: 'Promise.all([...document.images].map((i) => i.decode().catch(() => 0))).then(() => document.fonts.ready).then(() => true)',
        awaitPromise: true,
        returnByValue: true,
      });
      const pdf = (await this.dbg.sendCommand(this.target, 'Page.printToPDF', { printBackground: true, preferCSSPageSize: true })) as { data: string };
      return fromBase64(pdf.data);
    } catch (e) {
      if (this.stopped) throw new PdfStoppedError(this.stopped);
      throw e;
    }
  }

  /** Detach and close the tab. Safe to call twice. */
  async close(): Promise<void> {
    this.dbg.onDetach.removeListener(this.onDetach);
    if (!this.stopped) await this.dbg.detach(this.target).catch(() => undefined);
    this.stopped ??= 'closed';
    await this.tabs.remove(this.target.tabId).catch(() => undefined);
  }
}

/**
 * A PDF printer that opens its {@link PdfMaker} on first use, for an export that may never need one (a resumed job
 * of another format). `close` releases it.
 */
export function lazyPdfPrinter(open: () => Promise<PdfMaker> = () => PdfMaker.open()): { print: (html: string) => Promise<Uint8Array>; close: () => Promise<void> } {
  let maker: Promise<PdfMaker> | undefined;
  return {
    print: async (html) => (await (maker ??= open())).print(html),
    close: async () => {
      if (maker) await (await maker.catch(() => undefined))?.close();
    },
  };
}
