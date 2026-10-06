import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  clampTransform, initialCropFrame, moveCropFrameWithinImage, pinchTransform, resizeCropFrame,
} from '../../lib/cropGeometry';
import type { CropFrame, Point, ResizeHandle, Size, Transform } from '../../lib/cropGeometry';
import { clientToStage } from './contain';

type Gesture =
  | { kind: 'move' | 'pan'; start: Point; frame: CropFrame; transform: Transform }
  | { kind: 'pinch'; idA: number; idB: number; a: Point; b: Point; transform: Transform };
type HandleGesture = { id: number; handle: ResizeHandle; start: Point; frame: CropFrame };

const IDENTITY: Transform = { zoom: 1, pan: { x: 0, y: 0 } };

type Options = {
  stageRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  viewport: Size;
  image: Size;
  circle: boolean;
  resetKey: string;
};

export function usePhotoCrop({ stageRef, enabled, viewport, image, circle, resetKey }: Options) {
  const [frame, setFrameState] = useState<CropFrame>({ x: 0, y: 0, width: 0, height: 0 });
  const [transform, setTransformState] = useState<Transform>(IDENTITY);
  const frameRef = useRef(frame);
  const transformRef = useRef(transform);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const handleGesture = useRef<HandleGesture | null>(null);
  const envRef = useRef({ viewport, image, circle });
  envRef.current = { viewport, image, circle };

  const setFrame = useCallback((next: CropFrame) => { frameRef.current = next; setFrameState(next); }, []);
  const setTransform = useCallback((next: Transform) => { transformRef.current = next; setTransformState(next); }, []);

  const ready = enabled && viewport.width > 0 && viewport.height > 0 && image.width > 0 && image.height > 0;

  useEffect(() => {
    pointers.current.clear();
    gesture.current = null;
    handleGesture.current = null;
    if (!viewport.width || !viewport.height || !image.width || !image.height) return;
    const f = initialCropFrame(viewport, circle);
    setFrame(f);
    setTransform(clampTransform(IDENTITY, image, viewport, f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width, viewport.height, image.width, image.height, circle, resetKey]);

  useEffect(() => {
    if (ready) return;
    const ids = [...pointers.current.keys()];
    pointers.current.clear();
    gesture.current = null;
    handleGesture.current = null;
    for (const id of ids) {
      const stage = stageRef.current;
      if (stage?.hasPointerCapture(id)) stage.releasePointerCapture(id);
    }
  }, [ready, stageRef]);

  const begin = () => {
    const ids = [...pointers.current.keys()];
    const { viewport: vp, circle: isCircle } = envRef.current;
    void vp;
    if (ids.length === 1) {
      const start = pointers.current.get(ids[0])!;
      const f = frameRef.current;
      const inside = isCircle
        ? ((start.x - (f.x + f.width / 2)) / (f.width / 2)) ** 2 + ((start.y - (f.y + f.height / 2)) / (f.height / 2)) ** 2 <= 1
        : start.x >= f.x && start.x <= f.x + f.width && start.y >= f.y && start.y <= f.y + f.height;
      gesture.current = { kind: inside ? 'move' : 'pan', start, frame: f, transform: transformRef.current };
    } else if (ids.length >= 2) {
      gesture.current = {
        kind: 'pinch', idA: ids[0], idB: ids[1],
        a: pointers.current.get(ids[0])!, b: pointers.current.get(ids[1])!, transform: transformRef.current,
      };
    } else gesture.current = null;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const stage = stageRef.current;
    if (!ready || !stage || pointers.current.size >= 2) return;
    event.preventDefault();
    try { stage.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    pointers.current.set(event.pointerId, clientToStage(event, stage));
    handleGesture.current = null;
    begin();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, clientToStage(event, event.currentTarget));
    const g = gesture.current;
    if (!g) return;
    const { viewport: vp, image: img } = envRef.current;
    if (g.kind === 'pinch') {
      const a = pointers.current.get(g.idA);
      const b = pointers.current.get(g.idB);
      if (!a || !b) return;
      setTransform(pinchTransform(g.transform, g.a, g.b, a, b, img, vp, frameRef.current));
      return;
    }
    const p = pointers.current.get(event.pointerId)!;
    const delta = { x: p.x - g.start.x, y: p.y - g.start.y };
    if (g.kind === 'move') {
      const f = moveCropFrameWithinImage(g.frame, delta, img, vp, g.transform);
      setFrame(f);
      setTransform(clampTransform(g.transform, img, vp, f));
    } else {
      setTransform(clampTransform(
        { zoom: g.transform.zoom, pan: { x: g.transform.pan.x + delta.x, y: g.transform.pan.y + delta.y } },
        img, vp, frameRef.current,
      ));
    }
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    }
    begin(); // rebase remaining pointer so nothing jumps
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !ready) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { viewport: vp, image: img } = envRef.current;
      const p = clientToStage(event, stage);
      const k = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0016));
      const b = { x: p.x + 100, y: p.y };
      const nb = { x: p.x + 100 * k, y: p.y };
      setTransform(pinchTransform(transformRef.current, p, b, p, nb, img, vp, frameRef.current));
      gesture.current = null;
      begin();
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stageRef]);

  const applyResize = (base: CropFrame, handle: ResizeHandle, delta: Point) => {
    const { viewport: vp, image: img, circle: isCircle } = envRef.current;
    const f = resizeCropFrame(base, handle, delta, vp, isCircle);
    setFrame(f);
    setTransform(clampTransform(transformRef.current, img, vp, f));
  };

  const handleProps = (handle: ResizeHandle) => ({
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      event.stopPropagation();
      if (!ready) return;
      if (pointers.current.size > 0) { onPointerDown(event); return; }
      event.preventDefault();
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      const stage = stageRef.current;
      if (!stage) return;
      handleGesture.current = { id: event.pointerId, handle, start: clientToStage(event, stage), frame: frameRef.current };
      pointers.current.set(event.pointerId, clientToStage(event, stage));
      gesture.current = null;
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const g = handleGesture.current;
      const stage = stageRef.current;
      if (!g || g.id !== event.pointerId || !stage) return;
      event.stopPropagation();
      event.preventDefault();
      const p = clientToStage(event, stage);
      pointers.current.set(event.pointerId, p);
      applyResize(g.frame, g.handle, { x: p.x - g.start.x, y: p.y - g.start.y });
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      if (handleGesture.current?.id !== event.pointerId) return;
      event.stopPropagation();
      handleGesture.current = null;
      pointers.current.delete(event.pointerId);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      begin();
    },
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => {
      if (handleGesture.current?.id === event.pointerId) { handleGesture.current = null; pointers.current.delete(event.pointerId); begin(); }
    },
    onLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => {
      if (handleGesture.current?.id === event.pointerId) { handleGesture.current = null; pointers.current.delete(event.pointerId); begin(); }
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? 20 : 6;
      const map: Record<string, Point> = {
        ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
      };
      const delta = map[event.key];
      if (!delta) return;
      event.preventDefault();
      applyResize(frameRef.current, handle, delta);
    },
  });

  return { frame, transform, ready, stageProps: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onLostPointerCapture: onPointerEnd }, handleProps };
}
