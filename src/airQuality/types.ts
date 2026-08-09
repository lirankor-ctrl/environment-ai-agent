/** Official Israeli air-quality status levels (Ministry of Environmental Protection). */
export type OfficialStatus = 'טובה' | 'בינונית' | 'נמוכה' | 'נמוכה מאוד';

export const OFFICIAL_STATUSES: OfficialStatus[] = ['טובה', 'בינונית', 'נמוכה', 'נמוכה מאוד'];

/** A station record as returned by /v1/envista/stations. */
export interface SvivaStation {
  stationId: number;
  name: string;
  shortName?: string;
  city?: string;
  active: boolean;
}

/** One entry of the `data[]` array in /v1/envista/stations/index/latest. */
export interface SvivaIndexEntry {
  stationId: number;
  datetime: string;
  pollutant: string | null;
  index: number | null;
  color: string | null;
  description: string | null; // official status text, when recognized -> OfficialStatus
}

/** Full response shape of /v1/envista/stations/index/latest. */
export interface SvivaIndexLatestResponse {
  // Top-level fields describe the single current worst station network-wide.
  stationId: number;
  datetime: string;
  pollutant: string | null;
  index: number | null;
  description: string | null;
  data: SvivaIndexEntry[];
}

/** Raw per-channel reading from /v1/envista/stations/{id}/data/latest (fallback tier 2). */
export interface SvivaChannelReading {
  id: number;
  name: string;
  alias?: string;
  value: number | null;
  units?: string;
  datetime: string;
}
export interface SvivaStationDataLatest {
  stationId: number;
  data: Array<{ datetime: string; channels: SvivaChannelReading[] }>;
}

/** Air quality for one requested city, resolved to the station actually used. */
export interface CityAirQuality {
  city: string;
  stationName: string;
  measuredAt: string;
  index: number | null;
  status: OfficialStatus | null;
  dominantPollutant: string | null;
  /** True when this came from the degraded tier-2 (raw readings, no official index). */
  degraded?: boolean;
}

export interface WorstStation {
  stationName: string;
  city: string | null;
  status: OfficialStatus | null;
  index: number | null;
  dominantPollutant: string | null;
}

export interface NationalSnapshot {
  activeStationsWithData: number;
  statusCounts: Record<OfficialStatus, number>;
  worstStation: WorstStation | null;
  /** The site's own "current worst" status, surfaced as the general national status. Not a simple average. */
  generalStatus: OfficialStatus | null;
}

export type FallbackTier = 'official-index' | 'official-raw-readings' | 'unavailable';

export interface AqiDiagnostics {
  endpoint: string;
  httpStatus: number | null;
  stationsReceived: number;
  matchedStations: Record<string, string | null>; // city -> station name or null
  missingCities: string[];
  dataTimestamp: string | null;
  fallbackTier: FallbackTier;
  fallbackReason?: string;
}

export const SVIVA_SOURCE_URL = 'https://air.sviva.gov.il/';
export const PRELIMINARY_DATA_NOTE =
  'הנתונים מבוססים על מדידות בזמן אמת של מערך הניטור הארצי ועשויים להשתנות לאחר בקרת נתונים.';

export interface AqiReport {
  available: boolean;
  source: string;
  sourceUrl: string;
  measuredAt: string | null;
  national: NationalSnapshot | null;
  cities: CityAirQuality[];
  missingCities: string[];
  disclaimer: string;
  diagnostics: AqiDiagnostics;
}

/** Injectable client surface — lets fetchAirQuality's fallback logic be unit-tested without network. */
export interface AirQualityClient {
  getGuestApiToken(): Promise<string>;
  fetchStations(token: string): Promise<SvivaStation[]>;
  fetchIndexLatest(token: string): Promise<SvivaIndexLatestResponse>;
  fetchStationDataLatest(token: string, stationId: number): Promise<SvivaStationDataLatest>;
}
