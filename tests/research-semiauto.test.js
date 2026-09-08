const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-research-test-'));
process.env.SNS_RUNTIME_DATA_DIR = tmp;
delete process.env.APIFY_TOKEN;
delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.GOOGLE_OAUTH_CLIENT_JSON;
delete process.env.GOOGLE_OAUTH_TOKEN_JSON;

const semiauto = require('../lib/research/semiauto');

function basePayload(overrides = {}) {
  return {
    executor: 'テスト管理者',
    discordMessageId: 'discord-123',
    theme: '新卒採用向け 就活ノウハウ系',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-02',
    limit: 2,
    accounts: 'ascentbusiness_consulting, ascent.businessconsulting',
    allowExternalSearch: false,
    tabs: { candidates: 'リサーチ候補一覧', logs: '運用ログ' },
    ...overrides,
  };
}

(async () => {
  assert.deepStrictEqual(
    semiauto.validationErrors(basePayload()),
    [],
    '必須項目が揃うと実行前検証を通過する'
  );
  assert(
    semiauto.validationErrors(basePayload({ theme: '', limit: 30, accounts: '' })).some((e) => e.includes('対象テーマ')),
    '対象テーマ未入力を検知する'
  );
  assert(
    semiauto.validationErrors(basePayload({ periodStart: '2026-09-03', periodEnd: '2026-09-02' })).some((e) => e.includes('開始日')),
    '期間の逆転を検知する'
  );
  assert(
    semiauto.validationErrors(basePayload({ accounts: Array.from({ length: 11 }, (_, i) => `account${i}`).join(',') })).some((e) => e.includes('最大10件')),
    '対象アカウント数上限を検知する'
  );
  assert(
    semiauto.validationErrors(basePayload({ allowExternalSearch: true, externalLimit: 51 })).some((e) => e.includes('指定外探索')),
    '指定外探索上限を検知する'
  );

  const invalid = await semiauto.run(basePayload({ accounts: '' }));
  assert.strictEqual(invalid.ok, false, '不足項目がある場合は推測実行しない');
  assert.strictEqual(invalid.status, 'requires_confirmation');

  const result = await semiauto.run(basePayload());
  assert.strictEqual(result.ok, true, 'Apify未設定時も安全な検証用候補で画面確認できる');
  assert.strictEqual(result.count, 2);
  assert.strictEqual(result.sheet_write.candidates.appendedRows, 0, 'Sheets未設定時は追記しない');
  assert(result.allowedStatuses.includes('採用') && result.allowedStatuses.includes('不採用'), '人間判断ステータス定義を返す');
  assert(result.rows.every((r) => r.adoptionStatus === '未確認' || r.adoptionStatus === '要確認'), 'AIは採用/不採用を確定しない');
  assert(result.rows.every((r) => r.searchScope === '指定アカウント内'), '通常は指定アカウント内として保存する');

  const db = JSON.parse(fs.readFileSync(path.join(tmp, 'sns-runtime-db.json'), 'utf8'));
  assert.strictEqual(db.research_candidates.length, 2, '候補一覧をDBへ保存する');
  assert.strictEqual(db.research_runs.length, 1, '運用ログをDBへ保存する');
  assert(db.audit_logs.some((l) => l.action === 'research_semiauto_run' && l.external_sent === false), '外部送信なしの監査ログを残す');

  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  [
    'リサーチ半自動化',
    '指定外探索許可',
    '採用/不採用は人間判断',
    '要件定義チェック反映',
    '候補一覧必須列',
  ].forEach((label) => assert(appJs.includes(label), `画面に ${label} を表示する`));

  console.log('research-semiauto tests passed');
})();
