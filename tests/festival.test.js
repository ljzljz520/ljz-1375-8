import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.resolve('data/test-festival.db');
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(process.env.DB_PATH + suffix, { force: true });

const { app, db } = await import('../src/server.js');
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const token = process.env.ADMIN_TOKEN || 'dev-admin-token';

async function request(path, options = {}) {
  const response = await fetch(base + path, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('json') ? await response.json() : await response.text();
  return { status: response.status, headers: response.headers, body };
}
const admin = (path, method = 'GET', body) => request(path, {
  method,
  headers: { 'X-Admin-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
});
const BEFORE = '2026-10-06T00:00:00Z';
const WHEN_LATE_RULE_IS_ACTIVE = '2026-10-07T00:00:00Z';

test.after(() => { server.close(); db.close(); });

test('分类、公告和空间/时间有效区间由数据库和统一发布版本输出', async () => {
  const r = await request(`/api/release?lang=zh&at=${BEFORE}`);
  assert.equal(r.status, 200);
  assert.match(r.body.release.channel, /map\+text\+print\+export/);
  assert.ok(r.body.release.version >= 1);
  assert.deepEqual(r.body.categories.map(c => c.key), ['bird', 'ritual', 'family', 'access']);
  assert.ok(r.body.announcements.some(a => a.validStart && a.validEnd && a.body.includes('不表示活动期间一定能看到')));
  assert.ok(r.body.activeRestrictionNotices.length >= 1);
  assert.equal(JSON.stringify(r.body.activeRestrictionNotices).includes('coordinates'), false);
});

test('几何判定：同名行政区域不决定可见性，边界接触也隐藏', async () => {
  const zh = await request(`/api/release?lang=zh&at=${BEFORE}`).then(r => r.body);
  const en = await request(`/api/release?lang=en&at=${BEFORE}`).then(r => r.body);
  for (const release of [zh, en]) {
    const slugs = release.points.map(p => p.slug);
    assert.ok(slugs.includes('east-tidal-trail')); // 行政名同为东滩，但几何在区外
    assert.ok(!slugs.includes('core-boardwalk'));   // 几何在区内
    assert.ok(!slugs.includes('north-boundary-marker')); // 几何压边界，保守隐藏
  }
  const created = await admin('/api/admin/observation-points', 'POST', {
    slug: 'geometry-not-name-probe',
    administrativeArea: '完全不存在的行政区',
    publicGeometry: { type: 'Point', coordinates: [120.15, 32.15] }, // 实际落入核心区多边形
    translations: { zh: { name: '几何探针' }, en: { name: 'Geometry probe' } }
  });
  assert.equal(created.status, 201);
  const after = await request(`/api/release?lang=zh&at=${BEFORE}`).then(r => r.body);
  assert.ok(!after.points.some(p => p.slug === 'geometry-not-name-probe'));
});

test('精确观测位置与公开位置分离，列表、图片元数据、导出均不泄露精坐标', async () => {
  const zh = await request(`/api/release?lang=zh&at=${BEFORE}`).then(r => r.body);
  const en = await request(`/api/release?lang=en&at=${BEFORE}`).then(r => r.body);
  for (const release of [zh, en]) {
    const raw = JSON.stringify(release);
    for (const secret of ['120.1418', '32.1419', '120.3114', '32.1517', '120.1412', '32.1423', '120.2001']) {
      assert.ok(!raw.includes(secret), `secret coordinate fragment leaked: ${secret}`);
    }
    const sensitiveReport = release.birdReports.find(r => r.id === 1);
    assert.equal(sensitiveReport.location.type, 'withheld');
    assert.equal(sensitiveReport.location.pointId, undefined);
    assert.equal(sensitiveReport.location.coordinates, undefined);
  }
  const records = await admin('/api/admin/observation-records');
  assert.equal(records.status, 200);
  assert.ok(records.body.find(r => r.id === 1).exactGeometry.coordinates); // 管理端仍保留内部精确记录

  const pointsCsv = await request(`/api/export/points.csv?lang=en&at=${BEFORE}`);
  const reportsCsv = await request(`/api/export/bird-reports.csv?lang=en&at=${BEFORE}`);
  const imagesCsv = await request(`/api/export/images.csv?lang=en&at=${BEFORE}`);
  for (const csv of [pointsCsv.body, reportsCsv.body, imagesCsv.body]) {
    for (const secret of ['120.1418', '32.1419', '120.3114', '32.1517', '120.2001']) assert.ok(!csv.includes(String(secret)));
  }
  assert.match(reportsCsv.body, /withheld/);
  assert.match(imagesCsv.body, /gps-removed/);
});

test('一张图片可关联多种鸟，且仅输出剥离 GPS 后的元数据白名单', async () => {
  const release = await request(`/api/release?lang=zh&at=${BEFORE}`).then(r => r.body);
  const image = release.images.find(i => i.url === '/uploads/mixed-birds.svg');
  assert.deepEqual(image.species.map(s => s.slug).sort(), ['common-kingfisher', 'little-egret']);
  assert.equal(image.gpsStripped, true);
  assert.equal(image.metadata.locationStatus, 'gps-removed');
  assert.equal(JSON.stringify(image.metadata).includes('GPSLatitude'), false);
});

test('同名物种订正保留旧标签并指向被接受物种', async () => {
  const corrected = await admin('/api/admin/bird-reports/2/correct-species', 'POST', {
    oldLabel: '白鹭', lang: 'zh', speciesSlug: 'little-egret', basis: '黑嘴黑腿，排除同名俗名混淆'
  });
  assert.equal(corrected.status, 200);
  const release = await request(`/api/release?lang=zh&at=${BEFORE}`).then(r => r.body);
  const report = release.birdReports.find(r => r.id === 2);
  assert.equal(report.species.slug, 'little-egret');
  assert.equal(report.correction.oldLabel, '白鹭');
  assert.match(report.correction.basis, /同名/);
});

test('潮汐窗口按本地日期识别跨日，并且只作为来源材料', async () => {
  const release = await request(`/api/release?lang=zh&at=${BEFORE}`).then(r => r.body);
  const tide = release.tides[0];
  assert.equal(tide.crossesLocalMidnight, true);
  assert.equal(tide.source.kind, 'source-material-only');
  assert.match(release.disclaimers.tides, /来源材料/);
});

test('活动改期记录旧时间、新时间和原因', async () => {
  const changed = await admin('/api/admin/events/2/reschedule', 'POST', {
    startAt: '2026-10-18T14:00:00+08:00', endAt: '2026-10-18T15:30:00+08:00', reason: '临时潮沟安全演练'
  });
  assert.equal(changed.status, 200);
  const release = await request(`/api/release?lang=zh&at=2026-10-06T00:00:00Z`).then(r => r.body);
  const event = release.events.find(e => e.id === 2);
  assert.equal(event.status, 'rescheduled');
  assert.equal(event.previousSchedule.reason, '临时潮沟安全演练');
  assert.ok(Date.parse(event.startAt) > Date.parse(event.previousSchedule.startAt));
});

test('缺少翻译显示待补信息，切换语言不能取得另一种语言内容或绕过隐藏', async () => {
  const en = await request(`/api/release?lang=en&at=${BEFORE}`).then(r => r.body);
  const family = en.events.find(e => e.slug === 'family-bird-footprints');
  assert.match(family.description, /Pending translation/);
  assert.ok(!en.points.some(p => p.slug === 'core-boardwalk'));
  const raw = JSON.stringify(en);
  assert.ok(!raw.includes('120.14')); // 不通过 en 页面解析隐藏中文点
});

test('迟到限制区/边界变化后 bump，旧 ETag 与地图、文本、打印卡、导出全部失效', async () => {
  const path = `/api/release?lang=zh&at=${WHEN_LATE_RULE_IS_ACTIVE}`;
  const before = await request(path);
  const oldEtag = before.headers.get('etag');
  const oldVersion = before.body.release.version;
  assert.ok(before.body.points.some(p => p.slug === 'east-tidal-trail'));

  // 新规在生效日之后才送达（receivedAt 晚于 effectiveStart），即使先补录到核心区内也立即 bump。
  const lateReceived = await admin('/api/admin/restriction-zones', 'POST', {
    slug: 'late-core-roosting-notice',
    geometry: {
      type: 'Polygon',
      coordinates: [[[120.120,32.120],[120.130,32.120],[120.130,32.130],[120.120,32.130],[120.120,32.120]]]
    },
    effectiveStart: '2026-09-15T00:00:00Z',
    effectiveEnd: '2027-03-01T00:00:00Z',
    receivedAt: WHEN_LATE_RULE_IS_ACTIVE,
    source: 'late-manual-delivery-2026-10-07',
    translations: { zh: { name: '迟到补录夜栖通知', reason: '纸质通知当日才送达' }, en: { name: 'Late roosting notice', reason: 'Paper notice arrived today' } }
  });
  assert.equal(lateReceived.status, 201);
  assert.equal(lateReceived.body.releaseId, `r${oldVersion + 1}`);
  const lateRelease = await request(path).then(r => r.body);
  assert.equal(lateRelease.release.version, oldVersion + 1);
  assert.ok(lateRelease.activeRestrictionNotices.some(z => z.slug === 'late-core-roosting-notice'));
  assert.ok(lateRelease.points.some(p => p.slug === 'east-tidal-trail'), '补录小区域暂不影响区外公开点');

  // 管理端随后依据真实多边形扩大边界；行政名称仍可不变。
  const expanded = {
    type: 'Polygon',
    coordinates: [[[120.100,32.100],[120.320,32.100],[120.320,32.200],[120.100,32.200],[120.100,32.100]]]
  };
  const updated = await admin('/api/admin/restriction-zones/1', 'PUT', {
    geometry: expanded, source: 'wetland-authority-late-boundary-2026-10-07'
  });
  assert.equal(updated.status, 200);
  assert.ok(updated.body.releaseId === `r${oldVersion + 2}`);

  const afterMap = await request(path);
  assert.equal(afterMap.status, 200);
  assert.notEqual(afterMap.headers.get('etag'), oldEtag);
  assert.equal(afterMap.body.release.version, oldVersion + 2);
  assert.ok(!afterMap.body.points.some(p => p.slug === 'east-tidal-trail'));
  assert.ok(!afterMap.body.events.some(e => e.locationPointId));

  const oldEtagCheck = await request(path, { headers: { 'If-None-Match': oldEtag } });
  assert.equal(oldEtagCheck.status, 200, 'old cached representation must not be revalidated as fresh');

  for (const channel of ['/api/channels/map', '/api/channels/text']) {
    const channelResponse = await request(`${channel}?lang=zh&at=${WHEN_LATE_RULE_IS_ACTIVE}`);
    assert.equal(channelResponse.headers.get('x-release-id'), `r${oldVersion + 2}`);
    assert.ok(!channelResponse.body.points.some(p => p.slug === 'east-tidal-trail'));
  }
  const print = await request(`/print?lang=en&at=${WHEN_LATE_RULE_IS_ACTIVE}`);
  assert.equal(print.status, 200);
  assert.match(print.body, new RegExp(`r${oldVersion + 2}`));
  assert.ok(!print.body.includes('East Tidal Public Trail'));
  assert.ok(!print.body.includes('120.31'));

  const csv = await request(`/api/export/points.csv?lang=zh&at=${WHEN_LATE_RULE_IS_ACTIVE}`);
  assert.equal(csv.status, 200);
  assert.ok(!csv.body.includes('east-tidal-trail'));
  assert.ok(!csv.body.includes('120.31'));
});

test('离线服务工作线程绝不复用 API、打印卡或导出的旧限制敏感计划', () => {
  const sw = fs.readFileSync('public/sw.js', 'utf8');
  assert.match(sw, /Never cache API data or print cards/);
  assert.match(sw, /offline-plan-invalid/);
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
  const appJs = fs.readFileSync('public/app.js', 'utf8');
  assert.match(appJs, /window\.addEventListener\('offline', showOffline\)/);
  assert.match(appJs, /release = null[\s\S]*releaseId = null/);
});
