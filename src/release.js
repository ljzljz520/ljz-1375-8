import { currentVersion, RELEASE_VERSION_KEY } from './db.js';
import { parseGeometry, pointIsBlocked } from './geometry.js';

export const SUPPORTED_LANGS = ['zh', 'en'];
const MISSING = (label, lang) => `〔待补信息：${label}（${lang}） / Pending translation: ${label} (${lang})〕`;

function valueOrMissing(map, id, field, lang, label) {
  const row = map.get(`${id}:${lang}`);
  const value = row?.[field];
  if (value === undefined || value === null || String(value).trim() === '') return MISSING(label, lang);
  return value;
}

function loadMap(db, sql) {
  return new Map(db.prepare(sql).all().map((row) => [`${row.id}:${row.lang}`, row]));
}

function activeAt(start, end, atMs) {
  const s = Date.parse(start);
  const e = Date.parse(end);
  return s <= atMs && atMs < e;
}

function localCrossesDay(start, end, offsetMinutes) {
  const shift = offsetMinutes * 60_000;
  const sd = new Date(Date.parse(start) + shift);
  const ed = new Date(Date.parse(end) + shift);
  return sd.getUTCDate() !== ed.getUTCDate() ||
    sd.getUTCMonth() !== ed.getUTCMonth() ||
    sd.getUTCFullYear() !== ed.getUTCFullYear();
}

