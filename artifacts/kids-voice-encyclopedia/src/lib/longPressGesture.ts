export const LONG_PRESS_MS = 550;
export const LONG_PRESS_SLOP = 10;
export const TOUCH_TAP_SLOP = 25;
/** Final displacement, rather than native click/scroll classification, decides child taps. */
export function isChildTap(x0: number, y0: number, x1: number, y1: number, longPressed = false, cancelled = false) {
  return !longPressed && !cancelled && !movedTooFar(x0, y0, x1, y1, TOUCH_TAP_SLOP);
}
export function movedTooFar(x0: number, y0: number, x1: number, y1: number, slop = LONG_PRESS_SLOP) {
  return Math.hypot(x1 - x0, y1 - y0) > slop;
}
