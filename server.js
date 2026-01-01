const express = require('express');
const cors = require('cors');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static('public'));

// MTA GTFS-RT Feed URLs (no API key required)
const FEED_URLS = {
  '123456S': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
  'ACE': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
  'BDFM': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
  'G': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
  'JZ': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
  'L': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
  'NQRW': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
  'SIR': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si'
};

// Service alerts feed
const ALERTS_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts';

// Alert cause/effect mappings
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

// Line colors
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

// Station coordinates cache
let stationCoords = {};
let stationsLoaded = false;

// Load station coordinates from MTA data
async function loadStations() {
  if (stationsLoaded) return;

  try {
    console.log('Loading station coordinates...');
    const response = await fetch('https://data.ny.gov/api/views/39hk-dx4f/rows.json?accessType=DOWNLOAD');
    const data = await response.json();

    // Find column indices
    const columns = data.meta.view.columns;
    const gtfsIdIdx = columns.findIndex(c => c.fieldName === 'gtfs_stop_id');
    const latIdx = columns.findIndex(c => c.fieldName === 'gtfs_latitude');
    const lonIdx = columns.findIndex(c => c.fieldName === 'gtfs_longitude');
    const nameIdx = columns.findIndex(c => c.fieldName === 'stop_name');

    // Build coordinate lookup
    for (const row of data.data) {
      const stopId = row[gtfsIdIdx];
      const lat = parseFloat(row[latIdx]);
      const lon = parseFloat(row[lonIdx]);
      const name = row[nameIdx];

      if (stopId && lat && lon) {
        // Store base stop ID and directional variants
        stationCoords[stopId] = { lat, lon, name };
        stationCoords[stopId + 'N'] = { lat, lon, name };
        stationCoords[stopId + 'S'] = { lat, lon, name };
      }
    }

    stationsLoaded = true;
    console.log(`Loaded ${Object.keys(stationCoords).length} station coordinates`);
  } catch (error) {
    console.error('Error loading stations:', error.message);
  }
}

// Fetch and parse a single GTFS-RT feed
async function fetchFeed(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
    return feed;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    return null;
  }
}

// Extract train positions from feed
function extractTrainPositions(feed, feedName) {
  const trains = [];
  if (!feed || !feed.entity) return trains;

  const now = Date.now() / 1000;

  for (const entity of feed.entity) {
    // Check for vehicle position (real GPS data - rare)
    if (entity.vehicle && entity.vehicle.position) {
      const v = entity.vehicle;
      const routeId = v.trip?.routeId || 'Unknown';

      trains.push({
        id: entity.id,
        routeId: routeId,
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

    // Extract from trip updates (more common)
    if (entity.tripUpdate && entity.tripUpdate.stopTimeUpdate) {
      const tu = entity.tripUpdate;
      const routeId = tu.trip?.routeId || 'Unknown';

      // Find the next upcoming stop
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
          const departureTime = nextStop.departure?.time?.low || nextStop.departure?.time;

          // Add slight offset for visual separation
          const offset = (parseInt(entity.id) % 100) * 0.0001;

          trains.push({
            id: entity.id + '_trip',
            routeId: routeId,
            latitude: coords.lat + offset,
            longitude: coords.lon + offset,
            stopId: stopId,
            stopName: coords.name,
            arrivalTime: arrivalTime,
            departureTime: departureTime,
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

function getStatusText(status) {
  switch(status) {
    case 0: return 'Incoming';
    case 1: return 'At Station';
    case 2: return 'In Transit';
    default: return 'Unknown';
  }
}

// Extract alerts from feed
function extractAlerts(feed) {
  const alerts = [];
  if (!feed || !feed.entity) return alerts;

  for (const entity of feed.entity) {
    if (entity.alert) {
      const a = entity.alert;

      // Get affected routes
      const affectedRoutes = [];
      const affectedStops = [];

      if (a.informedEntity) {
        for (const ie of a.informedEntity) {
          if (ie.routeId && !affectedRoutes.includes(ie.routeId)) {
            affectedRoutes.push(ie.routeId);
          }
          if (ie.stopId && !affectedStops.includes(ie.stopId)) {
            affectedStops.push(ie.stopId);
          }
        }
      }

      // Extract text (can be in translation array)
      const headerText = a.headerText?.translation?.[0]?.text || a.headerText?.text || '';
      const descriptionText = a.descriptionText?.translation?.[0]?.text || a.descriptionText?.text || '';

      // Get time range
      const activePeriod = a.activePeriod?.[0];
      const startTime = activePeriod?.start?.low || activePeriod?.start;
      const endTime = activePeriod?.end?.low || activePeriod?.end;

      alerts.push({
        id: entity.id,
        header: headerText,
        description: descriptionText,
        cause: ALERT_CAUSE[a.cause] || 'Unknown',
        effect: ALERT_EFFECT[a.effect] || 'Unknown',
        affectedRoutes,
        affectedStops,
        startTime,
        endTime,
        severity: getSeverity(a.effect, affectedRoutes.length)
      });
    }
  }

  return alerts;
}

function getSeverity(effect, routeCount) {
  // Higher severity for service-impacting alerts
  if (effect === 1) return 'critical';  // No Service
  if (effect === 3) return 'high';      // Significant Delays
  if (effect === 2 || effect === 4) return 'medium';  // Reduced/Detour
  if (routeCount > 3) return 'medium';
  return 'low';
}

// API endpoint to get all train positions
app.get('/api/trains', async (req, res) => {
  try {
    // Ensure stations are loaded
    await loadStations();

    const allTrains = [];
    const feedPromises = Object.entries(FEED_URLS).map(async ([name, url]) => {
      const feed = await fetchFeed(url);
      return { name, trains: extractTrainPositions(feed, name) };
    });

    const results = await Promise.all(feedPromises);

    for (const result of results) {
      allTrains.push(...result.trains);
    }

    // Deduplicate by train ID (prefer GPS over schedule)
    const trainMap = new Map();
    for (const train of allTrains) {
      const baseId = train.id.replace('_trip', '');
      const existing = trainMap.get(baseId);
      if (!existing || train.source === 'gps') {
        trainMap.set(baseId, train);
      }
    }

    const trains = Array.from(trainMap.values());

    res.json({
      timestamp: Date.now(),
      trainCount: trains.length,
      trains: trains
    });
  } catch (error) {
    console.error('Error fetching trains:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint for alerts
app.get('/api/alerts', async (req, res) => {
  try {
    const feed = await fetchFeed(ALERTS_URL);
    const alerts = extractAlerts(feed);

    // Sort by severity
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    res.json({
      timestamp: Date.now(),
      alertCount: alerts.length,
      alerts: alerts
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint for station coordinates
app.get('/api/stations', async (req, res) => {
  await loadStations();
  res.json(stationCoords);
});

// API endpoint for subway line colors
app.get('/api/colors', (req, res) => {
  res.json(LINE_COLORS);
});

const PORT = process.env.PORT || 3000;

// Pre-load stations on startup
loadStations().then(() => {
  app.listen(PORT, () => {
    console.log(`NYC MTA Live Map server running at http://localhost:${PORT}`);
  });
});
