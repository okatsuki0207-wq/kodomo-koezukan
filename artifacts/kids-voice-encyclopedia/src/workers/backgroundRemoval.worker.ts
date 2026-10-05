import { env, pipeline } from '@huggingface/transformers';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ image: string }>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

// A single-threaded, quantized model keeps mobile memory use lower.
env.allowLocalModels = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}

workerScope.onmessage = async ({ data }) => {
  try {
    const removeBackground = await pipeline(
      'background-removal',
      'onnx-community/ormbg-ONNX',
      { dtype: 'q8', device: 'wasm' },
    );
    const result = await removeBackground(data.image);
    if (result.channels !== 4) throw new Error('Expected a transparent RGBA image');
    const pixels = Uint8ClampedArray.from(result.data);
    workerScope.postMessage(
      { pixels: pixels.buffer, width: result.width, height: result.height },
      [pixels.buffer],
    );
  } catch {
    workerScope.postMessage({ error: true });
  }
};
