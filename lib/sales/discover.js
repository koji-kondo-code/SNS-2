const fs = require('fs');
const path = require('path');
const { json } = require('../meta');

function htmlDecode(s = '') {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function normalizeHandle(raw = '') {
  return String(raw)
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
    .toLowerCase();
}

function cleanTitle(title = '', handle = '') {
  let t = htmlDecode(title)
    .replace(/\s*[-–|]\s*Instagram.*$/i, '')
    .replace(/\(@?[^)]*\)/g, '')
    .replace(/【公式】|公式Instagram|Instagram|インスタグラム|採用アカウント|採用/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length < 2) t = '@' + handle;
  return t.slice(0, 40);
}

const enterprisePatterns = [
  'mercari','cyberagent','rakuten','dena','pasona','dip','teamlab','mynavi','recruit holdings','rikunabi','softbank','ntt','kddi','docomo','linecorp','youtube','zozo','sony','toyota','honda','nissan','panasonic','hitachi','fujitsu','nec','mitsubishi','sumitomo','dentsu','hakuhodo','uniqlo','fastretailing','seven','aeon','lawson','familymart','muji','ana','jal','jtb','accenture','deloitte','pwc','kpmg','ey','amazon','google','microsoft','apple','meta','sompo','alsok','solasto','benesse','nichii','ベネッセ','ニチイ','損保'
];
const platformNoise = ['instagram','explore','accounts','p','reel','reels','popular','tv','stories','about','developer','business','direct','web','oauth','graphql','youtube','tiktok','facebook','meta'];
const localSignals = ['clinic','dental','care','kaigo','hoiku','salon','beauty','store','shop','cafe','restaurant','hotel','logi','driver','factory','kougyo','kensetsu','housing','fudosan','tax','law','school','nursery','welfare','medical','staff','saiyo','recruit','career','jinji'];
const sameIndustryProviderPatterns = [
  'snsコンサル','sns コンサル','sns運用代行','sns 運用代行','sns運用支援','sns 運用支援','snsマーケ','sns マーケ','sns集客','sns 集客',
  'instagram運用代行','instagram 運用代行','instagramマーケ','instagram マーケ','インスタ運用代行','インスタ 運用代行','インスタ集客','インスタ 集客',
  'tiktok運用代行','tiktok 運用代行','ショート動画運用','動画マーケティング支援','動画マーケティング',
  'sns×動画制作','sns動画制作','sns活用で解決','sns活用支援','sns採用術','sns採用 支援','sns 採用支援','snsteam','企画から投稿','運用をまるごと代行','運用 をまるごと 代行','動画制作会社','毎月15本作成','連動投稿',
  'social media agency','social media marketing','socialmediaagency','snsagency','sns_agency','insta_agency',
  'マーケティング支援会社','webマーケティング会社','webマーケ会社','広告代理店','集客支援会社','運用代行会社'
];
const difficultHiringIndustries = [
  ['医療・福祉採用', ['clinic','dental','nurse','kaigo','care','welfare','medical','hospital','薬局','クリニック','歯科','介護','看護','福祉']],
  ['店舗・サービス採用', ['salon','beauty','store','shop','cafe','restaurant','hotel','staff','美容','店舗','飲食','ホテル']],
  ['建設・製造・物流採用', ['kensetsu','construction','factory','kougyo','logi','driver','運送','物流','建設','製造','工場']],
  ['教育・保育採用', ['school','nursery','hoiku','edu','保育','教育','学校']],
  ['BtoB・地域企業採用', ['recruit','career','saiyo','jinji','採用','求人']]
];
const scheduledKeywordPool = [
  { keyword: '美容室 採用', industry: '店舗・サービス採用' },
  { keyword: '介護 採用', industry: '医療・福祉採用' },
  { keyword: '歯科 採用', industry: '医療・福祉採用' },
  { keyword: '建設 採用', industry: '建設・製造・物流採用' },
  { keyword: '物流 採用 ドライバー', industry: '建設・製造・物流採用' },
  { keyword: '保育 採用', industry: '教育・保育採用' },
  { keyword: '飲食 スタッフ募集', industry: '店舗・サービス採用' },
  { keyword: '工場 採用', industry: '建設・製造・物流採用' },
];
const cacheBaseDir = process.env.SNS_RUNTIME_DATA_DIR || (process.env.VERCEL ? '/tmp/sns-agent-runtime' : path.join(process.cwd(), 'data'));
const cacheFile = path.join(cacheBaseDir, 'sales-discovery-cache.json');

