# sns-agent 実バズ投稿抽出 差分反映手順

## 目的
`koji777 / sns-agent` のVercelプロジェクトへ、競合バズ分析の実運用版を反映するための差分です。

## 反映される内容
- `競合バズ動画分析` 画面に、公式API前提の実運用フローを追加
- `/api/competitor-candidates` を実装
  - Hashtag Search APIでハッシュタグID取得
  - Top/Recent Mediaから投稿候補取得
  - 投稿日時、caption、permalink、like_count、comments_count、反応スコアを保存
  - 登録済み競合usernameに対してBusiness Discovery分析
- 公式API制約を画面に明記
  - Hashtag APIは投稿者usernameを返さない
  - 投稿URLを人が確認して競合username登録
  - 投稿/DM/フォロー等の外部アクションなし

## Vercel環境変数
最低限、Productionに以下が必要です。

```env
META_GRAPH_API_VERSION=v21.0
META_ACCESS_TOKEN=xxxxxxxx
INSTAGRAM_BUSINESS_ACCOUNT_ID=xxxxxxxx
```

OAuth/Metaログインまで使う場合は以下も英語名で必要です。

```env
META_APP_ID=xxxxxxxx
META_APP_SECRET=xxxxxxxx
META_REDIRECT_URI=https://<production-domain>/api/meta/callback
FACEBOOK_PAGE_ID=xxxxxxxx
```

注意: スクリーンショット上で日本語名の `フェイスブックページID` / `メタアプリシークレット` が見えていましたが、コード側が読む標準名は `FACEBOOK_PAGE_ID` / `META_APP_SECRET` です。
バズ投稿抽出だけなら `META_ACCESS_TOKEN` と `INSTAGRAM_BUSINESS_ACCOUNT_ID` が主に必要です。

## 近藤さん側で行う最小タスク
1. Vercelの `koji777 / sns-agent` プロジェクトで、Production環境に以下があるか確認
   - `META_ACCESS_TOKEN`
   - `INSTAGRAM_BUSINESS_ACCOUNT_ID`
2. この差分ファイル一式を `sns-agent` のソースに反映して再デプロイ
3. デプロイ後に以下へアクセスしてJSONを確認
   - `https://<production-domain>/api/competitor-candidates`
   - `official_api_ready: true` になれば実API取得準備完了
4. 管理者ログイン後、`競合バズ動画分析` → `ハッシュタグ投稿抽出` を押す

## 検証方法

### API確認
```bash
curl https://<production-domain>/api/competitor-candidates
```

期待値:
```json
{
  "ok": true,
  "official_api_ready": true
}
```

### 画面確認
1. `https://<production-domain>/` を開く
2. `admin / admin1234` でログイン
3. `競合バズ動画分析` を開く
4. `公式API状態` が `接続可` になることを確認
5. `ハッシュタグ投稿抽出` を押す

## こちらで検証済み
ローカル/一時URLでは以下を確認済みです。
- `/api/competitor-candidates` GET: `200 OK`
- `discover_hashtags` POST: `200 OK`
- 画面に `実運用向け：公式APIで見る競合バズ分析` が表示
- `ハッシュタグ投稿抽出` ボタンが動作

## 注意
- Metaトークン値はチャット・GitHub・ZIP内に入れないでください。
- `.env` / `.env.local` / `.vercel` は成果物に含めないでください。
- Vercel環境変数を変更したら、必ずProductionをRedeployしてください。
