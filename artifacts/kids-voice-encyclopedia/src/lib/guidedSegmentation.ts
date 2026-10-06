import type { Point } from './cropGeometry';
export type MaskStroke = { points: Point[]; radius: number; kind: 'keep' | 'remove' };

/** Seeded, colour- and edge-aware geodesic segmentation. No network/model.
 * This is interactive segmentation, not semantic recognition: similar colours,
 * hair and transparent objects may need more keep/remove strokes. */
function paintSeeds(labels: Uint8Array, width: number, height: number, strokes: readonly MaskStroke[]) {
  for (const stroke of strokes) {
    if (!Number.isFinite(stroke.radius) || stroke.radius <= 0) continue;
    const radius = Math.min(Math.max(width, height), stroke.radius);
    const stamp = (p: Point) => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      const x0 = Math.max(0, Math.floor(p.x - radius));
      const x1 = Math.min(width - 1, Math.ceil(p.x + radius));
      const y0 = Math.max(0, Math.floor(p.y - radius));
      const y1 = Math.min(height - 1, Math.ceil(p.y + radius));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if ((x + .5 - p.x) ** 2 + (y + .5 - p.y) ** 2 <= radius ** 2) labels[y * width + x] = stroke.kind === 'keep' ? 1 : 2;
      }
    };
    for (let i = 0; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      if (i === 0) { stamp(p); continue; }
      const before = stroke.points[i - 1];
      const steps = Math.ceil(Math.hypot(p.x - before.x, p.y - before.y) / Math.max(1, radius / 2));
      for (let j = 0; j <= steps; j++) {
        const t = steps ? j / steps : 0;
        stamp({ x: before.x + (p.x - before.x) * t, y: before.y + (p.y - before.y) * t });
      }
    }
  }
}

type Colour = [number, number, number];
const colourDistance = (a: Colour, b: Colour) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function coloursFor(pixels: Uint8ClampedArray, seeds: Uint8Array, label: number): Colour[] {
  const count = seeds.reduce((n, seed) => n + Number(seed === label), 0);
  const stride = Math.max(1, Math.ceil(count / 1024));
  const samples: Colour[] = [];
  let seen = 0;
  for (let i = 0; i < seeds.length; i++) {
    if (seeds[i] === label && seen++ % stride === 0) samples.push([pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]]);
  }
  if (!samples.length) return [];
  // Farthest-colour initialization retains multiple colours on a painted toy.
  const centers: Colour[] = [samples[0]];
  while (centers.length < 6) {
    let farthest = samples[0], maxDistance = 0;
    for (const sample of samples) {
      const d = Math.min(...centers.map((center) => colourDistance(sample, center)));
      if (d > maxDistance) { maxDistance = d; farthest = sample; }
    }
    if (maxDistance < 400) break;
    centers.push(farthest);
  }
  for (let pass = 0; pass < 4; pass++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const sample of samples) {
      let nearest = 0, best = Infinity;
      centers.forEach((center, index) => {
        const distance = colourDistance(sample, center);
        if (distance < best) { best = distance; nearest = index; }
      });
      const sum = sums[nearest];
      sum[0] += sample[0]; sum[1] += sample[1]; sum[2] += sample[2]; sum[3]++;
    }
    sums.forEach((sum, i) => { if (sum[3]) centers[i] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]]; });
  }
  return centers;
}

class MinHeap {
  private nodes: number[] = [];
  private costs: number[] = [];
  push(node: number, cost: number) {
    let i = this.nodes.length;
    this.nodes.push(node); this.costs.push(cost);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent] <= cost) break;
      this.nodes[i] = this.nodes[parent]; this.costs[i] = this.costs[parent]; i = parent;
    }
    this.nodes[i] = node; this.costs[i] = cost;
  }
  pop(): [number, number] | null {
    if (!this.nodes.length) return null;
    const result: [number, number] = [this.nodes[0], this.costs[0]];
    const node = this.nodes.pop()!, cost = this.costs.pop()!;
    if (this.nodes.length) {
      let i = 0;
      while (i * 2 + 1 < this.nodes.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.nodes.length && this.costs[child + 1] < this.costs[child]) child++;
        if (this.costs[child] >= cost) break;
        this.nodes[i] = this.nodes[child]; this.costs[i] = this.costs[child]; i = child;
      }
      this.nodes[i] = node; this.costs[i] = cost;
    }
    return result;
  }
}

