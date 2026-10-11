import { TURN_PARTS, TURN_PRESETS, type TurnDefinition } from '@echoes/core';
import { describe, expect, it } from 'vitest';
import { includeSummary } from '../../src/pages/export/include-model';

describe('includeSummary', () => {
  it('shows the preset name while the choice equals a preset', () => {
    expect(includeSummary({ ...TURN_PRESETS.studyNotes })).toBe('Study notes');
    expect(includeSummary({ ...TURN_PRESETS.fullArchive })).toBe('Full archive');
  });

  it('lists the chosen parts for any other combination', () => {
    expect(includeSummary({ ...TURN_PRESETS.answersOnly, reasoning: true })).toBe('Answers, reasoning summaries, pictures');
  });

  it('says when nothing is chosen', () => {
    const none = Object.fromEntries(TURN_PARTS.map((k) => [k, false])) as unknown as TurnDefinition;
    expect(includeSummary(none)).toBe('Nothing selected');
  });
});
