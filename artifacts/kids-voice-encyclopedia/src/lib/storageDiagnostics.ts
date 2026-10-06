type FirebaseFailure = {
  code?: string;
  serverResponse?: unknown;
  customData?: { serverResponse?: unknown };
};

/** SDKのバージョンや失敗箇所で、応答本文の格納場所・有無が異なる。 */
export function storageResponse(error: unknown): string {
  const failure = error as FirebaseFailure | null;
  const response = failure?.serverResponse ?? failure?.customData?.serverResponse;
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') return JSON.stringify(response);
  return '';
}

export function storageFailureMessage(error: unknown, bucket: string): string | null {
  const failure = error as FirebaseFailure | null;
  const code = failure?.code ?? '';
  if (!code.startsWith('storage/')) return null;
  const response = storageResponse(error).toLowerCase();
  // 応答本文をそのまま画面やログへ出さず、既知の原因だけを案内する。
  if (response.includes('has not been set up properly for firebase storage')) {
    return `Storageバケット「${bucket}」のFirebase設定が未完了です（HTTP 400）。Firebase ConsoleのStorageでこのバケットを取り込み、firebase/storage.rules を公開してください。CORS設定だけでは解消しません。`;
  }
  if (response.includes('service account') || response.includes('service agent') || response.includes('permission to access the bucket')) {
    return `Firebaseのサービスエージェントにバケット「${bucket}」の権限が不足している可能性があります。Storageの関連付けとIAM権限を確認してください。`;
  }
  if (code === 'storage/bucket-not-found' || code === 'storage/project-not-found') {
    return `Storageバケット「${bucket}」またはFirebaseプロジェクトが見つかりません。バケット名と所属プロジェクトを確認してください。`;
  }
  if (code === 'storage/quota-exceeded' || response.includes('billing') || response.includes('blaze')) {
    return 'Firebase Storageの課金設定または利用上限に問題があります。Blazeプラン・課金アカウント・使用量を確認してください。';
  }
  if (code === 'storage/unauthenticated') return 'Firebaseの認証が切れています。ページを再読み込みしてからもう一度お試しください。';
  if (code === 'storage/unauthorized') return `Storageバケット「${bucket}」のアクセスが拒否されました。対象バケットのStorageルールとApp Check設定を確認してください。`;
  if (code === 'storage/retry-limit-exceeded') return 'Storageへの接続が時間内に完了しませんでした。通信状態を確認してもう一度お試しください。';
  if (code === 'storage/canceled') return 'Storageへのアップロードを中止しました。入力内容を確認してもう一度お試しください。';
  if (code === 'storage/unknown') {
    return `Storageバケット「${bucket}」への処理に失敗しました（storage/unknown）。Firebaseへの関連付け・Storageルール・サービスエージェントの権限を確認してください。サーバー応答が取得できない場合は、ブラウザのNetwork画面で通信エラーやCORSエラーも確認してください。`;
  }
  return null;
}

class DiagnosedStorageError extends Error {
  readonly code: string;
  readonly serverResponse: string;
  constructor(original: FirebaseFailure, message: string, response: string) {
    super(message);
    this.name = 'DiagnosedStorageError';
    this.code = original.code ?? 'storage/unknown';
    this.serverResponse = response;
  }
}

/**
 * SDKが応答本文を落とす場合だけ、存在しないオブジェクトを匿名で読み取り診断。
 * トークン送信、バケット内一覧取得、別経路でのアップロード、権限の緩和はしない。
 * 400等の応答は補足情報であり、403/404からアップロード可否を断定しない。
 */
export async function diagnoseStorageError(error: unknown, bucket: string): Promise<unknown> {
  const failure = error as FirebaseFailure | null;
  if (failure?.code !== 'storage/unknown' || storageResponse(error)) return error;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const object = encodeURIComponent(`__firebase_setup_probe__/${crypto.randomUUID()}`);
    const response = await fetch(
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${object}`,
      { method: 'GET', credentials: 'omit', signal: controller.signal, cache: 'no-store' },
    );
    if (response.ok) return error;
    const body = await response.text();
    const message = storageFailureMessage({ code: failure.code, serverResponse: body }, bucket);
    // 設定・サービスエージェント・課金の既知エラーだけをSDKエラーへ補足。
    if (body.toLowerCase().includes('has not been set up properly for firebase storage') ||
        body.toLowerCase().includes('service account') ||
        body.toLowerCase().includes('service agent') ||
        body.toLowerCase().includes('billing') ||
        body.toLowerCase().includes('blaze')) {
      return new DiagnosedStorageError(failure, message!, body);
    }
  } catch {
    // 診断の失敗で本来のアップロードエラーを上書きしない。
  } finally {
    clearTimeout(timer);
  }
  return error;
}
