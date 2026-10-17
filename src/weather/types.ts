/** Shared weather data types. All times are UTC milliseconds since the epoch. */

export interface GeoLocation {
  /** Stable identifier, derived from rounded coordinates. */
  id: string;
  name: string;
  region?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  /** How the location was chosen, shown to the user for transparency. */
  origin: 'search' | 'geolocation' | 'timezone-guess' | 'import';
}

/** One validated hour of weather. Compact field names keep stored history small. */
export interface HourRecord {
  /** Start of the hour, UTC ms. */
  t: number;
  /** Temperature, °C. */
  T: number;
  /** Wind speed at 10 m, km/h. */
  W: number;
  /** Wind direction the wind blows FROM, degrees. */
  D: number;
  /** Precipitation over the hour, mm. */
  P: number;
  /** Relative humidity, %. */
  H: number;
  /** Cloud cover, %. */
  C: number;
  /** WMO weather code (0 if unknown). */
  c: number;
  /** 1 if the sun is up. */
  d: 0 | 1;
  /** Location id this hour was observed at. */
  l: string;
}

/** Instantaneous conditions used for immediate reactions. */
export interface Conditions {
  time: number;
  temperature: number;
  windSpeed: number;
  windDirection: number;
  precipitation: number;
  humidity: number;
  cloudCover: number;
  weatherCode: number;
  isDay: boolean;
  sunrise: number | null;
  sunset: number | null;
}

/**
 * Where the conditions on screen came from.
 *  - live: fetched successfully within the freshness window
 *  - cached: last successful fetch is older than the freshness window (shown with its age)
 *  - simulated: no real data at all; a clearly labelled stand-in environment
 *  - laboratory: user-controlled experimental conditions
 */
export type ConditionSource = 'live' | 'cached' | 'simulated' | 'laboratory';

export interface ForecastResult {
  current: Conditions;
  /** Completed past hours, validated, oldest first. */
  hours: HourRecord[];
  fetchedAt: number;
  rejected: number;
}
