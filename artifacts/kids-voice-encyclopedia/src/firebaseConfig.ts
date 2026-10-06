import type { FirebaseOptions } from 'firebase/app';

/**
 * Firebase のセットアップ（Web SDK v9+ の modular API）
 * 1. https://console.firebase.google.com/ でプロジェクトと Web アプリを登録。
 * 2. プロジェクト設定 → Web アプリの firebaseConfig を下記へコピー。
 *    これは公開用 Web 設定です。サービスアカウントの秘密鍵は入れないでください。
 * 3. Authentication → ログイン方法 → 匿名を有効化。
 * 4. Firestore Database と Storage を作成し、firebase/ 配下のルールを公開。
 *    テストモード（全員に読み書き許可）は使わないでください。
 * 5. 開発・公開 URL を Authentication の承認済みドメインに追加。
 * 6. 保存・再読み込み・削除を確認してください。
 *
 * 注意: 2026年現在、Storage は Blaze（課金アカウント登録）が必須です。
 * 無料枠はありますが、リージョン・使用量で料金が発生します。
 * 予算アラートは料金の上限ではありません。完全無料は保証できません。
 * https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
 *
 * 匿名認証の ID は IndexedDB で保持します（LocalStorage には保存しません）。
 * 同じブラウザで再利用できますが、別端末やブラウザデータ消去後の復元には
 * 匿名アカウントを通常のログインにリンクする追加実装が必要です。
 */
export const firebaseConfig: FirebaseOptions = {
  apiKey: 'AIzaSyC3_8iu6dW6CA0dDieQogrejlCRO8cyba4',
  authDomain: 'klds-voice-zukan.firebaseapp.com',
  projectId: 'klds-voice-zukan',
  storageBucket: 'kids_voice_zukan',
  messagingSenderId: '986617757603',
  appId: '1:986617757603:web:bb333e795a5cc472c16416',
  measurementId: 'G-3BN1L97SR5',
};

export const isFirebaseConfigured = ['apiKey', 'projectId', 'storageBucket', 'appId']
  .every((key) => {
    const value = firebaseConfig[key as keyof FirebaseOptions];
    return typeof value === 'string' && value.length > 0 && !value.includes('YOUR_');
  });
