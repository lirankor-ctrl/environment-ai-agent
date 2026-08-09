import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNationalSnapshot, indexEntriesByStation, matchCityStations, normalizeStatus } from './mapper.js';
import type { SvivaIndexEntry, SvivaIndexLatestResponse, SvivaStation } from './types.js';

function station(id: number, name: string, city: string, active = true): SvivaStation {
  return { stationId: id, name, city, active };
}
function entry(id: number, description: string | null, index = 50, pollutant = 'PM2.5'): SvivaIndexEntry {
  return { stationId: id, datetime: '2026-08-02T10:00:00+03:00', pollutant, index, color: '#00E400', description };
}

test('normalizeStatus only accepts the four official Israeli levels', () => {
  assert.equal(normalizeStatus('טובה'), 'טובה');
  assert.equal(normalizeStatus('נמוכה מאוד'), 'נמוכה מאוד');
  assert.equal(normalizeStatus('Good'), null);
  assert.equal(normalizeStatus(null), null);
  assert.equal(normalizeStatus(undefined), null);
});

test('matchCityStations: successful full coverage', () => {
  const stations = [
    station(1, 'רחוב לחי', 'תל אביב-יפו'),
    station(2, 'רחוב בר אילן', 'ירושלים'),
  ];
  const byStation = indexEntriesByStation([entry(1, 'טובה', 60), entry(2, 'בינונית', 49)]);
  const { cities, missingCities, matched } = matchCityStations(stations, byStation, ['תל אביב', 'ירושלים']);

  assert.equal(cities.length, 2);
  assert.equal(missingCities.length, 0);
  assert.equal(matched['תל אביב'], 'רחוב לחי');
  assert.deepEqual(
    cities.find((c) => c.city === 'תל אביב'),
    { city: 'תל אביב', stationName: 'רחוב לחי', measuredAt: '2026-08-02T10:00:00+03:00', index: 60, status: 'טובה', dominantPollutant: 'PM2.5' },
  );
});

test('matchCityStations: partial coverage — missing cities are reported, not invented', () => {
  const stations = [station(1, 'רחוב לחי', 'תל אביב-יפו')];
  const byStation = indexEntriesByStation([entry(1, 'טובה')]);
  const { cities, missingCities, matched } = matchCityStations(stations, byStation, ['תל אביב', 'חיפה', 'באר שבע']);

  assert.equal(cities.length, 1);
  assert.deepEqual(missingCities, ['חיפה', 'באר שבע']);
  assert.equal(matched['חיפה'], null);
});

test('matchCityStations: inactive stations are never selected', () => {
  const stations = [station(1, 'תחנה לא פעילה', 'חיפה', false)];
  const byStation = indexEntriesByStation([entry(1, 'טובה')]);
  const { cities, missingCities } = matchCityStations(stations, byStation, ['חיפה']);
  assert.equal(cities.length, 0);
  assert.deepEqual(missingCities, ['חיפה']);
});

test('matchCityStations: a station with no current index entry is skipped in favor of another', () => {
  const stations = [station(1, 'תחנה בלי נתונים', 'חיפה'), station(2, 'תחנה עם נתונים', 'חיפה')];
  const byStation = indexEntriesByStation([entry(2, 'בינונית', 30)]); // station 1 has no entry
  const { cities } = matchCityStations(stations, byStation, ['חיפה']);
  assert.equal(cities.length, 1);
  assert.equal(cities[0].stationName, 'תחנה עם נתונים');
});

test('matchCityStations: malformed/unrecognized description never becomes an invented status', () => {
  const stations = [station(1, 'תחנה', 'חיפה')];
  const byStation = indexEntriesByStation([entry(1, 'משהו-לא-ידוע' as string)]);
  const { cities } = matchCityStations(stations, byStation, ['חיפה']);
  assert.equal(cities[0].status, null);
});

function indexLatestResponse(data: SvivaIndexEntry[], worst: Partial<SvivaIndexLatestResponse> = {}): SvivaIndexLatestResponse {
  return {
    stationId: worst.stationId ?? 1,
    datetime: worst.datetime ?? '2026-08-02T10:00:00+03:00',
    pollutant: worst.pollutant ?? 'PM10',
    index: worst.index ?? -50,
    description: worst.description ?? 'נמוכה',
    data,
  };
}

test('buildNationalSnapshot: counts stations per status and surfaces the worst station', () => {
  const stations = [station(1, 'תחנה גרועה', 'לוד'), station(2, 'תחנה טובה', 'רחובות')];
  const resp = indexLatestResponse([entry(1, 'נמוכה', -50), entry(2, 'טובה', 70)], { stationId: 1, description: 'נמוכה', index: -50, pollutant: 'PM10' });

  const snapshot = buildNationalSnapshot(resp, stations);
  assert.equal(snapshot.activeStationsWithData, 2);
  assert.equal(snapshot.statusCounts['נמוכה'], 1);
  assert.equal(snapshot.statusCounts['טובה'], 1);
  assert.equal(snapshot.generalStatus, 'נמוכה');
  assert.equal(snapshot.worstStation?.stationName, 'תחנה גרועה');
});

test('buildNationalSnapshot: does not compute a simple average — only counts + a named worst station', () => {
  const stations = [station(1, 'א', 'א'), station(2, 'ב', 'ב')];
  const resp = indexLatestResponse([entry(1, 'טובה', 10), entry(2, 'טובה', 90)]);
  const snapshot = buildNationalSnapshot(resp, stations);
  assert.ok(!('average' in snapshot));
  assert.ok(!('aqi' in snapshot));
});

test('buildNationalSnapshot: "None" city placeholder from the source is treated as unset', () => {
  const stations = [station(1, 'מחצבת מודיעים', 'None')];
  const resp = indexLatestResponse([entry(1, 'נמוכה', -76)], { stationId: 1, description: 'נמוכה' });
  const snapshot = buildNationalSnapshot(resp, stations);
  assert.equal(snapshot.worstStation?.city, null);
});

test('buildNationalSnapshot: malformed entries (unrecognized status) are not counted into any bucket', () => {
  const stations = [station(1, 'א', 'א')];
  const resp = indexLatestResponse([entry(1, 'not-a-real-status')]);
  const snapshot = buildNationalSnapshot(resp, stations);
  assert.equal(snapshot.activeStationsWithData, 0);
  assert.equal(Object.values(snapshot.statusCounts).reduce((a, b) => a + b, 0), 0);
});
