/** Browser-independent geometry shared by crop guides and pixel export. */
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type CropFrame = Point & Size;
export type Transform = { zoom: number; pan: Point };
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const minimum = (size: Size) => Math.min(40, size.width, size.height);

export function initialCropFrame(viewport: Size, circle: boolean): CropFrame {
  const side = Math.min(viewport.width * .72, viewport.height * .72, 320);
  const width = circle ? side : Math.min(viewport.width * .72, 420);
  const height = circle ? side : Math.min(viewport.height * .72, 320);
  return { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height };
}

export function moveCropFrame(frame: CropFrame, delta: Point, viewport: Size): CropFrame {
  return { ...frame, x: clamp(frame.x + delta.x, 0, viewport.width - frame.width),
    y: clamp(frame.y + delta.y, 0, viewport.height - frame.height) };
}

/** Moving the frame must not also pan a zoomed-out photo. Stop at its edges. */
export function moveCropFrameWithinImage(
  frame: CropFrame, delta: Point, image: Size, viewport: Size, transform: Transform,
): CropFrame {
  const next = moveCropFrame(frame, delta, viewport);
  if (!image.width || !image.height || !viewport.width || !viewport.height) return next;
  const fit = Math.max(viewport.width / image.width, viewport.height / image.height);
  const width = image.width * fit * transform.zoom;
  const height = image.height * fit * transform.zoom;
  const left = viewport.width / 2 + transform.pan.x - width / 2;
  const top = viewport.height / 2 + transform.pan.y - height / 2;
  const minX = Math.max(0, left), minY = Math.max(0, top);
  const maxX = Math.max(minX, Math.min(viewport.width - frame.width, left + width - frame.width));
  const maxY = Math.max(minY, Math.min(viewport.height - frame.height, top + height - frame.height));
  return { ...next, x: clamp(next.x, minX, maxX), y: clamp(next.y, minY, maxY) };
}

export function resizeCropFrame(
  frame: CropFrame, handle: ResizeHandle, delta: Point, viewport: Size, circle: boolean,
): CropFrame {
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  const min = minimum(viewport);
  if (!circle) {
    const left = handle.includes('w') ? clamp(frame.x + delta.x, 0, right - min) : frame.x;
    const top = handle.includes('n') ? clamp(frame.y + delta.y, 0, bottom - min) : frame.y;
    const newRight = handle.includes('e') ? clamp(right + delta.x, left + min, viewport.width) : right;
    const newBottom = handle.includes('s') ? clamp(bottom + delta.y, top + min, viewport.height) : bottom;
    return { x: left, y: top, width: newRight - left, height: newBottom - top };
  }
  const west = handle.includes('w');
  const north = handle.includes('n');
  const horizontal = handle.includes('e') || west;
  const vertical = handle.includes('s') || north;
  const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const changeX = horizontal ? delta.x * (west ? -1 : 1) : 0;
  const changeY = vertical ? delta.y * (north ? -1 : 1) : 0;
  const change = horizontal && vertical ? (changeX + changeY) / 2 : changeX + changeY;
  const availableX = horizontal ? (west ? right : viewport.width - frame.x) : 2 * Math.min(center.x, viewport.width - center.x);
  const availableY = vertical ? (north ? bottom : viewport.height - frame.y) : 2 * Math.min(center.y, viewport.height - center.y);
  const max = Math.min(availableX, availableY);
  const side = clamp(frame.width + change, Math.min(min, max), max);
  return {
    x: horizontal ? (west ? right - side : frame.x) : center.x - side / 2,
    y: vertical ? (north ? bottom - side : frame.y) : center.y - side / 2,
    width: side, height: side,
  };
}

/** Keep every crop pixel inside the source; zooming out cannot introduce blank strips. */
export function clampTransform(transform: Transform, image: Size, viewport: Size, frame: CropFrame): Transform {
  if (!image.width || !image.height || !viewport.width || !viewport.height) return transform;
  const fit = Math.max(viewport.width / image.width, viewport.height / image.height);
  const minZoom = Math.max(.05, frame.width / (image.width * fit), frame.height / (image.height * fit));
  const zoom = clamp(transform.zoom, minZoom, Math.max(8, minZoom));
  const width = image.width * fit * zoom;
  const height = image.height * fit * zoom;
  return { zoom, pan: {
    x: clamp(transform.pan.x, frame.x + frame.width - viewport.width / 2 - width / 2, frame.x - viewport.width / 2 + width / 2),
    y: clamp(transform.pan.y, frame.y + frame.height - viewport.height / 2 - height / 2, frame.y - viewport.height / 2 + height / 2),
  } };
}

export function pinchTransform(
  transform: Transform, startA: Point, startB: Point, nextA: Point, nextB: Point,
  image: Size, viewport: Size, frame: CropFrame,
): Transform {
  const before = Math.hypot(startA.x - startB.x, startA.y - startB.y);
  if (before < 1) return clampTransform(transform, image, viewport, frame);
  const after = Math.hypot(nextA.x - nextB.x, nextA.y - nextB.y);
  const zoom = clampTransform({ ...transform, zoom: transform.zoom * after / before }, image, viewport, frame).zoom;
  const ratio = zoom / transform.zoom;
  const startMid = { x: (startA.x + startB.x) / 2, y: (startA.y + startB.y) / 2 };
  const nextMid = { x: (nextA.x + nextB.x) / 2, y: (nextA.y + nextB.y) / 2 };
  return clampTransform({ zoom, pan: {
    x: nextMid.x + (viewport.width / 2 + transform.pan.x - startMid.x) * ratio - viewport.width / 2,
    y: nextMid.y + (viewport.height / 2 + transform.pan.y - startMid.y) * ratio - viewport.height / 2,
  } }, image, viewport, frame);
}

export function sourceCropRect(image: Size, viewport: Size, transform: Transform, frame: CropFrame): CropFrame {
  const fit = Math.max(viewport.width / image.width, viewport.height / image.height);
  const safe = clampTransform(transform, image, viewport, frame);
  const scale = fit * safe.zoom;
  return { x: image.width / 2 + (frame.x - viewport.width / 2 - safe.pan.x) / scale,
    y: image.height / 2 + (frame.y - viewport.height / 2 - safe.pan.y) / scale,
    width: frame.width / scale, height: frame.height / scale };
}

/** A periodic quadratic B-spline closes at a midpoint with matching tangents.
 * SVG and Canvas Path2D both consume this same path; no straight closing seam. */
export function smoothTracePath(input: readonly Point[], closed: boolean): string {
  if (!input.length) return '';
  const points = input.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!points.length) return '';
  if (closed && points.length > 3 && points[0].x === points.at(-1)!.x && points[0].y === points.at(-1)!.y) points.pop();
  const mid = (a: Point, b: Point) => `${(a.x + b.x) / 2} ${(a.y + b.y) / 2}`;
  if (closed && points.length > 2) {
    let path = `M ${mid(points.at(-1)!, points[0])}`;
    for (let i = 0; i < points.length; i++) path += ` Q ${points[i].x} ${points[i].y} ${mid(points[i], points[(i + 1) % points.length])}`;
    return `${path} Z`;
  }
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    path += ` Q ${points[i - 1].x} ${points[i - 1].y} ${mid(points[i - 1], points[i])}`;
  }
  const last = points.at(-1)!;
  return `${path} Q ${last.x} ${last.y} ${last.x} ${last.y}`;
}
