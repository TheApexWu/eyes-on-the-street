require('dotenv').config();
const express = require('express');
const cors = require('cors');
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
      res.status(500).json({ error: err.message });
    }
  };
}

// ---------------------------------------------------------------------------
// RIDERSHIP MODEL
// ---------------------------------------------------------------------------
let ridershipModel = null;

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

let stationCoords = {};
let stationsLoaded = false;

async function loadStations() {
  if (stationsLoaded) return;
  try {
    console.log('[stations] loading...');
    const response = await fetch('https://data.ny.gov/api/views/39hk-dx4f/rows.json?accessType=DOWNLOAD');
    const data = await response.json();
    const columns = data.meta.view.columns;
    const gtfsIdIdx = columns.findIndex(c => c.fieldName === 'gtfs_stop_id');
    const latIdx = columns.findIndex(c => c.fieldName === 'gtfs_latitude');
    const lonIdx = columns.findIndex(c => c.fieldName === 'gtfs_longitude');
    const nameIdx = columns.findIndex(c => c.fieldName === 'stop_name');

    for (const row of data.data) {
      const stopId = row[gtfsIdIdx];
      const lat = parseFloat(row[latIdx]);
      const lon = parseFloat(row[lonIdx]);
      const name = row[nameIdx];
      if (stopId && lat && lon) {
        stationCoords[stopId] = { lat, lon, name };
        stationCoords[stopId + 'N'] = { lat, lon, name };
        stationCoords[stopId + 'S'] = { lat, lon, name };
      }
    }
    stationsLoaded = true;
    console.log(`[stations] ${Object.keys(stationCoords).length} entries`);
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
// /api/trains - GTFS-RT train positions + stop time updates
// ---------------------------------------------------------------------------
app.get('/api/trains', async (req, res) => {
  try {
    await loadStations();
    const feedPromises = Object.entries(FEED_URLS).map(async ([, url]) => {
      const feed = await fetchFeed(url);
      return extractTrains(feed);
    });
    const results = await Promise.all(feedPromises);
    const allTrains = results.flat();

    const trainMap = new Map();
    for (const train of allTrains) {
      const baseId = train.id.replace('_trip', '');
      const existing = trainMap.get(baseId);
      if (!existing || train.source === 'gps') trainMap.set(baseId, train);
    }
    const trains = Array.from(trainMap.values());
    res.json({ timestamp: Date.now(), trainCount: trains.length, trains });
  } catch (error) {
    console.error('[trains] error:', error);
    res.status(500).json({ error: error.message });
  }
});

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
app.get('/api/alerts', async (req, res) => {
  try {
    const feed = await fetchFeed(ALERTS_URL);
    const alerts = extractAlerts(feed);
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    res.json({ timestamp: Date.now(), alertCount: alerts.length, alerts });
  } catch (error) {
    console.error('[alerts] error:', error);
    res.status(500).json({ error: error.message });
  }
});

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
app.get('/api/presence', cached('presence', 30000, async () => {
  if (!ridershipModel || !ridershipModel.stations) {
    return { timestamp: Date.now(), hour: new Date().getHours(), dayOfWeek: 'Mon', totalPresence: 0, stations: [] };
  }

  const now = new Date();
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hour = now.getHours();
  const dayOfWeek = DAY_NAMES[now.getDay()];

  // Get current train activity per station for modulation
  let trainsByStation = {};
  try {
    await loadStations();
    const feedPromises = Object.values(FEED_URLS).map(url => fetchFeed(url));
    const feeds = await Promise.all(feedPromises);
    const nowSec = Date.now() / 1000;

    for (const feed of feeds) {
      if (!feed || !feed.entity) continue;
      for (const entity of feed.entity) {
        // Count trains arriving at each station
        if (entity.tripUpdate && entity.tripUpdate.stopTimeUpdate) {
          for (const stu of entity.tripUpdate.stopTimeUpdate) {
            const arrTime = stu.arrival?.time?.low || stu.arrival?.time || 0;
            if (arrTime > nowSec - 300 && arrTime < nowSec + 300) {
              const stopId = stu.stopId?.replace(/[NS]$/, '');
              if (stopId) {
                trainsByStation[stopId] = (trainsByStation[stopId] || 0) + 1;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[presence] train modulation error:', err.message);
  }

  const stationList = [];
  let totalPresence = 0;

  for (const [id, station] of Object.entries(ridershipModel.stations)) {
    const hourlyData = station.hourly[dayOfWeek];
    if (!hourlyData) continue;

    const baseline = hourlyData[hour] || 0;

    // Modulate by actual train frequency if available
    let ridership = baseline;
    const trainCount = trainsByStation[id] || 0;
    if (trainCount > 0 && baseline > 0) {
      // More trains than expected = boost, fewer = reduce
      const expectedTrains = 4; // rough avg trains per 10min window per station
      const modulation = 0.7 + 0.3 * (trainCount / expectedTrains);
      ridership = Math.round(baseline * Math.min(modulation, 2.0));
    }

    const anomalyScore = baseline > 0 ? (ridership - baseline) / baseline : 0;

    stationList.push({
      id,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      ridership,
      baseline,
      anomalyScore: Math.round(anomalyScore * 1000) / 1000,
      isAnomaly: Math.abs(anomalyScore) > 0.3,
      trainCount
    });

    totalPresence += ridership;
  }

  // Sort by ridership descending
  stationList.sort((a, b) => b.ridership - a.ridership);

  return {
    timestamp: Date.now(),
    hour,
    dayOfWeek,
    totalPresence,
    anomalyCount: stationList.filter(s => s.isAnomaly).length,
    stations: stationList
  };
}));

// ---------------------------------------------------------------------------
// /api/intelligence - Claude narrative
// ---------------------------------------------------------------------------
let intelligenceCache = null;
let intelligenceCacheTs = 0;
const INTELLIGENCE_TTL = 5 * 60 * 1000; // 5 minutes

app.get('/api/intelligence', async (req, res) => {
  const now = Date.now();
  if (intelligenceCache && now - intelligenceCacheTs < INTELLIGENCE_TTL) {
    return res.json(intelligenceCache);
  }

  // If no API key, return null report
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({ report: null, anomalies: [], generated: now, error: 'No API key configured' });
  }

  try {
    // Get current presence data
    const presenceResp = cache['presence'];
    let presenceData;
    if (presenceResp) {
      presenceData = presenceResp.data;
    } else {
      // Fetch fresh
      const resp = await fetch(`http://localhost:${PORT}/api/presence`);
      presenceData = await resp.json();
    }

    const topStations = presenceData.stations.slice(0, 10);
    const anomalies = presenceData.stations.filter(s => s.isAnomaly);
    const totalPresence = presenceData.totalPresence;
    const hour = presenceData.hour;
    const dayOfWeek = presenceData.dayOfWeek;

    const Anthropic = require('@anthropic-ai/sdk');
    const key = process.env.ANTHROPIC_API_KEY;
    // OAuth tokens (sk-ant-oat*) use Authorization: Bearer via authToken
    // Regular API keys (sk-ant-api*) use x-api-key via apiKey
    // SDK auto-reads ANTHROPIC_API_KEY from env, so clear it for OAuth path
    let client;
    if (key.startsWith('sk-ant-oat')) {
      const saved = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      client = new Anthropic({ authToken: key });
      process.env.ANTHROPIC_API_KEY = saved;
    } else {
      client = new Anthropic({ apiKey: key });
    }

    const stationSummary = topStations.map(s =>
      `${s.name}: ${s.ridership.toLocaleString()} riders (baseline: ${s.baseline.toLocaleString()}, ${s.anomalyScore > 0 ? '+' : ''}${Math.round(s.anomalyScore * 100)}%)`
    ).join('\n');

    const anomalySummary = anomalies.length > 0
      ? anomalies.slice(0, 5).map(s =>
          `${s.name}: ${s.anomalyScore > 0 ? '+' : ''}${Math.round(s.anomalyScore * 100)}% vs baseline`
        ).join('\n')
      : 'No significant anomalies.';

    const message = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 300,
      system: `You are an urban intelligence analyst monitoring NYC subway crowd flow in real time. Write a brief situation report (3-5 lines). Use short declarative sentences. No greetings, no hedging. State what is happening. Note anomalies. Use compass directions and neighborhood names, not just station names. No em dashes.`,
      messages: [{
        role: 'user',
        content: `Current time: ${dayOfWeek} ${String(hour).padStart(2, '0')}:00
Total estimated street presence: ${totalPresence.toLocaleString()}

Top 10 busiest stations:
${stationSummary}

Anomalies:
${anomalySummary}

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
    console.error('[intelligence] error:', err.message);
    res.json({
      report: null,
      anomalies: [],
      generated: now,
      error: err.message
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

// ---------------------------------------------------------------------------
// START
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

loadRidershipModel();
loadStations().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  EYES ON THE STREET v2`);
    console.log(`  http://localhost:${PORT}\n`);
  });
});
