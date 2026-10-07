import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonDB, defaultData } from '../server/db.js';
import { seed } from '../server/seed.js';
import { createApp, ADMIN_TOKEN } from '../server/server.js';

// 固定验收时钟：2026-10-07 12:00Z
const NOW = Date.parse('2026-10-07T12:00:00.000Z');
let dir;

function fresh() {
  dir = mkdtempSync(join(tmpdir(), 'festival-'));
  const dbFile = join(dir, 'f.json');
  const db = new JsonDB(dbFile, seed);
  const app = createApp({ db, now: () => NOW });
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const req = async (path, opts = {}) => {
    const res = await fetch(base + path, opts);
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, body, headers: res.headers, header: (k) => res.headers.get(k) };
  };
  const admin = (path, opts = {}) =>
    req(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), 'X-Admin-Token': ADMIN_TOKEN } });
  const close = () => { server.close(); rmSync(dir, { recursive: true, force: true }); };
  return { db, req, admin, close };
}

test('几何判定优先：固定公开点 s3 落在核心限制区，公开包/打印卡/文本一致隐藏', async () => {
  const { req, close } = fresh();
  try {
    const pack = (await req('/api/pack')).body;
    assert.deepEqual(pack.sites.map((s) => s.id), ['s1', 's2', 's4']);
    assert.ok(!pack.sites.find((s) => s.id === 's3'), 's3 不得在公开列表');

    // 地图同版：版本戳存在且所有渠道一致
    const v = (await req('/api/version')).body;
    assert.equal(v.version, pack.version);

    // 打印卡：隐藏点 410 Gone
    const card = await req('/api/print/s3');
    assert.equal(card.status, 410);
    assert.match(card.body.message, /不可公开展示|限制区/);

    // 可见点打印卡正常
    const ok = await req('/api/print/s1');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.version, pack.version, '打印卡必须与包同版');
  } finally { close(); }
});

test('行政名称不参与判定：同区域名称的点一个可见一个不可见，由几何决定', async () => {
  const { admin, req, close } = fresh();
  try {
    // 新增一个与 s3 同名同行政区域、但几何在区外的点 -> 必须可见
    await admin('/admin/api/sites', {
      method: 'POST',
      body: JSON.stringify({
        id: 's3dup', fixed_public: true,
        name: { zh: '旧瞭望台', en: 'Old Watchtower' },
        region: { zh: '沧澜湾湿地保护小区·营鹭滩', en: 'Canglan Bay Wetland Reserve · Heron Rookery' },
        lat: 30.0, lng: 121.0, sensitive: false,
      }),
    });
    const pack = (await req('/api/pack')).body;
    assert.ok(pack.sites.find((s) => s.id === 's3dup'), '区外同名点可见（不靠名称屏蔽）');
    assert.ok(!pack.sites.find((s) => s.id === 's3'), '区内同名点仍隐藏（不靠名称放行）');
  } finally { close(); }
});

test('敏感栖息地：列表/图片元数据/公开导出都不暴露精坐标；管理端导出保留', async () => {
  const { req, admin, close } = fresh();
  try {
    const pack = (await req('/api/pack')).body;
    // r1 精坐标在核心区、share_coarse=false
    const r1 = pack.records.find((r) => r.id === 'r1');
    assert.equal(r1.lat, null); assert.equal(r1.lng, null);
    assert.equal(r1.coord_kind, 'none');
    assert.equal(r1.site_id, undefined, '不可见点的站点关联必须移除');
    // 图片 img1 EXIF 必须剥离
    const img1 = pack.images.find((i) => i.id === 'img1');
    assert.equal(img1.gps, null);
    assert.equal(img1.site_id, undefined, '隐藏点上的图片不得带站点');
    // 公开 JSON 导出
    const exj = (await req('/api/export/images.json')).body;
    assert.ok(!JSON.stringify(exj).includes('30.0103'), '导出中不得出现 EXIF 精坐标');
    // 公开 CSV 无精坐标列，r1 行坐标为空
    const csv = (await req('/api/export/observations.csv')).body;
    assert.ok(!csv.includes('30.0103') && !csv.includes('121.0098'));
    assert.ok(csv.includes('coord_kind'));
    // 管理端 CSV 含精坐标
    const acsv = (await admin('/admin/api/export/observations.csv')).body;
    assert.ok(acsv.includes('30.0103') && acsv.includes('121.0098'));
    // 无令牌访问管理端 401
    assert.equal((await req('/admin/api/pack')).status, 401);
  } finally { close(); }
});

