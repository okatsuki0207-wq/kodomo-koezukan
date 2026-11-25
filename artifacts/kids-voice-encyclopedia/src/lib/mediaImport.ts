const MEDIA_IMPORT_TIMEOUT_MS = 25_000;
const MEDIA_IMPORT_ATTEMPTS = 3;
const MEDIA_IMPORT_RETRY_DELAY_MS = 500;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function downloadImportedMedia(
  url: string,
  kind: 'image' | 'audio',
  fetcher: typeof fetch = fetch,
  delay: (milliseconds: number) => Promise<unknown> = wait,
): Promise<Blob> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MEDIA_IMPORT_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MEDIA_IMPORT_TIMEOUT_MS);
    try {
      const response = await fetcher(url, { signal: controller.signal });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`一時的な通信エラーです（${response.status}）。`);
      }
      if (!response.ok) {
        throw new Error(`Firebaseから${kind === 'image' ? '写真' : '音声'}を取得できませんでした（${response.status}）。`);
      }
      const blob = await response.blob();
      if (!blob.size || blob.size >= 20 * 1024 * 1024 || !blob.type.startsWith(`${kind}/`)) {
        throw new Error(`Firebaseの${kind === 'image' ? '写真' : '音声'}データを確認できません。`);
      }
      return blob;
    } catch (error) {
      lastError = error;
      const isRetryable = error instanceof TypeError ||
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && /一時的な通信エラー/u.test(error.message));
      if (!isRetryable || attempt === MEDIA_IMPORT_ATTEMPTS - 1) break;
      await delay(MEDIA_IMPORT_RETRY_DELAY_MS * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastError instanceof Error && lastError.name === 'AbortError') {
    throw new Error(`Firebaseの${kind === 'image' ? '写真' : '音声'}取得が時間切れになりました。通信状態を確認して再試行してください。`);
  }
  if (lastError instanceof Error && /一時的な通信エラー/u.test(lastError.message)) {
    throw new Error(`Firebaseの${kind === 'image' ? '写真' : '音声'}取得が一時的に失敗しました。時間をおいて再試行してください。`);
  }
  if (lastError instanceof TypeError || (lastError instanceof Error && /一時的な通信エラー/u.test(lastError.message))) {
    throw new Error(`Firebaseの${kind === 'image' ? '写真' : '音声'}を取得できませんでした。通信状態を確認して再試行してください。`);
  }
  throw lastError instanceof Error ? lastError : new Error('初回データの取り込みに失敗しました。');
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  const workerCount = Math.min(Math.max(1, concurrency), values.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (!failed && nextIndex < values.length) {
      const index = nextIndex++;
      try {
        results[index] = await map(values[index], index);
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  });
  await Promise.all(workers);
  if (failed) throw failure;
  return results;
}
