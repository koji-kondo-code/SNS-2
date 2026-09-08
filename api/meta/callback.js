const {
  requiredEnv,
  json,
  exchangeCodeForToken,
  exchangeLongLivedToken,
  listPages,
  safeTokenInfo,
} = require('../../lib/meta');

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function page(title, content) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f8fb;color:#0f172a;margin:0;padding:40px}.box{max-width:920px;margin:auto;background:white;border:1px solid #dbe3ef;border-radius:18px;padding:28px;box-shadow:0 20px 50px rgba(15,23,42,.08)}code,pre{background:#eef4ff;border-radius:10px;padding:3px 6px}pre{padding:16px;overflow:auto}.ok{color:#0369a1}.warn{color:#b45309}.btn{display:inline-block;background:#2563eb;color:white;padding:10px 14px;border-radius:10px;text-decoration:none;font-weight:700}.muted{color:#64748b}</style></head><body><main class="box">${content}</main></body></html>`;
}

module.exports = async function handler(req, res) {
  const missing = requiredEnv(['META_APP_ID', 'META_APP_SECRET']);
  if (missing.length) return html(res, 500, page('Meta連携設定不足', `<h1 class="warn">Meta連携の環境変数が不足しています</h1><p>VercelのEnvironment Variablesに以下を追加してください。</p><pre>${missing.join('\n')}</pre><p><a class="btn" href="/">トップへ戻る</a></p>`));

  const url = new URL(req.url, `https://${req.headers.host}`);
  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  const code = url.searchParams.get('code');
  if (error) return html(res, 400, page('Meta連携エラー', `<h1 class="warn">Meta側で連携が中断されました</h1><p>${String(error)}</p><p><a class="btn" href="/">トップへ戻る</a></p>`));
  if (!code) return json(res, 400, { ok: false, error: 'missing_code' });

  try {
    const shortToken = await exchangeCodeForToken(req, code);
    const longToken = await exchangeLongLivedToken(shortToken.access_token);
    const pages = await listPages(longToken.access_token);
    const igAccounts = (pages.data || [])
      .filter((p) => p.instagram_business_account)
      .map((p) => ({
        page_id: p.id,
        page_name: p.name,
        instagram_business_account_id: p.instagram_business_account.id,
        instagram_username: p.instagram_business_account.username || p.instagram_business_account.name || '',
        page_token_available: Boolean(p.access_token),
      }));

    return html(res, 200, page('Meta連携確認', `<h1 class="ok">Meta連携の認可が完了しました</h1><p>以下をVercelのEnvironment Variablesに登録してください。シークレット値なのでDiscordには貼らないでください。</p><h2>登録候補</h2><pre>FACEBOOK_PAGE_ID=${igAccounts[0]?.page_id || '取得できませんでした'}
INSTAGRAM_BUSINESS_ACCOUNT_ID=${igAccounts[0]?.instagram_business_account_id || '取得できませんでした'}
META_ACCESS_TOKEN=${longToken.access_token}</pre><h2>取得できたInstagramアカウント</h2><pre>${JSON.stringify(igAccounts, null, 2)}</pre><p class="muted">アクセストークン情報: ${JSON.stringify(safeTokenInfo(longToken.access_token))}</p><p><a class="btn" href="/">トップへ戻る</a></p>`));
  } catch (e) {
    return html(res, e.status || 500, page('Meta連携エラー', `<h1 class="warn">Meta Graph APIの処理に失敗しました</h1><p>${String(e.message || e)}</p><pre>${JSON.stringify(e.data || {}, null, 2)}</pre><p><a class="btn" href="/">トップへ戻る</a></p>`));
  }
};