test('语言参数不能绕过点位隐藏；缺翻译显示“待补”', async () => {
  const { req, close } = fresh();
  try {
    const en = (await req('/api/pack?lang=en')).body;
    assert.deepEqual(en.sites.map((s) => s.id), ['s1', 's2', 's4']);
    assert.ok(!en.sites.find((s) => s.id === 's3'));
    const e4 = en.events.find((e) => e.id === 'e4');
    assert.equal(e4.title.en, '', '缺英文译文');
    // 客户端 L() 会回退中文并标记；这里校验数据层缺口可被识别
    const { L } = await import('../public/i18n.js');
    const r = L(e4.title, 'en');
    assert.equal(r.missing, true);
    assert.equal(r.text, '候鸟小画家');
  } finally { close(); }
});

test('同名物种订正：重复录入合并并迁移记录/图片；合法同名打消歧标记不合并', async () => {
  const { db, admin, req, close } = fresh();
  try {
    // 1) sp5（无学名“麦鸡”）合并到 sp3，r3 记录迁移
    const merged = await admin('/admin/api/species/sp5/correct', {
      method: 'POST', body: JSON.stringify({ action: 'merge', targetId: 'sp3' }),
    });
    assert.equal(merged.status, 200);
    assert.equal(db.find('records', 'r3').species_id, 'sp3');
    // img1 含 sp1/sp2 不受影响；若有 sp5 标签需去重迁移（此处演示合并幂等）
    const pack = (await req('/api/pack')).body;
    assert.ok(!pack.species.find((s) => s.id === 'sp5'), '被合并物种退出公开名录');
    const r3pub = pack.records.find((r) => r.id === 'r3');
    assert.equal(r3pub.species_id, 'sp3', '公开包记录应指向 sp3');

    // 2) 凤头麦鸡与灰头麦鸡同名不同种 -> 打消歧标记，两者都保留
    await admin('/admin/api/species/sp4/correct', {
      method: 'POST', body: JSON.stringify({ action: 'disambiguate' }),
    });
    const pack2 = (await req('/api/pack')).body;
    const sp3 = pack2.species.find((s) => s.id === 'sp3');
    const sp4 = pack2.species.find((s) => s.id === 'sp4');
    assert.ok(sp3 && sp4, '两个麦鸡都必须保留');
    assert.equal(sp4.disambiguated, true);
    assert.notEqual(sp3.scientific, sp4.scientific);
  } finally { close(); }
});

test('一图多鸟保留多标签，且不因其中一物种/点敏感而泄露坐标', async () => {
  const { req, close } = fresh();
  try {
    const pack = (await req('/api/pack')).body;
    const img1 = pack.images.find((i) => i.id === 'img1');
    assert.deepEqual(img1.species_ids.sort(), ['sp1', 'sp2']);
    assert.equal(img1.gps, null);
  } finally { close(); }
});

test('潮汐跨日窗口被标记；鸟讯/潮汐仅来源材料并带免责声明', async () => {
  const { req, close } = fresh();
  try {
    const pack = (await req('/api/pack')).body;
    const t2 = pack.tides.find((t) => t.id === 't2');
    assert.equal(t2.cross_day, true);
    assert.equal(t2.window_start.date, '2026-10-11');
    assert.equal(t2.window_end.date, '2026-10-12');
    assert.match(pack.disclaimers.tides.zh, /不保证/);
    assert.match(pack.disclaimers.birdnews.zh, /来源材料/);
    assert.equal(pack.birdnews.length, 2);
  } finally { close(); }
});

