// Express 应用：公开只读 API + 管理端写 API（令牌鉴权）。
// 所有写操作递增内容版本；限制区几何/有效区间变化递增边界版本，
// 驱动地图、文本、打印卡、Service Worker 离线缓存全渠道失效。
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonDB, COLLECTIONS } from './db.js';
import { seed } from './seed.js';
import { buildPublicPack, buildAdminPack } from './pack.js';
import { activeZones, pointInZones, isZoneActive } from './geo.js';

export const ADMIN_TOKEN = process.env.FESTIVAL_ADMIN_TOKEN || 'dev-admin-token';
const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp({ dbFile = join(__dirname, '..', 'data', 'festival.json'), now = () => Date.now(), db = null } = {}) {
  const database = db || new JsonDB(dbFile, seed);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.set('db', database);

  const requireAdmin = (req, res, next) => {
    const token =
      req.header('X-Admin-Token') ||
      (req.query.admin_token && String(req.query.admin_token));
    if (token !== ADMIN_TOKEN) {
      return res.status(401).json({ error: 'admin token required' });
    }
    next();
  };

  // Service Worker 与 API 均不使用 HTTP 缓存；版本失效靠 epoch。
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Version', database.version().version);
    next();
  });

  app.get('/api/version', (req, res) => res.json(database.version()));

  app.get('/api/pack', (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'zh'; // 语言不参与可见性
    const pack = buildPublicPack(database, { now: now() });
    pack.lang = lang;
    res.json(pack);
  });

  // 打印卡：与地图/文本同包同源，仅按 id 取单个点；点不可见时 410 Gone。
  app.get('/api/print/:id', (req, res) => {
    const pack = buildPublicPack(database, { now: now() });
    const site = pack.sites.find((s) => s.id === req.params.id);
    if (!site) {
      return res.status(410).json({
        error: 'site_not_publishable',
        version: pack.version,
        message: '该点位当前不可公开展示（可能位于生效限制区内），打印卡不得发布。',
      });
    }
    res.json({
      ...database.version(),
      kind: 'print-card',
      site,
      related_events: pack.events.filter((e) => e.site_id === site.id),
      disclaimers: pack.disclaimers,
    });
  });

  // ---------- 导出：公开导出绝不带精坐标；管理端导出含精坐标 ----------
  function csvCell(v) {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function toCsv(rows, cols) {
    const head = cols.map((c) => csvCell(c.h)).join(',');
    const body = rows
      .map((r) => cols.map((c) => csvCell(typeof c.f === 'function' ? c.f(r) : r[c.f])).join(','))
      .join('\n');
    return `${head}\n${body}\n`;
  }

  app.get('/api/export/observations.csv', (req, res) => {
    const pack = buildPublicPack(database, { now: now() });
    const species = Object.fromEntries(pack.species.map((s) => [s.id, s]));
    const csv = toCsv(pack.records, [
      { h: 'id', f: 'id' },
      { h: 'species_zh', f: (r) => species[r.species_id]?.zh ?? '' },
      { h: 'scientific', f: (r) => species[r.species_id]?.scientific ?? '' },
      { h: 'count', f: 'count' },
      { h: 'date', f: 'date' },
      { h: 'site_id', f: (r) => r.site_id ?? '' }, // 不可见点已被服务端移除
      { h: 'lat_public', f: (r) => r.coord_kind === 'coarse' ? r.lat : '' },
      { h: 'lng_public', f: (r) => r.coord_kind === 'coarse' ? r.lng : '' },
      { h: 'coord_kind', f: 'coord_kind' }, // none/coarse，无精坐标列
    ]);
    res.type('text/csv; charset=utf-8').send('﻿' + csv);
  });

  app.get('/api/export/images.json', (req, res) => {
    const pack = buildPublicPack(database, { now: now() });
    res.json({ version: pack.version, images: pack.images }); // gps 已剥离/降精度
  });

  app.get('/admin/api/pack', requireAdmin, (req, res) => {
    res.json(buildAdminPack(database, { now: now() }));
  });

  app.get('/admin/api/export/observations.csv', requireAdmin, (req, res) => {
    const rows = database.all('records');
    const species = Object.fromEntries(database.all('species').map((s) => [s.id, s]));
    const csv = toCsv(rows, [
      { h: 'id', f: 'id' },
      { h: 'species_id', f: 'species_id' },
      { h: 'species_zh', f: (r) => species[r.species_id]?.zh ?? '' },
      { h: 'count', f: 'count' },
      { h: 'date', f: 'date' },
      { h: 'site_id', f: 'site_id' },
      { h: 'exact_lat', f: 'exact_lat' },
      { h: 'exact_lng', f: 'exact_lng' },
      { h: 'sensitive', f: (r) => (r.sensitive ? '1' : '0') },
      { h: 'note_json', f: 'note' },
    ]);
    res.type('text/csv; charset=utf-8').send('﻿' + csv);
  });

  // ---------- 管理端通用 CRUD ----------
  const WRITABLE = new Set(COLLECTIONS);
  app.post('/admin/api/:collection', requireAdmin, (req, res) => {
    const c = req.params.collection;
    if (!WRITABLE.has(c)) return res.status(404).json({ error: 'unknown collection' });
    const rec = database.insert(c, req.body || {});
    database.bump(c === 'zones' ? 'zone' : 'content');
    res.status(201).json({ record: rec, version: database.version() });
  });

  app.put('/admin/api/:collection/:id', requireAdmin, (req, res) => {
    const c = req.params.collection;
    if (!WRITABLE.has(c)) return res.status(404).json({ error: 'unknown collection' });
    const before = c === 'zones' ? JSON.stringify(database.find(c, req.params.id)) : null;
    const rec = database.update(c, req.params.id, req.body || {});
    if (!rec) return res.status(404).json({ error: 'not found' });
    if (c === 'zones') database.bump('zone'); // 任何限制区写操作都使边界版本失效
    else database.bump('content');
    res.json({ record: rec, version: database.version() });
  });

  app.delete('/admin/api/:collection/:id', requireAdmin, (req, res) => {
    const c = req.params.collection;
    if (!WRITABLE.has(c)) return res.status(404).json({ error: 'unknown collection' });
    if (!database.remove(c, req.params.id)) return res.status(404).json({ error: 'not found' });
    database.bump(c === 'zones' ? 'zone' : 'content');
    res.json({ ok: true, version: database.version() });
  });

  // ---------- 物种同名订正 ----------
  // body: { action: 'merge'|'disambiguate', targetId }
  app.post('/admin/api/species/:id/correct', requireAdmin, (req, res) => {
    const { action, targetId, name, scientific, desc } = req.body || {};
    const sp = database.find('species', req.params.id);
    if (!sp) return res.status(404).json({ error: 'species not found' });

    if (action === 'merge') {
      const target = database.find('species', targetId);
      if (!target) return res.status(400).json({ error: 'target species missing' });
      // 观测记录迁移到目标物种
      for (const r of database.all('records')) {
        if (r.species_id === sp.id) r.species_id = target.id;
      }
      // 图片标签去重迁移
      for (const im of database.all('images')) {
        if (Array.isArray(im.species_ids) && im.species_ids.includes(sp.id)) {
          im.species_ids = im.species_ids.map((x) => (x === sp.id ? target.id : x));
          im.species_ids = [...new Set(im.species_ids)];
        }
      }
      sp.merged_into = target.id;
      sp.correction = { action, target_id: target.id, at: new Date().toISOString() };
      database.flush();
      database.bump('content');
      return res.json({ ok: true, corrected: sp, migrated: true, version: database.version() });
    }
    if (action === 'disambiguate') {
      // 合法同名（如两种“麦鸡”）：补学名/说明并打消歧标记，禁止合并
      sp.scientific = scientific || sp.scientific;
      if (name) sp.zh = name.zh || sp.zh, sp.en = name.en || sp.en;
      if (desc) sp.desc = desc;
      sp.disambiguated = true;
      sp.correction = { action, at: new Date().toISOString() };
      database.flush();
      database.bump('content');
      return res.json({ ok: true, corrected: sp, migrated: false, version: database.version() });
    }
    res.status(400).json({ error: 'action must be merge or disambiguate' });
  });

  // ---------- 活动改期（保留审计历史，公开包只呈现新日期） ----------
  app.post('/admin/api/events/:id/reschedule', requireAdmin, (req, res) => {
    const { date, time, reason } = req.body || {};
    const ev = database.find('events', req.params.id);
    if (!ev) return res.status(404).json({ error: 'event not found' });
    if (!date) return res.status(400).json({ error: 'new date required' });
    ev.history = ev.history || [];
    ev.history.push({
      from_date: ev.date, from_time: ev.time,
      changed_at: new Date().toISOString(), reason: reason || {},
    });
    ev.date = date;
    if (time) ev.time = time;
    ev.status = 'rescheduled';
    database.flush();
    database.bump('content');
    res.json({ ok: true, event: ev, version: database.version() });
  });

  // ---------- 管理端几何诊断：按实际几何判断，不看行政名称 ----------
  app.get('/admin/api/check-point', requireAdmin, (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat/lng required' });
    }
    const zones = activeZones(database.all('zones'), now());
    const hit = pointInZones([lng, lat], zones);
    res.json({
      lat, lng, at: new Date(now()).toISOString(),
      blocked: !!hit,
      zone: hit ? { id: hit.id, name: hit.name, level: hit.level } : null,
    });
  });

  app.get('/admin/api/zones/:id/status', requireAdmin, (req, res) => {
    const z = database.find('zones', req.params.id);
    if (!z) return res.status(404).json({ error: 'zone not found' });
    res.json({
      id: z.id,
      active: isZoneActive(z, now()),
      valid_from: z.valid_from,
      valid_to: z.valid_to,
      now: new Date(now()).toISOString(),
    });
  });

  app.use('/', express.static(join(__dirname, '..', 'public'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/');
    },
  }));

  return app;
}

export function start(port = Number(process.env.PORT) || 3000) {
  const app = createApp();
  return app.listen(port, () => {
    console.log(`湿地鸟类民俗节专题: http://localhost:${port}  (管理端 /admin.html)`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
