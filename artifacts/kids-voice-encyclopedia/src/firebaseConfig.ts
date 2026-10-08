import type { FirebaseOptions } from 'firebase/app';

/**
 * Firebase のセットアップ（Web SDK v9+ の modular API）
 * 1. https://console.firebase.google.com/ でプロジェクトと Web アプリを登録。
 * 2. プロジェクト設定 → Web アプリの firebaseConfig を下記へコピー。
 *    これは公開用 Web 設定です。サービスアカウントの秘密鍵は入れないでください。
 * 3. Firestore Database と Storage を作成し、firebase/ 配下のルールを公開。
 * 4. この試作の rules は Firestore と Storage の全データを誰でも読み書きできます。
 *    URLを知る人は写真・録音を含め、Firebaseプロジェクト内の全データを変更・削除できます。
 *
 * 注意: 2026年現在、Storage は Blaze（課金アカウント登録）が必須です。
 * 無料枠はありますが、リージョン・使用量で料金が発生します。
 * 予算アラートは料金の上限ではありません。完全無料は保証できません。
 * https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
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