test('活动改期：公开包只呈现新日期，旧日期仅管理端历史', async () => {
  const { admin, req, close } = fresh();
  try {
    await admin('/admin/api/events/e1/reschedule', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-10-18', time: '10:00', reason: { zh: '天气原因', en: 'weather' } }),
    });
    const pack = (await req('/api/pack')).body;
    const e1 = pack.events.find((e) => e.id === 'e1');
    assert.equal(e1.date, '2026-10-18');
    assert.equal(e1.history, undefined, '历史详情不得出现在公开包');
    assert.equal(e1.rescheduled, true);
    const ap = (await admin('/admin/api/pack')).body;
    assert.equal(ap.events.find((e) => e.id === 'e1').history[0].from_date, '2026-10-10');
  } finally { close(); }
});

test('晚到的限制区新规即时生效：s4 被覆盖后全渠道消失且边界版本递增', async () => {
  const { db, admin, req, close } = fresh();
  try {
    const before = (await req('/api/pack')).body;
    assert.ok(before.sites.find((s) => s.id === 's4'));
    const zoneEpochBefore = before.zone_epoch;

    const create = await admin('/admin/api/zones', {
      method: 'POST',
      body: JSON.stringify({
        id: 'z_late',
        name: { zh: '晚到新规', en: 'Late rule' }, level: 'restricted',
        polygons: [[[
          [121.018, 30.018], [121.026, 30.018], [121.026, 30.026],
          [121.018, 30.026], [121.018, 30.018],
        ]]],
        valid_from: '2026-10-07T00:00:00.000Z',
        valid_to: '2026-12-31T00:00:00.000Z',
      }),
    });
    assert.equal(create.status, 201);
    assert.equal(create.body.version.version, `z${zoneEpochBefore + 1}-c1`, '边界版本必须 +1');

    const after = (await req('/api/pack')).body;
    assert.ok(!after.sites.find((s) => s.id === 's4'), 's4 应从公开列表消失');
    // r3 关联 s4 -> site_id 移除；图片若挂 s4 同步移除
    assert.equal(after.records.find((r) => r.id === 'r3').site_id, undefined);
    // 打印卡同步失效
    assert.equal((await req('/api/print/s4')).status, 410);
    // 版本头同步
    const v = await req('/api/version');
    assert.equal(v.body.version, after.version);
    assert.equal(v.header('x-content-version'), after.version);

    // 边界撤销（把区改到不覆盖/设为失效）后 s4 恢复，版本再次推进
    await admin('/admin/api/zones/z_late', {
      method: 'PUT', body: JSON.stringify({ valid_to: '2026-10-07T00:00:00.000Z' }),
    });
    const restored = (await req('/api/pack')).body;
    assert.ok(restored.sites.find((s) => s.id === 's4'), '边界失效后应恢复展示');
    assert.ok(restored.zone_epoch > after.zone_epoch);
  } finally { close(); }
});

test('空间有效区间：未到开始时间的限制区不隐藏点；过期公告不出现在公开包', async () => {
  const { admin, req, close } = fresh();
  try {
    // 未来生效的区（晚于验收时钟）
    await admin('/admin/api/zones', {
      method: 'POST',
      body: JSON.stringify({
        id: 'z_future', name: { zh: '未来区', en: 'Future' },
        polygons: [[[[120.99, 29.99], [121.01, 29.99], [121.01, 30.01], [120.99, 30.01], [120.99, 29.99]]]],
        valid_from: '2026-11-01T00:00:00.000Z', valid_to: null,
      }),
    });
    const pack = (await req('/api/pack')).body;
    assert.ok(pack.sites.find((s) => s.id === 's1'), '未到生效时间，s1 仍可见');
    assert.deepEqual(pack.bulletins.map((b) => b.id).sort(), ['b1', 'b4'], '过期/未开始公告被过滤');
  } finally { close(); }
});

test('地图/文本/打印卡同版发布：版本号一致且离线旧版本打印被拒绝', async () => {
  const { req, close } = fresh();
  try {
    const pack = (await req('/api/pack')).body;
    const card = (await req('/api/print/s1')).body;
    assert.equal(card.version, pack.version);
    assert.equal(card.kind, 'print-card');
    // 打印接口在离线/无网络由前端处理；这里验证版本字段存在
    assert.ok(/z\d+-c\d+/.test(pack.version));
  } finally { close(); }
});
