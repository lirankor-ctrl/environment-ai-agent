import axios from 'axios';
import { config } from './config.js';
import { log } from './logger.js';

export type AqiBand = 'good' | 'moderate' | 'usg' | 'unhealthy';

export interface AqiCity {
  name: string;
  aqi: number;
  band: AqiBand;
  status: string;
}

export interface AqiReport {
  available: boolean;
  source: string;
  national?: { aqi: number; band: AqiBand; status: string };
  cities: AqiCity[];
  retrieved: string[];
  missing: string[];
}

// Cities to report (with geo fallback for the WAQI feed).
const CITIES = [
  { key: 'jerusalem', he: 'ירושלים', geo: '31.7683;35.2137' },
  { key: 'tel-aviv', he: 'תל אביב', geo: '32.0853;34.7818' },
  { key: 'haifa', he: 'חיפה', geo: '32.7940;34.9896' },
  { key: 'beer-sheva', he: 'באר שבע', geo: '31.2518;34.7913' },
];

const STATUS_HE: Record<AqiBand, string> = {
  good: 'טובה',
  moderate: 'בינונית',
  usg: 'בעייתית לרגישים',
  unhealthy: 'לא בריאה',
};

/** US-EPA AQI band (collapsed to the four requested levels). */
export function bandOf(aqi: number): AqiBand {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'usg';
  return 'unhealthy';
}

export function statusHe(band: AqiBand): string {
  return STATUS_HE[band];
}

interface WaqiResponse {
  status: string;
  data?: { aqi?: number | string };
}

/** Fetch a single city's AQI (city keyword first, then geo coordinates). */
async function cityAqi(city: (typeof CITIES)[number]): Promise<number | null> {
  const token = config.waqiToken;
  const urls = [
    `https://api.waqi.info/feed/${city.key}/?token=${token}`,
    `https://api.waqi.info/feed/geo:${city.geo}/?token=${token}`,
  ];
  for (const url of urls) {
    try {
      const res = await axios.get<WaqiResponse>(url, { timeout: 15000 });
      if (res.data.status === 'ok') {
        const aqi = Number(res.data.data?.aqi);
        if (Number.isFinite(aqi) && aqi > 0) return Math.round(aqi);
      }
    } catch {
      // try next URL
    }
  }
  return null;
}

/**
 * Fetch current air quality for the reported cities. Never throws — on missing
 * token or total failure returns { available:false } so the report still runs.
 */
export async function fetchAirQuality(): Promise<AqiReport> {
  const SOURCE = 'World Air Quality Index (waqi.info)';
  if (!config.waqiToken) {
    log.warn('WAQI_TOKEN not set — air quality section will show as unavailable.');
    return { available: false, source: 'unavailable', cities: [], retrieved: [], missing: CITIES.map((c) => c.he) };
  }

  const cities: AqiCity[] = [];
  const retrieved: string[] = [];
  const missing: string[] = [];

  for (const c of CITIES) {
    const aqi = await cityAqi(c);
    if (aqi == null) {
      missing.push(c.he);
      continue;
    }
    const band = bandOf(aqi);
    cities.push({ name: c.he, aqi, band, status: statusHe(band) });
    retrieved.push(c.he);
  }

  let national: AqiReport['national'];
  if (cities.length) {
    const avg = Math.round(cities.reduce((s, x) => s + x.aqi, 0) / cities.length);
    national = { aqi: avg, band: bandOf(avg), status: statusHe(bandOf(avg)) };
  }

  const available = cities.length > 0;
  return { available, source: available ? SOURCE : 'unavailable', national, cities, retrieved, missing };
}
