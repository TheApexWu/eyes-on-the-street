#!/usr/bin/env node
// Build crime risk model from NYPD Complaint Data
// Dataset: https://data.cityofnewyork.us/resource/5uac-w243.json
// Computes per-station, per-time-window crime risk scores

const fs = require('fs');
const path = require('path');

const CRIME_URL = 'https://data.cityofnewyork.us/resource/5uac-w243.json';
const RIDERSHIP_PATH = path.join(__dirname, '..', 'public', 'data', 'ridership-model.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'crime-model.json');

const RADIUS_METERS = 400; // ~0.25 miles
const PAGE_SIZE = 50000;
const MONTHS_BACK = 6;

// Personal safety crimes only
const CRIME_TYPES = [
  'ROBBERY',
  'FELONY ASSAULT',
  'GRAND LARCENY OF PERSON',
  'RAPE',
  'MURDER & NON-NEGL. MANSLAUGHTER',
  'KIDNAPPING & RELATED OFFENSES'
];

// Time windows for safety analysis
const TIME_WINDOWS = {
  morning:   { start: 6,  end: 12, label: '6am-12pm' },
  afternoon: { start: 12, end: 18, label: '12pm-6pm' },
  evening:   { start: 18, end: 22, label: '6pm-10pm' },
  latenight: { start: 22, end: 30, label: '10pm-6am' }  // 30 = wraps past midnight
};

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getTimeWindow(hourStr) {
  // hourStr is like "14:30:00"
  const hour = parseInt(hourStr?.split(':')[0]);
  if (isNaN(hour)) return null;
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'latenight'; // 22-6
}

async function fetchCrimes() {
  const since = new Date();
  since.setMonth(since.getMonth() - MONTHS_BACK);
  const sinceStr = since.toISOString().split('T')[0];

  const typeFilter = CRIME_TYPES.map(t => `'${t}'`).join(',');

  const allRows = [];
  let offset = 0;

  console.log(`Fetching crime data since ${sinceStr}...`);
  console.log(`Crime types: ${CRIME_TYPES.join(', ')}`);

  while (true) {
    const params = new URLSearchParams({
      '$where': `cmplnt_fr_dt >= '${sinceStr}' AND ofns_desc in (${typeFilter}) AND latitude IS NOT NULL`,
      '$limit': String(PAGE_SIZE),
      '$offset': String(offset),
      '$select': 'cmplnt_fr_dt,cmplnt_fr_tm,ofns_desc,latitude,longitude'
    });

    const url = `${CRIME_URL}?${params}`;
    console.log(`  fetching offset=${offset}...`);

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`NYPD API: HTTP ${resp.status}`);
    const page = await resp.json();

    if (page.length === 0) break;
    allRows.push(...page);
    console.log(`  total crimes: ${allRows.length}`);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

// Recency decay: crimes from yesterday weight 1.0, crimes from 6 months ago weight ~0.18
function recencyWeight(crimeDateStr) {
  if (!crimeDateStr) return 0.5;
  const crimeDate = new Date(crimeDateStr);
  const now = new Date();
  const daysAgo = (now - crimeDate) / (1000 * 60 * 60 * 24);
  // Exponential decay with half-life of 30 days
  return Math.exp(-0.693 * daysAgo / 30);
}

// Absolute risk tiers (based on recency-weighted incident count per 6 months)
function absoluteRiskTier(weightedCount) {
  if (weightedCount >= 8) return 'critical';    // ~1.3+ incidents/month weighted
  if (weightedCount >= 4) return 'elevated';     // ~0.7+ incidents/month weighted
  if (weightedCount >= 1.5) return 'moderate';   // Some recent activity
  return 'low';
}

function computeStationRisk(stations, crimes) {
  // For efficiency: pre-filter using bounding box (~0.004 degrees ~ 400m at NYC latitude)
  const BOX = 0.004;

  const stationRisk = {};

  for (const [id, station] of Object.entries(stations)) {
    stationRisk[id] = {
      name: station.name,
      morning: 0,
      afternoon: 0,
      evening: 0,
      latenight: 0,
      total: 0,
      totalWeighted: 0,
      topCrimeType: null,
      crimeTypes: {}
    };
  }

  let matched = 0;
  const stationEntries = Object.entries(stations);

  for (const crime of crimes) {
    const cLat = parseFloat(crime.latitude);
    const cLon = parseFloat(crime.longitude);
    if (!cLat || !cLon) continue;

    const window = getTimeWindow(crime.cmplnt_fr_tm);
    if (!window) continue;

    const weight = recencyWeight(crime.cmplnt_fr_dt);

    // Find all stations within radius
    for (const [id, station] of stationEntries) {
      // Quick bounding box check first
      if (Math.abs(station.lat - cLat) > BOX || Math.abs(station.lon - cLon) > BOX) continue;

      // Precise distance check
      const dist = haversineMeters(station.lat, station.lon, cLat, cLon);
      if (dist <= RADIUS_METERS) {
        stationRisk[id][window] += weight;
        stationRisk[id].total++;
        stationRisk[id].totalWeighted += weight;
        matched++;

        const type = crime.ofns_desc || 'OTHER';
        stationRisk[id].crimeTypes[type] = (stationRisk[id].crimeTypes[type] || 0) + weight;
      }
    }
  }

  console.log(`  ${matched} crime-station matches`);

  // Determine top crime type per station (by recency-weighted count)
  for (const id in stationRisk) {
    const types = stationRisk[id].crimeTypes;
    let maxType = null;
    let maxCount = 0;
    for (const [type, count] of Object.entries(types)) {
      if (count > maxCount) { maxCount = count; maxType = type; }
    }
    stationRisk[id].topCrimeType = maxType;
    // Assign absolute risk tier based on recency-weighted total
    stationRisk[id].riskTier = absoluteRiskTier(stationRisk[id].totalWeighted);
    delete stationRisk[id].crimeTypes; // don't ship raw types to client
  }

  // Normalize each time window to 0-1 scale (relative to max station)
  for (const window of Object.keys(TIME_WINDOWS)) {
    let maxVal = 0;
    for (const id in stationRisk) {
      if (stationRisk[id][window] > maxVal) maxVal = stationRisk[id][window];
    }
    if (maxVal > 0) {
      for (const id in stationRisk) {
        stationRisk[id][window + 'Risk'] = Math.round((stationRisk[id][window] / maxVal) * 1000) / 1000;
      }
    }
  }

  // Compute overall risk (weighted: late night counts more, using recency-weighted values)
  let maxTotal = 0;
  for (const id in stationRisk) {
    const s = stationRisk[id];
    s.weightedTotal = s.morning * 0.5 + s.afternoon * 0.5 + s.evening * 1.0 + s.latenight * 2.0;
    if (s.weightedTotal > maxTotal) maxTotal = s.weightedTotal;
  }
  if (maxTotal > 0) {
    for (const id in stationRisk) {
      stationRisk[id].overallRisk = Math.round((stationRisk[id].weightedTotal / maxTotal) * 1000) / 1000;
    }
  }

  return stationRisk;
}

async function main() {
  console.log('=== Eyes on the Street - Crime Risk Model Builder ===\n');

  // Load ridership model for station locations
  console.log('Loading station locations from ridership model...');
  const ridershipRaw = fs.readFileSync(RIDERSHIP_PATH, 'utf8');
  const ridershipModel = JSON.parse(ridershipRaw);
  const stations = ridershipModel.stations;
  console.log(`  ${Object.keys(stations).length} stations`);

  // Fetch crime data
  const crimes = await fetchCrimes();
  console.log(`\nTotal crimes fetched: ${crimes.length}`);

  if (crimes.length === 0) {
    console.error('No crime data returned. Check API availability.');
    process.exit(1);
  }

  // Compute per-station risk
  console.log('\nComputing per-station crime risk...');
  const stationRisk = computeStationRisk(stations, crimes);

  // Stats
  const riskyStations = Object.values(stationRisk).filter(s => s.total > 0);
  console.log(`  Stations with nearby crimes: ${riskyStations.length}`);
  console.log(`  Top 10 highest risk stations:`);
  const sorted = Object.entries(stationRisk).sort((a, b) => b[1].overallRisk - a[1].overallRisk);
  sorted.slice(0, 10).forEach(([id, s]) => {
    console.log(`    ${s.name}: risk=${s.overallRisk}, total=${s.total}, latenight=${s.latenight}, top=${s.topCrimeType}`);
  });

  const model = {
    stationRisk,
    metadata: {
      monthsBack: MONTHS_BACK,
      crimeTypes: CRIME_TYPES,
      radiusMeters: RADIUS_METERS,
      totalCrimes: crimes.length,
      generated: new Date().toISOString().split('T')[0]
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
