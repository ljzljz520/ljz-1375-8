import express from 'express';
import { openDb, seedDb, bumpVersion, RELEASE_VERSION_KEY } from './db.js';
import { buildRelease, releaseEtag, SUPPORTED_LANGS } from './release.js';
import { parseGeometry } from './geometry.js';

const db = openDb();
seedDb(db);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public', { etag: false, lastModified: false }));
app.use('/uploads', express.static('public/uploads', { etag: false, lastModified: false }));

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token';
const PORT = Number(process.env.PORT || 3000);

function parseAt(req) {
  const raw = req.query.at;
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return { error: res(req, 400, { error: 'Invalid at timestamp' }), date: null };
  return { date, error: null };
}
function res(_req, status, body) { return { status, body }; }

function getReleaseForRequest(req, res, next) {
  const lang = String(req.query.lang || 'zh');
  if (!SUPPORTED_LANGS.includes(lang)) return res.status(400).json({ error: 'Unsupported language', supportedLanguages: SUPPORTED_LANGS });
  const { date, error } = parseAt(req);
  if (error) return res.status(error.status).json(error.body);
  req.festival = { lang, at: date, release: buildRelease(db, { lang, at: date }) };
  res.set('ETag', releaseEtag(req.festival.release));
  res.set('X-Release-Id', req.festival.release.release.id);
  res.set('Cache-Control', 'no-cache, must-revalidate');
  if (req.headers['if-none-match'] === releaseEtag(req.festival.release)) return res.status(304).end();
  next();
}

function publicJson(req, res) {
  res.json(req.festival.release);
}

app.get(['/api/release', '/api/channels/map', '/api/channels/text'], getReleaseForRequest, publicJson);
app.get('/api/release/version', (req, res) => {
  const lang = SUPPORTED_LANGS.includes(String(req.query.lang)) ? String(req.query.lang) : 'zh';
  const row = db.prepare('SELECT * FROM content_versions WHERE version_key=?').get(RELEASE_VERSION_KEY);
  res.set('Cache-Control', 'no-store');
  res.json({ id: `r${row.version}`, version: row.version, changedAt: row.changed_at, lang });
});

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function csv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(','))].join('\r\n');
}

