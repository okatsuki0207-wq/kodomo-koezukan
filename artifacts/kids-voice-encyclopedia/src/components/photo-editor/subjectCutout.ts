import { removeBackgroundOnDevice } from '../../lib/backgroundRemoval';
import { intersectSubjectMask, refineSubjectOpacity, subjectBounds } from '../../lib/subjectMask';
import { AI_MAX_DIMENSION, makeCanvas } from './exportImage';

/** Only the selected subject region reaches the local AI worker. No image upload. */
export async function removeSelectedBackground(selection: string) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('囲んだ写真を読み込めませんでした。'));
    img.src = selection;
  });
  const { canvas: original, context } = makeCanvas(image.naturalWidth, image.naturalHeight);
  context.drawImage(image, 0, 0);
  const originalPixels = context.getImageData(0, 0, original.width, original.height);
  const padding = 32;
  const scale = Math.min(1, (AI_MAX_DIMENSION - padding * 2) / Math.max(original.width, original.height));
  const contentWidth = Math.max(1, Math.round(original.width * scale));
  const contentHeight = Math.max(1, Math.round(original.height * scale));
  const { canvas: input, context: inputCtx } = makeCanvas(contentWidth + padding * 2, contentHeight + padding * 2);
  // White outside the lasso prevents artificial black transparency from becoming a subject.
  inputCtx.fillStyle = '#fff';
  inputCtx.fillRect(0, 0, input.width, input.height);
  // Context padding prevents a tightly enclosed object from being mistaken for edge background.
  inputCtx.drawImage(original, padding, padding, contentWidth, contentHeight);
  const inferred = await removeBackgroundOnDevice(input.toDataURL('image/jpeg', .8));
  const { canvas: mask, context: maskCtx } = makeCanvas(original.width, original.height);
  const sx = inferred.width / input.width, sy = inferred.height / input.height;
  maskCtx.drawImage(inferred, padding * sx, padding * sy, contentWidth * sx, contentHeight * sy, 0, 0, mask.width, mask.height);
  const refined = refineSubjectOpacity(originalPixels.data, maskCtx.getImageData(0, 0, mask.width, mask.height).data, mask.width, mask.height);
  const pixels = intersectSubjectMask(originalPixels.data, refined);
  const bounds = subjectBounds(pixels, original.width, original.height);
  context.putImageData(new ImageData(pixels, original.width, original.height), 0, 0);
  const { canvas: result, context: resultCtx } = makeCanvas(bounds.width, bounds.height);
  resultCtx.drawImage(original, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  original.width = input.width = mask.width = inferred.width = 1;
  return result;
}
