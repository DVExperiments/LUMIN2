/**
 * Approximate solar geometry (NOAA simplified algorithm, accurate to well under a degree).
 * Used to derive day/night for archival data, the simulated environment and the laboratory,
 * and to place the light source that shades the organism's membrane.
 */
const RAD = Math.PI / 180;

function solarParams(time: number) {
  const jd = time / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const epsilon = (23.439 - 0.0000004 * n) * RAD;
  const decl = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  return { decl, ra, gmst };
}

/** Solar elevation in degrees for a time and place. */
export function solarElevation(time: number, lat: number, lon: number): number {
  const { decl, ra, gmst } = solarParams(time);
  const lst = (gmst * 15 + lon) * RAD;
  const ha = lst - ra;
  const phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha));
  return el / RAD;
}

/** Solar azimuth in degrees clockwise from north. */
export function solarAzimuth(time: number, lat: number, lon: number): number {
  const { decl, ra, gmst } = solarParams(time);
  const lst = (gmst * 15 + lon) * RAD;
  const ha = lst - ra;
  const phi = lat * RAD;
  const az = Math.atan2(-Math.sin(ha), Math.tan(decl) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return ((az / RAD) + 360) % 360;
}

/**
 * Map elevation to a 0..1 "daylight" amount with soft civil twilight
 * (0 below −8°, 1 above +10°).
 */
export function daylightFromElevation(elevationDeg: number): number {
  const t = Math.min(1, Math.max(0, (elevationDeg + 8) / 18));
  return t * t * (3 - 2 * t);
}
