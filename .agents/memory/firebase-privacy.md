---
name: Firebase public prototype
description: Firestore and Storage are intentionally open across origins for prototype use
---

試作中は匿名認証や共有権限による分離を使わず、どのURL・端末からも同じ図鑑を閲覧・編集する。Firebase Rules はFirestoreとStorageの全パスを誰でも読み書きできる設定にしている。URLを知る人は写真・録音を含むデータを変更・削除できる。

**Why:** ユーザーは試作段階では別端末からの動作を優先し、全データを誰でも読み書きできる方式を明示的に選んだ。将来は一般ユーザー向けサービスへ拡張する予定とも述べている。

**How to apply:** 試作の全環境で共通データを使い、閲覧専用モードやPINによる保護があるとは表示しない。一般ユーザーへ公開する前に、認証・ユーザーごとのアクセス制御・アップロード制限を再設計し、Firebase Consoleにも新しいRulesを公開する。

旧UID配下と旧図鑑配下のカード・カテゴリ・設定は、共通図鑑へ移す際に元のFirestore文書やStorageファイルを削除しない。

**Why:** 別URLの開発プレビューで既存カードが見えなくなった問題を避け、移行失敗時にも元データを回復できるようにするため。

**How to apply:** 移行を変更する場合も、元データ削除は別途検証してから行う。Storageの既存URLを新規アップロードで置き換えない限り、元オブジェクトは同じ場所に残す。

## ブラウザ用APIキー

このアプリでは既存のFirebase用公開キーを使い、Secretsの `GOOGLE_API_KEY` はブラウザへ渡さない。

**Why:** Firebase Web SDKのキーはブラウザから閲覧できることを説明したうえで、ユーザーが「既存のFirebase用公開キーを使う」を選択した。

**How to apply:** Firebase設定の更新でも、この選択を維持する。汎用Google APIキーをフロントエンドのビルドや公開設定へ埋め込まない。

