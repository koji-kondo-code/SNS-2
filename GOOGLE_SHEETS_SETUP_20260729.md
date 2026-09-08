# SNSagent Google Sheets連携 手順

## 方式
Vercel本番アプリから固定のGoogleスプレッドシートへ書き込むため、OAuthではなくサービスアカウント方式を使います。

## 必要なVercel環境変数
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

## 書き込み先タブ
- `05_営業候補アカウント`
- `企画候補履歴`

## Google Cloud側
1. Google Cloud Consoleを開く
2. 対象プロジェクトを作成/選択
3. 「APIとサービス」→「ライブラリ」
4. `Google Sheets API` を有効化
5. 「APIとサービス」→「認証情報」
6. 「認証情報を作成」→「サービスアカウント」
7. サービスアカウントを作成
8. サービスアカウント詳細→「キー」→「鍵を追加」→「新しい鍵を作成」→JSON
9. JSONファイルをダウンロード
10. JSON内の `client_email` をコピー

## Google Sheets側
1. 書き込み先スプレッドシートを開く
2. 右上「共有」
3. サービスアカウントの `client_email` を追加
4. 権限は「編集者」
5. 送信/共有
6. URL中の `/d/` と `/edit` の間をコピーして `GOOGLE_SHEETS_SPREADSHEET_ID` に使う

## Vercel側
1. Vercel Dashboard → 対象Project → Settings
2. Environment Variables
3. `GOOGLE_SHEETS_SPREADSHEET_ID` を追加
4. `GOOGLE_SERVICE_ACCOUNT_JSON` を追加
   - JSON全文を1行の値として入れる
   - チャットやGitHubには貼らない
5. Productionにチェック
6. Save
7. Deployments → 最新ProductionをRedeploy

## 確認
- 営業候補画面でSheets出力を実行
- スプレッドシートの `05_営業候補アカウント` に行が追加されること
- 競合候補保存で `企画候補履歴` に行が追加されること

## 注意
- サービスアカウントJSONは秘密情報です。GitHub/ZIP/チャットに含めないでください。
- Sheets APIを有効化しても、スプレッドシートが公開されるわけではありません。
- アプリは指定したスプレッドシートIDにだけ書く設計です。
