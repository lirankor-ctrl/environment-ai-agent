import axios from 'axios';
import { log } from '../logger.js';
import type { AirQualityClient, SvivaIndexLatestResponse, SvivaStation, SvivaStationDataLatest } from './types.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const TIMEOUT_MS = 12000;

const SITE_BASE = 'https://air.sviva.gov.il';
const API_BASE = 'https://air-papi.sviva.gov.il/v1/envista';
const DATA_SOURCE = 'MANA';

/**
 * Public, credential-free "Guest" token issuance — the exact same call every
 * anonymous visitor's browser makes on page load. Not a login, no bypass:
 * anyone can request one with no auth of any kind.
 */
export async function getGuestApiToken(): Promise<string> {
  const res = await axios.post<string>(
    `${SITE_BASE}/Account/GetApiToken`,
    JSON.stringify({ userName: 'Guest' }),
    {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': UA, Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    },
  );
  const token = typeof res.data === 'string' ? res.data.replace(/^"|"$/g, '').trim() : '';
  if (!token) throw new Error('Empty guest token from air.sviva.gov.il');
  return token;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `ApiToken ${token}`,
    'envi-data-source': DATA_SOURCE,
    Accept: 'application/json',
    'User-Agent': UA,
  };
}

export async function fetchStations(token: string): Promise<SvivaStation[]> {
  const res = await axios.get<SvivaStation[]>(`${API_BASE}/stations`, {
    headers: authHeaders(token),
    timeout: TIMEOUT_MS,
  });
  if (!Array.isArray(res.data)) throw new Error('Malformed /stations response (expected an array)');
  return res.data;
}

/** Tier 1 — official computed index/status per station (the site's own real-time layer). */
export async function fetchIndexLatest(token: string): Promise<SvivaIndexLatestResponse> {
  const res = await axios.get<SvivaIndexLatestResponse>(`${API_BASE}/stations/index/latest`, {
    headers: authHeaders(token),
    timeout: TIMEOUT_MS,
  });
  const data = res.data;
  if (!data || typeof data !== 'object' || !Array.isArray(data.data)) {
    throw new Error('Malformed /stations/index/latest response (missing data[])');
  }
  return data;
}

/** Tier 2 — raw per-station pollutant readings (no computed official index). */
export async function fetchStationDataLatest(token: string, stationId: number): Promise<SvivaStationDataLatest> {
  const res = await axios.get<SvivaStationDataLatest>(`${API_BASE}/stations/${stationId}/data/latest`, {
    headers: authHeaders(token),
    timeout: TIMEOUT_MS,
  });
  if (!res.data || !Array.isArray(res.data.data)) {
    throw new Error(`Malformed /stations/${stationId}/data/latest response`);
  }
  return res.data;
}

export { API_BASE, SITE_BASE };

export function logRequest(label: string, url: string): void {
  log.info(`[air-quality] requesting ${label}: ${url}`);
}

/** The real air.sviva.gov.il client. Tests inject a fake AirQualityClient instead. */
export const svivaClient: AirQualityClient = {
  getGuestApiToken,
  fetchStations,
  fetchIndexLatest,
  fetchStationDataLatest,
};
