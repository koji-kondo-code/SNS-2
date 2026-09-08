# Vercel Hobbyブロック回避用：オーナー名義での反映手順

## 目的
Vercel Hobbyプランで協働編集者コミットがブロックされているため、修正済みソースをリポジトリ所有者のGitHubアカウントで取り込み直し、オーナー名義の新規コミットとしてProductionへ反映します。

## 受け取るもの
- `sns-agent-owner-apply-20260729.zip`：反映用ソース一式
- SHA256：受領後の破損確認用

## 手順

### 1. オーナーPCで対象リポジトリを最新化
```bash
cd SNSagent
# まだcloneしていない場合は先に git clone <対象リポジトリURL> SNSagent

git checkout main
git pull origin main
```

### 2. 念のため作業ブランチを作成
```bash
git checkout -b owner-apply-sns-fix-20260729
```

### 3. ZIPを別フォルダへ解凍
```bash
mkdir -p ../sns-agent-owner-apply-20260729
unzip sns-agent-owner-apply-20260729.zip -d ../sns-agent-owner-apply-20260729
```

### 4. ソースを上書き反映
```bash
rsync -av \\
  --exclude='.git' \\
  --exclude='.vercel' \\
  --exclude='node_modules' \\
  --exclude='.env*' \\
  ../sns-agent-owner-apply-20260729/ ./
```

### 5. 変更確認
```bash
git status
git diff --stat
```

### 6. オーナー名義でコミット
```bash
git add .
git commit -m "SNS分析機能の修正を反映"
```

### 7. mainへ反映してpush
直接main運用の場合：
```bash
git checkout main
git merge owner-apply-sns-fix-20260729
git push origin main
```

PR運用の場合：
```bash
git push origin owner-apply-sns-fix-20260729
```
GitHub上でPull Requestを作成し、オーナーがMergeしてください。

## Vercel確認
1. Vercel Dashboard → 対象Project → Deployments
2. 最新デプロイが `Blocked` ではなく `Building` → `Ready` になることを確認
3. Production URLを開く
4. `/api/competitor-candidates` が 404/500 ではなく応答することを確認

## 注意
- `.env`、APIキー、MetaトークンはZIPに含めていません。VercelのEnvironment Variablesで設定してください。
- 重要なのは「最終的にVercelに流れるコミットがオーナー名義になること」です。
- 協働編集者の既存コミットをそのまま再デプロイしても、再度Blockedになる可能性があります。
