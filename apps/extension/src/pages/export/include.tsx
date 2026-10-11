import { TURN_PARTS, TURN_PRESETS, matchTurnPreset, type TurnDefinition, type TurnPresetName } from '@echoes/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { PART_LABELS, PRESET_LABELS, includeSummary } from './include-model';

/**
 * A dropdown of checkboxes: any combination of the parts of a turn. The presets at the top tick their parts in one
 * click and stay editable afterwards. Closes on Esc or a click outside.
 */
export function IncludeSelect({ value, onChange, label = 'Include' }: { value: TurnDefinition; onChange: (def: TurnDefinition) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const preset = matchTurnPreset(value);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const summary = includeSummary(value);
  return (
    <div class="multi" ref={root}>
      <button type="button" class="multi-button" aria-label={`${label}: ${summary}`} aria-haspopup="true" aria-expanded={open} title={summary} onClick={() => setOpen(!open)}>
        <span class={TURN_PARTS.some((k) => value[k]) ? '' : 'warn'}>{summary}</span> <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div class="multi-menu" role="group" aria-label={label}>
          <div class="multi-presets">
            {(Object.keys(TURN_PRESETS) as TurnPresetName[]).map((name) => (
              <button type="button" aria-pressed={preset === name} onClick={() => onChange({ ...TURN_PRESETS[name] })}>
                {PRESET_LABELS[name]}
              </button>
            ))}
          </div>
          {TURN_PARTS.map((k) => (
            <label>
              <input type="checkbox" checked={value[k]} onChange={(e) => onChange({ ...value, [k]: (e.target as HTMLInputElement).checked })} /> {PART_LABELS[k]}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
