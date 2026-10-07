import Database from 'better-sqlite3';

export const RELEASE_VERSION_KEY = 'festival-release';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS content_versions (
  version_key TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS category_translations (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (category_id, lang)
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  valid_start TEXT NOT NULL,
  valid_end TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS announcement_translations (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (announcement_id, lang)
);

CREATE TABLE IF NOT EXISTS species (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  scientific_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS species_translations (
  species_id INTEGER NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  common_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (species_id, lang)
);
CREATE TABLE IF NOT EXISTS taxon_corrections (
  id INTEGER PRIMARY KEY,
  old_label TEXT NOT NULL,
  lang TEXT NOT NULL,
  accepted_species_id INTEGER NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  bird_report_id INTEGER,
  basis TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observation_points (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  -- 可公开几何与敏感精确几何物理上分开。公开响应永远只能读取前者。
  public_geometry TEXT,
  sensitive_geometry TEXT,
  is_sensitive INTEGER NOT NULL DEFAULT 0,
  administrative_area TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS observation_point_translations (
  point_id INTEGER NOT NULL REFERENCES observation_points(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  access_note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (point_id, lang)
);

CREATE TABLE IF NOT EXISTS bird_reports (
  id INTEGER PRIMARY KEY,
  species_id INTEGER NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  point_id INTEGER REFERENCES observation_points(id) ON DELETE SET NULL,
  observed_at TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_url TEXT,
  original_label TEXT,
  review_status TEXT NOT NULL DEFAULT 'source-material',
  exact_geometry TEXT,
  public_geometry TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bird_report_translations (
  report_id INTEGER NOT NULL REFERENCES bird_reports(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  summary TEXT NOT NULL,
  PRIMARY KEY (report_id, lang)
);

CREATE TABLE IF NOT EXISTS observation_images (
  id INTEGER PRIMARY KEY,
  bird_report_id INTEGER REFERENCES bird_reports(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  gps_stripped INTEGER NOT NULL DEFAULT 1,
  sanitized_metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS observation_image_translations (
  image_id INTEGER NOT NULL REFERENCES observation_images(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  alt_text TEXT NOT NULL,
  PRIMARY KEY (image_id, lang)
);
CREATE TABLE IF NOT EXISTS observation_image_species (
  image_id INTEGER NOT NULL REFERENCES observation_images(id) ON DELETE CASCADE,
  species_id INTEGER NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  PRIMARY KEY (image_id, species_id)
);

CREATE TABLE IF NOT EXISTS restriction_zones (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  geometry TEXT NOT NULL,
  effective_start TEXT NOT NULL,
  effective_end TEXT NOT NULL,
  administrative_area TEXT,
  source TEXT NOT NULL DEFAULT 'management',
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS restriction_zone_translations (
  zone_id INTEGER NOT NULL REFERENCES restriction_zones(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  name TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (zone_id, lang)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  category_key TEXT NOT NULL CHECK (category_key IN ('ritual','family')),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  timezone_offset_minutes INTEGER NOT NULL DEFAULT 480,
  status TEXT NOT NULL DEFAULT 'scheduled',
  location_point_id INTEGER REFERENCES observation_points(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS event_translations (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (event_id, lang)
);
CREATE TABLE IF NOT EXISTS event_schedule_history (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  old_start_at TEXT NOT NULL,
  old_end_at TEXT NOT NULL,
  reason TEXT,
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tides (
  id INTEGER PRIMARY KEY,
  location_slug TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  tide_type TEXT NOT NULL,
  timezone_offset_minutes INTEGER NOT NULL DEFAULT 480,
  source_title TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_restriction_interval ON restriction_zones(effective_start, effective_end);
`;

export function openDb(filename = process.env.DB_PATH || 'data/festival.db') {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function currentVersion(db, key = RELEASE_VERSION_KEY) {
  const row = db.prepare('SELECT version, changed_at FROM content_versions WHERE version_key=?').get(key);
  return row ? { version: row.version, changedAt: row.changed_at } : { version: 0, changedAt: null };
}

export function bumpVersion(db, key = RELEASE_VERSION_KEY) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO content_versions(version_key, version, changed_at)
    VALUES (?, 1, ?)
    ON CONFLICT(version_key) DO UPDATE SET version=version+1, changed_at=excluded.changed_at
  `).run(key, now);
  return currentVersion(db, key);
}

export function seedDb(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (count > 0) return false;
  const now = new Date().toISOString();
  const iso = (value) => new Date(value).toISOString();
  const tx = db.transaction(() => {
    const cat = db.prepare('INSERT INTO categories(key,sort_order) VALUES (?,?)');
    const catT = db.prepare('INSERT INTO category_translations(category_id,lang,name) VALUES (?,?,?)');
    const addCategory = (key, order, zh, en) => {
      const id = Number(cat.run(key, order).lastInsertRowid);
      catT.run(id, 'zh', zh); catT.run(id, 'en', en);
      return id;
    };
    const birdCat = addCategory('bird', 1, '鸟类', 'Birds');
    const ritualCat = addCategory('ritual', 2, '仪式', 'Rituals');
    const familyCat = addCategory('family', 3, '亲子活动', 'Family activities');
    addCategory('access', 4, '通行与保护', 'Access and conservation');

    const ann = db.prepare(`INSERT INTO announcements(category_id,severity,valid_start,valid_end,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`);
    const annT = db.prepare('INSERT INTO announcement_translations(announcement_id,lang,title,body) VALUES (?,?,?,?)');
    const addAnnouncement = (categoryId, severity, start, end, zh, en) => {
      const id = Number(ann.run(categoryId, severity, iso(start), iso(end), now, now).lastInsertRowid);
      annT.run(id, 'zh', zh.title, zh.body);
      annT.run(id, 'en', en.title, en.body);
      return id;
    };
    addAnnouncement(birdCat, 'source', '2026-09-01T00:00+08:00', '2027-03-01T00:00+08:00',
      { title: '鸟讯仅为来源材料', body: '鸟讯来自志愿者和游客上报，不表示活动期间一定能看到该鸟；也不代表所述地点可以进入。' },
      { title: 'Bird reports are source material only', body: 'Reports come from volunteers and visitors. They do not guarantee a sighting or permit access to any location.' });
    addAnnouncement(familyCat, 'info', '2026-09-01T00:00+08:00', '2027-03-01T00:00+08:00',
      { title: '亲子集合请以当日公告为准', body: '潮汐窗口可能跨日，活动若改期将通过公告和现场标识通知。' },
      { title: 'Check the daily notice before family meetings', body: 'Tide windows may cross midnight. Reschedules are published in notices and on-site signs.' });

    const sp = db.prepare('INSERT INTO species(slug,scientific_name,created_at) VALUES (?,?,?)');
    const spT = db.prepare('INSERT INTO species_translations(species_id,lang,common_name,description) VALUES (?,?,?,?)');
    const addSpecies = (slug, scientific, zh, en, zhDesc, enDesc) => {
      const id = Number(sp.run(slug, scientific, now).lastInsertRowid);
      spT.run(id, 'zh', zh, zhDesc);
      spT.run(id, 'en', en, enDesc);
      return id;
    };
    const gull = addSpecies('saunders-gull', 'Saundersilarus saundersi', '黑嘴鸥', "Saunders's Gull",
      '依赖潮间带和盐沼，越冬期对干扰敏感。', 'Depends on tidal flats and saltmarshes; sensitive to disturbance in winter.');
    const egret = addSpecies('little-egret', 'Egretta garzetta', '小白鹭', 'Little Egret',
      '常见于浅滩和河口，黑色喙、黑腿。', 'Uses shoals and estuaries; black bill and black legs.');
    const kingfisher = addSpecies('common-kingfisher', 'Alcedo atthis', '普通翠鸟', 'Common Kingfisher',
      '在水道边停栖，迅速俯冲入水。', 'Perches by waterways and dives quickly for fish.');
    const warbler = addSpecies('oriental-reed-warbler', 'Acrocephalus orientalis', '东方大苇莺', 'Oriental Reed Warbler',
      '体型较大、眉纹较淡，繁殖期鸣唱响亮。', 'Large warbler with a pale supercilium and loud breeding song.');

    const point = db.prepare(`INSERT INTO observation_points
      (slug,category_id,public_geometry,sensitive_geometry,is_sensitive,administrative_area,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    const pointT = db.prepare('INSERT INTO observation_point_translations(point_id,lang,name,description,access_note) VALUES (?,?,?,?,?)');
    const corePolygon = {
      type: 'Polygon',
      coordinates: [[[120.100,32.100],[120.200,32.100],[120.200,32.200],[120.100,32.200],[120.100,32.100]]]
    };
    const p1 = Number(point.run('core-boardwalk', birdCat,
      JSON.stringify({ type: 'Point', coordinates: [120.140, 32.140] }),
      JSON.stringify({ type: 'Point', coordinates: [120.1412, 32.1423] }),
      1, '东滩', now, now).lastInsertRowid);
    pointT.run(p1, 'zh', '核心区木栈道（限制中）', '繁殖/栖息敏感点，当前不公开精确位置。', '限行');
    pointT.run(p1, 'en', 'Core boardwalk (restricted)', 'Sensitive breeding and roosting site; exact location is withheld.', 'No access');
    const p2 = Number(point.run('east-tidal-trail', birdCat,
      JSON.stringify({ type: 'Point', coordinates: [120.310, 32.150] }),
      JSON.stringify({ type: 'Point', coordinates: [120.3114, 32.1517] }),
      0, '东滩', now, now).lastInsertRowid);
    pointT.run(p2, 'zh', '东滩访客小径', '固定公开观测点，仍会在每次请求时按当前限制区计算。', '开放步道');
    pointT.run(p2, 'en', 'East Tidal Public Trail', 'A fixed public point, but visibility is recalculated from active restrictions on every request.', 'Open trail');
    const p3 = Number(point.run('north-boundary-marker', birdCat,
      JSON.stringify({ type: 'Point', coordinates: [120.200, 32.150] }),
      JSON.stringify({ type: 'Point', coordinates: [120.2001, 32.1501] }),
      1, '东滩', now, now).lastInsertRowid);
    pointT.run(p3, 'zh', '北界桩（边界点）', '位于限制区边界上，按保守原则不公开。', '边界管控');
    pointT.run(p3, 'en', 'North boundary marker', 'On the restriction boundary and withheld under the conservative rule.', 'Boundary control');

    const zone = db.prepare(`INSERT INTO restriction_zones
      (slug,geometry,effective_start,effective_end,administrative_area,source,received_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    const zoneT = db.prepare('INSERT INTO restriction_zone_translations(zone_id,lang,name,reason) VALUES (?,?,?,?)');
    const z1 = Number(zone.run('east-core-habitat', JSON.stringify(corePolygon),
      iso('2026-09-01T00:00+08:00'), iso('2027-03-01T00:00+08:00'),
      '东滩', 'wetland-authority-2026-09', iso('2026-08-25T10:00+08:00'), now, now).lastInsertRowid);
    zoneT.run(z1, 'zh', '东滩核心栖息地区', '候鸟繁殖与夜栖保护，禁止离栈进入。');
    zoneT.run(z1, 'en', 'East Core Habitat Zone', 'Breeding and roosting habitat; no off-boardwalk access.');

    const report = db.prepare(`INSERT INTO bird_reports
      (species_id,point_id,observed_at,source_title,source_url,original_label,review_status,exact_geometry,public_geometry,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const reportT = db.prepare('INSERT INTO bird_report_translations(report_id,lang,summary) VALUES (?,?,?)');
    const r1 = Number(report.run(gull, p1, iso('2026-10-05T07:20+08:00'),
      '志愿者鸟讯汇总', 'https://example.test/bird-reports/oct-05', null,
      'source-material', JSON.stringify({ type:'Point', coordinates:[120.1418,32.1419] }), null, now, now).lastInsertRowid);
    reportT.run(r1, 'zh', '东滩河口一带曾有黑嘴鸥记录，精确点位不公开。');
    reportT.run(r1, 'en', 'A Saunders’s Gull was reported around the broad estuary; exact coordinates are withheld.');
    const r2 = Number(report.run(egret, p2, iso('2026-10-06T08:10+08:00'),
      '访客步道观察岗', 'https://example.test/bird-reports/oct-06', null,
      'source-material', JSON.stringify({ type:'Point', coordinates:[120.3114,32.1517] }),
      JSON.stringify({ type:'Point', coordinates:[120.310,32.150] }), now, now).lastInsertRowid);
    reportT.run(r2, 'zh', '公开步道附近有小白鹭活动记录。');
    reportT.run(r2, 'en', 'Little Egret activity was recorded near the public trail.');
    const r3 = Number(report.run(warbler, null, iso('2026-10-04T09:30+08:00'),
      '旧版同名物种记录', null, '苇莺',
      'corrected', JSON.stringify({ type:'Point', coordinates:[120.159,32.162] }), null, now, now).lastInsertRowid);
    reportT.run(r3, 'zh', '旧称“苇莺”，已按鸣声和体型订正为东方大苇莺。');
    reportT.run(r3, 'en', 'The old ambiguous label “warbler” was corrected to Oriental Reed Warbler by song and size.');
    db.prepare(`INSERT INTO taxon_corrections(old_label,lang,accepted_species_id,bird_report_id,basis,created_at)
      VALUES (?,?,?,?,?,?)`).run('苇莺', 'zh', warbler, r3, '同名俗名记录；依据体型、眉纹和鸣唱订正', now);

    const img = db.prepare(`INSERT INTO observation_images(bird_report_id,url,gps_stripped,sanitized_metadata,created_at)
      VALUES (?,?,?,?,?)`);
    const imgT = db.prepare('INSERT INTO observation_image_translations(image_id,lang,caption,alt_text) VALUES (?,?,?,?)');
    const imgSpecies = db.prepare('INSERT OR IGNORE INTO observation_image_species(image_id,species_id) VALUES (?,?)');
    const i1 = Number(img.run(r2, '/uploads/mixed-birds.svg', 1,
      JSON.stringify({ camera: 'Trail Cam A', exposure: '1/500', gps: 'removed' }), now).lastInsertRowid);
    imgT.run(i1, 'zh', '同一张图包含小白鹭与普通翠鸟，EXIF 定位已剥离。', '小白鹭和普通翠鸟同框');
    imgT.run(i1, 'en', 'One image contains both Little Egret and Common Kingfisher; EXIF location has been removed.', 'Little Egret and Common Kingfisher together');
    imgSpecies.run(i1, egret); imgSpecies.run(i1, kingfisher);

    const event = db.prepare(`INSERT INTO events
      (slug,category_key,start_at,end_at,timezone_offset_minutes,status,location_point_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    const eventT = db.prepare('INSERT INTO event_translations(event_id,lang,title,description) VALUES (?,?,?,?)');
    const addEvent = (slug, category, start, end, pointId, zhTitle, zhDesc, enTitle, enDesc, includeEnDesc = true) => {
      const id = Number(event.run(slug, category, iso(start), iso(end), 480, 'scheduled', pointId, now, now).lastInsertRowid);
      eventT.run(id, 'zh', zhTitle, zhDesc);
      if (includeEnDesc) eventT.run(id, 'en', enTitle, enDesc);
      else eventT.run(id, 'en', enTitle, '');
      return id;
    };
    const ritual1 = addEvent('tide-crane-ceremony', 'ritual',
      '2026-10-10T15:00+08:00', '2026-10-10T16:30+08:00', p2,
      '迎潮鹤祭', '民俗祭祀与鹤舞表演，已因潮时由上午改至下午。',
      'Tide-Welcoming Crane Ceremony', 'Folk ritual and crane dance; moved from morning to afternoon for the tide.');
    db.prepare('UPDATE events SET status=? WHERE id=?').run('rescheduled', ritual1);
    db.prepare(`INSERT INTO event_schedule_history(event_id,old_start_at,old_end_at,reason,changed_at)
      VALUES (?,?,?,?,?)`).run(ritual1, iso('2026-10-10T09:00+08:00'), iso('2026-10-10T10:30+08:00'),
      '潮时延后，避免滩涂裸露不足', iso('2026-09-28T12:00+08:00'));
    addEvent('family-bird-footprints', 'family',
      '2026-10-11T10:00+08:00', '2026-10-11T11:30+08:00', p2,
      '小鸟足迹自然课', '沿开放步道辨识鸟迹、潮沟和盐生植物。',
      'Little Bird Footprints Class', 'Identify tracks, tidal creeks and saltmarsh plants along the open trail.', false);
    const family2 = addEvent('mudflat-treasure-hunt', 'family',
      '2026-10-12T09:00+08:00', '2026-10-12T10:30+08:00', p2,
      '泥滩寻宝', '亲子潮间带观察，已从 10 月 11 日改期。',
      'Mudflat Treasure Hunt', 'Family intertidal observation; rescheduled from 11 October.');
    db.prepare('UPDATE events SET status=? WHERE id=?').run('rescheduled', family2);
    db.prepare(`INSERT INTO event_schedule_history(event_id,old_start_at,old_end_at,reason,changed_at)
      VALUES (?,?,?,?,?)`).run(family2, iso('2026-10-11T13:00+08:00'), iso('2026-10-11T14:30+08:00'),
      '配合跨日低潮窗口和志愿导览力量', iso('2026-09-30T09:00+08:00'));

    db.prepare(`INSERT INTO tides(location_slug,start_at,end_at,tide_type,timezone_offset_minutes,source_title,source_url,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run('east-creek',
      iso('2026-10-10T23:40+08:00'), iso('2026-10-11T00:50+08:00'),
      'low-window', 480, '东海区潮汐预报表（来源材料）', 'https://example.test/tides', now);

    bumpVersion(db);
  });
  tx();
  return true;
}