function wordsFromCriteria(criteria, key, fallback = []) {
  const raw = criteria && criteria[key];
  const words = String(raw || '').split(/[、,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return words.length ? words : fallback;
}
function textHasAny(text, words) {
  const hay = String(text || '').toLowerCase();
  return (words || []).some((w) => w && hay.includes(String(w).toLowerCase()));
}
function criteriaSearchSuffix(criteria) {
  const recruit = wordsFromCriteria(criteria, 'recruitKeywords', ['採用','求人','recruit','career']).slice(0, 8).join(' OR ');
  const target = wordsFromCriteria(criteria, 'targetSignals', ['中小','地域','介護','美容','建設','保育']).slice(0, 8).join(' OR ');
  return `(${recruit}) (${target})`;
}

function isEnterprise(handle, text = '', criteria = null) {
  const h = normalizeHandle(handle);
  const hay = `${h} ${String(text).toLowerCase()}`;
  const words = wordsFromCriteria(criteria, 'largeExcludes', enterprisePatterns);
  return textHasAny(hay, words);
}

function isSameIndustryProvider(handle, text = '', criteria = null) {
  const h = normalizeHandle(handle);
  const hay = `${h} ${String(text).toLowerCase()}`;
  const compact = hay.replace(/\s+/g, '');
  const providerWords = wordsFromCriteria(criteria, 'providerExcludes', sameIndustryProviderPatterns);
  return providerWords.some((p) => {
      const pp = String(p).toLowerCase();
      return hay.includes(pp) || compact.includes(pp.replace(/\s+/g, ''));
    })
    || /(sns|instagram|insta|tiktok|youtube|ショート動画|動画).{0,18}(consult|agency|marketing|マーケ|コンサル|運用代行|運用支援|集客支援|採用支援|動画制作)/i.test(compact)
    || /(consult|agency|marketing|マーケ|コンサル|運用代行|運用支援|集客支援|採用支援|動画制作).{0,18}(sns|instagram|insta|tiktok|youtube|ショート動画|動画)/i.test(compact);
}

function looksLikeInstagramPostId(handle, text = '') {
  const h = normalizeHandle(handle);
  const meaningful = /(recruit|saiyo|career|staff|official|kaigo|salon|hair|beauty|clinic|dental|hoiku|care|reha|fukushi|jinji|group|tokyo|osaka|nagoya|shop|store|home|works|company)/i;
  return /^[a-z0-9_-]{10,}$/.test(h) && !/[.]/.test(h) && !meaningful.test(h);
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { return { prospects: [] }; }
}

function writeCache(prospects = []) {
  try {
    const cache = readCache();
    const byKey = new Map((cache.prospects || []).map((p) => [normalizeHandle(p.account), p]));
    for (const p of prospects) {
      const key = normalizeHandle(p.account);
      if (!key) continue;
      byKey.set(key, { ...byKey.get(key), ...p, lastSeenAt: new Date().toISOString() });
    }
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ updatedAt: new Date().toISOString(), prospects: [...byKey.values()].slice(-500) }, null, 2));
  } catch (e) {}
}

function cachedProspects({ industry = 'all', limit = 20 } = {}) {
  const rows = (readCache().prospects || []).filter((p) => {
    if (industry && industry !== 'all' && p.industry !== industry) return false;
    if (isEnterprise(p.account, `${p.company || ''} ${p.account || ''}`)) return false;
    if (isSameIndustryProvider(p.account, `${p.company || ''} ${p.snippet || ''}`)) return false;
    return true;
  });
  return rows.sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''))).slice(0, limit);
}

