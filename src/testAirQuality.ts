import { log } from './logger.js';
import { fetchAirQuality } from './airQuality.js';

/**
 * npm run test-air-quality — fetches and prints the current official
 * air-quality data (air.sviva.gov.il) without generating or sending the
 * full weekly report. Useful for quickly checking the source is reachable
 * and which cities/stations resolved.
 */
async function main(): Promise<void> {
  log.step('TEST AIR QUALITY — fetching current official data');
  const aqi = await fetchAirQuality();

  log.step('Result');
  console.log(`Available:      ${aqi.available}`);
  console.log(`Source:         ${aqi.source}`);
  console.log(`Source URL:     ${aqi.sourceUrl}`);
  console.log(`Measured at:    ${aqi.measuredAt ?? '—'}`);
  console.log(`Fallback tier:  ${aqi.diagnostics.fallbackTier}`);
  if (aqi.diagnostics.fallbackReason) {
    console.log(`Fallback reason: ${aqi.diagnostics.fallbackReason}`);
  }

  if (aqi.national) {
    console.log('\nNational snapshot:');
    console.log(`  Active stations with data: ${aqi.national.activeStationsWithData}`);
    console.log(`  Status counts: ${JSON.stringify(aqi.national.statusCounts)}`);
    console.log(`  General status: ${aqi.national.generalStatus ?? '—'}`);
    if (aqi.national.worstStation) {
      const w = aqi.national.worstStation;
      console.log(`  Worst station: ${w.stationName}${w.city ? ` (${w.city})` : ''} — ${w.status ?? '—'}${w.dominantPollutant ? ` [${w.dominantPollutant}]` : ''}`);
    }
  }

  console.log('\nCities:');
  if (!aqi.cities.length) {
    console.log('  (none available)');
  }
  for (const c of aqi.cities) {
    console.log(
      `  ${c.city.padEnd(12)} station="${c.stationName}" index=${c.index ?? '—'} status=${c.status ?? '—'} pollutant=${c.dominantPollutant ?? '—'}${c.degraded ? ' [degraded: no official index]' : ''}`,
    );
  }
  if (aqi.missingCities.length) {
    console.log(`\nMissing cities (no current data): ${aqi.missingCities.join(', ')}`);
  }

  console.log('\nDiagnostics:');
  console.log(`  Endpoint:            ${aqi.diagnostics.endpoint}`);
  console.log(`  HTTP status:         ${aqi.diagnostics.httpStatus ?? '—'}`);
  console.log(`  Stations received:   ${aqi.diagnostics.stationsReceived}`);
  console.log(`  Data timestamp:      ${aqi.diagnostics.dataTimestamp ?? '—'}`);
  console.log(`  Matched stations:    ${JSON.stringify(aqi.diagnostics.matchedStations)}`);

  console.log(`\nDisclaimer: ${aqi.disclaimer}`);
  log.step('TEST AIR QUALITY — done');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error(`test-air-quality crashed: ${(err as Error).stack ?? err}`);
    process.exit(1);
  });
