import { TURN_PARTS, TURN_PRESETS, type TurnDefinition, type TurnPresetName } from '@echoes/core';
import { useEffect, useState } from 'preact/hooks';
import type { ExportController, SavedPreset } from './controller';
import { PART_LABELS, PRESET_LABELS } from './include-model';

const BUILT_IN: SavedPreset[] = (Object.keys(TURN_PRESETS) as TurnPresetName[]).map((k) => ({ name: PRESET_LABELS[k], turns: TURN_PRESETS[k] }));

const same = (a: TurnDefinition, b: TurnDefinition) => TURN_PARTS.every((k) => a[k] === b[k]);

/**
 * "Parts of each turn": the one place that chooses which parts of a turn go into an export, for a whole chat, picked
 * turns and many chats alike. Presets (built-in and the user's own) fill the parts in one click and stay editable.
 */
export function PartsPicker({ value, onChange, controller }: { value: TurnDefinition; onChange: (def: TurnDefinition) => void; controller: ExportController }) {
  const [saved, setSaved] = useState<SavedPreset[]>([]);
  useEffect(() => void controller.loadPresets().then(setSaved), []);
  const presets = [...BUILT_IN, ...saved];
  const nothing = !TURN_PARTS.some((k) => value[k]);

  const save = () => {
    const name = prompt('Name for this choice of parts')?.trim();
    if (!name || BUILT_IN.some((p) => p.name === name)) return;
    const next = [...saved.filter((p) => p.name !== name), { name, turns: { ...value } }];
    setSaved(next);
    void controller.savePresets(next);
  };
  const remove = (name: string) => {
    const next = saved.filter((p) => p.name !== name);
    setSaved(next);
    void controller.savePresets(next);
  };

  return (
    <div class="parts" role="group" aria-label="Parts of each turn">
      <div class="presets">
        <span class="hint">Start from</span>
        {presets.map((p) => {
          const mine = !BUILT_IN.includes(p);
          return (
            <span class="preset">
              <button type="button" class="pill" aria-pressed={same(p.turns, value)} onClick={() => onChange({ ...p.turns })}>
                {p.name}
              </button>
              {mine && (
                <button type="button" class="pill-x" aria-label={`Delete preset ${p.name}`} title="Delete this preset" onClick={() => remove(p.name)}>
                  ×
                </button>
              )}
            </span>
          );
        })}
        <button type="button" class="link" onClick={save}>
          Save as preset
        </button>
      </div>
      <div class="chips">
        {TURN_PARTS.map((k) => (
          <label class="chip">
            <input type="checkbox" checked={value[k]} onChange={(e) => onChange({ ...value, [k]: (e.target as HTMLInputElement).checked })} />
            <span>{PART_LABELS[k]}</span>
          </label>
        ))}
      </div>
      {nothing && <p class="warn small">Pick at least one part, or the export will be empty.</p>}
      <p class="hint">"Reasoning summaries" are the summaries ChatGPT shows, never raw chain of thought.</p>
    </div>
  );
}
