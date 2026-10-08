import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Image as ImageIcon, LoaderCircle, PenLine, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { containScale, smoothTracePath } from '../lib/cropGeometry';
import type { ResizeHandle, Size } from '../lib/cropGeometry';
import { containMap, naturalToStage } from './photo-editor/contain';
import { cropForAi, cropFreehand, cropToShape, resizedDataUrl } from './photo-editor/exportImage';
import { usePhotoCrop } from './photo-editor/usePhotoCrop';
import { useFreehand } from './photo-editor/usePointerPaint';
import { removeSelectedBackground } from './photo-editor/subjectCutout';
import './PhotoEditor.css';

type EditMode = 'shape' | 'freehand' | 'ai';
type CropShape = 'circle' | 'square';
type Props = { source: string; onCancel: () => void; onApply: (image: string) => void; onUseOriginal: () => void };

const CIRCLE_HANDLES: ResizeHandle[] = ['nw', 'ne', 'se', 'sw'];
const RECT_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_LABEL: Record<ResizeHandle, string> = {
  n: '上', s: '下', e: '右', w: '左', ne: '右上', nw: '左上', se: '右下', sw: '左下',
};

function handlePos(handle: ResizeHandle, f: { x: number; y: number; width: number; height: number }) {
  const cx = handle.includes('w') ? f.x : handle.includes('e') ? f.x + f.width : f.x + f.width / 2;
  const cy = handle.includes('n') ? f.y : handle.includes('s') ? f.y + f.height : f.y + f.height / 2;
  return { left: cx, top: cy };
}

