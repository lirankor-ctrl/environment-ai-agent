import {
  OFFICIAL_STATUSES,
  type CityAirQuality,
  type NationalSnapshot,
  type OfficialStatus,
  type SvivaIndexEntry,
  type SvivaIndexLatestResponse,
  type SvivaStation,
  type WorstStation,
} from './types.js';

/** Only ever return a status the Ministry actually uses — never invent/guess one. */
export function normalizeStatus(desc: string | null | undefined): OfficialStatus | null {
  if (!desc) return null;
  return (OFFICIAL_STATUSES as string[]).includes(desc) ? (desc as OfficialStatus) : null;
}

/** Index the /stations/index/latest data[] array by stationId for O(1) lookup. */
export function indexEntriesByStation(data: SvivaIndexEntry[]): Map<number, SvivaIndexEntry> {
  const map = new Map<number, SvivaIndexEntry>();
  for (const entry of data) {
    if (typeof entry.stationId === 'number' && !map.has(entry.stationId)) map.set(entry.stationId, entry);
  }
  return map;
}

/**
 * Pick one representative station per requested city: the first active
 * station (stable list order) whose `city` field matches, that also has a
 * current index entry. Deterministic and transparent — the chosen station
 * name is always surfaced to the reader.
 */
export function matchCityStations(
  stations: SvivaStation[],
  byStationId: Map<number, SvivaIndexEntry>,
  targetCities: string[],
): { cities: CityAirQuality[]; missingCities: string[]; matched: Record<string, string | null> } {
  const cities: CityAirQuality[] = [];
  const missingCities: string[] = [];
  const matched: Record<string, string | null> = {};

  for (const city of targetCities) {
    const candidates = stations.filter((s) => s.active && (s.city ?? '').startsWith(city));
    let hit: { station: SvivaStation; entry: SvivaIndexEntry } | null = null;
    for (const station of candidates) {
      const entry = byStationId.get(station.stationId);
      if (entry) {
        hit = { station, entry };
        break;
      }
    }
    if (!hit) {
      missingCities.push(city);
      matched[city] = null;
      continue;
    }
    matched[city] = hit.station.name;
    cities.push({
      city,
      stationName: hit.station.name,
      measuredAt: hit.entry.datetime,
      index: hit.entry.index,
      status: normalizeStatus(hit.entry.description),
      dominantPollutant: hit.entry.pollutant,
    });
  }

  return { cities, missingCities, matched };
}

/**
 * National snapshot from the official index/latest response: how many active
 * stations reported data, how many fall in each official status, and the
 * worst station right now (as the source's own top-level object already
 * identifies it). No simple average is computed — the source does not
 * publish one, and inventing one would misrepresent the official methodology.
 */
export function buildNationalSnapshot(
  resp: SvivaIndexLatestResponse,
  stations: SvivaStation[],
): NationalSnapshot {
  const statusCounts: Record<OfficialStatus, number> = { טובה: 0, בינונית: 0, נמוכה: 0, 'נמוכה מאוד': 0 };
  let activeStationsWithData = 0;
  for (const entry of resp.data) {
    const status = normalizeStatus(entry.description);
    if (status) {
      statusCounts[status]++;
      activeStationsWithData++;
    }
  }

  const worstStationRecord = stations.find((s) => s.stationId === resp.stationId) ?? null;
  const worstStatus = normalizeStatus(resp.description);
  // The source uses the literal string "None" as a city placeholder for a
  // handful of stations (e.g. quarry/industrial sites) — treat as unset.
  const worstCity = worstStationRecord?.city && worstStationRecord.city !== 'None' ? worstStationRecord.city : null;
  const worstStation: WorstStation | null = worstStationRecord
    ? {
        stationName: worstStationRecord.name,
        city: worstCity,
        status: worstStatus,
        index: resp.index,
        dominantPollutant: resp.pollutant,
      }
    : null;

  return {
    activeStationsWithData,
    statusCounts,
    worstStation,
    generalStatus: worstStatus,
  };
}
