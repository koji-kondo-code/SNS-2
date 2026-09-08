# 既存azteca OAuth JSONを使うGoogle Sheets連携手順

## 確認済み
- ローカルに保存済みのGoogle OAuthは `azteca@ascent-biz.com` です。
- `SNSagent_営業候補管理` がaztecaアカウントから見えています。
- 対象スプレッドシートIDはVercel環境変数 `GOOGLE_SHEETS_SPREADSHEET_ID` に設定します。

## Vercelへ追加する環境変数
以下をProduction環境に追加してください。

1. `GOOGLE_SHEETS_SPREADSHEET_ID`
   - 値: 対象Google Sheet URLの `/d/` と `/edit` の間

2. `GOOGLE_OAUTH_CLIENT_JSON`
   - 値: Google Consoleからダウンロード済みのOAuthクライアントJSON全文
   - `client_secret` が含まれるためGitHub/チャットには貼らない

3. `GOOGLE_OAUTH_TOKEN_JSON`
   - 値: aztecaで承認済みのOAuthトークンJSON全文
   - `refresh_token` が含まれるためGitHub/チャットには貼らない

## アプリ側の挙動
- 営業候補出力 → `05_営業候補アカウント` に追記
- 競合候補保存 → `企画候補履歴` に追記
- Gmail/Calendar/Drive操作はアプリコードからは呼びません
- 書き込み先は `GOOGLE_SHEETS_SPREADSHEET_ID` の1ファイルのみです

## Vercel設定後
1. Vercel Dashboard → Project → Settings → Environment Variables
2. 上記3つをProductionに追加
3. Deployments → 最新Production → Redeploy
4. アプリからSheets出力を実行
5. Sheetに行追加されることを確認

## セキュリティ注意
既存OAuthトークンはaztecaアカウントの権限を持ちます。アプリ側は指定Sheetだけに書き込む実装ですが、GoogleのOAuth権限表示上はアカウントがアクセスできるSheetsに対する権限になります。本番運用では、将来的にサービスアカウント方式へ切り替える方がより安全です。