export default function PhotoEditor({ source, onCancel, onApply, onUseOriginal }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const runId = useRef(0);
  const busyRef = useRef(false);
  const [mode, setMode] = useState<EditMode>('shape');
  const [shape, setShape] = useState<CropShape>('circle');
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState<Size>({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState(false);
  const [processedImage, setProcessedImage] = useState('');
  const [processing, setProcessing] = useState<'' | 'ai'>('');
  const [error, setError] = useState('');

  const idle = !processedImage && !processing && loaded;
  const circle = mode === 'shape' && shape === 'circle';
  const crop = usePhotoCrop({
    stageRef, enabled: idle && (mode === 'shape' || mode === 'ai'), viewport, image: imageSize, circle, resetKey: source,
  });
  const surfaceOpts = { stageRef, enabled: idle, image: imageSize, viewport };
  const freehand = useFreehand({ ...surfaceOpts, enabled: idle && mode === 'freehand',
    onComplete: (points) => guard(() => cropFreehand(imageRef.current!, points)) });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setViewport({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const clearWork = () => {
    runId.current += 1;
    busyRef.current = false;
    freehand.clear();
    setProcessedImage('');
    setProcessing('');
    setError('');
  };
  const clearWorkRef = useRef(clearWork);
  clearWorkRef.current = clearWork;
  useEffect(() => () => { runId.current += 1; }, []);

  useEffect(() => {
    clearWorkRef.current();
    setMode('shape');
    setShape('circle');
    const image = imageRef.current;
    const ready = Boolean(image?.complete && image.naturalWidth);
    setLoaded(ready);
    setImageSize(ready && image ? { width: image.naturalWidth, height: image.naturalHeight } : { width: 0, height: 0 });
  }, [source]);

  const chooseMode = (next: EditMode) => { clearWork(); setMode(next); };

  const guard = (fn: () => string) => {
    const image = imageRef.current;
    if (!image?.naturalWidth) return;
    try { setProcessedImage(fn()); setError(''); } catch (caught) {
      setError(caught instanceof Error ? caught.message : '写真を切り抜けませんでした。別の写真をお試しください。');
    }
  };

  const runShapeCrop = () => guard(() => cropToShape(imageRef.current!, circle, viewport, crop.transform, crop.frame));
  const runFreehandCrop = () => guard(() => cropFreehand(imageRef.current!, freehand.points));

  const runAi = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const id = ++runId.current;
    setProcessing('ai');
    setError('');
    try {
      const selection = cropForAi(imageRef.current!, viewport, crop.transform, crop.frame);
      // Existing local semantic model intersects source opacity and crops its
      // transparent bounds after inference. The rectangle is selected first.
      const canvas = await removeSelectedBackground(selection);
      if (id !== runId.current) return;
      setProcessedImage(resizedDataUrl(canvas, canvas.width, canvas.height, 'image/png'));
    } catch {
      if (id === runId.current) setError('背景を削除できませんでした。枠を少し広げて再度お試しください。元の写真と枠はそのままです。');
    } finally {
      if (id === runId.current) { busyRef.current = false; setProcessing(''); }
    }
  };

  const map = containMap(imageSize, viewport);
  const fit = containScale(imageSize, viewport);
  let imageStyle: React.CSSProperties | undefined;
  if (loaded && viewport.width) {
    if (mode === 'shape' || mode === 'ai') {
      const w = imageSize.width * fit;
      const h = imageSize.height * fit;
      imageStyle = {
        width: w, height: h,
        transform: `translate(${viewport.width / 2 + crop.transform.pan.x - w / 2}px, ${viewport.height / 2 + crop.transform.pan.y - h / 2}px) scale(${crop.transform.zoom})`,
      };
    } else {
      imageStyle = { width: map.width, height: map.height, transform: `translate(${map.ox}px, ${map.oy}px)` };
    }
  }

  const toView = (pts: { x: number; y: number }[]) => pts.map((p) => naturalToStage(p, map));
  const freehandPath = freehand.points.length > 1 ? smoothTracePath(toView(freehand.points), !freehand.drawing) : '';
  const f = crop.frame;
  const handles = circle ? CIRCLE_HANDLES : RECT_HANDLES;
  const showFrame = idle && (mode === 'shape' || mode === 'ai') && crop.ready && f.width > 0;
  const stageClass = !processedImage && idle
    ? mode === 'shape' || mode === 'ai' ? ' is-cropping' : mode === 'freehand' ? ' is-drawing' : ''
    : '';

  return (
    <div className="photo-editor-overlay" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !processing) onCancel(); }}>
      <section className="photo-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="photo-editor-title">
        <header className="photo-editor-header">
          <div>
            <h2 id="photo-editor-title">写真をととのえる</h2>
            <p>型抜き、なぞって切り抜く、AIで切り抜く。</p>
          </div>
          <button type="button" className="photo-editor-close" onClick={onCancel} disabled={Boolean(processing)} aria-label="写真編集を閉じる" data-testid="button-close-photo-editor">
            <X size={19} />
          </button>
        </header>

        <div className="photo-editor-tabs" role="tablist" aria-label="写真の加工方法">
          <button type="button" role="tab" aria-label="型抜き（丸・四角）" title="型抜き（丸・四角）" aria-selected={mode === 'shape'} onClick={() => chooseMode('shape')} disabled={Boolean(processing)} data-testid="tab-photo-shape"><Circle size={18} /></button>
          <button type="button" role="tab" aria-label="なぞって切り抜く" title="なぞって切り抜く" aria-selected={mode === 'freehand'} onClick={() => chooseMode('freehand')} disabled={Boolean(processing)} data-testid="tab-photo-freehand"><PenLine size={18} /></button>
          <button type="button" role="tab" aria-label="AIで背景を切り抜く" title="AIで背景を切り抜く" aria-selected={mode === 'ai'} onClick={() => chooseMode('ai')} disabled={Boolean(processing)} data-testid="tab-photo-ai"><Sparkles size={18} /></button>
        </div>

        <div className={`photo-editor-stage${stageClass}`} ref={stageRef} {...((mode === 'shape' || mode === 'ai') && !processedImage ? crop.stageProps : {})} data-testid="photo-editor-stage">
          {processedImage && <img className="photo-editor-image is-result" src={processedImage} alt="加工後の写真プレビュー" />}
          <img
            ref={imageRef}
            className={`photo-editor-image is-source${processedImage ? ' is-hidden' : ''}`}
            style={imageStyle}
            src={source}
            alt="加工する写真"
            draggable={false}
            onLoad={(event) => {
              setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
              setLoaded(true);
            }}
            onError={() => setError('写真を表示できませんでした。別の写真を選んでください。')}
          />
          {showFrame && (
            <>
              <div
                className={`photo-editor-crop-frame ${circle ? 'is-circle' : 'is-square'}`}
                style={{ left: f.x, top: f.y, width: f.width, height: f.height }}
                data-x={Math.round(f.x)} data-y={Math.round(f.y)}
                data-width={Math.round(f.width)} data-height={Math.round(f.height)}
                aria-hidden="true"
                data-testid="photo-crop-frame"
              />
              {handles.map((handle) => (
                <button
                  key={handle}
                  type="button"
                  className={`photo-editor-handle handle-${handle}`}
                  style={handlePos(handle, f)}
                  aria-label={`切り抜き枠の${HANDLE_LABEL[handle]}をサイズ変更。矢印キーで動かせます`}
                  data-testid={`crop-handle-${handle}`}
                  {...crop.handleProps(handle)}
                />
              ))}
            </>
          )}
          {!processedImage && loaded && mode === 'freehand' && (
            <svg className="photo-editor-trace" width={viewport.width} height={viewport.height}
              viewBox={`0 0 ${viewport.width} ${viewport.height}`} aria-label="切り抜く範囲をなぞる"
              {...freehand.surfaceProps} onPointerDown={(event) => { setError(''); freehand.surfaceProps.onPointerDown(event); }} data-testid="photo-freehand-surface">
              {freehandPath && !freehand.drawing && freehand.points.length > 2 && <path d={freehandPath} className="trace-fill" />}
              {freehandPath && <path d={freehandPath} className="trace-halo" vectorEffect="non-scaling-stroke" />}
              {freehandPath && <path d={freehandPath} className="trace-core" vectorEffect="non-scaling-stroke" />}
            </svg>
          )}
          {!loaded && !error && !processedImage && <span className="photo-editor-wait">写真を読み込んでいます…</span>}
          {processing && (
            <div className="photo-editor-processing" role="status" aria-live="polite" data-testid="status-photo-ai-processing">
              <LoaderCircle className="photo-editor-spinner" size={38} />
              <strong>選んだ範囲の背景を消しています…</strong>
              <span>初回はAIモデルをダウンロードします。写真は端末内で処理され、外部には送られません。</span>
            </div>
          )}
        </div>

        {processedImage ? (
          <div className="photo-editor-controls">
            <p className="photo-editor-hint">加工した画像を確認してください。</p>
            <div className="photo-editor-actions">
              <button type="button" className="photo-editor-secondary" aria-label="やり直す" title="やり直す" onClick={() => setProcessedImage('')} data-testid="button-redo-photo"><RotateCcw size={19} /></button>
              <button type="button" className="photo-editor-apply" aria-label="この画像で図鑑に登録" title="この画像で図鑑に登録" onClick={() => onApply(processedImage)} data-testid="button-apply-photo"><Check size={19} /></button>
            </div>
          </div>
        ) : (
          <div className="photo-editor-controls">
            {mode === 'shape' && (
              <>
                <div className="photo-editor-shapes" role="group" aria-label="切り抜く形">
                  <button type="button" aria-label="丸型" title="丸型" aria-pressed={circle} onClick={() => setShape('circle')} data-testid="button-crop-circle"><Circle size={19} /></button>
                  <button type="button" aria-label="四角形" title="四角形" aria-pressed={!circle} onClick={() => setShape('square')} data-testid="button-crop-square"><Square size={19} /></button>
                </div>
                <p className="photo-editor-hint">枠の中をドラッグで枠を移動、外側で写真を移動。2本指のピンチやマウスホイールで拡大縮小、枠の角{circle ? '' : 'や辺'}で大きさを変えられます。</p>
                <div className="photo-editor-actions">
                  <button type="button" className="photo-editor-secondary" aria-label="切り抜かず写真をそのまま使う" title="切り抜かず写真をそのまま使う" onClick={onUseOriginal} data-testid="button-use-original-photo"><ImageIcon size={19} /></button>
                  <button type="button" className="photo-editor-primary" aria-label="この形で切り抜く" title="この形で切り抜く" onClick={runShapeCrop} disabled={!crop.ready || f.width <= 0} data-testid="button-run-shape-crop"><Check size={19} /></button>
                </div>
              </>
            )}
            {mode === 'freehand' && (
              <>
                <p className="photo-editor-hint">ドラッグ中はペンの線だけが表示されます。指を離すと、始点と終点をなめらかにつないで内側を切り抜きます。</p>
                <div className="photo-editor-actions">
                  <button type="button" className="photo-editor-secondary" aria-label="切り抜かず写真をそのまま使う" title="切り抜かず写真をそのまま使う" onClick={onUseOriginal} data-testid="button-use-original-photo"><ImageIcon size={19} /></button>
                  <button type="button" className="photo-editor-secondary" aria-label="なぞり直す" title="なぞり直す" onClick={() => { freehand.clear(); setError(''); }} disabled={freehand.points.length === 0} data-testid="button-clear-photo-trace"><RotateCcw size={19} /></button>
                  <button type="button" className="photo-editor-primary" aria-label="なぞった範囲を切り抜く" title="なぞった範囲を切り抜く" onClick={runFreehandCrop} disabled={!loaded || freehand.drawing || freehand.points.length < 3} data-testid="button-run-freehand-crop"><Check size={19} /></button>
                </div>
              </>
            )}
            {mode === 'ai' && (
              <>
                <p className="photo-editor-hint">① 四角い枠を対象のすぐ外側に合わせます（角や辺をドラッグ）。② 枠の中だけをAIで背景削除します。透明な余白も詰めて仕上げます。処理は端末内で行います。</p>
                <p className="photo-editor-alpha-note">※別アプリで背景透過した画像をそのまま追加することもできます</p>
                <div className="photo-editor-actions">
                  <button type="button" className="photo-editor-secondary" aria-label="切り抜かず写真をそのまま使う" title="切り抜かず写真をそのまま使う" onClick={onUseOriginal} data-testid="button-use-original-photo"><ImageIcon size={19} /></button>
                  <button type="button" className="photo-editor-primary" aria-label="この範囲をAIで背景カット" title="この範囲をAIで背景カット" onClick={() => void runAi()} disabled={!loaded || !crop.ready || f.width <= 0 || Boolean(processing)} data-testid="button-run-photo-ai"><Sparkles size={20} /></button>
                </div>
              </>
            )}
            {error && <p className="photo-editor-error" role="alert" data-testid="status-photo-editor-error">{error}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