function geodesic(pixels: Uint8ClampedArray, seeds: Uint8Array, width: number, height: number, label: number) {
  const count = width * height;
  const models = coloursFor(pixels, seeds, label);
  const prior = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const colour: Colour = [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]];
    let best = Infinity;
    for (const model of models) best = Math.min(best, colourDistance(colour, model));
    prior[i] = Math.min(40, best / 1024);
  }
  const distance = new Float64Array(count).fill(Infinity);
  const heap = new MinHeap();
  for (let i = 0; i < count; i++) if (seeds[i] === label) { distance[i] = 0; heap.push(i, 0); }
  let entry: [number, number] | null;
  while ((entry = heap.pop())) {
    const [index, cost] = entry;
    if (cost !== distance[index]) continue;
    const x = index % width, y = Math.floor(index / width);
    const neighbors = [x ? index - 1 : -1, x < width - 1 ? index + 1 : -1,
      y ? index - width : -1, y < height - 1 ? index + width : -1];
    for (const next of neighbors) {
      if (next < 0 || (seeds[next] !== 0 && seeds[next] !== label)) continue;
      const a = index * 4, b = next * 4;
      const edge = (pixels[a] - pixels[b]) ** 2 + (pixels[a + 1] - pixels[b + 1]) ** 2 + (pixels[a + 2] - pixels[b + 2]) ** 2;
      const candidate = cost + 1 + edge / 64 + prior[next];
      if (candidate < distance[next]) { distance[next] = candidate; heap.push(next, candidate); }
    }
  }
  return distance;
}

export function computeGuidedMask(pixels: Uint8ClampedArray, width: number, height: number, strokes: readonly MaskStroke[]): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 600 || height > 600 || pixels.length !== width * height * 4) throw new Error('画像サイズが正しくありません。');
  const count = width * height;
  const seeds = new Uint8Array(count);
  paintSeeds(seeds, width, height, strokes);
  for (let i = 0; i < count; i++) {
    if (pixels[i * 4 + 3] === 0) seeds[i] = 2;
    else if (seeds[i] === 0 && (i < width || i >= count - width || i % width === 0 || i % width === width - 1)) seeds[i] = 2;
  }
  if (!seeds.includes(1)) throw new Error('残したい対象の内側を塗ってください。');
  const fg = geodesic(pixels, seeds, width, height, 1);
  const bg = geodesic(pixels, seeds, width, height, 2);
  const region = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let tail = 0;
  for (let i = 0; i < count; i++) if (seeds[i] === 1) { queue[tail++] = i; region[i] = 1; }
  // Do not retain unrelated, unpainted disconnected objects of a similar colour.
  for (let head = 0; head < tail; head++) {
    const index = queue[head], x = index % width, y = Math.floor(index / width);
    for (const next of [x ? index - 1 : -1, x < width - 1 ? index + 1 : -1,
      y ? index - width : -1, y < height - 1 ? index + width : -1]) {
      if (next >= 0 && !region[next] && seeds[next] !== 2 && fg[next] < bg[next]) {
        region[next] = 1; queue[tail++] = next;
      }
    }
  }
  const result = new Uint8ClampedArray(pixels);
  for (let i = 0; i < count; i++) {
    let alpha = region[i] * 255;
    // A one-pixel antialiased boundary; explicit keep/remove marks win.
    if (seeds[i] === 0 && region[i] === 1) {
      const x = i % width, y = Math.floor(i / width);
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) { sum += region[i + dy * width + dx]; n++; }
      }
      alpha = 255 * sum / n;
    }
    result[i * 4 + 3] = Math.round(pixels[i * 4 + 3] * alpha / 255);
    if (result[i * 4 + 3] === 0) {
      result[i * 4] = 0; result[i * 4 + 1] = 0; result[i * 4 + 2] = 0;
    }
  }
  return result;
}
