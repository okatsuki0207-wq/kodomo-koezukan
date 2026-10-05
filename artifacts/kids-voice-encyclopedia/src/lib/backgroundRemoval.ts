const AI_TIMEOUT_MS = 120_000;

type WorkerResult = {
  error?: boolean;
  pixels?: ArrayBuffer;
  width?: number;
  height?: number;
};

/** Terminates inference on success, failure, or timeout so it cannot keep using memory. */
export function removeBackgroundOnDevice(image: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/backgroundRemoval.worker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Background removal timed out'));
    }, AI_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.terminate();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      cleanup();
      reject(new Error('Background removal failed'));
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(new Error('Could not read the background removal result'));
    };
    worker.onmessage = ({ data }: MessageEvent<WorkerResult>) => {
      cleanup();
      try {
        if (data.error || !data.pixels || !data.width || !data.height) {
          throw new Error('Background removal failed');
        }
        const canvas = document.createElement('canvas');
        canvas.width = data.width;
        canvas.height = data.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create the background removal preview');
        context.putImageData(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height), 0, 0);
        resolve(canvas);
      } catch (error) {
        reject(error);
      }
    };
    worker.postMessage({ image });
  });
}
