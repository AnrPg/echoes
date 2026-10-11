import { useEffect, useRef, useState } from 'preact/hooks';
import { FieldName } from './info';
import { moveItem } from './merge-model';

export interface OrderedChat {
  id: string;
  title: string;
}

/**
 * The chats of an "All in one file" export, in file order. Drag a row to move it; or focus its handle and use the
 * arrow keys (Home and End jump to the ends); or use its ↑ and ↓ buttons. A screen reader hears each move.
 */
export function MergeOrder({ chats, onChange, onReset }: { chats: OrderedChat[]; onChange: (ids: string[]) => void; onReset: () => void }) {
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const [over, setOver] = useState<number | undefined>(undefined);
  const [said, setSaid] = useState('');
  const focusId = useRef<string | undefined>(undefined);
  const handles = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const id = focusId.current;
    focusId.current = undefined;
    if (id) handles.current.get(id)?.focus();
  });

  const move = (from: number, to: number, keepFocus: boolean) => {
    if (to < 0 || to >= chats.length || from === to) return;
    const next = moveItem(chats, from, to);
    if (keepFocus) focusId.current = chats[from]!.id;
    setSaid(`${chats[from]!.title || 'Untitled'} moved to position ${to + 1} of ${chats.length}.`);
    onChange(next.map((c) => c.id));
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? chats.length - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    move(i, to, true);
  };

  return (
    <div class="merge-order">
      <div class="merge-order-head">
        <FieldName id="mergeOrder" as="h3" />
        <button type="button" class="link-button" title="Put the chats back in the order of the list" onClick={onReset}>
          Reset order
        </button>
      </div>
      {chats.length === 0 ? (
        <p class="hint">Load your chats in step 1 and tick the ones to include; they appear here in file order.</p>
      ) : (
        <ol class="order-list" aria-label="Order of the chats in the file">
          {chats.map((c, i) => (
            <li
              key={c.id}
              class={`order-item${dragging === i ? ' dragging' : ''}${over === i && dragging !== undefined && dragging !== i ? (dragging < i ? ' drop-after' : ' drop-before') : ''}`}
              draggable
              onDragStart={(e) => {
                setDragging(i);
                e.dataTransfer?.setData('text/plain', c.id);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (over !== i) setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== undefined) move(dragging, i, false);
                setDragging(undefined);
                setOver(undefined);
              }}
              onDragEnd={() => {
                setDragging(undefined);
                setOver(undefined);
              }}
            >
              <button
                type="button"
                class="order-handle"
                ref={(el) => {
                  if (el) handles.current.set(c.id, el);
                  else handles.current.delete(c.id);
                }}
                aria-label={`${c.title || 'Untitled'}, position ${i + 1} of ${chats.length}. Arrow keys move it.`}
                title="Drag to move, or focus and use the arrow keys"
                onKeyDown={(e) => onKey(e, i)}
              >
                <span aria-hidden="true">⠿</span>
              </button>
              <span class="order-num" aria-hidden="true">
                {i + 1}
              </span>
              <span class="order-title">{c.title || 'Untitled'}</span>
              <button type="button" class="order-move" aria-label={`Move ${c.title || 'Untitled'} up`} title="Move up" disabled={i === 0} onClick={() => move(i, i - 1, false)}>
                ↑
              </button>
              <button type="button" class="order-move" aria-label={`Move ${c.title || 'Untitled'} down`} title="Move down" disabled={i === chats.length - 1} onClick={() => move(i, i + 1, false)}>
                ↓
              </button>
            </li>
          ))}
        </ol>
      )}
      <p class="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
