import { useEffect, useRef, useState } from 'react';
import { Check, Circle, LoaderCircle, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { removeBackgroundOnDevice } from '../lib/backgroundRemoval';
import './PhotoEditor.css';

const MAX_IMAGE_DIMENSION = 600;
const JPEG_QUALITY = 0.75;
const AI_MAX_DIMENSION = 448;

type EditMode = 'shape' | 'freehand' | 'ai';
type CropShape = 'circle' | 'square';
type TracePoint = { x: number; y: number; viewX: number; viewY: number };
type Pan = { x: number; y: number };
type Props = {
  source: string;
  onCancel: () => void;
  onApply: (image: string) => void;
};
function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を加工できませんでした');
  return { canvas, context };
}

function resizedDataUrl(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  format: 'image/jpeg' | 'image/png',
) {
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const { canvas, context } = makeCanvas(width, height);
  context.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL(format, format === 'image/jpeg' ? JPEG_QUALITY : undefined);
}

function resizeForAi(source: string) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, AI_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const { canvas, context } = makeCanvas(width, height);
        context.drawImage(image, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        canvas.width = 1;
        canvas.height = 1;
        resolve(dataUrl);
      } catch {
        reject(new Error('Could not prepare the image for background removal'));
      }
    };
    image.onerror = () => reject(new Error('Could not load the image for background removal'));
    image.src = source;
  });
}

function cropToShape(
  image: HTMLImageElement,
  shape: CropShape,
  frameSize: number,
  viewport: { width: number; height: number },
  zoom: number,
  pan: Pan,
) {
  const fitScale = Math.max(viewport.width / image.naturalWidth, viewport.height / image.naturalHeight);
  const sourceScale = fitScale * zoom;
  const side = frameSize / sourceScale;
  const sourceX = image.naturalWidth / 2 - pan.x / sourceScale - side / 2;
  const sourceY = image.naturalHeight / 2 - pan.y / sourceScale - side / 2;
  const outputSize = Math.min(MAX_IMAGE_DIMENSION, Math.max(1, Math.round(side)));
  const { canvas, context } = makeCanvas(outputSize, outputSize);

  if (shape === 'circle') {
    context.beginPath();
    context.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
    context.clip();
  } else {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, outputSize, outputSize);
  }
  context.drawImage(image, sourceX, sourceY, side, side, 0, 0, outputSize, outputSize);
  return canvas.toDataURL(shape === 'circle' ? 'image/png' : 'image/jpeg', JPEG_QUALITY);
}

function cropFreehand(image: HTMLImageElement, points: TracePoint[]) {
  const minX = Math.max(0, Math.min(...points.map((point) => point.x)));
  const minY = Math.max(0, Math.min(...points.map((point) => point.y)));
  const maxX = Math.min(image.naturalWidth, Math.max(...points.map((point) => point.x)));
  const maxY = Math.min(image.naturalHeight, Math.max(...points.map((point) => point.y)));
  const sourceWidth = maxX - minX;
  const sourceHeight = maxY - minY;
  if (points.length < 3 || sourceWidth < 2 || sourceHeight < 2) {
    throw new Error('写真の上を指で囲んでから、切り抜いてください。');
  }

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const { canvas, context } = makeCanvas(width, height);
  context.scale(scale, scale);
  context.beginPath();
  context.moveTo(points[0].x - minX, points[0].y - minY);
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const midX = (current.x + next.x) / 2 - minX;
    const midY = (current.y + next.y) / 2 - minY;
    context.quadraticCurveTo(current.x - minX, current.y - minY, midX, midY);
  }
  context.closePath();
  context.clip();
  context.drawImage(image, -minX, -minY);
  return canvas.toDataURL('image/png');
}

