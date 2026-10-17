import { useCallback, useRef, useState } from 'react';

/**
 * Drag-and-drop reordering for a vertical or grid list, on the browser's own
 * drag events — no library, nothing to mount, works in the SSR render check.
 *
 * Two kinds of props are handed out:
 *   - `handleProps(index)` goes on the element the applicant grabs (a grip
 *     icon, or the whole card). It is `draggable`, so it must NOT wrap text
 *     inputs, or selecting text inside them would start a drag.
 *   - `itemProps(index)` goes on the element that receives the drop (the card).
 *
 * The hook does not reorder anything itself: it calls `onMove(from, to)` once,
 * on drop, with the index the item left and the index it should now occupy.
 * The owner persists the new order; the hook keeps no copy of the list, so
 * nothing can be lost between a drop and a save.
 *
 * @param {{ onMove: (from: number, to: number) => void, disabled?: boolean }} options
 */
export function useDragReorder({ onMove, disabled = false }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const dragging = useRef(null);

  const reset = useCallback(() => {
    dragging.current = null;
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  const handleProps = useCallback((index) => ({
    draggable: !disabled,
    onDragStart: (event) => {
      if (disabled) { event.preventDefault(); return; }
      dragging.current = index;
      setDragIndex(index);
      // Firefox needs data on the transfer before it will start a drag.
      try {
        event.dataTransfer.setData('text/plain', String(index));
        event.dataTransfer.effectAllowed = 'move';
      } catch { /* some engines expose a read-only dataTransfer during tests */ }
    },
    onDragEnd: reset,
  }), [disabled, reset]);

  const itemProps = useCallback((index) => ({
    onDragOver: (event) => {
      if (dragging.current === null) return;
      event.preventDefault();
      try { event.dataTransfer.dropEffect = 'move'; } catch { /* read-only in some engines */ }
      if (overIndex !== index) setOverIndex(index);
    },
    onDragEnter: (event) => {
      if (dragging.current === null) return;
      event.preventDefault();
      setOverIndex(index);
    },
    onDrop: (event) => {
      if (dragging.current === null) return;
      event.preventDefault();
      const from = dragging.current;
      reset();
      if (from !== index) onMove(from, index);
    },
    'data-drag-over': dragIndex !== null && overIndex === index && dragIndex !== index ? 'true' : undefined,
    'data-dragging': dragIndex === index ? 'true' : undefined,
  }), [dragIndex, overIndex, onMove, reset]);

  return { dragIndex, overIndex, handleProps, itemProps, reset };
}

/** Moves one item of a list from `from` to `to`, returning a new array. */
export function moveItem(list, from, to) {
  const items = [...(list || [])];
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  return items;
}
