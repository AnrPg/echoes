import { describe, expect, it } from 'vitest';
import { FLAVOR_NAMES, FORMAT_NAMES } from '../../src/pages/export/action-model';
import { HELP, optionTip, type HelpId } from '../../src/pages/export/help';
import { PART_LABELS, PRESET_LABELS } from '../../src/pages/export/include-model';
import { CONDITION_LABELS } from '../../src/pages/export/picker-model';

describe('every field and option is explained', () => {
  it('each entry has a tooltip and an info text', () => {
    for (const [id, h] of Object.entries(HELP)) {
      expect(h.tip.length, id).toBeGreaterThan(10);
      expect(h.intro.length, id).toBeGreaterThan(20);
    }
  });

  it('each option the page shows has its explanation, under the same name', () => {
    const shown: [HelpId, string[]][] = [
      ['format', Object.values(FORMAT_NAMES)],
      ['flavor', Object.values(FLAVOR_NAMES)],
      ['parts', Object.values(PART_LABELS)],
      ['presets', [...Object.values(PRESET_LABELS), 'Save as preset']],
      ['scope', ['This chat', 'Some turns', 'Many chats']],
      ['versions', ['Only the one shown', 'All versions']],
      ['layout', ['One file per chat', 'All in one file']],
      ['turnsPerFile', ['All in one file', 'In groups']],
      ['colours', ['Follow system', 'Light', 'Dark']],
      ['look', ['Like ChatGPT', 'Article', 'Compact notes', 'Print-friendly']],
      ['rules', Object.entries(CONDITION_LABELS).filter(([k]) => k !== 'first' && k !== 'last').map(([, v]) => v)],
    ];
    for (const [id, names] of shown) for (const n of names) expect(optionTip(id, n), `${id}: ${n}`).toBeTruthy();
  });
});
