import { useEffect, useRef, useState } from 'preact/hooks';
import { FieldName } from './info';
import { isNoopSlot, moveItem, moveToSlot, slotAt } from './merge-model';

export interface OrderedChat {
  id: string;
  title: string;
}

/**
 * The chats of an "All in one file" export, in file order. Drag a row to move it (it lands in the gap the line
 * shows, by which half of a row the pointer is over); or focus its handle and use the arrow keys (Home and End jump
 * to the ends); or use its buttons: to the top, up, down, to the bottom. A screen reader hears each move.
 */
export function MergeOrder({ chats, onChange, onReset }: { chats: OrderedChat[]; onChange: (ids: string[]) => void; onReset: () => void }) {
  // The dragged chat is kept by id in a ref: drop handlers must not depend on a render having happened, and the
  // rows' indexes can change while a drag is on.
  const draggedId = useRef<string | undefined>(undefined);
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [slot, setSlot] = useState<number | undefined>(undefined);
  const list = useRef<HTMLOListElement>(null);
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

  const endDrag = () => {
    draggedId.current = undefined;
    setDragging(undefined);
    setSlot(undefined);
  };

  // The gap under the pointer, from the rows' positions now (the list may have scrolled).
  const slotFor = (y: number): number => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(':scope > .order-item') ?? [])];
    return slotAt(y, rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    }));
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
        <ol
          class="order-list"
          aria-label="Order of the chats in the file"
          ref={list}
          // The whole list is the drop zone, gaps between rows included, so a drop never falls through.
          onDragOver={(e) => {
            if (draggedId.current === undefined) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const at = slotFor(e.clientY);
            if (at !== slot) setSlot(at);
          }}
          onDragLeave={(e) => {
            if (!list.current?.contains(e.relatedTarget as Node | null)) setSlot(undefined);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const from = chats.findIndex((c) => c.id === draggedId.current);
            const at = slotFor(e.clientY);
            endDrag();
            if (from < 0 || isNoopSlot(from, at)) return;
            const to = at > from ? at - 1 : at;
            setSaid(`${chats[from]!.title || 'Untitled'} moved to position ${to + 1} of ${chats.length}.`);
            onChange(moveToSlot(chats, from, at).map((c) => c.id));
          }}
        >
          {chats.map((c, i) => {
            const from = chats.findIndex((x) => x.id === dragging);
            const showLine = slot !== undefined && from >= 0 && !isNoopSlot(from, slot);
            const line = showLine && slot === i ? ' drop-before' : showLine && slot === chats.length && i === chats.length - 1 ? ' drop-after' : '';
            const name = c.title || 'Untitled';
            return (
              <li
                key={c.id}
                class={`order-item${dragging === c.id ? ' dragging' : ''}${line}`}
                draggable
                onDragStart={(e) => {
                  draggedId.current = c.id;
                  e.dataTransfer?.setData('text/plain', c.id);
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                  // Restyling the dragged row inside dragstart makes Chrome cancel the drag: do it a frame later.
                  requestAnimationFrame(() => {
                    if (draggedId.current === c.id) setDragging(c.id);
                  });
                }}
                onDragEnd={endDrag}
              >
                <button
                  type="button"
                  class="order-handle"
                  ref={(el) => {
                    if (el) handles.current.set(c.id, el);
                    else handles.current.delete(c.id);
                  }}
                  aria-label={`${name}, position ${i + 1} of ${chats.length}. Arrow keys move it.`}
                  title="Drag to move, or focus and use the arrow keys"
                  onKeyDown={(e) => onKey(e, i)}
                >
                  <span aria-hidden="true">⠿</span>
                </button>
                <span class="order-num" aria-hidden="true">
                  {i + 1}
                </span>
                <span class="order-title">{name}</span>
                <button type="button" class="order-move" aria-label={`Move ${name} to the top`} title="Move to the top" disabled={i === 0} onClick={() => move(i, 0, false)}>
                  ⤒
                </button>
                <button type="button" class="order-move" aria-label={`Move ${name} up`} title="Move up" disabled={i === 0} onClick={() => move(i, i - 1, false)}>
                  ↑
                </button>
                <button type="button" class="order-move" aria-label={`Move ${name} down`} title="Move down" disabled={i === chats.length - 1} onClick={() => move(i, i + 1, false)}>
                  ↓
                </button>
                <button type="button" class="order-move" aria-label={`Move ${name} to the bottom`} title="Move to the bottom" disabled={i === chats.length - 1} onClick={() => move(i, chats.length - 1, false)}>
                  ⤓
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p class="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
