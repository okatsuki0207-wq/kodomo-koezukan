---
name: SDK unit verification
description: Avoid false-green Firebase tests when Node VM module support is absent
---

Firebase SDKのフィクスチャを実行するテストでは、NodeのVMモジュールが有効になっていることを確認する。静的なソース確認だけへのフォールバックを、SDK呼び出しの検証として数えない。

**Why:** この環境の通常のNode起動では、実行テストではなく静的チェックが選ばれ、統合後に古くなったフィクスチャが成功扱いのまま隠れていた。

**How to apply:** この環境ではテストを `--experimental-vm-modules` 付きで実行する。Node更新時は必要性を再確認する。保存や分類の変更を検証するときは、実際の対象操作と副作用なしの条件が実行されたことを結果で確認し、画像・音声に触れる不要なモック呼び出しは明示的に失敗させる。
