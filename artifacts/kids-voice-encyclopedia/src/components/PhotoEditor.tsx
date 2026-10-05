import { useEffect, useRef, useState } from 'react';
import { Check, Circle, LoaderCircle, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import './PhotoEditor.css';

const MAX_IMAGE_DIMENSION = 600;
const JPEG_QUALITY = 0.75;
const AI_MAX_DIMENSION = 448;
const AI_TIMEOUT_MS = 120_000;

type EditMode = 'shape' | 'freehand' | 'ai';
type CropShape = 'circle' | 'square';
type TracePoint = { x: number; y: number; viewX: number; viewY: number };
type Pan = { x: number; y: number };
type Props = {
  source: string;
  onCancel: () => void;
  onApply: (image: string) => void;
};
type BackgroundRemovalOutput = { toCanvas: () => HTMLCanvasElement };
type BackgroundRemovalPipeline = (image: string) => Promise<BackgroundRemovalOutput>;

let backgroundRemovalPipeline: Promise<BackgroundRemovalPipeline> | null = null;

function getBackgroundRemovalPipeline() {
  if (!backgroundRemovalPipeline) {
    backgroundRemovalPipeline = import('@huggingface/transformers')
      .then(({ pipeline }) => pipeline(
        'background-removal',
        'onnx-community/ormbg-ONNX',
        { dtype: 'q8' },
      ) as unknown as BackgroundRemovalPipeline)
      .catch((error: unknown) => {
        backgroundRemovalPipeline = null;
        throw error;
      });
  }
  return backgroundRemovalPipeline;
}

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
  event: React.PointerEvent<SVGSVGElement>,
  stage: HTMLDivElement,
  image: HTMLImageElement,
): TracePoint | null {
  const bounds = stage.getBoundingClientRect();
  if (!image.naturalWidth || !image.naturalHeight || !bounds.width || !bounds.height) return null;
  const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const displayedWidth = image.naturalWidth * scale;
  const displayedHeight = image.naturalHeight * scale;
  const offsetX = (bounds.width - displayedWidth) / 2;
  const offsetY = (bounds.height - displayedHeight) / 2;
  const x = event.clientX - bounds.left - offsetX;
  const y = event.clientY - bounds.top - offsetY;
  if (x < 0 || y < 0 || x > displayedWidth || y > displayedHeight) return null;
  return {
    x: x / scale,
    y: y / scale,
    viewX: ((event.clientX - bounds.left) / bounds.width) * 1000,
    viewY: ((event.clientY - bounds.top) / bounds.height) * 1000,
  };
}