export function buildRelease(db, { lang = 'zh', at = new Date() } = {}) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = 'zh';
  const atMs = at.getTime();
  const version = currentVersion(db, RELEASE_VERSION_KEY);

  const categoryT = loadMap(db, `SELECT category_id AS id, lang, name FROM category_translations`);
  const pointT = loadMap(db, `SELECT point_id AS id, lang, name, description, access_note AS accessNote FROM observation_point_translations`);
  const speciesT = loadMap(db, `SELECT species_id AS id, lang, common_name AS commonName, description FROM species_translations`);
  const reportT = loadMap(db, `SELECT report_id AS id, lang, summary FROM bird_report_translations`);
  const eventT = loadMap(db, `SELECT event_id AS id, lang, title, description FROM event_translations`);
  const imageT = loadMap(db, `SELECT image_id AS id, lang, caption, alt_text AS altText FROM observation_image_translations`);
  const zoneT = loadMap(db, `SELECT zone_id AS id, lang, name, reason FROM restriction_zone_translations`);
  const announcementT = loadMap(db, `SELECT announcement_id AS id, lang, title, body FROM announcement_translations`);

  const zones = db.prepare(`SELECT * FROM restriction_zones ORDER BY effective_start`).all()
    .filter((zone) => activeAt(zone.effective_start, zone.effective_end, atMs));
  const zoneGeometries = zones.map((zone) => zone.geometry);

  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order,id').all().map((row) => ({
    id: row.id,
    key: row.key,
    name: valueOrMissing(categoryT, row.id, 'name', lang, 'category.name')
  }));

  const allPoints = db.prepare('SELECT * FROM observation_points ORDER BY id').all();
  const visibilityById = new Map();
  const points = [];
  for (const point of allPoints) {
    // Real-time geometric filtering: a fixed public point remains hidden whenever it lies in/on an active zone.
    const visible = Boolean(point.public_geometry) && !pointIsBlocked(point.public_geometry, zoneGeometries);
    visibilityById.set(point.id, visible);
    if (!visible) continue;
    points.push({
      id: point.id,
      slug: point.slug,
      categoryId: point.category_id,
      name: valueOrMissing(pointT, point.id, 'name', lang, 'point.name'),
      description: valueOrMissing(pointT, point.id, 'description', lang, 'point.description'),
      accessNote: valueOrMissing(pointT, point.id, 'accessNote', lang, 'point.accessNote'),
      geometry: parseGeometry(point.public_geometry)
    });
  }

  const speciesRows = db.prepare('SELECT * FROM species ORDER BY scientific_name').all();
  const speciesById = new Map();
  const species = speciesRows.map((row) => {
    const item = {
      id: row.id,
      slug: row.slug,
      scientificName: row.scientific_name,
      commonName: valueOrMissing(speciesT, row.id, 'commonName', lang, 'species.commonName'),
      description: valueOrMissing(speciesT, row.id, 'description', lang, 'species.description')
    };
    speciesById.set(row.id, item);
    return item;
  });

  const images = db.prepare('SELECT * FROM observation_images ORDER BY id').all().map((image) => {
    let sanitizedMetadata = {};
    try { sanitizedMetadata = JSON.parse(image.sanitized_metadata || '{}'); } catch { sanitizedMetadata = {}; }
    // Whitelist avoids accidental GPS/EXIF regrowth from future columns.
    const metadata = {
      camera: sanitizedMetadata.camera || '',
      exposure: sanitizedMetadata.exposure || '',
      locationStatus: 'gps-removed'
    };
    return {
      id: image.id,
      url: image.url,
      caption: valueOrMissing(imageT, image.id, 'caption', lang, 'image.caption'),
      altText: valueOrMissing(imageT, image.id, 'altText', lang, 'image.altText'),
      metadata,
      gpsStripped: Boolean(image.gps_stripped),
      speciesIds: db.prepare('SELECT species_id FROM observation_image_species WHERE image_id=? ORDER BY species_id')
        .all(image.id).map((row) => row.species_id)
    };
  });
  for (const image of images) {
    image.species = image.speciesIds.map((id) => speciesById.get(id)).filter(Boolean);
    delete image.speciesIds;
  }

  const reports = db.prepare(`SELECT br.* FROM bird_reports br ORDER BY br.observed_at DESC`).all().map((report) => {
    const point = report.point_id ? allPoints.find((p) => p.id === report.point_id) : null;
    const pointVisible = point ? visibilityById.get(point.id) : false;
    const publicGeometry = parseGeometry(report.public_geometry);
    // Exact observation geometry is never returned. Even separately stored public geometry is rechecked.
    const publicGeometryVisible = publicGeometry &&
      !pointIsBlocked(publicGeometry, zoneGeometries);
    const correction = db.prepare(`SELECT * FROM taxon_corrections WHERE bird_report_id=? ORDER BY id DESC LIMIT 1`).get(report.id);
    return {
      id: report.id,
      speciesId: report.species_id,
      species: speciesById.get(report.species_id) || null,
      observedAt: report.observed_at,
      summary: valueOrMissing(reportT, report.id, 'summary', lang, 'report.summary'),
      source: { title: report.source_title, url: report.source_url || null, kind: 'source-material-only' },
      originalLabel: report.original_label || null,
      correction: correction ? {
        oldLabel: correction.old_label,
        acceptedSpeciesId: correction.accepted_species_id,
        basis: correction.basis
      } : null,
      location: pointVisible ? {
        type: 'public-point',
        pointId: point.id,
        pointSlug: point.slug,
        geometry: parseGeometry(point.public_geometry),
        coordinates: publicGeometryVisible ? publicGeometry.coordinates : undefined
      } : {
        type: 'withheld',
        broadArea: point?.administrative_area || null,
        reason: report.point_id ? 'active-restriction-or-sensitive-habitat' : 'exact-observation-not-public',
        // Deliberately no pointId and no coordinates: another language cannot resolve a hidden point.
      }
    };
  });

  const events = db.prepare('SELECT * FROM events ORDER BY start_at').all()
    .filter((event) => !event.location_point_id || visibilityById.get(event.location_point_id) === true)
    .map((event) => {
      const latestHistory = db.prepare(`SELECT * FROM event_schedule_history WHERE event_id=? ORDER BY changed_at DESC LIMIT 1`).get(event.id);
      return {
        id: event.id,
        slug: event.slug,
        categoryKey: event.category_key,
        title: valueOrMissing(eventT, event.id, 'title', lang, 'event.title'),
        description: valueOrMissing(eventT, event.id, 'description', lang, 'event.description'),
        startAt: event.start_at,
        endAt: event.end_at,
        timezoneOffsetMinutes: event.timezone_offset_minutes,
        status: event.status,
        rescheduled: event.status === 'rescheduled',
        previousSchedule: latestHistory ? {
          startAt: latestHistory.old_start_at,
          endAt: latestHistory.old_end_at,
          reason: latestHistory.reason
        } : null,
        locationPointId: event.location_point_id
      };
    });

  const tides = db.prepare('SELECT * FROM tides ORDER BY start_at').all().map((tide) => ({
    id: tide.id,
    locationSlug: tide.location_slug,
    startAt: tide.start_at,
    endAt: tide.end_at,
    timezoneOffsetMinutes: tide.timezone_offset_minutes,
    crossesLocalMidnight: localCrossesDay(tide.start_at, tide.end_at, tide.timezone_offset_minutes),
    tideType: tide.tide_type,
    source: { title: tide.source_title, url: tide.source_url || null, kind: 'source-material-only' }
  }));

  const announcements = db.prepare('SELECT * FROM announcements ORDER BY valid_start DESC').all()
    .filter((row) => activeAt(row.valid_start, row.valid_end, atMs))
    .map((row) => ({
      id: row.id,
      categoryId: row.category_id,
      severity: row.severity,
      title: valueOrMissing(announcementT, row.id, 'title', lang, 'announcement.title'),
      body: valueOrMissing(announcementT, row.id, 'body', lang, 'announcement.body'),
      validStart: row.valid_start,
      validEnd: row.valid_end
    }));

  const activeRestrictionNotices = zones.map((zone) => ({
    id: zone.id,
    slug: zone.slug,
    name: valueOrMissing(zoneT, zone.id, 'name', lang, 'restriction.name'),
    reason: valueOrMissing(zoneT, zone.id, 'reason', lang, 'restriction.reason'),
    broadArea: zone.administrative_area,
    effectiveStart: zone.effective_start,
    effectiveEnd: zone.effective_end,
    receivedAt: zone.received_at,
    // Polygon is deliberately absent from public release.
  }));

  return {
    lang,
    generatedAt: new Date().toISOString(),
    evaluatedAt: at.toISOString(),
    release: {
      id: `r${version.version}`,
      version: version.version,
      changedAt: version.changedAt,
      channel: 'map+text+print+export',
      filtering: 'fixed-public-points-recomputed-against-active-restriction-geometries'
    },
    categories,
    announcements,
    activeRestrictionNotices,
    points,
    species,
    images,
    birdReports: reports,
    events,
    tides,
    disclaimers: {
      birds: lang === 'zh'
        ? '鸟讯只是来源材料，不保证一定见鸟，也不构成进入任何区域的许可。'
        : 'Bird reports are source material only. They neither guarantee a sighting nor authorize access.',
      tides: lang === 'zh'
        ? '潮汐仅为来源材料；潮时可能修订，跨日窗口须以官方公告和现场指引为准。'
        : 'Tides are source material only. Times may change; cross-midnight windows are subject to official notices and on-site guidance.'
    }
  };
}

export function releaseEtag(release) {
  // Same content version across all channels; language is part of the negotiated representation only.
  return `"festival-v${release.release.version}-${release.lang}"`;
}
