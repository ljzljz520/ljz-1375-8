// 构建对外内容包（地图、文本、打印卡共用同一包 -> 同版发布）。
// 关键规则：
//  1) 地点可展示性 = 服务端按“实际几何关系 + 当前生效限制区”实时计算；
//     fixed_public 策展白名单不能豁免几何过滤；行政名称不参与判定。
//  2) 精坐标（观测记录 exact_*、图片 EXIF gps_*）只进管理端包；
//     公开包：share_coarse=true 给约 1km 网格，否则无坐标；
//     站点不可见时，记录/图片/活动中的站点身份（名称、区域）一并隐藏。
import { activeZones, pointInZones, coarsePoint } from './geo.js';

export const DISCLAIMERS = {
  birdnews: {
    zh: '鸟讯仅为来源材料（网友报料/日志摘录），不保证一定见鸟，亦不构成进入许可。',
    en: 'Bird news is source material only; sightings are not guaranteed and it grants no right of entry.',
  },
  tides: {
    zh: '潮汐仅为参考来源材料，不保证按窗口见鸟；请以现场管制与官方潮汐表为准。',
    en: 'Tides are reference material only; sightings are not guaranteed. Obey on-site controls and official tables.',
  },
  access: {
    zh: '点位可进入性以现场公告和生效限制区为准；边界调整后旧计划立即失效。',
    en: 'Access is governed by on-site notices and active restriction zones; old plans lapse when boundaries change.',
  },
};

export function visibleSitesMap(db, now) {
  const zones = activeZones(db.all('zones'), now);
  const map = new Map();
  for (const s of db.all('sites')) {
    const hit = pointInZones([s.lng, s.lat], zones);
    map.set(s.id, { visible: !hit, zone: hit ? hit.id : null });
  }
  return map;
}

export function buildPublicPack(db, { now = Date.now() } = {}) {
  const vis = visibleSitesMap(db, now);
  const t = typeof now === 'number' ? now : Date.parse(now);

  const publicSite = (s) => ({
    id: s.id,
    name: s.name,
    region: s.region,
    // 敏感点即使可见也只给降精度公开坐标；普通点给展示坐标
    ...(s.sensitive ? coarsePoint(s.lat, s.lng) : { lat: s.lat, lng: s.lng }),
    sensitive: !!s.sensitive,
    guidance: s.guidance,
    facilities: s.facilities,
  });

  const sites = db
    .all('sites')
    .filter((s) => vis.get(s.id)?.visible)
    .map(publicSite);

  const records = db
    .all('records')
    .map((r) => {
      const siteVisible = vis.get(r.site_id)?.visible;
      const out = {
        id: r.id,
        species_id: r.species_id,
        count: r.count,
        date: r.date,
        note: r.note,
      };
      if (r.share_coarse) {
        // 公开的只是网格位置，与精坐标分离
        Object.assign(out, coarsePoint(r.exact_lat, r.exact_lng), { coord_kind: 'coarse' });
      } else {
        Object.assign(out, { lat: null, lng: null, coord_kind: 'none' });
      }
      if (siteVisible) out.site_id = r.site_id;
      // 站点不可见：不返回 site_id、名称等任何可定位线索
      return out;
    });

  const images = db.all('images').map((im) => {
    const siteVisible = vis.get(im.site_id)?.visible;
    const out = {
      id: im.id,
      caption: im.caption,
      species_ids: im.species_ids || [],
      date: im.date,
      camera: im.camera,
      license: im.license,
      gps: null, // 图片元数据默认不暴露任何坐标
    };
    if (im.share_coarse && im.gps_lat != null) {
      out.gps = { ...coarsePoint(im.gps_lat, im.gps_lng), coord_kind: 'coarse' };
    }
    if (siteVisible) out.site_id = im.site_id;
    return out;
  });

  const events = db.all('events').map((e) => {
    const siteVisible = vis.get(e.site_id)?.visible;
    const out = {
      id: e.id,
      code: e.code,
      category_id: e.category_id,
      title: e.title,
      desc: e.desc,
      date: e.date,
      time: e.time,
      status: e.status,
    };
    if (siteVisible) out.site_id = e.site_id;
    // 历史改期详情仅管理端；公开侧只给当前排期 + 是否改过期标记
    if (e.history && e.history.length) out.rescheduled = true;
    return out;
  });

  const tides = db.all('tides').map((td) => {
    const crossDay =
      td.window_end && td.window_start && td.window_end.date !== td.date;
    return {
      id: td.id,
      date: td.date,
      entries: td.entries,
      window_start: td.window_start,
      window_end: td.window_end,
      cross_day: crossDay, // 跨日潮汐/窗口标记
    };
  });

  const bulletins = db
    .all('bulletins')
    .filter((b) => {
      if (b.valid_from && Date.parse(b.valid_from) > t) return false;
      if (b.valid_to && Date.parse(b.valid_to) <= t) return false;
      return true;
    })
    .map((b) => ({
      id: b.id, title: b.title, body: b.body, level: b.level,
      valid_from: b.valid_from, valid_to: b.valid_to,
    }));

  return {
    ...db.version(),
    categories: db.all('categories'),
    species: db
      .all('species')
      .filter((s) => !s.merged_into)
      .map((s) => ({
        id: s.id, zh: s.zh, en: s.en, scientific: s.scientific,
        category_id: s.category_id, folk_name: s.folk_name, desc: s.desc,
        disambiguated: !!s.disambiguated,
      })),
    sites,
    records,
    images,
    events,
    tides,
    bulletins,
    birdnews: db.all('birdnews').map((n) => ({
      id: n.id, date: n.date, source: n.source, summary: n.summary,
    })),
    disclaimers: DISCLAIMERS,
  };
}

// 管理端包：含隐藏点、精坐标、被合并物种、改期历史与命中的限制区。
export function buildAdminPack(db, { now = Date.now() } = {}) {
  const vis = visibleSitesMap(db, now);
  return {
    ...db.version(),
    now: new Date(typeof now === 'number' ? now : Date.parse(now)).toISOString(),
    zones: db
      .all('zones')
      .map((z) => ({ ...z, active: activeZones([z], now).length === 1 })),
    sites: db.all('sites').map((s) => ({
      ...s,
      visible: vis.get(s.id)?.visible,
      blocked_by_zone: vis.get(s.id)?.zone || null,
    })),
    records: db.all('records'),
    images: db.all('images'),
    events: db.all('events'),
    bulletins: db.all('bulletins'),
    species: db.all('species'),
    categories: db.all('categories'),
    tides: db.all('tides'),
    birdnews: db.all('birdnews'),
  };
}
