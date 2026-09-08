# sns-agent 運用設定手順（Cloudflare / Meta Business Discovery / Apify）

## 1. Cloudflare側の対象URLを `sns-agent.vercel.app` に向ける

前提: Vercel側の本体URLは `https://sns-agent.vercel.app` とする。

1. Cloudflare Dashboard → 対象ドメインを開く
2. **DNS** → **Records** → **Add record**
3. サブドメイン運用の場合
   - Type: `CNAME`
   - Name: 例 `sns-agent`（`sns-agent.example.com` にしたい場合）
   - Target: `sns-agent.vercel.app`
   - Proxy status: 初回は `DNS only` 推奨。Vercel側で認証完了後に必要なら Proxied へ変更
   - TTL: Auto
4. ルートドメイン運用の場合
   - Cloudflareでは CNAME flattening を使い、Name: `@` / Target: `sns-agent.vercel.app`
5. Vercel → Project → **Settings** → **Domains** に Cloudflare側の実URLを追加
6. Vercelで表示される確認用DNSレコードがある場合は、Cloudflare DNSへ追加
7. 反映確認
   - `https://<Cloudflare側URL>/` がアプリTOPを表示
   - `https://<Cloudflare側URL>/api/competitor-candidates` がJSONを返す

## 2. Meta Business Discovery設定・確認手順

### Vercel環境変数
Vercel → Project → Settings → Environment Variables に以下を登録する。

```text
META_GRAPH_API_VERSION=v21.0
META_REDIRECT_URI=https://<Cloudflare側URL>/api/meta/callback
META_APP_ID=<MetaアプリID>
META_APP_SECRET=<Metaアプリシークレット>
FACEBOOK_PAGE_ID=<対象FacebookページID>
INSTAGRAM_BUSINESS_ACCOUNT_ID=<自社InstagramビジネスアカウントID>
META_ACCESS_TOKEN=<長期アクセストークン>
```

注意: `META_APP_SECRET` と `META_ACCESS_TOKEN` はチャットに貼らず、Vercel環境変数だけに保存する。

### Meta側のURL設定
Meta for Developers → 対象アプリで以下をCloudflare側URLに合わせる。

1. App settings → Basic
   - App Domains: `<Cloudflare側ドメイン>`
   - Privacy Policy URL: `https://<Cloudflare側URL>/privacy/`
   - User Data Deletion URL: `https://<Cloudflare側URL>/data-deletion/`
2. Facebook Login → Settings
   - Valid OAuth Redirect URIs: `https://<Cloudflare側URL>/api/meta/callback`

### Business Discovery取得条件
- 自社InstagramがBusiness/Creatorアカウントである
- 自社InstagramがFacebookページに紐づいている
- `META_ACCESS_TOKEN` に `instagram_basic`, `pages_show_list`, `pages_read_engagement` が含まれる
- 競合側usernameもBusiness/Creatorの公開アカウントである
- 入力は `@account` でも `https://www.instagram.com/account/` でも可

### 画面での確認
1. 管理者ログイン
2. **競合バズ動画分析** を開く
3. 「登録済み競合username」に分析対象をカンマ区切りで入力
4. **登録済み競合を分析** を押す
5. 成功時: 「Business Discoveryで n件の競合アカウントを保存しました」と表示され、抽出リストに上位投稿が出る
6. 一部失敗時: 成功分は保存され、未取得件数だけ表示される

## 3. Apify API利用手順

用途: 公式Meta APIで取得しにくい公開Instagram候補の補助取得。DM・フォロー・投稿など外部アクションには使わない。

### Apify側
1. Apifyにログイン
2. Settings → Integrations または API tokens を開く
3. `APIFY_TOKEN` を発行
4. 利用Actorを選ぶ
   - Instagram Profile Scraper系: アカウントプロフィール・投稿一覧取得
   - Instagram Hashtag Scraper系: ハッシュタグ起点の投稿取得
   - Google Search / Website Content系: 候補企業URL・採用ページ探索
5. ActorのInput例をApify Consoleで一度実行し、Runが成功することを確認

### Vercel環境変数
```text
APIFY_TOKEN=<Apify API token>
APIFY_INSTAGRAM_PROFILE_ACTOR=<actor-id例: apify/instagram-profile-scraper>
APIFY_INSTAGRAM_HASHTAG_ACTOR=<actor-id例: apify/instagram-hashtag-scraper>
```

### API呼び出しの基本形
```bash
curl -X POST "https://api.apify.com/v2/acts/<ACTOR_ID>/runs" \
  -G --data-urlencode "token=$APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "usernames": ["example_account"],
    "resultsLimit": 20
  }'
```

Run結果取得:
```bash
curl "https://api.apify.com/v2/actor-runs/<RUN_ID>/dataset/items?token=$APIFY_TOKEN&clean=true"
```

### 運用ルール
- Apifyは公開情報の補助取得に限定
- 同業者・大手・運用成功済み候補はアプリ側スコアで除外
- DM/自動送信/フォローは実行しない
- 取得元URL・取得日時・判定理由を保存する
- 料金超過防止のため、初期は `resultsLimit` を小さくする（例: 10〜20）

## 4. トラブル時の切り分け

- Cloudflare URLが開かない: Cloudflare DNS → Vercel Domains → SSL順に確認
- Metaログインが戻らない: `META_REDIRECT_URI` と MetaのValid OAuth Redirect URIが完全一致しているか確認
- Business Discoveryが0件: username、権限、Business/Creator公開状態、トークン期限を確認
- Sheets保存が失敗: Google Sheets環境変数と共有権限を確認。ただしDB保存は継続する
- Apifyが失敗: Actor ID、Input形式、APIFY_TOKEN、Runログ、利用上限を確認
