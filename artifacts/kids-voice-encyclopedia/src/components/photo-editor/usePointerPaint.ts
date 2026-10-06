import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Point, Size } from '../../lib/cropGeometry';
import type { MaskStroke } from '../../lib/guidedSegmentation';
import { clientToStage, containMap, samples, stageToNatural } from './contain';

type Options = { stageRef: RefObject<HTMLDivElement | null>; enabled: boolean; image: Size; viewport: Size };


/** Freehand lasso: natural-coordinate points only; view coords are derived at render time. */
export function useFreehand(options: Options) {
  const [points, setPoints] = useState<Point[]>([]);
  const [drawing, setDrawing] = useState(false);
  const activeId = useRef<number | null>(null);
  const opts = useRef(options);
  opts.current = options;

  const finish = (event: React.PointerEvent<SVGSVGElement>) => {
    if (activeId.current !== event.pointerId) return;
    activeId.current = null;
    setDrawing(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    }
  };

  const surfaceProps = {
    onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => {
      const { stageRef, enabled, image, viewport } = opts.current;
      const stage = stageRef.current;
      if (!enabled || !stage || activeId.current !== null) return;
      const p = stageToNatural(clientToStage(event, stage), containMap(image, viewport), false);
      if (!p) return;
      event.preventDefault();
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      activeId.current = event.pointerId;
      setPoints([p]);
      setDrawing(true);
    },
    onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => {
      const { stageRef, enabled, image, viewport } = opts.current;
      const stage = stageRef.current;
      if (!enabled || activeId.current !== event.pointerId || !stage) return;
      event.preventDefault();
      const map = containMap(image, viewport);
      const minGap = 2 / (map.scale || 1);
      const next = samples(event.nativeEvent)
        .map((s) => stageToNatural(clientToStage(s, stage), map, true))
        .filter((p): p is Point => p !== null);
      setPoints((cur) => {
        const out = [...cur];
        for (const p of next) {
          const last = out[out.length - 1];
          if (!last || Math.hypot(last.x - p.x, last.y - p.y) >= minGap) out.push(p);
        }
        return out;
      });
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  };

  const clear = useCallback(() => { activeId.current = null; setDrawing(false); setPoints([]); }, []);
  return { points, drawing, surfaceProps, clear };
}

export type BrushSize = 'small' | 'large';
export const BRUSH_DISPLAY_RADIUS: Record<BrushSize, number> = { small: 7, large: 18 };

/** Foreground/background paint strokes in natural image coordinates. */
export function useMaskPaint(options: Options) {
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [kind, setKind] = useState<'keep' | 'remove'>('keep');
  const [brush, setBrush] = useState<BrushSize>('small');
  const activeId = useRef<number | null>(null);
  const opts = useRef(options);
  opts.current = options;
  const settings = useRef({ kind, brush });
  settings.current = { kind, brush };

  const finish = (event: React.PointerEvent<SVGSVGElement>) => {
    if (activeId.current !== event.pointerId) return;
    activeId.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    }
  };

  const surfaceProps = {
    onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => {
      const { stageRef, enabled, image, viewport } = opts.current;
      const stage = stageRef.current;
      if (!enabled || !stage || activeId.current !== null) return;
      const map = containMap(image, viewport);
      const p = stageToNatural(clientToStage(event, stage), map, false);
      if (!p) return;
      event.preventDefault();
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      activeId.current = event.pointerId;
      const radius = BRUSH_DISPLAY_RADIUS[settings.current.brush] / map.scale;
      setStrokes((cur) => [...cur, { points: [p], radius, kind: settings.current.kind }]);
    },
    onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => {
      const { stageRef, enabled, image, viewport } = opts.current;
      const stage = stageRef.current;
      if (!enabled || activeId.current !== event.pointerId || !stage) return;
      event.preventDefault();
      const map = containMap(image, viewport);
      const next = samples(event.nativeEvent)
        .map((s) => stageToNatural(clientToStage(s, stage), map, true))
        .filter((p): p is Point => p !== null);
      setStrokes((cur) => {
        if (!cur.length) return cur;
        const last = cur[cur.length - 1];
        const pts = [...last.points];
        for (const p of next) {
          const prev = pts[pts.length - 1];
          if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) >= 1.5 / map.scale) pts.push(p);
        }
        return [...cur.slice(0, -1), { ...last, points: pts }];
      });
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  };

  const undo = useCallback(() => { activeId.current = null; setStrokes((cur) => cur.slice(0, -1)); }, []);
  const clear = useCallback(() => { activeId.current = null; setStrokes([]); }, []);
  return { strokes, kind, setKind, brush, setBrush, surfaceProps, undo, clear };
}
