# sns-agent 移管・再デプロイ手順

## 目的
このフォルダは、現在公開中の以下ページを近藤さん自身のVercelアカウントへ移すための静的サイト一式です。

- 現在URL: https://sns-agent.vercel.app/
- プライバシーポリシー: /privacy
- データ削除案内: /data-deletion

## 含まれるファイル

- index.html: トップページ
- styles.css: 画面デザイン
- app.js: デモ画面の動作
- privacy/index.html: Meta登録用プライバシーポリシー
- data-deletion/index.html: Meta登録用データ削除案内

## Vercelへ移す手順（初心者向け）

### 1. Vercelアカウント作成
https://vercel.com/signup を開き、GoogleまたはGitHubでアカウントを作成します。

### 2. 新規プロジェクトを作る
Vercelにログイン後、右上の「Add New...」→「Project」を選びます。
GitHub連携が難しい場合は、Vercel CLIまたはファイルアップロード相当の方法でこのフォルダをデプロイします。

### 3. デプロイ設定
Framework Preset は Other / Static を選びます。
Build Command は空欄で構いません。
Output Directory は `.` または未指定で構いません。

### 4. 環境変数を入れる
Vercelの対象プロジェクトで以下に進みます。

Settings → Environment Variables

登録する値:

META_GRAPH_API_VERSION=v21.0
META_REDIRECT_URI=https://<近藤さん側のVercelドメイン>/api/meta/callback
META_APP_ID=<MetaアプリID>
META_APP_SECRET=<Metaアプリシークレット>
FACEBOOK_PAGE_ID=<対象FacebookページID>
INSTAGRAM_BUSINESS_ACCOUNT_ID=<対象InstagramビジネスアカウントID>
META_ACCESS_TOKEN=<長期アクセストークン>

注意: META_APP_SECRET と META_ACCESS_TOKEN はDiscordやチャットには貼らず、VercelのEnvironment Variablesにだけ登録してください。

### 5. Meta側のURLを新ドメインへ変更
近藤さん側のVercel URLが発行されたら、Meta for Developersで以下を新URLに変更します。

アプリ設定 → ベーシック:
- アプリドメイン: <新Vercelドメインのホスト名のみ>
- ウェブサイトURL: https://<新Vercelドメイン>/
- プライバシーポリシーURL: https://<新Vercelドメイン>/privacy
- データ削除URL: https://<新Vercelドメイン>/data-deletion

Facebookログイン → 設定:
- 有効なOAuthリダイレクトURI: https://<新Vercelドメイン>/api/meta/callback

## 現在のデモログイン

管理者:
- ID: admin
- PW: admin1234

クライアント:
- ID: client-a
- PW: client1234

クライアント:
- ID: client-b
- PW: client1234

## 注意
現状の「Instagram連携を開始」ボタンは、実OAuthへ飛ぶ本番実装ではなく案内表示です。
実接続まで進めるには、別途 /api/meta/callback と /api/instagram-insights のサーバー側実装が必要です。
