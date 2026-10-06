import type { MaskStroke } from './guidedSegmentation';
export type { MaskStroke } from './guidedSegmentation';

/** Photo pixels never leave the browser. Work is bounded and off the UI thread. */
export async function guidedCutoutOnDevice(source: string, strokes: MaskStroke[]): Promise<HTMLCanvasElement> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('写真を読み込めませんでした。'));
    image.src = source;
  });
  const scale = Math.min(1, 600 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('画像を加工できませんでした。');
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const scaled = strokes.map((stroke) => ({ ...stroke, radius: stroke.radius * scale,
    points: stroke.points.map((point) => ({ x: point.x * scale, y: point.y * scale })) }));
  const result = await new Promise<Uint8ClampedArray<ArrayBuffer>>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/guidedCutout.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { window.clearTimeout(timer); worker.terminate(); };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('処理に時間がかかっています。塗る範囲を減らして再度お試しください。')); }, 45_000);
    worker.onerror = () => { cleanup(); reject(new Error('切り抜きに失敗しました。もう一度お試しください。')); };
    worker.onmessage = (event: MessageEvent<{ pixels?: ArrayBuffer; error?: string }>) => {
      cleanup();
      if (event.data.error || !event.data.pixels) reject(new Error(event.data.error || '切り抜きに失敗しました。'));
      else resolve(new Uint8ClampedArray(event.data.pixels));
    };
    worker.postMessage({ pixels: data.buffer, width, height, strokes: scaled }, [data.buffer]);
  });
  // Tight transparent output bounds keep the sticker large in the collection.
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (result[(y * width + x) * 4 + 3] > 0) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('対象を見つけられませんでした。残す領域を塗り直してください。');
  ctx.putImageData(new ImageData(result, width, height), 0, 0);
  const output = document.createElement('canvas');
  output.width = right - left + 1; output.height = bottom - top + 1;
  const outputCtx = output.getContext('2d');
  if (!outputCtx) throw new Error('切り抜き画像を作れませんでした。');
  outputCtx.drawImage(canvas, left, top, output.width, output.height, 0, 0, output.width, output.height);
  return output;
}
