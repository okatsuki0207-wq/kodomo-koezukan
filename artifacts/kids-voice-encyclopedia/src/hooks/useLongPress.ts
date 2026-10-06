import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent, SyntheticEvent } from 'react';
import { LONG_PRESS_MS, movedTooFar } from '../lib/longPressGesture';

/** 長押しで onLong を呼ぶ。発火後の click は抑止し、短いタップは通常どおり。 */
export function useLongPress<T>(onLong: (value: T) => void, delay = LONG_PRESS_MS) {
  const cb = useRef(onLong); cb.current = onLong;
  const timer = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);
  const moved = useRef(false);
  const activePointer = useRef<number | null>(null);
  const cancel = useCallback(() => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null; activePointer.current = null; }, []);
  useEffect(() => {
    const stop = () => { if (activePointer.current !== null) moved.current = true; cancel(); };
    const down = () => { cancel(); fired.current = false; moved.current = false; };
    const up = (event: globalThis.PointerEvent) => { if (event.pointerId === activePointer.current) cancel(); };
    // Touch compatibility mouse events can land on the newly opened backdrop,
    // not the original now-inert card. Suppress them globally for this gesture.
    const suppress = (event: globalThis.MouseEvent) => {
      if (event.type === 'click' && event.detail === 0) { fired.current = false; moved.current = false; return; }
      if (fired.current || moved.current) { event.preventDefault(); event.stopPropagation(); }
      if (event.type === 'click') { fired.current = false; moved.current = false; }
    };
    window.addEventListener('scroll', stop, true);
    window.addEventListener('blur', stop);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('mousedown', suppress, true);
    document.addEventListener('click', suppress, true);
    return () => {
      stop(); window.removeEventListener('scroll', stop, true); window.removeEventListener('blur', stop);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('mousedown', suppress, true);
      document.removeEventListener('click', suppress, true);
    };
  }, [cancel]);
  return useCallback((value: T) => ({
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.isPrimary === false) return;
      cancel(); fired.current = false;
      activePointer.current = e.pointerId;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => { timer.current = null; fired.current = true; cb.current(value); }, delay);
    },
    onPointerMove: (e: PointerEvent) => { if (e.pointerId === activePointer.current && movedTooFar(start.current.x, start.current.y, e.clientX, e.clientY)) { moved.current = true; cancel(); } },
    onPointerUp: cancel,
    onPointerCancel: () => { moved.current = true; cancel(); },
    onPointerLeave: () => { if (activePointer.current !== null) { moved.current = true; cancel(); } },
    onClickCapture: (e: MouseEvent) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } },
    onContextMenu: (e: SyntheticEvent) => e.preventDefault(),
    onDragStart: (e: SyntheticEvent) => e.preventDefault(),
  }), [cancel, delay]);
}
