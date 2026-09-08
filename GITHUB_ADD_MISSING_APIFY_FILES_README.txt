GitHub追加用：Apify/API新規ファイル反映手順

目的
- sns-agent.vercel.app 側で 404 になっている Apify 系 API を Vercel に認識させるため、GitHub リポジトリ直下へ新規ファイル/新規ディレクトリを追加します。
- 既存の Meta API 設定は維持し、API 実装ファイルを追加する作業です。

追加先
- GitHub リポジトリ：SNSagent
- 追加位置：リポジトリ直下
- ZIPを展開したときに、以下のパスがそのままGitHub上に存在する状態にしてください。

追加/更新するファイル
1. api/apify/status.js
2. api/sales/[endpoint].js
3. api/competitor/apify-buzz.js
4. lib/apify.js
5. lib/google-sheets.js
6. lib/meta.js
7. lib/runtime-store.js
8. lib/sales/apify-discover.js
9. lib/sales/discover.js
10. lib/sales/export-sheets.js
11. lib/sales/extract-hybrid.js
12. lib/sales/scheduler.js
13. api/instagram-insights.js
14. api/meta/login.js
15. api/meta/callback.js
16. api/plans.js
17. api/state.js
18. api/competitor-candidates.js
19. package.json
20. package-lock.json
21. .vercelignore

GitHubでの作業手順
1. GitHubのSNSagentリポジトリを開く。
2. ZIPをローカルで展開する。
3. 展開された api/ と lib/ などを、リポジトリ直下へ同じ階層でアップロード/上書きする。
   - api/apify/status.js が api フォルダ直下の apify フォルダ内に入ること。
   - api/sales/[endpoint].js のファイル名は角括弧付きの [endpoint].js のままにすること。
   - lib/ フォルダは新規追加される想定。
4. Commit changes を押して main ブランチへ反映する。
5. VercelでProductionデプロイが走るのを待つ。
6. 必要なら Vercel → Deployments → 最新デプロイ → Redeploy で、Use existing Build Cache を外して再デプロイする。

反映後に確認するURL
- https://sns-agent.vercel.app/api/apify/status
- https://sns-agent.vercel.app/api/sales/apify-discover
- https://sns-agent.vercel.app/api/sales/extract-hybrid
- https://sns-agent.vercel.app/api/competitor/apify-buzz

期待される状態
- 404 ではなく JSON が返る。
- APIFY_TOKEN 未設定の場合は missing_APIFY_TOKEN と表示されるが、それはAPIルート反映成功です。
- Apifyを実行可能にするには、Vercel環境変数に APIFY_TOKEN と Actor ID を設定してください。

注意
- .env、.vercel、data、node_modules は含めていません。
- 秘密情報はGitHubへ入れないでください。
- 本番URLを将来的にCloudflare固定URLにする場合も、Vercel側APIはこのGitHub/Vercelデプロイで管理できます。
