export const LONG_PRESS_MS = 550;
export const LONG_PRESS_SLOP = 10;
export function movedTooFar(x0: number, y0: number, x1: number, y1: number, slop = LONG_PRESS_SLOP) {
  return Math.hypot(x1 - x0, y1 - y0) > slop;
}
