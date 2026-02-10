require('dotenv').config();
const express = require('express');
const cors = require('cors');
const AnthropicModule = require('@anthropic-ai/sdk');
const Anthropic = AnthropicModule.default || AnthropicModule;
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static('public'));

// ---------------------------------------------------------------------------
// CACHE UTILITY
// ---------------------------------------------------------------------------
const cache = {};

function cached(key, ttlMs, fetchFn) {
  return async (req, res) => {
    const now = Date.now();
    if (cache[key] && now - cache[key].ts < ttlMs) {
      return res.json(cache[key].data);
    }
    try {
      const data = await fetchFn();
      cache[key] = { data, ts: now };
      res.json(data);
    } catch (err) {
      console.error(`[${key}] error:`, err.message);
      if (cache[key]) return res.json(cache[key].data);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// ---------------------------------------------------------------------------
// RIDERSHIP MODEL
// ---------------------------------------------------------------------------
let ridershipModel = null;
let crimeModel = null;

function loadRidershipModel() {
  const modelPath = path.join(__dirname, 'public', 'data', 'ridership-model.json');
  try {
    const raw = fs.readFileSync(modelPath, 'utf8');
    ridershipModel = JSON.parse(raw);
    console.log(`[model] loaded ${Object.keys(ridershipModel.stations).length} stations`);
  } catch (err) {
    console.warn('[model] ridership-model.json not found. Run: node scripts/build-model.js');
    ridershipModel = { stations: {}, metadata: {} };
  }
}

function loadCrimeModel() {
  const modelPath = path.join(__dirname, 'public', 'data', 'crime-model.json');
  try {
    const raw = fs.readFileSync(modelPath, 'utf8');
    crimeModel = JSON.parse(raw);
    console.log(`[crime] loaded risk data for ${Object.keys(crimeModel.stationRisk).length} stations`);
  } catch (err) {
    console.warn('[crime] crime-model.json not found. Run: node scripts/build-crime-model.js');
    crimeModel = { stationRisk: {}, metadata: {} };
  }
}

function getTimeWindow(hour) {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'latenight';
}

function computeSafetyLevel(ridership, crimeRisk, hour) {
  const isNight = hour >= 22 || hour < 6;
  const isEvening = hour >= 18 && hour < 22;

  // Principle: an empty station with no crime history is just quiet, not dangerous.
  // Only flag "avoid" when there's BOTH low foot traffic AND elevated crime risk.
  // crimeRisk is 0-1 normalized: 1.0 = highest-crime station in NYC.
  // Most stations cluster near 0. Only ~15% exceed 0.5.

  // DAYTIME (6am-6pm): NYC is overwhelmingly safe during business hours.
  if (!isNight && !isEvening) {
    if (crimeRisk >= 0.8 && ridership < 15) return 'caution';
    return 'safe';
  }

  // EVENING (6pm-10pm): mostly safe, flag genuine hotspots
  if (isEvening) {
    if (crimeRisk >= 0.7 && ridership < 25) return 'avoid';
    if (crimeRisk >= 0.5 && ridership < 15) return 'caution';
    return 'safe';
  }

  // LATE NIGHT (10pm-6am): more nuanced
  // AVOID = known crime corridor + empty platform
  if (crimeRisk >= 0.5 && ridership < 15) return 'avoid';
  // CAUTION = moderate risk factor present
  if (crimeRisk >= 0.3 && ridership < 25) return 'caution';
  if (ridership < 5 && crimeRisk >= 0.15) return 'caution';
  // SAFE = enough eyes on the street
  return 'safe';
}

// ---------------------------------------------------------------------------
// MTA GTFS-RT
// ---------------------------------------------------------------------------
const FEED_URLS = {
  '123456S': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
  'ACE':     'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
  'BDFM':    'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
  'G':       'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
  'JZ':      'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
  'L':       'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
  'NQRW':    'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
  'SIR':     'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si'
};

const ALERTS_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts';

const LINE_COLORS = {
  '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
  '4': '#00933C', '5': '#00933C', '6': '#00933C', '6X': '#00933C',
  '7': '#B933AD', '7X': '#B933AD',
  'A': '#0039A6', 'C': '#0039A6', 'E': '#0039A6',
  'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'FX': '#FF6319', 'M': '#FF6319',
  'G': '#6CBE45',
  'J': '#996633', 'Z': '#996633',
  'L': '#A7A9AC',
  'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W': '#FCCC0A',
  'S': '#808183', 'SF': '#808183', 'SR': '#808183', 'H': '#808183', 'FS': '#808183', 'GS': '#808183',
  'SI': '#0039A6', 'SIR': '#0039A6'
};

const ALERT_CAUSE = {
  1: 'Unknown', 2: 'Other', 3: 'Technical Problem', 4: 'Strike',
  5: 'Demonstration', 6: 'Accident', 7: 'Holiday', 8: 'Weather',
  9: 'Maintenance', 10: 'Construction', 11: 'Police Activity',
  12: 'Medical Emergency'
};

const ALERT_EFFECT = {
  1: 'No Service', 2: 'Reduced Service', 3: 'Significant Delays',
  4: 'Detour', 5: 'Additional Service', 6: 'Modified Service',
  7: 'Other', 8: 'Unknown', 9: 'Stop Moved'
};

// ---------------------------------------------------------------------------
// STATION DATA (GTFS stop coords + stop-to-complex mapping)
// ---------------------------------------------------------------------------
let stationCoords = {};
let gtfsStopToComplex = {};  // GTFS stop_id -> station_complex_id
let stationPromise = null;

async function loadStations() {
  if (stationPromise) return stationPromise;
  stationPromise = _loadStations();
  return stationPromise;
}

async function _loadStations() {
  try {
    console.log('[stations] loading...');
    const response = await fetch('https://data.ny.gov/api/views/39hk-dx4f/rows.json?accessType=DOWNLOAD');
    const data = await response.json();
    const columns = data.meta.view.columns;
    const gtfsIdIdx = columns.findIndex(c => c.fieldName === 'gtfs_stop_id');
    const latIdx = columns.findIndex(c => c.fieldName === 'gtfs_latitude');
    const lonIdx = columns.findIndex(c => c.fieldName === 'gtfs_longitude');
    const nameIdx = columns.findIndex(c => c.fieldName === 'stop_name');
    const complexIdx = columns.findIndex(c => c.fieldName === 'complex_id');

    for (const row of data.data) {
      const stopId = row[gtfsIdIdx];
      const lat = parseFloat(row[latIdx]);
      const lon = parseFloat(row[lonIdx]);
      const name = row[nameIdx];
      const complexId = row[complexIdx];

      if (stopId && lat && lon) {
        stationCoords[stopId] = { lat, lon, name };
        stationCoords[stopId + 'N'] = { lat, lon, name };
        stationCoords[stopId + 'S'] = { lat, lon, name };

        // Build the critical mapping: GTFS stop_id -> station_complex_id
        if (complexId) {
          gtfsStopToComplex[stopId] = String(complexId);
          gtfsStopToComplex[stopId + 'N'] = String(complexId);
          gtfsStopToComplex[stopId + 'S'] = String(complexId);
        }
      }
    }
    console.log(`[stations] ${Object.keys(stationCoords).length} coords, ${Object.keys(gtfsStopToComplex).length} stop-to-complex mappings`);
  } catch (error) {
    console.error('[stations] error:', error.message);
  }
}

async function fetchFeed(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
  } catch (error) {
    console.error(`[feed] ${url}: ${error.message}`);
    return null;
  }
}

function getStatusText(status) {
  switch (status) {
    case 0: return 'Incoming';
    case 1: return 'At Station';
    case 2: return 'In Transit';
    default: return 'Unknown';
  }
}

function getSeverity(effect, routeCount) {
  if (effect === 1) return 'critical';
  if (effect === 3) return 'high';
  if (effect === 2 || effect === 4) return 'medium';
  if (routeCount > 3) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// SHARED: Fetch all GTFS-RT feeds (used by both /api/trains and /api/presence)
// ---------------------------------------------------------------------------
let feedCache = { data: null, ts: 0 };
const FEED_CACHE_TTL = 25000; // 25 seconds

async function fetchAllFeeds() {
  const now = Date.now();
  if (feedCache.data && now - feedCache.ts < FEED_CACHE_TTL) {
    return feedCache.data;
  }
  const feeds = await Promise.all(Object.values(FEED_URLS).map(url => fetchFeed(url)));
  feedCache = { data: feeds, ts: now };
  return feeds;
}

// ---------------------------------------------------------------------------
// /api/trains - GTFS-RT train positions + stop time updates
// ---------------------------------------------------------------------------
app.get('/api/trains', cached('trains', 30000, async () => {
  await loadStations();
  const feeds = await fetchAllFeeds();
  const allTrains = feeds.flatMap(feed => extractTrains(feed));

  const trainMap = new Map();
  for (const train of allTrains) {
    const baseId = train.id.replace('_trip', '');
    const existing = trainMap.get(baseId);
    if (!existing || train.source === 'gps') trainMap.set(baseId, train);
  }
  const trains = Array.from(trainMap.values());
  return { timestamp: Date.now(), trainCount: trains.length, trains };
}));

function extractTrains(feed) {
  const trains = [];
  if (!feed || !feed.entity) return trains;
  const now = Date.now() / 1000;

  for (const entity of feed.entity) {
    if (entity.vehicle && entity.vehicle.position) {
      const v = entity.vehicle;
      const routeId = v.trip?.routeId || 'Unknown';
      trains.push({
        id: entity.id,
        routeId,
        latitude: v.position.latitude,
        longitude: v.position.longitude,
        bearing: v.position.bearing || 0,
        speed: v.position.speed || 0,
        stopId: v.stopId,
        status: getStatusText(v.currentStatus),
        timestamp: v.timestamp?.low || v.timestamp || now,
        color: LINE_COLORS[routeId] || '#666666',
        source: 'gps'
      });
    }

    if (entity.tripUpdate && entity.tripUpdate.stopTimeUpdate) {
      const tu = entity.tripUpdate;
      const routeId = tu.trip?.routeId || 'Unknown';
      const upcomingStops = tu.stopTimeUpdate.filter(stu => {
        const arrTime = stu.arrival?.time?.low || stu.arrival?.time || 0;
        const depTime = stu.departure?.time?.low || stu.departure?.time || 0;
        return arrTime >= now - 60 || depTime >= now - 60;
      });

      if (upcomingStops.length > 0) {
        const nextStop = upcomingStops[0];
        const stopId = nextStop.stopId;
        const coords = stationCoords[stopId];
        if (coords) {
          const arrivalTime = nextStop.arrival?.time?.low || nextStop.arrival?.time;
          trains.push({
            id: entity.id + '_trip',
            routeId,
            latitude: coords.lat,
            longitude: coords.lon,
            stopId,
            stopName: coords.name,
            arrivalTime,
            eta: arrivalTime ? Math.round((arrivalTime - now) / 60) : null,
            color: LINE_COLORS[routeId] || '#666666',
            source: 'schedule'
          });
        }
      }
    }
  }
  return trains;
}

// ---------------------------------------------------------------------------
// /api/alerts - Service disruptions
// ---------------------------------------------------------------------------
app.get('/api/alerts', cached('alerts', 60000, async () => {
  const feed = await fetchFeed(ALERTS_URL);
  const alerts = extractAlerts(feed);
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return { timestamp: Date.now(), alertCount: alerts.length, alerts };
}));

function extractAlerts(feed) {
  const alerts = [];
  if (!feed || !feed.entity) return alerts;

  for (const entity of feed.entity) {
    if (!entity.alert) continue;
    const a = entity.alert;
    const affectedRoutes = [];
    const affectedStops = [];

    if (a.informedEntity) {
      for (const ie of a.informedEntity) {
        if (ie.routeId && !affectedRoutes.includes(ie.routeId)) affectedRoutes.push(ie.routeId);
        if (ie.stopId && !affectedStops.includes(ie.stopId)) affectedStops.push(ie.stopId);
      }
    }

    const headerText = a.headerText?.translation?.[0]?.text || a.headerText?.text || '';
    const descriptionText = a.descriptionText?.translation?.[0]?.text || a.descriptionText?.text || '';
    const activePeriod = a.activePeriod?.[0];

    alerts.push({
      id: entity.id,
      header: headerText,
      description: descriptionText,
      cause: ALERT_CAUSE[a.cause] || 'Unknown',
      effect: ALERT_EFFECT[a.effect] || 'Unknown',
      affectedRoutes,
      affectedStops,
      startTime: activePeriod?.start?.low || activePeriod?.start,
      endTime: activePeriod?.end?.low || activePeriod?.end,
      severity: getSeverity(a.effect, affectedRoutes.length)
    });
  }
  return alerts;
}

// ---------------------------------------------------------------------------
// /api/presence - The core intelligence endpoint
// ---------------------------------------------------------------------------
async function computePresence() {
  if (!ridershipModel || !ridershipModel.stations) {
    return { timestamp: Date.now(), hour: new Date().getHours(), dayOfWeek: 'Mon', totalPresence: 0, stations: [] };
  }

  const now = new Date();
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hour = now.getHours();
  const dayOfWeek = DAY_NAMES[now.getDay()];

  // Get current train activity per station complex for modulation
  let trainsByComplex = {};
  try {
    await loadStations();
    const feeds = await fetchAllFeeds();
    const nowSec = Date.now() / 1000;

    for (const feed of feeds) {
      if (!feed || !feed.entity) continue;
      for (const entity of feed.entity) {
        if (entity.tripUpdate && entity.tripUpdate.stopTimeUpdate) {
          for (const stu of entity.tripUpdate.stopTimeUpdate) {
            const arrTime = stu.arrival?.time?.low || stu.arrival?.time || 0;
            if (arrTime > nowSec - 300 && arrTime < nowSec + 300) {
              const rawStopId = stu.stopId;
              if (!rawStopId) continue;
              // Strip N/S suffix to get base stop ID, then map to complex
              const baseStop = rawStopId.replace(/[NS]$/, '');
              const complexId = gtfsStopToComplex[baseStop] || gtfsStopToComplex[rawStopId];
              if (complexId) {
                trainsByComplex[complexId] = (trainsByComplex[complexId] || 0) + 1;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[presence] train modulation error:', err.message);
  }

  const matchedCount = Object.keys(trainsByComplex).length;
  const totalTrains = Object.values(trainsByComplex).reduce((a, b) => a + b, 0);
  if (matchedCount > 0) {
    console.log(`[presence] train modulation: ${totalTrains} train arrivals across ${matchedCount} station complexes`);
  }

  const stationList = [];
  let totalPresence = 0;
  let anomalyCount = 0;

  for (const [id, station] of Object.entries(ridershipModel.stations)) {
    const hourlyData = station.hourly[dayOfWeek];
    if (!hourlyData) continue;

    const baseline = hourlyData[hour] || 0;

    // Modulate by actual train frequency
    let ridership = baseline;
    const trainCount = trainsByComplex[id] || 0;
    if (trainCount > 0 && baseline > 0) {
      // Expected trains: use 4 as default, but scale by station size
      // Busy stations (baseline > 2000) expect more trains
      const expectedTrains = baseline > 5000 ? 12 :
                             baseline > 2000 ? 8 :
                             baseline > 500 ? 5 : 3;
      const modulation = 0.7 + 0.3 * (trainCount / expectedTrains);
      ridership = Math.round(baseline * Math.min(modulation, 2.0));
    }

    const anomalyScore = baseline > 0 ? (ridership - baseline) / baseline : 0;
    const isAnomaly = Math.abs(anomalyScore) > 0.3;
    if (isAnomaly) anomalyCount++;

    // Crime risk for this station at this time window
    const timeWindow = getTimeWindow(hour);
    const crimeData = crimeModel?.stationRisk?.[id];
    const crimeRisk = crimeData?.[timeWindow + 'Risk'] || 0;
    const crimeTotal = crimeData?.total || 0;
    const topCrimeType = crimeData?.topCrimeType || null;
    const safetyLevel = computeSafetyLevel(ridership, crimeRisk, hour);

    stationList.push({
      id,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      ridership,
      baseline,
      anomalyScore: Math.round(anomalyScore * 1000) / 1000,
      isAnomaly,
      trainCount,
      crimeRisk: Math.round(crimeRisk * 1000) / 1000,
      crimeTotal,
      topCrimeType,
      safetyLevel
    });

    totalPresence += ridership;
  }

  stationList.sort((a, b) => b.ridership - a.ridership);

  const isNightMode = hour >= 22 || hour < 6;
  const avoidCount = stationList.filter(s => s.safetyLevel === 'avoid').length;
  const cautionCount = stationList.filter(s => s.safetyLevel === 'caution').length;

  return {
    timestamp: Date.now(),
    hour,
    dayOfWeek,
    totalPresence,
    anomalyCount,
    isNightMode,
    safetyStats: { avoid: avoidCount, caution: cautionCount, safe: stationList.length - avoidCount - cautionCount },
    stations: stationList
  };
}

app.get('/api/presence', cached('presence', 30000, computePresence));

// ---------------------------------------------------------------------------
// /api/intelligence - Claude narrative
// ---------------------------------------------------------------------------
let intelligenceCache = null;
let intelligenceCacheTs = 0;
const INTELLIGENCE_TTL = 5 * 60 * 1000;

app.get('/api/intelligence', async (req, res) => {
  const now = Date.now();
  if (intelligenceCache && now - intelligenceCacheTs < INTELLIGENCE_TTL) {
    return res.json(intelligenceCache);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({ report: null, anomalies: [], generated: now, error: 'No API key configured' });
  }

  try {
    // Use cached presence data if available; only compute if no cache exists.
    // This prevents the intelligence endpoint from doing heavy GTFS fetches
    // during a cold start (which would exceed Vercel's function timeout).
    let presenceData;
    if (cache['presence'] && Date.now() - cache['presence'].ts < 120000) {
      presenceData = cache['presence'].data;
    } else {
      try {
        presenceData = await computePresence();
        cache['presence'] = { data: presenceData, ts: Date.now() };
      } catch (presErr) {
        console.error('[intelligence] presence computation failed:', presErr.message);
        return res.json({ report: null, anomalies: [], generated: now, error: 'Warming up, try again shortly' });
      }
    }

    const topStations = presenceData.stations.slice(0, 10);
    const anomalies = presenceData.stations.filter(s => s.isAnomaly);
    const totalPresence = presenceData.totalPresence;
    const hour = presenceData.hour;
    const dayOfWeek = presenceData.dayOfWeek;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const stationSummary = topStations.map(s =>
      `${s.name}: ${s.ridership.toLocaleString()} riders (baseline: ${s.baseline.toLocaleString()}, ${s.anomalyScore > 0 ? '+' : ''}${Math.round(s.anomalyScore * 100)}%) [safety: ${s.safetyLevel}]`
    ).join('\n');

    const anomalySummary = anomalies.length > 0
      ? anomalies.slice(0, 5).map(s =>
          `${s.name}: ${s.anomalyScore > 0 ? '+' : ''}${Math.round(s.anomalyScore * 100)}% vs baseline`
        ).join('\n')
      : 'No significant anomalies.';

    const avoidStations = presenceData.stations.filter(s => s.safetyLevel === 'avoid').slice(0, 8);
    const safetySummary = avoidStations.length > 0
      ? avoidStations.map(s =>
          `${s.name}: ${s.ridership} riders/hr, crime risk ${Math.round(s.crimeRisk * 100)}%${s.topCrimeType ? ' (' + s.topCrimeType.toLowerCase() + ')' : ''}`
        ).join('\n')
      : 'No stations flagged.';

    const isNight = hour >= 22 || hour < 6;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 400,
      system: `You are an urban intelligence analyst monitoring NYC subway crowd flow and street safety in real time. Write a situation report (4-6 lines). Use short declarative sentences. No greetings, no hedging. No em dashes.

Your audience includes newcomers to NYC who rely on this for personal safety decisions.

Report structure:
1. Overall system state (crowd levels, trend direction)
2. Notable anomalies and likely causes
3. Safety advisory: flag stations/corridors with low presence and elevated crime risk
${isNight ? '4. NIGHT MODE: emphasize which areas to avoid and which corridors remain well-populated' : ''}

Use compass directions and neighborhood names. Be specific about which stations are safe vs which to avoid at this hour.`,
      messages: [{
        role: 'user',
        content: `Current time: ${dayOfWeek} ${String(hour).padStart(2, '0')}:00
${isNight ? '*** NIGHT MODE ACTIVE ***' : ''}
Total estimated street presence: ${totalPresence.toLocaleString()}

Top 10 busiest stations:
${stationSummary}

Anomalies:
${anomalySummary}

Stations flagged AVOID (low presence + elevated crime risk):
${safetySummary}

Safety stats: ${presenceData.safetyStats.safe} safe, ${presenceData.safetyStats.caution} caution, ${presenceData.safetyStats.avoid} avoid

Write the situation report.`
      }]
    });

    const report = message.content[0].text;

    intelligenceCache = {
      report,
      anomalies: anomalies.map(s => ({
        id: s.id,
        name: s.name,
        score: s.anomalyScore,
        ridership: s.ridership,
        baseline: s.baseline
      })),
      generated: now
    };
    intelligenceCacheTs = now;

    res.json(intelligenceCache);
  } catch (err) {
    console.error('[intelligence] error:', err.message, err.status || '', err.error || '');
    res.json({
      report: null,
      anomalies: [],
      generated: now,
      error: 'Analysis temporarily unavailable',
      debug: process.env.VERCEL ? err.message : undefined
    });
  }
});

// ---------------------------------------------------------------------------
// Static endpoints
// ---------------------------------------------------------------------------
app.get('/api/stations', async (req, res) => {
  await loadStations();
  res.json(stationCoords);
});

app.get('/api/colors', (req, res) => {
  res.json(LINE_COLORS);
});

app.get('/api/config', (req, res) => {
  res.json({ mapboxToken: process.env.MAPBOX_TOKEN || '' });
});

app.get('/health', (req, res) => {
  res.sendStatus(200);
});

// Diagnostic: check what's happening with the intelligence pipeline
app.get('/api/debug', (req, res) => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const keyPrefix = hasKey ? process.env.ANTHROPIC_API_KEY.substring(0, 12) + '...' : 'MISSING';
  const hasModel = !!ridershipModel && Object.keys(ridershipModel.stations || {}).length > 0;
  const hasCrime = !!crimeModel && Object.keys(crimeModel.stationRisk || {}).length > 0;
  const hasPresenceCache = !!cache['presence'];
  const hasIntelCache = !!intelligenceCache;
  res.json({
    anthropicKey: keyPrefix,
    ridershipModel: hasModel ? Object.keys(ridershipModel.stations).length + ' stations' : 'NOT LOADED',
    crimeModel: hasCrime ? Object.keys(crimeModel.stationRisk).length + ' stations' : 'NOT LOADED',
    presenceCached: hasPresenceCache,
    intelligenceCached: hasIntelCache,
    intelligenceCacheAge: hasIntelCache ? Math.round((Date.now() - intelligenceCacheTs) / 1000) + 's' : null,
    env: process.env.VERCEL ? 'vercel' : 'local',
    nodeVersion: process.version
  });
});

// Init + export
loadRidershipModel();
loadCrimeModel();
const stationInit = loadStations();

// Local dev: start server
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  stationInit.then(() => {
    app.listen(PORT, () => {
      console.log(`\n  EYES ON THE STREET v2`);
      console.log(`  http://localhost:${PORT}\n`);
    });
  });
}

// Vercel serverless: export the app
module.exports = app;