function eventToImagePoint(
  event: { clientX: number; clientY: number },
  stage: HTMLDivElement,
  image: HTMLImageElement,
  clampToImage = false,
): TracePoint | null {
  const bounds = stage.getBoundingClientRect();
  if (!image.naturalWidth || !image.naturalHeight || !bounds.width || !bounds.height) return null;
  const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const displayedWidth = image.naturalWidth * scale;
  const displayedHeight = image.naturalHeight * scale;
  const offsetX = (bounds.width - displayedWidth) / 2;
  const offsetY = (bounds.height - displayedHeight) / 2;
  const rawX = event.clientX - bounds.left - offsetX;
  const rawY = event.clientY - bounds.top - offsetY;
  if (!clampToImage && (rawX < 0 || rawY < 0 || rawX > displayedWidth || rawY > displayedHeight)) return null;
  const x = Math.max(0, Math.min(displayedWidth, rawX));
  const y = Math.max(0, Math.min(displayedHeight, rawY));
  return {
    x: x / scale,
    y: y / scale,
    viewX: ((x + offsetX) / bounds.width) * 1000,
    viewY: ((y + offsetY) / bounds.height) * 1000,
  };
}

function tracePath(points: TracePoint[], closed: boolean) {
  if (!points.length) return '';
  let path = `M ${points[0].viewX} ${points[0].viewY}`;
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const next = points[index + 1] ?? (closed ? points[0] : current);
    path += ` Q ${current.viewX} ${current.viewY} ${(current.viewX + next.viewX) / 2} ${(current.viewY + next.viewY) / 2}`;
  }
  return `${path}${closed ? ' Z' : ''}`;
}

