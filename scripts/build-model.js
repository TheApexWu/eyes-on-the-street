#!/usr/bin/env node
// Build ridership model from MTA Subway Hourly Ridership dataset
// Dataset: https://data.ny.gov/resource/5wq4-mkjj.json (Socrata API)
// Aggregates 4 weeks of hourly ridership per station per hour per day-of-week

const fs = require('fs');
const path = require('path');

const SOCRATA_URL = 'https://data.ny.gov/resource/5wq4-mkjj.json';
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'ridership-model.json');
const WEEKS = 4;
const PAGE_SIZE = 50000;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function fetchPage(offset, since) {
  const sinceStr = since.toISOString().split('T')[0];
  const params = new URLSearchParams({
    '$where': `transit_timestamp >= '${sinceStr}'`,
    '$limit': String(PAGE_SIZE),
    '$offset': String(offset),
    '$order': 'transit_timestamp ASC'
  });
  const url = `${SOCRATA_URL}?${params}`;
  console.log(`  fetching offset=${offset}...`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Socrata API: HTTP ${resp.status}`);
  return resp.json();
}

async function fetchAllData() {
  const since = new Date();
  since.setDate(since.getDate() - WEEKS * 7);

  console.log(`Fetching ridership data since ${since.toISOString().split('T')[0]}...`);

  const allRows = [];
  let offset = 0;
  while (true) {
    const page = await fetchPage(offset, since);
    if (page.length === 0) break;
    allRows.push(...page);
    console.log(`  total rows: ${allRows.length}`);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

function aggregate(rows) {
  // station_complex_id -> { name, lat, lon, hourly: { Mon: [24 hours], ... }, stddev: { Mon: [24], ... } }
  const stations = {};
  const counts = {};    // station_complex_id -> { Mon: [24 counts], ... }
  const sumSq = {};     // station_complex_id -> { Mon: [24 sum-of-squares], ... }
  const rawSums = {};   // station_complex_id -> { Mon: [24 raw sums], ... }

  for (const row of rows) {
    const id = row.station_complex_id;
    if (!id) continue;

    const ridership = parseInt(row.ridership) || 0;
    const ts = new Date(row.transit_timestamp);
    const hour = ts.getHours();
    const dayName = DAY_NAMES[ts.getDay()];
    const lat = parseFloat(row.latitude);
    const lon = parseFloat(row.longitude);

    if (!lat || !lon) continue;

    if (!stations[id]) {
      stations[id] = {
        name: row.station_complex || `Station ${id}`,
        lat,
        lon,
        hourly: {},
        stddev: {}
      };
      counts[id] = {};
      sumSq[id] = {};
      rawSums[id] = {};
      for (const d of DAY_NAMES) {
        stations[id].hourly[d] = new Array(24).fill(0);
        stations[id].stddev[d] = new Array(24).fill(0);
        counts[id][d] = new Array(24).fill(0);
        sumSq[id][d] = new Array(24).fill(0);
        rawSums[id][d] = new Array(24).fill(0);
      }
    }

    rawSums[id][dayName][hour] += ridership;
    sumSq[id][dayName][hour] += ridership * ridership;
    counts[id][dayName][hour] += 1;
  }

  // Compute mean and standard deviation
  for (const id in stations) {
    for (const day of DAY_NAMES) {
      for (let h = 0; h < 24; h++) {
        const c = counts[id][day][h];
        if (c > 0) {
          const mean = rawSums[id][day][h] / c;
          stations[id].hourly[day][h] = Math.round(mean);
          // Variance = E[X^2] - (E[X])^2
          const variance = (sumSq[id][day][h] / c) - (mean * mean);
          stations[id].stddev[day][h] = Math.round(Math.sqrt(Math.max(0, variance)));
        }
      }
    }
  }

  return stations;
}

async function main() {
  console.log('=== Eyes on the Street - Ridership Model Builder ===\n');

  const rows = await fetchAllData();
  console.log(`\nTotal rows fetched: ${rows.length}`);

  if (rows.length === 0) {
    console.error('No data returned. Check API availability.');
    process.exit(1);
  }

  console.log('Aggregating...');
  const stations = aggregate(rows);
  const stationCount = Object.keys(stations).length;
  console.log(`Stations: ${stationCount}`);

  const model = {
    stations,
    metadata: {
      weeks: WEEKS,
      generated: new Date().toISOString().split('T')[0],
      stationCount
    }
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(model));

  const sizeMB = (Buffer.byteLength(JSON.stringify(model)) / 1024 / 1024).toFixed(2);
  console.log(`\nWrote ${OUTPUT_PATH} (${sizeMB} MB)`);
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