function inferIndustry(handle, text = '') {
  const hay = `${handle} ${text}`.toLowerCase();
  for (const [industry, words] of difficultHiringIndustries) {
    if (words.some((w) => hay.includes(String(w).toLowerCase()))) return industry;
  }
  return 'BtoB・地域企業採用';
}

function prospectFromResult(result, criteria = null) {
  const handle = normalizeHandle(result.handle);
  if (!handle || platformNoise.includes(handle) || handle.length < 4) return null;
  const text = `${result.title || ''} ${result.snippet || ''} ${handle}`;
  if (looksLikeInstagramPostId(handle, text)) return null;
  if (isEnterprise(handle, `${result.title || ''} ${handle}`, criteria)) return null;
  if (isSameIndustryProvider(handle, text, criteria)) return null;
  const recruitSignal = textHasAny(text, wordsFromCriteria(criteria, 'recruitKeywords', ['採用','求人','新卒','中途','recruit','career','saiyo','jinji','staff','社員','募集']));
  if (!recruitSignal) return null;
  const localFit = wordsFromCriteria(criteria, 'targetSignals', localSignals).filter((w) => text.toLowerCase().includes(w)).length;
  const industry = inferIndustry(handle, text);
  const company = cleanTitle(result.title, handle);
  const kind = /(採用|recruit|career|saiyo|jinji)/i.test(handle) ? '採用専用' : '企業公式内採用投稿あり';
  return {
    company,
    account: '@' + handle,
    accountUrl: `https://www.instagram.com/${handle}/`,
    industry,
    kind,
    feed: null,
    reels: null,
    avgReel: null,
    over10k: '公開検索では未取得',
    type: localFit >= 2 ? '中小・地域採用候補' : '確認後アプローチ候補',
    link: '公開検索で要確認',
    gap: '採用SNSの投稿量・リール活用・プロフィール導線を確認',
    priority: localFit >= 2 ? '高' : '中',
    angle: `${industry.replace('採用','')}向けに、社員紹介・職場紹介・応募導線を短尺動画化`,
    status: 'Web検索抽出候補',
    source: result.engine || 'Web検索',
    sourceNote: `検索結果から抽出。大手・有名企業名、SNSコンサル等の同業者は除外済み / title: ${cleanTitle(result.title, handle)}`,
    snippet: htmlDecode(result.snippet || '').slice(0, 180),
    sizeFit: localFit >= 2 ? '中小・地域企業寄り' : '要規模確認',
    contactability: localFit >= 2 ? '高' : '中',
    autoExtracted: true,
  };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0',
        'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
      },
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseInstagramResults(html, engine) {
  const out = [];
  const seen = new Set();
  const decoded = htmlDecode(html)
    .replace(/%3A/gi, ':')
    .replace(/%2F/gi, '/')
    .replace(/&nbsp;/g, ' ');
  const patterns = [
    /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?[^\s"'<>)]*/g,
    /instagram\.com\s*>\s*([A-Za-z0-9_.]+)/g,
  ];
  for (const re of patterns) {
  let m;
  while ((m = re.exec(decoded))) {
    const handle = normalizeHandle(m[1]);
    if (!handle || seen.has(handle)) continue;
    const start = Math.max(0, m.index - 500);
    const end = Math.min(decoded.length, m.index + 700);
    const ctx = decoded.slice(start, end).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const titleMatch = ctx.match(/(?:aria-label|title)="([^"]{4,160})"/) || ctx.match(/>([^<>]{4,120})</);
    seen.add(handle);
    out.push({ handle, title: titleMatch ? titleMatch[1] : '@' + handle, snippet: ctx, engine });
  }
  }
  return out;
}


function parseRssItems(xml, engine) {
  const items = [];
  const re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    items.push({ title: htmlDecode(m[1]).replace(/<!\[CDATA\[|\]\]>/g, ''), link: htmlDecode(m[2]), snippet: htmlDecode(m[3]).replace(/<[^>]+>/g, ' '), engine });
  }
  return items;
}

