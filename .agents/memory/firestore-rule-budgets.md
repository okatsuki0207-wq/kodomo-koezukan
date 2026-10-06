---
name: Firestore rule evaluation budgets
description: Large atomic media edits can exceed Firestore's expression budget despite smaller edits passing.
---

Firestoreのルールを含む保存処理は、通常のケースだけでなく、許可する最大の画像・音声変更件数とカスタムカテゴリを同時に検証する。

**Why:** エミュレーターでは音声5件だけの編集が成功しても、写真と音声5件とカスタムカテゴリをまとめた編集は、1000式の評価上限によるPERMISSION_DENIEDになった。個々のアップロードが成功していることや、別UIDへの拒否テストが通ることは、この上限内での保存成功を保証しない。

**How to apply:** ファイル数や検証項目を増やす際は、最大構成を実SDK・実ルールで試す。参照束縛や永久削除フェンスを弱めて回避しない。保存回数を分ける必要がある場合は、アップロード前にUIと保存層の両方で明示する。
