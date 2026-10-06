import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent, SyntheticEvent, TouchEvent } from 'react';
import { LONG_PRESS_MS, movedTooFar, isChildTap } from '../lib/longPressGesture';

/** 長押しで onLong を呼ぶ。発火後の click は抑止し、短いタップは通常どおり。 */
export function useLongPress<T>(onLong: (value: T) => void, delay = LONG_PRESS_MS, onTap?: (value: T) => void) {
  const cb = useRef(onLong); cb.current = onLong;
  const tap = useRef(onTap); tap.current = onTap;
  const touch = useRef<{ id: number; x: number; y: number; cancelled: boolean } | null>(null);
  const timer = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);
  const moved = useRef(false);
  const activePointer = useRef<number | null>(null);
  const cancel = useCallback(() => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null; activePointer.current = null; }, []);
  useEffect(() => {
    // A native scroll/pointercancel cancels the long-press timer, not the
    // touch candidate: touchend can still play when final displacement <=25px.
    const stop = () => { if (!touch.current && activePointer.current !== null) moved.current = true; cancel(); };
    const blur = () => { if (touch.current) touch.current.cancelled = true; stop(); };
    const down = (event: globalThis.PointerEvent) => {
      cancel();
      if (!event.isPrimary) { if (touch.current) touch.current.cancelled = true; return; }
      touch.current = null; fired.current = false; moved.current = false;
    };
    const up = (event: globalThis.PointerEvent) => { if (event.pointerId === activePointer.current) cancel(); };
    // Touch compatibility mouse events can land on the newly opened backdrop,
    // not the original now-inert card. Suppress them globally for this gesture.
    const suppress = (event: globalThis.MouseEvent) => {
      if (event.type === 'click' && event.detail === 0) { fired.current = false; moved.current = false; return; }
      if (fired.current || moved.current) { event.preventDefault(); event.stopPropagation(); }
      if (event.type === 'click') { fired.current = false; moved.current = false; }
    };
    window.addEventListener('scroll', stop, true);
    window.addEventListener('blur', blur);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('mousedown', suppress, true);
    document.addEventListener('click', suppress, true);
    return () => {
      stop(); window.removeEventListener('scroll', stop, true); window.removeEventListener('blur', blur);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('mousedown', suppress, true);
      document.removeEventListener('click', suppress, true);
    };
  }, [cancel]);
  return useCallback((value: T) => ({
    onTouchStart: (e: TouchEvent) => {
      cancel();
      if (e.touches.length !== 1) { if (touch.current) touch.current.cancelled = true; moved.current = true; return; }
      const t = e.touches[0];
      touch.current = { id: t.identifier, x: t.clientX, y: t.clientY, cancelled: false };
      fired.current = false; moved.current = false;
      timer.current = window.setTimeout(() => { timer.current = null; fired.current = true; cb.current(value); }, delay);
    },
    onTouchMove: (e: TouchEvent) => {
      const t = touch.current;
      if (!t) return;
      if (e.touches.length !== 1) { t.cancelled = true; cancel(); return; }
      const point = Array.from(e.touches).find(p => p.identifier === t.id);
      if (point && movedTooFar(t.x, t.y, point.clientX, point.clientY)) cancel();
    },
    onTouchEnd: (e: TouchEvent) => {
      const t = touch.current;
      const point = t && Array.from(e.changedTouches).find(p => p.identifier === t.id);
      cancel(); touch.current = null;
      if (!t) return;
      // Suppress the compatibility click even for a swipe or long press,
      // including clicks targeted at a newly opened dialog backdrop.
      moved.current = true;
      if (point && isChildTap(t.x, t.y, point.clientX, point.clientY, fired.current, t.cancelled)) tap.current?.(value);
    },
    onTouchCancel: () => { cancel(); touch.current = null; moved.current = true; },
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
