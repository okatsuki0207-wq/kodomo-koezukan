---
name: Firebase privacy boundary
description: Why cloud keepsakes are private rather than a shared public collection
---

Firebaseの移行では、ログイン画面を新設せず匿名認証で利用者を分離する。共通の公開コレクションや全員読み書き可能なルールで置き換えない。

**Why:** 子どもの写真・声を保存するアプリであり、移行依頼はデータの公開・全利用者への共有を許可するものではない。既存の操作を維持しつつ、他人のデータへのアクセスを防ぐための判断。

**How to apply:** 端末間共有・家族共有・アカウント復元を追加するときは、誰に閲覧権限を付けるか確認し、既存の匿名アカウントを通常の認証へリンクする。データを単純に共通領域へ移さない。