export default function PhotoEditor({ source, onCancel, onApply }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const sourceImageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; pan: Pan } | null>(null);
  const drawingPointerRef = useRef<number | null>(null);
  const [mode, setMode] = useState<EditMode>('shape');
  const [shape, setShape] = useState<CropShape>('circle');
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [processedImage, setProcessedImage] = useState('');
  const [points, setPoints] = useState<TracePoint[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => {
      setViewport({ width: stage.clientWidth, height: stage.clientHeight });
      setPan({ x: 0, y: 0 });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setMode('shape');
    setShape('circle');
    const image = sourceImageRef.current;
    const ready = Boolean(image?.complete && image.naturalWidth);
    setSourceLoaded(ready);
    setSourceSize(ready && image
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : { width: 0, height: 0 });
    setProcessedImage('');
    setPoints([]);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setError('');
  }, [source]);

  const chooseMode = (nextMode: EditMode) => {
    setMode(nextMode);
    setProcessedImage('');
    setPoints([]);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDrawing(false);
    drawingPointerRef.current = null;
    setError('');
  };

  const frameSize = Math.min(viewport.width * 0.72, viewport.height * 0.72, 320);
  const naturalWidth = sourceSize.width;
  const naturalHeight = sourceSize.height;
  const fitScale = naturalWidth && naturalHeight
    ? Math.max(viewport.width / naturalWidth, viewport.height / naturalHeight)
    : 1;

  const clampPan = (next: Pan, nextZoom = zoom) => {
    const maxX = Math.max(0, (naturalWidth * fitScale * nextZoom + frameSize) / 2 - 20);
    const maxY = Math.max(0, (naturalHeight * fitScale * nextZoom + frameSize) / 2 - 20);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'shape' || processing || processedImage || !sourceLoaded || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan };
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setPan(clampPan({
      x: drag.pan.x + event.clientX - drag.x,
      y: drag.pan.y + event.clientY - drag.y,
    }));
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const runShapeCrop = () => {
    const image = sourceImageRef.current;
    if (!image?.naturalWidth) return;
    try {
      setProcessedImage(cropToShape(image, shape, frameSize, viewport, zoom, pan));
      setError('');
    } catch {
      setError('写真を切り抜けませんでした。別の写真をお試しください。');
    }
  };

  const runFreehandCrop = () => {
    const image = sourceImageRef.current;
    if (!image?.naturalWidth) return;
    try {
      setProcessedImage(cropFreehand(image, points));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '写真を切り抜けませんでした。');
    }
  };

  const runBackgroundRemoval = async () => {
    setProcessing(true);
    setError('');
    try {
      // Resize immediately before inference, never pass the original phone photo.
      const lightweightImage = await resizeForAi(source);
      const transparentCanvas = await removeBackgroundOnDevice(lightweightImage);
      setProcessedImage(resizedDataUrl(
        transparentCanvas,
        transparentCanvas.width,
        transparentCanvas.height,
        'image/png',
      ));
    } catch {
      setError('処理に失敗しました。他のモードをお試しください');
    } finally {
      setProcessing(false);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode !== 'freehand' || processing || processedImage || !sourceLoaded || drawingPointerRef.current !== null) return;
    const stage = stageRef.current;
    const image = sourceImageRef.current;
    if (!stage || !image) return;
    const point = eventToImagePoint(event, stage, image);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingPointerRef.current = event.pointerId;
    setPoints([point]);
    setDrawing(true);
    setError('');
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drawingPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const stage = stageRef.current;
    const image = sourceImageRef.current;
    if (!stage || !image) return;
    const samples = event.nativeEvent.getCoalescedEvents?.();
    const nextPoints = (samples?.length ? samples : [event.nativeEvent])
      .map((sample) => eventToImagePoint(sample, stage, image, true))
      .filter((point): point is TracePoint => point !== null);
    setPoints((current) => {
      const result = [...current];
      for (const point of nextPoints) {
        const previous = result[result.length - 1];
        if (!previous || Math.hypot(previous.viewX - point.viewX, previous.viewY - point.viewY) >= 2) result.push(point);
      }
      return result;
    });
  };

  const finishDrawing = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drawingPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    drawingPointerRef.current = null;
    setDrawing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const trace = tracePath(points, !drawing);

  return (
    <div
      className="photo-editor-overlay"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !processing) onCancel(); }}
    >
      <section className="photo-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="photo-editor-title">
        <header className="photo-editor-header">
          <div>
            <h2 id="photo-editor-title">写真をととのえる</h2>
            <p>形を選んだり、指で切り抜いたりできます。</p>
          </div>
          <button type="button" className="photo-editor-close" onClick={onCancel} disabled={processing} aria-label="写真編集を閉じる" data-testid="button-close-photo-editor">
            <X size={19} />
          </button>
        </header>

        <div className="photo-editor-tabs" role="tablist" aria-label="写真の加工方法">
          <button type="button" role="tab" aria-selected={mode === 'shape'} onClick={() => chooseMode('shape')} disabled={processing} data-testid="tab-photo-shape">
            <Circle size={16} /> 形を選ぶ
          </button>
          <button type="button" role="tab" aria-selected={mode === 'freehand'} onClick={() => chooseMode('freehand')} disabled={processing} data-testid="tab-photo-freehand">
            <Square size={16} /> 指でなぞる
          </button>
          <button type="button" role="tab" aria-selected={mode === 'ai'} onClick={() => chooseMode('ai')} disabled={processing} data-testid="tab-photo-ai">
            <Sparkles size={16} /> AIで背景を消す
          </button>
        </div>

        <div
          className={`photo-editor-stage${!processedImage && mode === 'freehand' ? ' is-drawing' : ''}${!processedImage && mode === 'shape' ? ' is-cropping' : ''}`}
          ref={stageRef}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          data-testid="photo-editor-stage"
        >
          {processedImage ? (
            <img className="photo-editor-image" src={processedImage} alt="加工後の写真プレビュー" />
          ) : (
            <img
              ref={sourceImageRef}
              className={`photo-editor-image${mode === 'shape' ? ' is-crop-source' : ''}`}
              style={mode === 'shape' && sourceLoaded ? {
                width: naturalWidth * fitScale,
                height: naturalHeight * fitScale,
                transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
              } : undefined}
              src={source}
              alt="加工する写真"
              draggable={false}
              onLoad={(event) => {
                setSourceSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
                setSourceLoaded(true);
              }}
              onError={() => setError('写真を表示できませんでした。別の写真を選んでください。')}
            />
          )}
          {!processedImage && mode === 'shape' && sourceLoaded && (
            <div
              className={`photo-editor-crop-frame ${shape === 'circle' ? 'is-circle' : 'is-square'}`}
              style={{ width: frameSize, height: frameSize }}
              aria-hidden="true"
              data-testid="photo-crop-frame"
            />
          )}
          {!processedImage && mode === 'freehand' && sourceLoaded && (
            <svg
              className="photo-editor-trace"
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              aria-label="切り抜く範囲をなぞる"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishDrawing}
              onPointerCancel={finishDrawing}
              data-testid="photo-freehand-surface"
            >
              {points.length > 2 && (
                <path d={`${trace}${drawing ? ' Z' : ''}`} fill="rgba(189, 112, 87, 0.22)" stroke="none" />
              )}
              {points.length > 0 && (
                <path d={trace} fill="none" stroke="#fff8ed" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />
              )}
              {points.length > 0 && (
                <path d={trace} fill="none" stroke="#bd7057" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
              )}
            </svg>
          )}
          {!sourceLoaded && !error && !processedImage && <span className="photo-editor-wait">写真を読み込んでいます…</span>}
          {processing && (
            <div className="photo-editor-processing" role="status" aria-live="polite" data-testid="status-photo-ai-processing">
              <LoaderCircle className="photo-editor-spinner" size={38} />
              <strong>AIが背景を消しています...✨</strong>
              <span>初回はAIモデルをダウンロードします。写真は端末内で処理されます。</span>
            </div>
          )}
        </div>

        {processedImage ? (
          <div className="photo-editor-controls">
            <p className="photo-editor-hint">加工した画像を確認してください。</p>
            <div className="photo-editor-actions">
              <button type="button" className="photo-editor-secondary" onClick={() => setProcessedImage('')} data-testid="button-redo-photo">
                <RotateCcw size={16} /> やり直す
              </button>
              <button type="button" className="photo-editor-apply" onClick={() => onApply(processedImage)} data-testid="button-apply-photo">
                <Check size={17} /> この画像で図鑑に登録
              </button>
            </div>
          </div>
        ) : (
          <div className="photo-editor-controls">
            {mode === 'shape' && (
              <>
                <div className="photo-editor-shapes" role="group" aria-label="切り抜く形">
                  <button type="button" aria-pressed={shape === 'circle'} onClick={() => setShape('circle')} data-testid="button-crop-circle">
                    <Circle size={17} /> 丸型
                  </button>
                  <button type="button" aria-pressed={shape === 'square'} onClick={() => setShape('square')} data-testid="button-crop-square">
                    <Square size={17} /> 四角形
                  </button>
                </div>
                <label className="photo-editor-zoom">
                  <span>拡大・縮小</span>
                  <input
                    type="range"
                    min="0.25"
                    max="4"
                    step="0.01"
                    value={zoom}
                    onChange={(event) => {
                      const nextZoom = Number(event.currentTarget.value);
                      setZoom(nextZoom);
                      setPan(clampPan(pan, nextZoom));
                    }}
                    aria-label="写真の拡大率"
                    data-testid="input-photo-zoom"
                  />
                  <output>{Math.round(zoom * 100)}%</output>
                </label>
                <p className="photo-editor-hint">写真を指で動かし、スライダーで大きさを調整してください。枠の内側が残ります。</p>
                <button type="button" className="photo-editor-primary" onClick={runShapeCrop} disabled={!sourceLoaded || frameSize <= 0} data-testid="button-run-shape-crop">
                  この形で切り抜く
                </button>
              </>
            )}
            {mode === 'freehand' && (
              <>
                <p className="photo-editor-hint">写真の上を指やマウスで一周なぞってください。囲んだ内側を残します。</p>
                <div className="photo-editor-actions">
                  <button type="button" className="photo-editor-secondary" onClick={() => { setPoints([]); setError(''); }} disabled={points.length === 0} data-testid="button-clear-photo-trace">
                    <RotateCcw size={16} /> なぞり直す
                  </button>
                  <button type="button" className="photo-editor-primary" onClick={runFreehandCrop} disabled={!sourceLoaded || points.length < 3} data-testid="button-run-freehand-crop">
                    なぞった範囲を切り抜く
                  </button>
                </div>
              </>
            )}
            {mode === 'ai' && (
              <>
                <p className="photo-editor-hint">写真を448px以下に縮小し、軽量な量子化モデルで端末内処理します。初回はモデルの読み込みに時間がかかることがあります。</p>
                <button type="button" className="photo-editor-primary" onClick={() => void runBackgroundRemoval()} disabled={!sourceLoaded || processing} data-testid="button-run-photo-ai">
                  <Sparkles size={17} /> ワンタップで背景を消す
                </button>
              </>
            )}
            {error && <p className="photo-editor-error" role="alert" data-testid="status-photo-editor-error">{error}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
