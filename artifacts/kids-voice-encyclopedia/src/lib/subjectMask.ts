/**
 * Repair low-confidence matte holes in solid-colour drawings using AI foreground
 * anchors. Never grow into an unrelated disconnected colour patch or colours
 * predominantly seen in confident exterior background. Keep other soft edges.
 */
export function refineSubjectOpacity(original: Uint8ClampedArray, mask: Uint8ClampedArray, width: number, height: number) {
  if (original.length !== width * height * 4 || mask.length !== original.length || !width || !height) {
    throw new Error('画像とマスクの大きさが一致しません。');
  }
  const count = width * height;
  const foreground = new Uint32Array(4096), background = new Uint32Array(4096);
  const left = new Int32Array(height).fill(width), right = new Int32Array(height).fill(-1);
  const top = new Int32Array(width).fill(height), bottom = new Int32Array(width).fill(-1);
  const key = (i: number) => ((original[i] >> 4) << 8) | ((original[i + 1] >> 4) << 4) | (original[i + 2] >> 4);
  const margin = Math.max(2, Math.floor(Math.min(width, height) * .05));
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    if (original[i + 3] < 224) continue;
    const x = p % width, y = Math.floor(p / width);
    if (mask[i + 3] >= 64) {
      foreground[key(i)]++;
      left[y] = Math.min(left[y], x); right[y] = Math.max(right[y], x);
      top[x] = Math.min(top[x], y); bottom[x] = Math.max(bottom[x], y);
    }
    if (mask[i + 3] <= 8 && (x < margin || y < margin || x >= width - margin || y >= height - margin)) {
      background[key(i)]++;
    }
  }
  const candidate = new Uint8Array(count), visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0, tail = 0;
  for (let p = 0; p < count; p++) {
    const i = p * 4, bin = key(i);
    const x = p % width, y = Math.floor(p / width);
    const supported = mask[i + 3] >= 24 || (x > left[y] && x < right[y] && y > top[x] && y < bottom[x]);
    if (!supported || original[i + 3] < 8 || foreground[bin] < 4 || foreground[bin] <= background[bin] * 4) continue;
    candidate[p] = 1;
    if (mask[i + 3] >= 64) { visited[p] = 1; queue[tail++] = p; }
  }
  const result = mask.slice();
  const enqueue = (p: number) => {
    if (candidate[p] && !visited[p]) { visited[p] = 1; queue[tail++] = p; }
  };
  while (head < tail) {
    const p = queue[head++], x = p % width;
    result[p * 4 + 3] = 255;
    if (x > 0) enqueue(p - 1);
    if (x < width - 1) enqueue(p + 1);
    if (p >= width) enqueue(p - width);
    if (p < count - width) enqueue(p + width);
  }
  return result;
}

/** Use the model's alpha, never its JPEG RGB; retain the original lasso boundary. */
export function intersectSubjectMask(original: Uint8ClampedArray, mask: Uint8ClampedArray) {
  if (original.length !== mask.length || original.length % 4 !== 0) throw new Error('画像とマスクの大きさが一致しません。');
  const result = new Uint8ClampedArray(original.length);
  for (let i = 0; i < original.length; i += 4) {
    const alpha = Math.round(original[i + 3] * mask[i + 3] / 255);
    if (alpha < 8) continue;
    result[i] = original[i]; result[i + 1] = original[i + 1]; result[i + 2] = original[i + 2];
    result[i + 3] = alpha;
  }
  return result;
}

export function subjectBounds(pixels: Uint8ClampedArray, width: number, height: number) {
  if (!width || !height || pixels.length !== width * height * 4) throw new Error('画像の大きさを確認できませんでした。');
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] === 0) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error('囲んだ範囲に被写体を見つけられませんでした。範囲を変えてやり直してください。');
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
