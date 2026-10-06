---
name: Firebase Storage diagnosis
description: Distinguishing generic SDK errors from CORS and bucket setup failures
---

`storage/unknown` や応答本文の欠落だけを根拠に、CORS不良と断定しない。

**Why:** この環境では認証とCORS事前確認が成功していても、Firebaseへのバケット設定不足でアップロードが拒否された。SDKがそのサーバー応答をエラーに含めないケースも実際に確認した。

**How to apply:** SDKのエラーに本文がなければ、認証情報を送らない読み取り専用の診断で既知の設定エラーを補足する。診断不能時は断定せず元の失敗を保持する。公開IAMや無制限のStorageルールで回避しない。
