import { computeGuidedMask, type MaskStroke } from '../lib/guidedSegmentation';

self.onmessage = (event: MessageEvent<{ pixels: ArrayBuffer; width: number; height: number; strokes: MaskStroke[] }>) => {
  try {
    const { pixels, width, height, strokes } = event.data;
    const result = computeGuidedMask(new Uint8ClampedArray(pixels), width, height, strokes);
    self.postMessage({ pixels: result.buffer, width, height }, { transfer: [result.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '塗り指定の切り抜きに失敗しました。' });
  }
};
