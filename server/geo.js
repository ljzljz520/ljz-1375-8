// 纯几何判定：点是否落在多边形（支持外环+洞、多多边形）。
// 坐标统一为 [lng, lat]（GeoJSON 序）。边界上的点按“在区内”从严处理。
// 可见性只允许依据实际几何关系，禁止用行政名称匹配（见 siteVisibility）。

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
    // 落在线段上（含边界）按在区内处理
    if (onSegment([x, y], [xi, yi], [xj, yj])) return true;
  }
  return inside;
}

function onSegment(p, a, b) {
  const cross =
    (p[1] - a[1]) * (b[0] - a[0]) - (p[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(cross) > 1e-9) return false;
  return (
    Math.min(a[0], b[0]) - 1e-12 <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + 1e-12 &&
    Math.min(a[1], b[1]) - 1e-12 <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + 1e-12
  );
}

function ringBBox(ring) {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function pointInPolygon(point, rings) {
  if (!rings || rings.length === 0) return false;
  const [exterior, ...holes] = rings;
  if (exterior.length < 3) return false;
  const [minX, minY, maxX, maxY] = ringBBox(exterior);
  if (point[0] < minX || point[0] > maxX || point[1] < minY || point[1] > maxY)
    return false;
  if (!pointInRing(point, exterior)) return false;
  return !holes.some((h) => h.length >= 3 && pointInRing(point, h));
}

export function pointInZones(point, zones) {
  for (const z of zones) {
    for (const rings of z.polygons || []) {
      if (pointInPolygon(point, rings)) return z;
    }
  }
  return null;
}

// 空间有效区间：[valid_from, valid_to)；null 端点开区间。
export function isZoneActive(zone, now = Date.now()) {
  const t = typeof now === 'number' ? now : Date.parse(now);
  if (zone.valid_from && Date.parse(zone.valid_from) > t) return false;
  if (zone.valid_to && Date.parse(zone.valid_to) <= t) return false;
  return true;
}

export function activeZones(zones, now = Date.now()) {
  return zones.filter((z) => isZoneActive(z, now));
}

// 降精度公开点：保留约 1km 网格（2 位小数），绝不等于精坐标。
export function coarsePoint(lat, lng) {
  if (lat == null || lng == null) return { lat: null, lng: null };
  return {
    lat: Math.round(lat * 100) / 100,
    lng: Math.round(lng * 100) / 100,
  };
}
