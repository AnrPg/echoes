import { TURN_PARTS, matchTurnPreset, type TurnDefinition, type TurnPresetName } from '@echoes/core';

/** What each part of a turn is called on screen. */
export const PART_LABELS: Record<keyof TurnDefinition, string> = {
  questions: 'Questions',
  answers: 'Answers',
  reasoning: 'Reasoning summaries',
  tools: 'Tool calls and outputs',
  citations: 'Citations',
  images: 'Pictures',
  attachments: 'Attachments',
  hidden: 'Hidden context',
};

export const PRESET_LABELS: Record<TurnPresetName, string> = {
  fullArchive: 'Full archive',
  answersOnly: 'Answers only',
  studyNotes: 'Study notes',
};

/** The closed control's text: the preset's name while the choice equals one, else the chosen parts. */
export function includeSummary(def: TurnDefinition): string {
  const preset = matchTurnPreset(def);
  if (preset) return PRESET_LABELS[preset];
  const on = TURN_PARTS.filter((k) => def[k]);
  if (on.length === 0) return 'Nothing selected';
  return on.map((k, i) => (i === 0 ? PART_LABELS[k] : PART_LABELS[k].toLowerCase())).join(', ');
}
