const assert = require('assert');
const { validatePayload, buildRowsFromInsights, CONTENT_TAB, MONTHLY_TAB, addDaysKey } = require('../lib/monthly-report');

const missing = validatePayload({ targetMonth: '2026-08', dataType: 'both', targetTab: MONTHLY_TAB });
assert.strictEqual(missing.ok, false);
assert(missing.errors.some((e) => e.includes('対象アカウント')));

const badTab = validatePayload({ targetMonth: '2026-08', account: 'ascentbusiness_consulting', dataType: 'both', targetTab: '別シート' });
assert.strictEqual(badTab.ok, false);
assert(badTab.errors.some((e) => e.includes('許可範囲外')));

const valid = validatePayload({ targetMonth: '2026-08', account: '@ascentbusiness_consulting', dataType: 'content', targetTab: CONTENT_TAB });
assert.strictEqual(valid.ok, true);
assert.strictEqual(valid.normalized.account, 'ascentbusiness_consulting');

const rows = buildRowsFromInsights({
  profile: { username: 'ascentbusiness_consulting', followers_count: 1000 },
  accountInsights: [
    { name: 'views', total_value: { value: 2000 } },
    { name: 'reach', total_value: { value: 1000 } },
    { name: 'profile_views', total_value: { value: 120 } },
    { name: 'website_clicks', total_value: { value: 30 } },
  ],
  media: [
    { id: 'p1', permalink: 'https://www.instagram.com/x/reel/p1/', timestamp: '2026-08-05T00:00:00+0000', media_product_type: 'REELS', caption: 'client_secret should not leak', like_count: 10, insights: { data: [{ name: 'views', values: [{ value: 100 }] }, { name: 'reach', values: [{ value: 80 }] }, { name: 'saved', values: [{ value: 5 }] }, { name: 'profile_visits', values: [{ value: 8 }] }, { name: 'link_clicks', values: [{ value: 2 }] }] } },
  ],
}, { targetMonth: '2026-08', account: 'ascentbusiness_consulting', previousMonthly: { views: 1000, reach: 800, profileAccess: 100, linkClicks: 20, followers: 900 } });

assert.strictEqual(rows.contentRows.length, 1);
assert.strictEqual(rows.monthlyRows.length, 1);
assert.strictEqual(rows.contentRows[0].status, '取得済み');
assert(!/client_secret/i.test(rows.contentRows[0].analysis));
assert.strictEqual(rows.monthlyRows[0].viewsMoM, '100.0%');
assert.strictEqual(rows.monthlyRows[0].reflected, false);
assert.strictEqual(rows.contentRows[0].postType, 'リール');
assert.strictEqual(rows.contentRows[0].accountCategory, '新卒向け');

const sevenDayRows = buildRowsFromInsights({
  profile: { username: 'abc_midcareer', followers_count: 1000 },
  accountInsights: [],
  media: [
    { id: 'extract-me', permalink: 'https://www.instagram.com/reel/extract-me/', timestamp: '2026-08-10T00:00:00+0000', media_product_type: 'REELS', caption: '7日目対象', like_count: 10, insights: { data: [{ name: 'views', values: [{ value: 100 }] }, { name: 'reach', values: [{ value: 80 }] }] } },
    { id: 'too-old', permalink: 'https://www.instagram.com/reel/too-old/', timestamp: '2026-08-09T00:00:00+0000', media_product_type: 'REELS', caption: '8日目は対象外', like_count: 10, insights: { data: [{ name: 'views', values: [{ value: 100 }] }, { name: 'reach', values: [{ value: 80 }] }] } },
    { id: 'already-done', permalink: 'https://www.instagram.com/p/already-done/', timestamp: '2026-08-10T00:00:00+0000', media_product_type: 'FEED', caption: '重複対象外', like_count: 10, insights: { data: [{ name: 'views', values: [{ value: 100 }] }, { name: 'reach', values: [{ value: 80 }] }] } },
  ],
}, { targetMonth: '2026-08', account: 'abc_midcareer', contentExtractionMode: 'post_7th_day', extractionTargetDate: '2026-08-17', extractedPostIds: new Set(['already-done']) });
assert.strictEqual(addDaysKey('2026-08-17', -7), '2026-08-10');
assert.deepStrictEqual(sevenDayRows.contentRows.map((r) => r.postId), ['extract-me']);
assert.strictEqual(sevenDayRows.contentRows[0].postAgeDays, 7);
assert.strictEqual(sevenDayRows.contentRows[0].accountCategory, '中途向け');

console.log('monthly-report tests passed');
