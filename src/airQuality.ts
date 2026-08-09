import { log } from './logger.js';
import { API_BASE, svivaClient } from './airQuality/client.js';
import { buildNationalSnapshot, indexEntriesByStation, matchCityStations } from './airQuality/mapper.js';
import {
  PRELIMINARY_DATA_NOTE,
  SVIVA_SOURCE_URL,
  type AirQualityClient,
  type AqiDiagnostics,
  type AqiReport,
  type CityAirQuality,
} from './airQuality/types.js';

export * from './airQuality/types.js';

/** The five cities the weekly report always tries to cover. */
export const DEFAULT_CITIES = ['תל אביב', 'ירושלים', 'חיפה', 'באר שבע', 'ראשון לציון'];

const SOURCE_LABEL = 'המשרד להגנת הסביבה — מערך הניטור הארצי (air.sviva.gov.il)';
const INDEX_ENDPOINT = `${API_BASE}/stations/index/latest`;
const RAW_ENDPOINT = `${API_BASE}/stations/{id}/data/latest`;

/**
 * Tier 1 — the official structured endpoint the site's own real-time map
 * uses: computed status/index per station, already carrying the Ministry's
 * own status text (טובה/בינונית/נמוכה/נמוכה מאוד) and its own "current worst
 * station" summary. Preferred whenever it's reachable.
 */
async function tryOfficialIndex(cities: string[], client: AirQualityClient): Promise<AqiReport | null> {
  try {
    const token = await client.getGuestApiToken();
    log.info('[air-quality] obtained a guest API token from air.sviva.gov.il (public, credential-free).');
    log.info(`[air-quality] requesting ${INDEX_ENDPOINT}`);
    const [stations, indexLatest] = await Promise.all([client.fetchStations(token), client.fetchIndexLatest(token)]);
    log.info(
      `[air-quality] tier1 OK — status=200 stations=${stations.length} index entries=${indexLatest.data.length}`,
    );

    const byStation = indexEntriesByStation(indexLatest.data);
    const { cities: cityResults, missingCities, matched } = matchCityStations(stations, byStation, cities);
    const national = buildNationalSnapshot(indexLatest, stations);

    for (const [city, station] of Object.entries(matched)) {
      log.info(`[air-quality] city "${city}" -> station "${station ?? '(no match)'}"`);
    }
    if (missingCities.length) {
      log.warn(`[air-quality] cities with no current data (logged only, not shown as empty cards): ${missingCities.join(', ')}`);
    }

    const diagnostics: AqiDiagnostics = {
      endpoint: INDEX_ENDPOINT,
      httpStatus: 200,
      stationsReceived: stations.length,
      matchedStations: matched,
      missingCities,
      dataTimestamp: indexLatest.datetime,
      fallbackTier: 'official-index',
    };

    return {
      available: true,
      source: SOURCE_LABEL,
      sourceUrl: SVIVA_SOURCE_URL,
      measuredAt: indexLatest.datetime,
      national,
      cities: cityResults,
      missingCities,
      disclaimer: PRELIMINARY_DATA_NOTE,
      diagnostics,
    };
  } catch (err) {
    log.warn(`[air-quality] tier 1 (official index) unavailable — ${(err as Error).message}`);
    return null;
  }
}

/**
 * Tier 2 — same official system, raw per-station pollutant readings (no
 * computed index/status; we do not invent one). Used only when the computed
 * index endpoint itself is unreachable, so the newsletter still shows real
 * official measurements and timestamps instead of nothing.
 */
async function tryOfficialRawReadings(cities: string[], client: AirQualityClient): Promise<AqiReport | null> {
  try {
    const token = await client.getGuestApiToken();
    const stations = await client.fetchStations(token);
    log.info(`[air-quality] tier2 fallback — requesting per-station readings from ${RAW_ENDPOINT}`);

    const cityResults: CityAirQuality[] = [];
    const missingCities: string[] = [];
    const matched: Record<string, string | null> = {};
    let latestTs: string | null = null;

    for (const city of cities) {
      const station = stations.find((s) => s.active && (s.city ?? '').startsWith(city));
      if (!station) {
        missingCities.push(city);
        matched[city] = null;
        continue;
      }
      try {
        const data = await client.fetchStationDataLatest(token, station.stationId);
        const point = data.data[0];
        const dominant = point?.channels?.[0];
        if (!point || !dominant) {
          missingCities.push(city);
          matched[city] = null;
          continue;
        }
        matched[city] = station.name;
        latestTs = point.datetime;
        cityResults.push({
          city,
          stationName: station.name,
          measuredAt: point.datetime,
          index: null,
          status: null,
          dominantPollutant: dominant.alias ?? dominant.name ?? null,
          degraded: true,
        });
      } catch (err) {
        log.warn(`[air-quality] tier2: station ${station.stationId} (${city}) failed — ${(err as Error).message}`);
        missingCities.push(city);
        matched[city] = null;
      }
    }

    if (!cityResults.length) return null;
    log.warn('[air-quality] using tier 2 — raw station readings only (no official computed status).');

    return {
      available: true,
      source: `${SOURCE_LABEL} — נתוני מדידה גולמיים (המדד הרשמי אינו זמין כרגע)`,
      sourceUrl: SVIVA_SOURCE_URL,
      measuredAt: latestTs,
      national: null,
      cities: cityResults,
      missingCities,
      disclaimer: PRELIMINARY_DATA_NOTE,
      diagnostics: {
        endpoint: RAW_ENDPOINT,
        httpStatus: 200,
        stationsReceived: stations.length,
        matchedStations: matched,
        missingCities,
        dataTimestamp: latestTs,
        fallbackTier: 'official-raw-readings',
        fallbackReason: 'stations/index/latest (tier 1) was unavailable',
      },
    };
  } catch (err) {
    log.warn(`[air-quality] tier 2 (raw readings) also unavailable — ${(err as Error).message}`);
    return null;
  }
}

/** Tier 3 — compact "unavailable" result. Never throws. */
function unavailable(cities: string[], reason: string): AqiReport {
  log.error(`[air-quality] all official sources unavailable — ${reason}`);
  return {
    available: false,
    source: 'unavailable',
    sourceUrl: SVIVA_SOURCE_URL,
    measuredAt: null,
    national: null,
    cities: [],
    missingCities: cities,
    disclaimer: PRELIMINARY_DATA_NOTE,
    diagnostics: {
      endpoint: INDEX_ENDPOINT,
      httpStatus: null,
      stationsReceived: 0,
      matchedStations: {},
      missingCities: cities,
      dataTimestamp: null,
      fallbackTier: 'unavailable',
      fallbackReason: reason,
    },
  };
}

/**
 * Fetch current official Israeli air-quality data (air.sviva.gov.il), with a
 * 3-tier fallback. Never throws — worst case returns an `available:false`
 * report so the report pipeline always completes. `client` is injectable so
 * this can be unit-tested without hitting the network (see airQuality.test.ts).
 */
export async function fetchAirQuality(
  cities: string[] = DEFAULT_CITIES,
  client: AirQualityClient = svivaClient,
): Promise<AqiReport> {
  const tier1 = await tryOfficialIndex(cities, client);
  if (tier1) return tier1;

  const tier2 = await tryOfficialRawReadings(cities, client);
  if (tier2) return tier2;

  return unavailable(cities, 'Both the official index endpoint and the raw-readings fallback failed or timed out.');
}
