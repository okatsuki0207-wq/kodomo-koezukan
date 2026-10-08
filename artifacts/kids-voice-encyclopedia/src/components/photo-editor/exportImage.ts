import { smoothTracePath, sourceCropRect } from '../../lib/cropGeometry';
import type { CropFrame, Point, Size, Transform } from '../../lib/cropGeometry';

export const MAX_IMAGE_DIMENSION = 600;
const JPEG_QUALITY = 0.75;
export const AI_MAX_DIMENSION = 448;

export function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を加工できませんでした');
  return { canvas, context };
}

export function resizedDataUrl(source: CanvasImageSource, w: number, h: number, format: 'image/jpeg' | 'image/png') {
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(w, h));
  const { canvas, context } = makeCanvas(w * scale, h * scale);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(format, format === 'image/jpeg' ? JPEG_QUALITY : undefined);
}

export function resizeForAi(source: string) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, AI_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
        const { canvas, context } = makeCanvas(image.naturalWidth * scale, image.naturalHeight * scale);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/jpeg', 0.8);
        canvas.width = 1;
        canvas.height = 1;
        resolve(url);
      } catch {
        reject(new Error('Could not prepare the image for background removal'));
      }
    };
    image.onerror = () => reject(new Error('Could not load the image for background removal'));
    image.src = source;
  });
}

export function cropToShape(
  image: HTMLImageElement, circle: boolean, viewport: Size, transform: Transform, frame: CropFrame,
) {
  const rect = sourceCropRect({ width: image.naturalWidth, height: image.naturalHeight }, viewport, transform, frame);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(rect.width, rect.height));
  const { canvas, context } = makeCanvas(rect.width * scale, rect.height * scale);
  if (circle) {
    context.beginPath();
    context.ellipse(canvas.width / 2, canvas.height / 2, canvas.width / 2, canvas.height / 2, 0, 0, Math.PI * 2);
    context.clip();
  }
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  // Always encode a crop as PNG so existing alpha is not flattened to white.
  return canvas.toDataURL('image/png');
}

/** Rectangle-only ROI for AI. Preserve source transparency, and never send the
 * unselected portion of the photo to the inference worker. */
export function cropForAi(image: HTMLImageElement, viewport: Size, transform: Transform, frame: CropFrame) {
  const rect = sourceCropRect({ width: image.naturalWidth, height: image.naturalHeight }, viewport, transform, frame);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(rect.width, rect.height));
  const { canvas, context } = makeCanvas(rect.width * scale, rect.height * scale);
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function cropFreehand(image: HTMLImageElement, points: Point[]) {
  const pad = 2;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.max(0, Math.min(...xs) - pad);
  const minY = Math.max(0, Math.min(...ys) - pad);
  const maxX = Math.min(image.naturalWidth, Math.max(...xs) + pad);
  const maxY = Math.min(image.naturalHeight, Math.max(...ys) + pad);
  const sw = maxX - minX;
  const sh = maxY - minY;
  if (points.length < 3 || sw < 4 || sh < 4) throw new Error('写真の上を指で囲んでから、切り抜いてください。');
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(sw, sh));
  const { canvas, context } = makeCanvas(sw * scale, sh * scale);
  context.scale(canvas.width / sw, canvas.height / sh);
  context.translate(-minX, -minY);
  context.clip(new Path2D(smoothTracePath(points, true)));
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let visible = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > 0) { visible = true; break; }
  }
  if (!visible) throw new Error('囲んだ範囲がありません。対象の周りを一周なぞってください。');
  return canvas.toDataURL('image/png');
}
