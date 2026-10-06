---
name: Firebase privacy boundary
description: Why cloud keepsakes are private rather than a shared public collection
---

Firebaseの移行では、ログイン画面を新設せず匿名認証で利用者を分離する。共通の公開コレクションや全員読み書き可能なルールで置き換えない。

**Why:** 子どもの写真・声を保存するアプリであり、移行依頼はデータの公開・全利用者への共有を許可するものではない。既存の操作を維持しつつ、他人のデータへのアクセスを防ぐための判断。

**How to apply:** 端末間共有・家族共有・アカウント復元を追加するときは、誰に閲覧権限を付けるか確認し、既存の匿名アカウントを通常の認証へリンクする。データを単純に共通領域へ移さない。

## ブラウザ用APIキー

このアプリでは既存のFirebase用公開キーを使い、Secretsの `GOOGLE_API_KEY` はブラウザへ渡さない。

**Why:** Firebase Web SDKのキーはブラウザから閲覧できることを説明したうえで、ユーザーが「既存のFirebase用公開キーを使う」を選択した。

**How to apply:** Firebase設定の更新でも、この選択を維持する。汎用Google APIキーをフロントエンドのビルドや公開設定へ埋め込まない。
