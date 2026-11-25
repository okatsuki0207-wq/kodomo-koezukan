# Muse向け引き継ぎ — こどもの こえずかん

## このファイル一式について

このフォルダーは、アプリのソースコード・テスト・関連ワークスペース設定をまとめたものです。`.env`、認証トークン、Netlifyの接続状態、`node_modules`、生成済み`dist`、開発ログ、IndexedDBの利用者データは含めていません。

## アプリの目的

子どもが好きなものの写真と声を一緒に記録し、家族で見たり聞いたりできる日本語の図鑑アプリです。

## 現在のデータ仕様

- カード、写真・音声Blob、独自カテゴリ、表示設定はブラウザのIndexedDBに保存します。
- IndexedDBは各ブラウザ・端末ごとに独立しています。端末間の自動同期やクラウド保存はありません。
- 新規インストール時はその端末の図鑑が空で始まります。配布用ビルドに利用者のカードや写真・音声は含みません。
- 設定画面の「データのバックアップ」から、カード・写真・最大5件の音声・カテゴリ・表示設定をJSONに書き出せます。
- JSON復元は対象端末の既存カード・独自カテゴリ・表示設定を置き換えます。画面で確認を出してから実行し、不正ファイルや200MB超のJSONは拒否します。写真・音声は各20MB未満です。
- バックアップJSONには写真・音声が含まれるため、共有・保管には注意してください。
- 子ども向け操作には通常、見るだけ、声を追加できるモードがあります。設定画面は保護者確認の後に開きます。

## 主な機能

- 写真と録音を使ったカード作成、カード編集、メモ
- 1カードあたり最大5件の音声、再生・シャッフル
- 標準・独自カテゴリ、カテゴリ別表示
- アーカイブ、復元、削除
- 画面サイズに応じたページ送り
- PWAマニフェスト、アプリアイコン
- JSONバックアップと復元

## オフライン・クラウドに関する注意

- 記録データはローカル保存ですが、Service Workerによるアプリ本体のオフラインキャッシュはありません。オフライン起動が常にできるPWAではありません。
- `src/lib/keepsakeStore.ts`は現在ローカルIndexedDB実装を呼び出します。`src/lib/keepsakeRepository.ts`、`src/firebaseConfig.ts`、Firebase設定・ルール・旧移行資料は互換性やテスト用に残っている履歴コードです。現行のカード保存をFirebaseに戻さないでください。
- Firebaseの旧設定・ルールを公開・変更する必要はありません。既存のクラウドデータは今回の配布物に含まれていません。
- 引き継ぎZIPでは、未使用の`src/firebaseConfig.ts`（既存FirebaseプロジェクトのWeb設定を含む）とFirebaseのルール・接続設定・デバッグログを安全のため除外しています。現行アプリからはこれらを参照していません。

## 技術構成と実行方法

- React、TypeScript、Vite、pnpm workspace
- アプリ: `artifacts/kids-voice-encyclopedia/`
- 共有ワークスペース依存: `lib/api-client-react/`
- ルートの`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.base.json`も同梱しています。

ルートフォルダーで依存関係を準備し、次のコマンドを実行します。

```sh
pnpm install --filter @workspace/kids-voice-encyclopedia...
pnpm run typecheck:libs
pnpm --filter @workspace/kids-voice-encyclopedia run typecheck
pnpm --filter @workspace/kids-voice-encyclopedia run test
PORT=21965 BASE_PATH=/ pnpm --filter @workspace/kids-voice-encyclopedia run build
```

開発サーバー:

```sh
PORT=21965 BASE_PATH=/ pnpm --filter @workspace/kids-voice-encyclopedia run dev
```

## 確認済みの状態と未完了事項

- 引き継ぎ作成時点で、型チェック成功、既存テスト87件成功、本番ビルド成功を確認済みです。
- JSONバックアップの実ブラウザ間往復テストはまだ追加されていません。
- 公開URLは発行されていません。Netlifyの配布先はアカウント全体のSSOで保護されています。Vercel連携は未接続です。GitHub Pagesはビルド成果物中の背景切り抜きワーカーがGitHubのシークレット検出で拒否されたため公開していません。
- 再公開時は、利用者データを含めず、`BASE_PATH`とホスト側のSPAフォールバックを確認してください。既存の認証・シークレット検出を迂回しないでください。
