import { describe, expect, it } from 'vitest';
import { printedEntry } from '../../src/pages/export/activity';

describe('after the print window', () => {
  it('says the PDF exists only if it was saved as PDF, and where it goes', () => {
    const e = printedEntry([]);
    expect(e.title).toBe('Print window closed');
    expect(e.level).toBe('ok');
    expect(e.lines?.[0]?.text).toMatch(/only if Destination was "Save as PDF" and you pressed Save.*Downloads/);
  });

  it('adds notes on what was kept differently', () => {
    const e = printedEntry(['file-unavailable: a.png: gone']);
    expect(e.level).toBe('warn');
    expect(e.lines).toHaveLength(3);
  });
});
