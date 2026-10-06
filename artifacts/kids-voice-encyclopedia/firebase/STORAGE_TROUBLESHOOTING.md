# kids_voice_zukan のアップロードエラー対応

## 実際に確認した原因
FirebaseのバケットエンドポイントはHTTP 400で以下を返しました。

> Your bucket has not been set up properly for Firebase Storage.
> Please visit .../project/klds-voice-zukan/storage/rules to set up security rules.

同じエンドポイントのCORS事前確認は成功し、POSTと必要なSDKヘッダーが許可されていました。
認証も成功しています。今回確認した失敗の原因はバケットのFirebase設定で、
CORS設定や `gs://kids_voice_zukan` の指定形式ではありません。
この結果だけではGCSのCORS設定そのものや、すべての公開サイトのOriginを確認したことにはなりません。

アプリは公式形式の `getStorage(app, 'gs://kids_voice_zukan')` を使用します。
画像・音声とも、同じStorageから参照を作成して `uploadBytes` と `getDownloadURL` を呼びます。
SDKが応答本文を省略することがあるため、未知のエラー時だけ存在しないオブジェクトを
匿名・読み取り専用で確認し、既知の設定エラーを補足します。
HTTP 403や診断用GET失敗だけでCORSやアップロード拒否の原因を断定しません。

## 1. 所属プロジェクトとFirebaseの関連付け
管理権限のあるGoogleアカウントでGoogle Cloud Shellを開いて実行します。
以下はバケットを削除したり、全員公開にしたりするコマンドではありません。

```sh
gcloud config set project klds-voice-zukan
gcloud projects describe klds-voice-zukan --format='value(projectNumber)'
gcloud storage buckets describe gs://kids_voice_zukan --format=json
```

プロジェクト番号が `986617757603` であり、バケットもこのプロジェクトに所属することを確認してください。
違う場合、勝手にプロジェクトを変更・バケットを削除せず、所属とFirebaseプロジェクトを確認します。

Firebase ConsoleのStorageで `kids_voice_zukan` を取り込むか、次の公式APIを使います。
以下はFirebaseへの関連付けを変更する操作です。管理者権限とBlazeプランが必要です。
トークンや実行結果に含まれる認証情報をチャットへ貼らないでください。

```sh
gcloud services enable firebasestorage.googleapis.com --project=klds-voice-zukan

curl --fail-with-body --request POST \
  'https://firebasestorage.googleapis.com/v1beta/projects/986617757603/buckets/kids_voice_zukan:addFirebase' \
  --header "Authorization: Bearer $(gcloud auth print-access-token)"
```

既に関連付け済みと表示された場合は次へ進みます。
APIが権限エラーの場合、プロジェクト所有者等、`firebasestorage.buckets.addFirebase` 権限のあるアカウントで実行してください。
APIキーだけではこの管理操作はできません。

## 2. 対象バケットのStorageルールを公開
[Firebase ConsoleのStorageルール](https://console.firebase.google.com/project/klds-voice-zukan/storage/rules)を開き、
対象が `kids_voice_zukan` であることを確認してください。
`firebase/storage.rules` の内容をルール欄に貼り付けて「公開」を押します。
デフォルトバケットだけに公開しても、今回のカスタムバケットには適用されません。

ルールは `users/{認証UID}/keepsakes/...` だけを本人に許可します。
`allow read, write: if true` に変更したり、IAMで `allUsers` を追加したりしないでください。
課金設定・組織ポリシー・バケットの関連付けでエラーが出る場合は、その表示内容に従って先に解消します。

## 3. サービスエージェントの権限（412等の場合だけ）
現在確認できた400の初動は、上の関連付けとルール公開です。
その後、サービスアカウントの権限エラーが出る場合、Firebase ConsoleでStorageを再度開き、
必要なサービスエージェントの自動設定を先に試してください。

それでも不足する場合、プロジェクトの管理者が次を確認・実行します。
このコマンドはFirebase専用サービスエージェントだけに公式のIAMロールを付与します。
バケットやファイルを一般公開する操作ではありません。

```sh
gcloud beta services identity create \
  --service=firebasestorage.googleapis.com \
  --project=klds-voice-zukan

gcloud projects add-iam-policy-binding klds-voice-zukan \
  --member='serviceAccount:service-986617757603@gcp-sa-firebasestorage.iam.gserviceaccount.com' \
  --role='roles/firebasestorage.serviceAgent'
```

バケットが別プロジェクトだった場合、この操作だけでは直りません。
細かなACLと統一バケットレベルアクセス（UBLA）は扱いが違うため、
`gsutil acl` を無条件に実行したり、UBLAを無効化したりしないでください。

## 4. CORSの確認・変更（別途CORSエラーがある場合だけ）
今回のFirebase SDKエンドポイントではCORS事前確認が通っています。
GCSのCORS設定変更はFirebaseの関連付け・ルール設定の代替にはなりません。
ブラウザのNetwork画面で、実際にどのURL・メソッド・Originが失敗したか確認してから行ってください。
`gsutil cors get` の結果が空でも、それだけでFirebase SDKのCORS不良とは判断できません。

```sh
gsutil cors get gs://kids_voice_zukan
```

変更が必要な場合は `firebase/storage-cors.example.json` をCloud Shellへコピーして、
`YOUR-...` の2つのOriginを実際の開発URL・公開URLに置き換え、`cors.json` として保存します。
Originは `https://ホスト名` だけです。アプリのパスや末尾の `/` は含めません。
使わないOriginは削除します。`*` や存在しないドメインを無条件に追加しないでください。

以下の `cors set` は既存のCORS設定を置き換えます。
既存アプリ向けの設定がある場合は、それらも保持したJSONにしてください。

```sh
gsutil cors get gs://kids_voice_zukan > cors.before.json
gsutil cors set cors.json gs://kids_voice_zukan
gsutil cors get gs://kids_voice_zukan
```

同じ変更は次でも可能です（両方を実行する必要はありません）。

```sh
gcloud storage buckets update gs://kids_voice_zukan --cors-file=cors.json
```

CORSはブラウザの通信許可であり、データのアクセス権限ではありません。
認証・Storageルール・サービスエージェントの権限は別途必要です。

## 5. 最終確認
設定後にアプリを再読み込みして、小さな写真と短い録音を新規保存します。
新規保存ではStorageに `users/{uid}/keepsakes/{id}/{保存試行ID}/photo` と `voice` ができ、
Firestoreのカードに両方のURLが保存されることを確認します。
さらにページ再読み込み、画像表示、音声再生、テストカードの削除を確認します。
既存データの一括移行・削除は今回行いません。
旧形式の `users/{uid}/keepsakes/{id}/photo` と `voice` も引き続き読み取り・削除できます。
この新規保存形式を使用するアプリ変更の公開前に、更新した `firestore.rules` と
対象バケットの `storage.rules` を先に公開してください。

## 隔離環境での自動確認

実バケットを変更せずに保存・再読み込み・URL取得・削除と障害時の保護を確認する
コマンド・検証範囲・安全対策は [TESTING.md](TESTING.md) を参照してください。

## 公式資料
- [カスタムバケットのSDK初期化](https://firebase.google.com/docs/storage/web/start#use_multiple_storage_buckets)
- [既存バケットをFirebaseへ関連付けるAPI](https://firebase.google.com/docs/reference/rest/storage/rest/v1beta/projects.buckets/addFirebase)
- [サービスアカウントのトラブルシューティング](https://firebase.google.com/docs/storage/faq-and-troubleshooting#storage-accounts)
- [GCSのCORS設定](https://cloud.google.com/storage/docs/configuring-cors)