export default function PhotoEditor({ source, onCancel, onApply }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const sourceImageRef = useRef<HTMLImageElement>(null);
  const [mode, setMode] = useState<EditMode>('shape');
  const [shape, setShape] = useState<CropShape>('circle');
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [processedImage, setProcessedImage] = useState('');
  const [points, setPoints] = useState<TracePoint[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setMode('shape');
    setShape('circle');
    setSourceLoaded(false);
    setProcessedImage('');
    setPoints([]);
    setError('');
  }, [source]);

  const chooseMode = (nextMode: EditMode) => {
    setMode(nextMode);
    setProcessedImage('');
    setPoints([]);
    setError('');
  };

  const runShapeCrop = () => {
    const image = sourceImageRef.current;
    if (!image?.naturalWidth) return;
    try {
      setProcessedImage(cropToShape(image, shape));
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
      const removeBackground = await getBackgroundRemovalPipeline();
      const result = await removeBackground(source);
      const transparentCanvas = result.toCanvas();
      setProcessedImage(resizedDataUrl(
        transparentCanvas,
        transparentCanvas.width,
        transparentCanvas.height,
        'image/png',
      ));
    } catch {
      setError('背景を消せませんでした。通信環境を確認して、もう一度お試しください。');
    } finally {
      setProcessing(false);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode !== 'freehand' || processing || processedImage || !sourceLoaded) return;
    const stage = stageRef.current;
    const image = sourceImageRef.current;
    if (!stage || !image) return;
    const point = eventToImagePoint(event, stage, image);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPoints([point]);
    setDrawing(true);
    setError('');
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return;
    const stage = stageRef.current;
    const image = sourceImageRef.current;
    if (!stage || !image) return;
    const point = eventToImagePoint(event, stage, image);
    if (!point) return;
    setPoints((current) => {
      const previous = current[current.length - 1];
      if (previous && Math.hypot(previous.viewX - point.viewX, previous.viewY - point.viewY) < 3) return current;
      return [...current, point];
    });
  };

  const finishDrawing = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return;
    setDrawing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const trace = points.map((point) => `${point.viewX},${point.viewY}`).join(' ');

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
          <button type="button" className="photo-editor-close" onClick={onCancel} disabled={processing} aria-label="写真編集を閉じる">
            <X size={19} />
          </button>
        </header>

        <div className="photo-editor-tabs" role="tablist" aria-label="写真の加工方法">
          <button type="button" role="tab" aria-selected={mode === 'shape'} onClick={() => chooseMode('shape')} disabled={processing}>
            <Circle size={16} /> 形を選ぶ
          </button>
          <button type="button" role="tab" aria-selected={mode === 'freehand'} onClick={() => chooseMode('freehand')} disabled={processing}>
            <Square size={16} /> 指でなぞる
          </button>
          <button type="button" role="tab" aria-selected={mode === 'ai'} onClick={() => chooseMode('ai')} disabled={processing}>
            <Sparkles size={16} /> AIで背景を消す
          </button>
        </div>

        <div className={`photo-editor-stage${mode === 'freehand' && !processedImage ? ' is-drawing' : ''}`} ref={stageRef}>
          {processedImage ? (
            <img className="photo-editor-image" src={processedImage} alt="加工後の写真プレビュー" />
          ) : (
            <img
              ref={sourceImageRef}
              className="photo-editor-image"
              src={source}
              alt="加工する写真"
              onLoad={() => setSourceLoaded(true)}
              onError={() => setError('写真を表示できませんでした。別の写真を選んでください。')}
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
            >
              {points.length > 2 && (
                <polygon points={trace} fill="rgba(189, 112, 87, 0.22)" stroke="none" />
              )}
              {points.length > 0 && (
                <polyline points={`${trace}${drawing ? '' : ` ${points[0].viewX},${points[0].viewY}`}`} fill="none" stroke="#fff8ed" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />
              )}
              {points.length > 0 && (
                <polyline points={`${trace}${drawing ? '' : ` ${points[0].viewX},${points[0].viewY}`}`} fill="none" stroke="#bd7057" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
              )}
            </svg>
          )}
          {!sourceLoaded && !error && !processedImage && <span className="photo-editor-wait">写真を読み込んでいます…</span>}
          {processing && (
            <div className="photo-editor-processing" role="status" aria-live="polite">
              <LoaderCircle className="photo-editor-spinner" size={38} />
              <strong>背景を消しています…✨</strong>
              <span>初回はAIモデルをダウンロードします。写真は端末内で処理されます。</span>
            </div>
          )}
        </div>

        {processedImage ? (
          <div className="photo-editor-controls">
            <p className="photo-editor-hint">加工した画像を確認してください。</p>
            <div className="photo-editor-actions">
              <button type="button" className="photo-editor-secondary" onClick={() => setProcessedImage('')}>
                <RotateCcw size={16} /> やり直す
              </button>
              <button type="button" className="photo-editor-apply" onClick={() => onApply(processedImage)}>
                <Check size={17} /> この画像で図鑑に登録
              </button>
            </div>
          </div>
        ) : (
          <div className="photo-editor-controls">
            {mode === 'shape' && (
              <>
                <div className="photo-editor-shapes" role="group" aria-label="切り抜く形">
                  <button type="button" aria-pressed={shape === 'circle'} onClick={() => setShape('circle')}>
                    <Circle size={17} /> 丸型
                  </button>
                  <button type="button" aria-pressed={shape === 'square'} onClick={() => setShape('square')}>
                    <Square size={17} /> 四角形
                  </button>
                </div>
                <p className="photo-editor-hint">写真の中央を選んだ形に切り抜きます。</p>
                <button type="button" className="photo-editor-primary" onClick={runShapeCrop} disabled={!sourceLoaded}>
                  この形で切り抜く
                </button>
              </>
            )}
            {mode === 'freehand' && (
              <>
                <p className="photo-editor-hint">写真の上を指やマウスで一周なぞってください。囲んだ内側を残します。</p>
                <div className="photo-editor-actions">
                  <button type="button" className="photo-editor-secondary" onClick={() => { setPoints([]); setError(''); }} disabled={points.length === 0}>
                    <RotateCcw size={16} /> なぞり直す
                  </button>
                  <button type="button" className="photo-editor-primary" onClick={runFreehandCrop} disabled={!sourceLoaded || points.length < 3}>
                    なぞった範囲を切り抜く
                  </button>
                </div>
              </>
            )}
            {mode === 'ai' && (
              <>
                <p className="photo-editor-hint">写真は端末内でAI処理します。初回のみ約44MBのモデルを読み込みます。</p>
                <button type="button" className="photo-editor-primary" onClick={() => void runBackgroundRemoval()} disabled={!sourceLoaded || processing}>
                  <Sparkles size={17} /> ワンタップで背景を消す
                </button>
              </>
            )}
            {error && <p className="photo-editor-error" role="alert">{error}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
