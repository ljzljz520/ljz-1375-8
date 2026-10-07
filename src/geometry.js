// GeoJSON spatial checks used for actual geometry rather than administrative-name matching.
const EPS = 1e-9;

export function parseGeometry(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return structuredClone(value);
  return JSON.parse(value);
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  let onBoundary = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || EPS) + xi);
    if (intersect) inside = !inside;

    const cross = (x - xi) * (yj - yi) - (y - xi) * (xj - xi);
    const onSegmentBBox = Math.min(xi, xj) - EPS <= x && x <= Math.max(xi, xj) + EPS &&
      Math.min(yi, yj) - EPS <= y && y <= Math.max(yi, yj) + EPS;
    if (Math.abs(cross) <= EPS && onSegmentBBox) onBoundary = true;
  }
  return { inside, onBoundary };
}

export function pointIntersectsPolygon(pointCoordinates, polygon) {
  if (!polygon || polygon.type !== 'Polygon' || !Array.isArray(polygon.coordinates)) return false;
  const [outer, ...holes] = polygon.coordinates;
  const outerCheck = pointInRing(pointCoordinates, outer);
  // Boundary contact is treated as inside a restricted zone (conservative access policy).
  if (!outerCheck.inside && !outerCheck.onBoundary) return false;
  return !holes.some((hole) => pointInRing(pointCoordinates, hole).onBoundary) &&
    !holes.some((hole) => pointInRing(pointCoordinates, hole).inside);
}

export function pointIntersectsGeometry(pointCoordinates, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointIntersectsPolygon(pointCoordinates, geometry);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((rings) => pointIntersectsPolygon(pointCoordinates, { type: 'Polygon', coordinates: rings }));
  }
  return false;
}

export function pointIsBlocked(pointGeometry, restrictionGeometries) {
  const point = parseGeometry(pointGeometry);
  if (!point || point.type !== 'Point' || !Array.isArray(point.coordinates)) return true;
  return restrictionGeometries.some((zoneGeometry) => pointIntersectsGeometry(point.coordinates, parseGeometry(zoneGeometry)));
}