function siteAllowed(url = '') {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes('instagram.com') || host.includes('bing.com') || host.includes('google.') || host.includes('youtube.com')) return false;
    if (host.includes('mynavi') || host.includes('rikunabi') || host.includes('indeed') || host.includes('townwork') || host.includes('求人')) return false;
    return true;
  } catch (e) { return false; }
}

async function discoverInstagramFromCompanySites(keyword, industry, limit, criteria = null) {
  const sectorWords = industry && industry !== 'all' ? industry.replace('採用', '') : wordsFromCriteria(criteria, 'targetSignals', ['介護','歯科','美容室','建設','保育','物流','店舗']).slice(0,8).join(' OR ');
  const queries = [
    `${keyword || '採用'} ${sectorWords} 会社 採用 Instagram`,
    `${keyword || '採用'} ${sectorWords} スタッフ募集 Instagram`,
    `${keyword || '採用'} ${sectorWords} 採用情報 公式 Instagram`,
  ];
  const siteItems = [];
  for (const q of queries) {
    try {
      const xml = await fetchText(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(q)}`);
      siteItems.push(...parseRssItems(xml, 'Bing RSS'));
    } catch (e) {}
  }
  const out = [];
  const seenSites = new Set();
  const seenHandles = new Set();
  for (const item of siteItems) {
    if (out.length >= limit) break;
    if (!siteAllowed(item.link)) continue;
    let host = '';
    try { host = new URL(item.link).hostname.replace(/^www\./, ''); } catch (e) {}
    if (!host || seenSites.has(host)) continue;
    seenSites.add(host);
    try {
      const page = await fetchText(item.link);
      const matches = parseInstagramResults(page, '公式サイト掲載Instagram');
      for (const r of matches) {
        const handle = normalizeHandle(r.handle);
        if (!handle || seenHandles.has(handle)) continue;
        const resultText = `${item.title} ${item.snippet} ${host} ${r.snippet}`;
        const p = prospectFromResult({ handle, title: item.title, snippet: resultText, engine: '公式サイト→Instagram抽出' }, criteria);
        if (!p) continue;
        p.companyUrl = item.link;
        p.sourceNote = `Bing検索で企業公式/採用ページを発見し、公式サイト内のInstagramリンクから抽出 / ${host}`;
        p.gap = '公式サイトにInstagram導線あり。採用投稿・リール活用・応募導線を確認';
        p.angle = `${p.industry.replace('採用','')}向けに、公式サイト流入とInstagram投稿を採用導線へ接続`;
        p.contactability = '高';
        p.sizeFit = '中小・地域企業寄り';
        seenHandles.add(handle);
        out.push(p);
        if (out.length >= limit) break;
      }
    } catch (e) {}
  }
  return out;
}

async function discover(keyword, industry, limit, criteria = null) {
  if (isSameIndustryProvider('', keyword, criteria)) return [];
  const qBase = [keyword || '採用', industry && industry !== 'all' ? industry : '', criteriaSearchSuffix(criteria), 'site:instagram.com'].filter(Boolean).join(' ');
  const queries = [
    qBase,
    `${keyword || '採用'} site:instagram.com/ recruit saiyo clinic salon store staff`,
    `${keyword || '採用'} site:instagram.com/ 会社 採用 Instagram 中小`,
    `${keyword || '採用'} site:instagram.com/ 採用アカウント OR リクルート OR 求人`,
  ];
  const byHandle = new Map();
  const addResults = (rows) => {
    for (const r of rows) {
      const p = prospectFromResult(r, criteria);
      if (!p) continue;
      if (industry && industry !== 'all' && p.industry !== industry) continue;
      const key = normalizeHandle(p.account);
      if (!byHandle.has(key)) byHandle.set(key, p);
      if (byHandle.size >= limit) break;
    }
  };
  for (const q of queries) {
    const encoded = encodeURIComponent(q);
    const urls = [
      [`https://r.jina.ai/http://r.jina.ai/http://duckduckgo.com/html/?q=${encoded}`, 'DuckDuckGo検索'],
      [`https://r.jina.ai/http://r.jina.ai/http://http://search.yahoo.co.jp/search?p=${encoded}`, 'Yahoo検索'],
      [`https://www.bing.com/search?q=${encoded}&count=20&setlang=ja-JP`, 'Bing検索'],
      [`https://search.yahoo.co.jp/search?p=${encoded}`, 'Yahoo検索'],
      [`https://html.duckduckgo.com/html/?q=${encoded}`, 'DuckDuckGo検索'],
    ];
    for (const [url, engine] of urls) {
      if (byHandle.size >= limit) break;
      try {
        const html = await fetchText(url);
        addResults(parseInstagramResults(html, engine));
      } catch (e) {}
    }
    if (byHandle.size >= limit) break;
  }
  if (byHandle.size < limit) {
    const siteProspects = await discoverInstagramFromCompanySites(keyword, industry, limit - byHandle.size, criteria);
    for (const p of siteProspects) {
      if (!byHandle.has(normalizeHandle(p.account))) byHandle.set(normalizeHandle(p.account), p);
      if (byHandle.size >= limit) break;
    }
  }
  const prospects = [...byHandle.values()].slice(0, limit);
  if (prospects.length) writeCache(prospects);
  return prospects;
}

