const { json } = require('../lib/meta');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) {}
  const document_markdown = ['# SNS企画書', '', '【日程】', body.schedule || '', '', '【動画詳細】', body.video_details || '', '', '【企画内容】', body.plan_content || '', '', '【企画詳細】', body.plan_detail || ''].join('\n');
  return json(res, 200, { ok: true, plan: { document_markdown }, state: { audit_logs: [{ at: new Date().toISOString(), action: 'proposal_document_create', external_ai_used: false, external_sent: false }] } });
};
