/** Retain Blob bytes for editor drafts instead of borrowing revocable URLs.
 * Saved Firebase links may be refreshed once using their owner-scoped path. */
export async function loadVoiceSource(
  source: string | Blob,
  signal: AbortSignal,
  refresh?: () => Promise<string>,
): Promise<Blob> {
  signal.throwIfAborted();
  const validate = (blob: Blob) => {
    if (!blob.size) throw new Error('音声ファイルが空です。元の録音は変更していません。');
    if (blob.size >= 20 * 1024 * 1024) throw new Error('波形編集は20MB未満の音声に対応しています。');
    if (/^(text\/|application\/(json|xml))/.test(blob.type)) throw new Error('音声ではない応答が返りました。保存先のアクセス設定を確認してください。');
    return blob;
  };
  if (source instanceof Blob) return validate(source);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('音声の取得がタイムアウトしました。通信を確認し、再読み込みしてください。')), 25_000);
  const fetchBlob = async (url: string) => {
    controller.signal.throwIfAborted();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`音声の取得に失敗しました（HTTP ${response.status}）。`);
    const blob = validate(await response.blob());
    controller.signal.throwIfAborted();
    return blob;
  };
  try {
    try { return await fetchBlob(source); }
    catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (refresh && /^https:\/\//.test(source)) return await fetchBlob(await refresh());
      if (source.startsWith('blob:')) throw new Error('一時音声が見つかりません。編集画面を開き直してください。保存済みの音声は変更していません。');
      if (error instanceof TypeError) throw new Error('音声を取得できませんでした。通信、StorageのCORS設定、アクセス権をご確認ください。元の録音は変更していません。');
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