async function discoverScheduled(industry, limit, criteria = null) {
  const targetIndustry = industry && industry !== 'all' ? industry : 'all';
  const jobs = scheduledKeywordPool.filter((x) => targetIndustry === 'all' || x.industry === targetIndustry);
  const byHandle = new Map();
  for (const job of jobs) {
    if (byHandle.size >= limit) break;
    const rows = await discover(job.keyword, targetIndustry === 'all' ? 'all' : job.industry, Math.min(8, Math.max(3, limit - byHandle.size)), criteria);
    for (const p of rows) {
      const key = normalizeHandle(p.account);
      if (!key || byHandle.has(key)) continue;
      byHandle.set(key, { ...p, scheduledSeed: job.keyword });
      if (byHandle.size >= limit) break;
    }
  }
  let prospects = [...byHandle.values()].slice(0, limit);
  const cacheRows = cachedProspects({ industry: targetIndustry, limit });
  for (const p of cacheRows) {
    const key = normalizeHandle(p.account);
    if (!key || byHandle.has(key)) continue;
    byHandle.set(key, { ...p, source: p.source || '抽出キャッシュ', sourceNote: `${p.sourceNote || ''} / 検索一時失敗時のキャッシュ補完` });
    if (byHandle.size >= limit) break;
  }
  prospects = [...byHandle.values()].slice(0, limit);
  if (prospects.length) writeCache(prospects);
  return prospects;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });
  const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})) : {};
  const params = req.method === 'GET' ? req.query || {} : body;
  const keyword = String(params.keyword || '採用').slice(0, 80);
  const industry = String(params.industry || 'all');
  const limit = Math.max(1, Math.min(20, Number(params.limit || 8)));
  const mode = String(params.mode || '').toLowerCase();
  const criteria = params.criteria || null;
  try {
    const prospects = mode === 'scheduled' ? await discoverScheduled(industry, limit, criteria) : await discover(keyword, industry, limit, criteria);
    return json(res, 200, {
      ok: true,
      source: mode === 'scheduled' ? 'scheduled_multi_source_discovery' : 'live_web_search',
      searchedAt: new Date().toISOString(),
      keyword,
      industry,
      prospects,
      criteriaApplied: Boolean(criteria),
      note: mode === 'scheduled' ? '定期抽出向けに採用難業種キーワードを巡回し、複数検索元とキャッシュ補完でInstagram候補を抽出。大手・有名企業、SNSコンサル等の同業者は除外。DM送信なし。' : '事前登録リストは使用せず、検索結果からInstagramプロフィールを抽出。大手・有名企業、SNSコンサル等の同業者は除外。DM送信なし。',
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: 'discover_failed', detail: e.message || String(e) });
  }
};
