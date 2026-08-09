import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAirQuality } from './airQuality.js';
import type { AirQualityClient, SvivaIndexLatestResponse, SvivaStation } from './airQuality/types.js';

const CITIES = ['תל אביב', 'ירושלים', 'חיפה'];

function stations(): SvivaStation[] {
  return [
    { stationId: 1, name: 'רחוב לחי', city: 'תל אביב-יפו', active: true },
    { stationId: 2, name: 'רחוב בר אילן', city: 'ירושלים', active: true },
    { stationId: 3, name: 'פארק הכרמל', city: 'חיפה', active: true },
  ];
}

function indexLatest(overrides: Partial<SvivaIndexLatestResponse> = {}): SvivaIndexLatestResponse {
  return {
    stationId: 1,
    datetime: '2026-08-02T10:00:00+03:00',
    pollutant: 'PM2.5',
    index: 60,
    description: 'טובה',
    data: [
      { stationId: 1, datetime: '2026-08-02T10:00:00+03:00', pollutant: 'PM2.5', index: 60, color: '#0f0', description: 'טובה' },
      { stationId: 2, datetime: '2026-08-02T10:00:00+03:00', pollutant: 'PM2.5', index: 49, color: '#ff0', description: 'בינונית' },
      { stationId: 3, datetime: '2026-08-02T10:00:00+03:00', pollutant: 'O3', index: 20, color: '#ff0', description: 'בינונית' },
    ],
    ...overrides,
  };
}

function workingClient(overrides: Partial<AirQualityClient> = {}): AirQualityClient {
  return {
    getGuestApiToken: async () => 'fake-token',
    fetchStations: async () => stations(),
    fetchIndexLatest: async () => indexLatest(),
    fetchStationDataLatest: async (_token, stationId) => ({
      stationId,
      data: [{ datetime: '2026-08-02T10:00:00+03:00', channels: [{ id: 1, name: 'PM2.5', alias: 'PM2.5', value: 12, units: 'ug/m3', datetime: '2026-08-02T10:00:00+03:00' }] }],
    }),
    ...overrides,
  };
}

test('successful official response — tier 1, all cities resolved', async () => {
  const report = await fetchAirQuality(CITIES, workingClient());
  assert.equal(report.available, true);
  assert.equal(report.diagnostics.fallbackTier, 'official-index');
  assert.equal(report.cities.length, 3);
  assert.equal(report.missingCities.length, 0);
  assert.equal(report.national?.activeStationsWithData, 3);
  assert.match(report.source, /air\.sviva\.gov\.il|המשרד להגנת הסביבה/);
});

test('partial city coverage — some cities missing are reported, not fabricated', async () => {
  // Only Tel Aviv + Jerusalem have current index entries; Haifa's station has none.
  const client = workingClient({
    fetchIndexLatest: async () =>
      indexLatest({ data: indexLatest().data.filter((d) => d.stationId !== 3) }),
  });
  const report = await fetchAirQuality(CITIES, client);
  assert.equal(report.available, true);
  assert.equal(report.cities.length, 2);
  assert.deepEqual(report.missingCities, ['חיפה']);
  assert.equal(report.cities.some((c) => c.city === 'חיפה'), false);
});

test('malformed response from tier 1 falls back to tier 2 raw readings', async () => {
  const client = workingClient({
    // Simulates client.ts's own validation throwing on a malformed payload.
    fetchIndexLatest: async () => {
      throw new Error('Malformed /stations/index/latest response (missing data[])');
    },
  });
  const report = await fetchAirQuality(CITIES, client);
  assert.equal(report.available, true);
  assert.equal(report.diagnostics.fallbackTier, 'official-raw-readings');
  assert.equal(report.national, null); // tier 2 never invents a national snapshot
  assert.ok(report.cities.every((c) => c.status === null && c.degraded === true));
});

test('timeout on tier 1 falls back to tier 2', async () => {
  const client = workingClient({
    fetchIndexLatest: async () => {
      throw new Error('timeout of 12000ms exceeded');
    },
  });
  const report = await fetchAirQuality(CITIES, client);
  assert.equal(report.available, true);
  assert.equal(report.diagnostics.fallbackTier, 'official-raw-readings');
});

test('official source fully unavailable — tier 3 compact message, never throws', async () => {
  const client: AirQualityClient = {
    getGuestApiToken: async () => {
      throw new Error('ECONNREFUSED');
    },
    fetchStations: async () => {
      throw new Error('should not be reached');
    },
    fetchIndexLatest: async () => {
      throw new Error('should not be reached');
    },
    fetchStationDataLatest: async () => {
      throw new Error('should not be reached');
    },
  };
  const report = await fetchAirQuality(CITIES, client);
  assert.equal(report.available, false);
  assert.equal(report.source, 'unavailable');
  assert.equal(report.cities.length, 0);
  assert.deepEqual(report.missingCities, CITIES);
  assert.equal(report.diagnostics.fallbackTier, 'unavailable');
  assert.ok(report.diagnostics.fallbackReason);
  // The preliminary-data disclaimer and source URL are always present, even when unavailable.
  assert.match(report.disclaimer, /בקרת נתונים/);
  assert.equal(report.sourceUrl, 'https://air.sviva.gov.il/');
});

test('fetchAirQuality never throws even if the client rejects unexpectedly', async () => {
  const client: AirQualityClient = {
    getGuestApiToken: async () => {
      throw new TypeError('unexpected shape');
    },
    fetchStations: async () => {
      throw new Error('unreachable');
    },
    fetchIndexLatest: async () => {
      throw new Error('unreachable');
    },
    fetchStationDataLatest: async () => {
      throw new Error('unreachable');
    },
  };
  await assert.doesNotReject(() => fetchAirQuality(CITIES, client));
});