app.get('/api/export/points.csv', getReleaseForRequest, (req, res) => {
  const rows = req.festival.release.points.map((point) => ({
    id: point.id,
    slug: point.slug,
    name: point.name,
    description: point.description,
    access_note: point.accessNote,
    // Public geometry only; hidden points are absent and sensitive_geometry is never exported.
    longitude: point.geometry?.coordinates?.[0] ?? '',
    latitude: point.geometry?.coordinates?.[1] ?? ''
  }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="public-points.csv"');
  res.send('﻿' + csv(rows));
});

app.get('/api/export/bird-reports.csv', getReleaseForRequest, (req, res) => {
  const rows = req.festival.release.birdReports.map((report) => ({
    id: report.id,
    species: report.species?.commonName || '',
    scientific_name: report.species?.scientificName || '',
    observed_at: report.observedAt,
    location_type: report.location.type,
    broad_area: report.location.type === 'withheld' ? report.location.broadArea : '',
    // Hidden/sensitive reports emit no longitude or latitude columns.
    longitude: report.location.coordinates?.[0] || '',
    latitude: report.location.coordinates?.[1] || '',
    source: report.source.title,
    note: report.source.kind
  }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bird-reports-safe.csv"');
  res.send('﻿' + csv(rows));
});

app.get('/api/export/images.csv', getReleaseForRequest, (req, res) => {
  const rows = req.festival.release.images.map((image) => ({
    id: image.id,
    url: image.url,
    caption: image.caption,
    alt_text: image.altText,
    species: image.species.map((s) => s.scientificName).join('|'),
    gps_status: image.gpsStripped ? 'gps-removed' : 'blocked',
    camera: image.metadata.camera,
    exposure: image.metadata.exposure
  }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="images-safe.csv"');
  res.send('﻿' + csv(rows));
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
app.get('/print', getReleaseForRequest, (req, res) => {
  const r = req.festival.release;
  const section = (title, items) => `<section><h2>${escapeHtml(title)}</h2>${items || '<p>〔待补信息：无内容〕</p>'}</section>`;
  const pointCards = r.points.map((p) => `<article class="card"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p><p>${escapeHtml(p.accessNote)}</p></article>`).join('');
  const eventCards = r.events.map((e) => `<article class="card"><h3>${escapeHtml(e.title)}</h3><time>${escapeHtml(e.startAt)} – ${escapeHtml(e.endAt)}</time><p>${escapeHtml(e.status)}</p><p>${escapeHtml(e.description)}</p></article>`).join('');
  const notices = r.announcements.concat(r.activeRestrictionNotices.map((z) => ({ title: z.name, body: `${z.reason} ${z.effectiveStart}–${z.effectiveEnd}` })))
    .map((a) => `<li><strong>${escapeHtml(a.title)}</strong>: ${escapeHtml(a.body)}</li>`).join('');
  const tides = r.tides.map((t) => `<li>${escapeHtml(t.locationSlug)} ${escapeHtml(t.startAt)}–${escapeHtml(t.endAt)} (cross-day: ${t.crossesLocalMidnight})</li>`).join('');
  res.send(`<!doctype html><html lang="${r.lang}"><head><meta charset="utf-8"><title>${r.lang === 'zh' ? '湿地鸟类民俗节打印卡' : 'Wetland Bird Festival print card'}</title>
<style>body{font-family:sans-serif;margin:24px}.meta{color:#555;font-size:12px}.card{border:1px solid #999;padding:10px;margin:8px 0;break-inside:avoid}@media print{.no-print{display:none}}</style></head>
<body><h1>${r.lang === 'zh' ? '湿地鸟类民俗节' : 'Wetland Bird Folklore Festival'}</h1>
<div class="meta">Release ${escapeHtml(r.release.id)} · ${escapeHtml(r.release.changedAt || '')} · map/text/print/export same version</div>
<p>${escapeHtml(r.disclaimers.birds)}</p><p>${escapeHtml(r.disclaimers.tides)}</p>
${section(r.lang === 'zh' ? '可展示观测点' : 'Visible observation points', pointCards)}
${section(r.lang === 'zh' ? '仪式与亲子活动' : 'Rituals and family activities', eventCards)}
${section(r.lang === 'zh' ? '公告与限制区' : 'Notices and restrictions', `<ul>${notices}</ul>`)}
${section(r.lang === 'zh' ? '潮汐来源材料' : 'Tide source material', `<ul>${tides}</ul>`)}
<script>localStorage.setItem('festivalReleaseId',${JSON.stringify(r.release.id)});window.addEventListener('offline',()=>document.title='[旧计划需复核] '+document.title);</script>
</body></html>`);
});

function requireAdmin(req, res, next) {
  if (req.get('X-Admin-Token') !== ADMIN_TOKEN) return res.status(401).json({ error: 'Invalid admin token' });
  next();
}

function validPointGeometry(g) {
  const geometry = parseGeometry(g);
  return geometry?.type === 'Point' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 &&
    geometry.coordinates.every((n) => typeof n === 'number' && Number.isFinite(n));
}
function validPolygonGeometry(g) {
  const geometry = parseGeometry(g);
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return false;
  return geometry.coordinates.every((ring) => Array.isArray(ring) && ring.length >= 4 &&
    ring.every((c) => Array.isArray(c) && c.length >= 2 && c.every((n) => typeof n === 'number' && Number.isFinite(n))));
}
function translationsObject(body, fields) {
  const out = { zh: body.translations?.zh || {}, en: body.translations?.en || {} };
  for (const lang of ['zh', 'en']) for (const field of fields) out[lang][field] = out[lang][field] ?? '';
  return out;
}
function savePointTranslations(id, translations) {
  const stmt = db.prepare(`INSERT INTO observation_point_translations(point_id,lang,name,description,access_note)
    VALUES (@id,@lang,@name,@description,@accessNote)
    ON CONFLICT(point_id,lang) DO UPDATE SET name=excluded.name, description=excluded.description, access_note=excluded.access_note`);
  for (const lang of ['zh', 'en']) stmt.run({ id, lang, name: translations[lang].name || '', description: translations[lang].description || '', accessNote: translations[lang].accessNote || '' });
}
function saveZoneTranslations(id, translations) {
  const stmt = db.prepare(`INSERT INTO restriction_zone_translations(zone_id,lang,name,reason)
    VALUES (@id,@lang,@name,@reason)
    ON CONFLICT(zone_id,lang) DO UPDATE SET name=excluded.name, reason=excluded.reason`);
  for (const lang of ['zh', 'en']) stmt.run({ id, lang, name: translations[lang].name || '', reason: translations[lang].reason || '' });
}
function normalizeIso(value, field) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error(`Invalid ${field}`), { status: 400 });
  return parsed.toISOString();
}

app.get('/api/admin/observation-points', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM observation_points ORDER BY id').all().map((p) => ({
    ...p,
    publicGeometry: JSON.parse(p.public_geometry || 'null'),
    sensitiveGeometry: JSON.parse(p.sensitive_geometry || 'null'),
    translations: {
      zh: db.prepare('SELECT * FROM observation_point_translations WHERE point_id=? AND lang=?').get(p.id, 'zh'),
      en: db.prepare('SELECT * FROM observation_point_translations WHERE point_id=? AND lang=?').get(p.id, 'en')
    }
  })));
});

app.post('/api/admin/observation-points', requireAdmin, (req, res) => {
  try {
    const b = req.body;
    if (!b.slug || !validPointGeometry(b.publicGeometry)) return res.status(400).json({ error: 'slug and valid public Point geometry are required' });
    if (b.sensitiveGeometry && !validPointGeometry(b.sensitiveGeometry)) return res.status(400).json({ error: 'sensitiveGeometry must be a Point' });
    const now = new Date().toISOString();
    const tr = translationsObject(b, ['name', 'description', 'accessNote']);
    const info = db.prepare(`INSERT INTO observation_points(slug,category_id,public_geometry,sensitive_geometry,is_sensitive,administrative_area,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(b.slug, b.categoryId || null, JSON.stringify(b.publicGeometry),
      b.sensitiveGeometry ? JSON.stringify(b.sensitiveGeometry) : null, b.isSensitive ? 1 : 0, b.administrativeArea || null, now, now);
    savePointTranslations(info.lastInsertRowid, tr);
    bumpVersion(db);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.put('/api/admin/observation-points/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM observation_points WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Point not found' });
  const b = req.body;
  if (b.publicGeometry && !validPointGeometry(b.publicGeometry)) return res.status(400).json({ error: 'Invalid public Point geometry' });
  if (b.sensitiveGeometry && !validPointGeometry(b.sensitiveGeometry)) return res.status(400).json({ error: 'Invalid sensitive Point geometry' });
  const now = new Date().toISOString();
  db.prepare(`UPDATE observation_points SET slug=COALESCE(?,slug), category_id=COALESCE(?,category_id),
    public_geometry=COALESCE(?,public_geometry), sensitive_geometry=COALESCE(?,sensitive_geometry),
    is_sensitive=COALESCE(?,is_sensitive), administrative_area=COALESCE(?,administrative_area), updated_at=? WHERE id=?`)
    .run(b.slug ?? null, b.categoryId ?? null, b.publicGeometry ? JSON.stringify(b.publicGeometry) : null,
      b.sensitiveGeometry ? JSON.stringify(b.sensitiveGeometry) : null,
      b.isSensitive === undefined ? null : (b.isSensitive ? 1 : 0), b.administrativeArea ?? null, now, id);
  if (b.translations) savePointTranslations(id, translationsObject(b, ['name', 'description', 'accessNote']));
  bumpVersion(db);
  res.json({ ok: true });
});

app.delete('/api/admin/observation-points/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM observation_points WHERE id=?').run(Number(req.params.id));
  bumpVersion(db);
  res.json({ ok: true });
});

app.get('/api/admin/restriction-zones', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM restriction_zones ORDER BY id').all().map((z) => ({
    ...z,
    geometry: JSON.parse(z.geometry),
    translations: {
      zh: db.prepare('SELECT * FROM restriction_zone_translations WHERE zone_id=? AND lang=?').get(z.id, 'zh'),
      en: db.prepare('SELECT * FROM restriction_zone_translations WHERE zone_id=? AND lang=?').get(z.id, 'en')
    }
  })));
});

app.post('/api/admin/restriction-zones', requireAdmin, (req, res) => {
  try {
    const b = req.body;
    if (!b.slug || !validPolygonGeometry(b.geometry)) return res.status(400).json({ error: 'slug and Polygon geometry are required' });
    const start = normalizeIso(b.effectiveStart, 'effectiveStart');
    const end = normalizeIso(b.effectiveEnd, 'effectiveEnd');
    if (Date.parse(end) <= Date.parse(start)) return res.status(400).json({ error: 'effectiveEnd must be after effectiveStart' });
    const receivedAt = b.receivedAt ? normalizeIso(b.receivedAt, 'receivedAt') : new Date().toISOString();
    const now = new Date().toISOString();
    const tr = translationsObject(b, ['name', 'reason']);
    const info = db.prepare(`INSERT INTO restriction_zones(slug,geometry,effective_start,effective_end,administrative_area,source,received_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(b.slug, JSON.stringify(b.geometry), start, end, b.administrativeArea || '', b.source || 'management', receivedAt, now, now);
    saveZoneTranslations(info.lastInsertRowid, tr);
    bumpVersion(db); // A late rule taking effect now invalidates every cached channel immediately.
    res.status(201).json({ id: Number(info.lastInsertRowid), releaseId: `r${currentPublicVersion()}` });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.put('/api/admin/restriction-zones/:id', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM restriction_zones WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Restriction zone not found' });
    const b = req.body;
    if (b.geometry && !validPolygonGeometry(b.geometry)) return res.status(400).json({ error: 'Invalid Polygon geometry' });
    const start = b.effectiveStart ? normalizeIso(b.effectiveStart, 'effectiveStart') : existing.effective_start;
    const end = b.effectiveEnd ? normalizeIso(b.effectiveEnd, 'effectiveEnd') : existing.effective_end;
    if (Date.parse(end) <= Date.parse(start)) return res.status(400).json({ error: 'Invalid spatial/time interval' });
    const now = new Date().toISOString();
    db.prepare(`UPDATE restriction_zones SET slug=COALESCE(?,slug), geometry=COALESCE(?,geometry),
      effective_start=?, effective_end=?, administrative_area=COALESCE(?,administrative_area),
      source=COALESCE(?,source), updated_at=? WHERE id=?`)
      .run(b.slug ?? null, b.geometry ? JSON.stringify(b.geometry) : null, start, end,
        b.administrativeArea ?? null, b.source ?? null, now, id);
    if (b.translations) saveZoneTranslations(id, translationsObject(b, ['name', 'reason']));
    bumpVersion(db); // Boundary change invalidates map, text, print card and export together.
    res.json({ ok: true, releaseId: `r${currentPublicVersion()}` });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.delete('/api/admin/restriction-zones/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM restriction_zones WHERE id=?').run(Number(req.params.id));
  bumpVersion(db);
  res.json({ ok: true, releaseId: `r${currentPublicVersion()}` });
});

function currentPublicVersion() {
  return db.prepare('SELECT version FROM content_versions WHERE version_key=?').get(RELEASE_VERSION_KEY).version;
}

app.get('/api/admin/observation-records', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id,species_id,point_id,observed_at,exact_geometry,public_geometry,review_status FROM bird_reports ORDER BY id').all()
    .map((r) => ({ ...r, exactGeometry: r.exact_geometry ? JSON.parse(r.exact_geometry) : null, publicGeometry: r.public_geometry ? JSON.parse(r.public_geometry) : null })));
});

app.post('/api/admin/bird-reports/:id/correct-species', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const report = db.prepare('SELECT * FROM bird_reports WHERE id=?').get(id);
  if (!report) return res.status(404).json({ error: 'Bird report not found' });
  let species;
  if (req.body.speciesSlug) species = db.prepare('SELECT * FROM species WHERE slug=?').get(req.body.speciesSlug);
  else if (req.body.acceptedSpeciesId) species = db.prepare('SELECT * FROM species WHERE id=?').get(Number(req.body.acceptedSpeciesId));
  else {
    const lang = SUPPORTED_LANGS.includes(req.body.lang) ? req.body.lang : 'zh';
    const matches = db.prepare(`SELECT s.* FROM species s
      JOIN species_translations st ON st.species_id=s.id WHERE st.lang=? AND st.common_name=?`).all(lang, req.body.commonName);
    if (matches.length > 1) return res.status(409).json({ error: 'Ambiguous same common-name record; use scientific name/slug', candidates: matches.map((s) => ({ id: s.id, slug: s.slug, scientificName: s.scientific_name })) });
    species = matches[0];
  }
  if (!species) return res.status(404).json({ error: 'Accepted species not found' });
  const now = new Date().toISOString();
  db.prepare('UPDATE bird_reports SET species_id=?, original_label=COALESCE(?,original_label), review_status=?, updated_at=? WHERE id=?')
    .run(species.id, req.body.oldLabel ?? null, 'corrected', now, id);
  db.prepare('INSERT INTO taxon_corrections(old_label,lang,accepted_species_id,bird_report_id,basis,created_at) VALUES (?,?,?,?,?,?)')
    .run(req.body.oldLabel || report.original_label || '', req.body.lang || 'zh', species.id, id, req.body.basis || 'admin taxonomic correction', now);
  bumpVersion(db);
  res.json({ ok: true, speciesId: species.id, releaseId: `r${currentPublicVersion()}` });
});

app.post('/api/admin/images', requireAdmin, (req, res) => {
  try {
    const b = req.body;
    const report = b.birdReportId ? db.prepare('SELECT id FROM bird_reports WHERE id=?').get(Number(b.birdReportId)) : null;
    if (b.birdReportId && !report) return res.status(404).json({ error: 'Report not found' });
    if (!b.url) return res.status(400).json({ error: 'url is required' });
    const now = new Date().toISOString();
    // Even admins cannot accidentally preserve GPS; only a small non-location metadata allowlist is stored.
    const safeMetadata = { camera: b.metadata?.camera || '', exposure: b.metadata?.exposure || '', gps: 'removed' };
    const info = db.prepare(`INSERT INTO observation_images(bird_report_id,url,gps_stripped,sanitized_metadata,created_at)
      VALUES (?,?,?,?,?)`).run(b.birdReportId || null, b.url, 1, JSON.stringify(safeMetadata), now);
    const imageId = Number(info.lastInsertRowid);
    for (const lang of ['zh', 'en']) {
      db.prepare('INSERT INTO observation_image_translations(image_id,lang,caption,alt_text) VALUES (?,?,?,?)')
        .run(imageId, lang, b.translations?.[lang]?.caption || '', b.translations?.[lang]?.altText || '');
    }
    for (const speciesId of b.speciesIds || []) db.prepare('INSERT OR IGNORE INTO observation_image_species(image_id,species_id) VALUES (?,?)').run(imageId, Number(speciesId));
    bumpVersion(db);
    res.status(201).json({ id: imageId, releaseId: `r${currentPublicVersion()}` });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/admin/events/:id/reschedule', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const event = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const start = normalizeIso(req.body.startAt, 'startAt');
    const end = normalizeIso(req.body.endAt, 'endAt');
    if (Date.parse(end) <= Date.parse(start)) return res.status(400).json({ error: 'endAt must be after startAt' });
    const now = new Date().toISOString();
    db.prepare('INSERT INTO event_schedule_history(event_id,old_start_at,old_end_at,reason,changed_at) VALUES (?,?,?,?,?)')
      .run(id, event.start_at, event.end_at, req.body.reason || 'rescheduled', now);
    db.prepare('UPDATE events SET start_at=?, end_at=?, status=?, updated_at=? WHERE id=?')
      .run(start, end, 'rescheduled', now, id);
    bumpVersion(db);
    res.json({ ok: true, releaseId: `r${currentPublicVersion()}` });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`Wetland festival running on http://localhost:${PORT}`));
}
export { app, db };
