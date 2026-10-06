import type { Point, Size } from '../../lib/cropGeometry';

export type ContainMap = { scale: number; ox: number; oy: number; width: number; height: number };

export function containMap(image: Size, viewport: Size): ContainMap {
  if (!image.width || !image.height || !viewport.width || !viewport.height) {
    return { scale: 1, ox: 0, oy: 0, width: 0, height: 0 };
  }
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { scale, ox: (viewport.width - width) / 2, oy: (viewport.height - height) / 2, width, height };
}

/** Client coords -> stage content-box coords. */
export function clientToStage(event: { clientX: number; clientY: number }, stage: HTMLElement): Point {
  const bounds = stage.getBoundingClientRect();
  return { x: event.clientX - (bounds.left + stage.clientLeft), y: event.clientY - (bounds.top + stage.clientTop) };
}

export function stageToNatural(p: Point, map: ContainMap, clamp: boolean): Point | null {
  if (!map.scale || !map.width) return null;
  let x = p.x - map.ox;
  let y = p.y - map.oy;
  if (!clamp && (x < 0 || y < 0 || x > map.width || y > map.height)) return null;
  x = Math.max(0, Math.min(map.width, x));
  y = Math.max(0, Math.min(map.height, y));
  return { x: x / map.scale, y: y / map.scale };
}

export function naturalToStage(p: Point, map: ContainMap): Point {
  return { x: p.x * map.scale + map.ox, y: p.y * map.scale + map.oy };
}

export function samples(event: PointerEvent): PointerEvent[] {
  const list = event.getCoalescedEvents?.();
  return list && list.length ? list : [event];
}
