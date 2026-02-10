// EYES ON THE STREET v2 - Station Pulse Rings + Interaction
// Detects train arrivals, draws expanding ring animations, handles station clicks

const StationLayer = (() => {
  let canvas, ctx;
  let map;
  let stationData = []; // from /api/presence
  let pulseRings = [];  // active ring animations
  let previousTrainStops = new Set(); // track which stations had trains last update
  let animFrame = null;
  let running = false;

  // Ring animation params
  const RING_DURATION = 90;       // frames
  const RING_MAX_RADIUS = 40;     // pixels
  const RING_LINE_WIDTH = 1.5;
  const ANOMALY_PULSE_SPEED = 2;  // faster rings for anomalies

  // Station dot params
  const STATION_DOT_MIN = 2;
  const STATION_DOT_MAX = 6;

  function createRing(lat, lon, isAnomaly) {
    return {
      lat, lon,
      age: 0,
      maxAge: RING_DURATION,
      isAnomaly,
      speed: isAnomaly ? ANOMALY_PULSE_SPEED : 1
    };
  }

  function render() {
    if (!ctx || !canvas || !map) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const zoom = map.getZoom();
    const scaleFactor = Math.pow(1.2, zoom - 12); // scale relative to zoom 12

    // Draw station dots
    for (const station of stationData) {
      const point = map.latLngToContainerPoint([station.lat, station.lon]);

      // Dot size proportional to ridership (log scale)
      const ridership = station.ridership || 0;
      const logRider = ridership > 0 ? Math.log10(ridership) : 0;
      const dotSize = Math.min(STATION_DOT_MAX, STATION_DOT_MIN + logRider * 0.8);

      // Color: anomalies pulse red, normal stations are warm amber
      if (station.isAnomaly) {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
        ctx.fillStyle = `rgba(255, 34, 68, ${0.4 + pulse * 0.4})`;
        ctx.shadowColor = '#ff2244';
        ctx.shadowBlur = 8;
      } else {
        const alpha = Math.min(0.8, 0.15 + (ridership / 5000) * 0.6);
        ctx.fillStyle = `rgba(255, 170, 68, ${alpha})`;
        ctx.shadowColor = '#ff8844';
        ctx.shadowBlur = ridership > 1000 ? 6 : 0;
      }

      ctx.beginPath();
      ctx.arc(point.x, point.y, dotSize * scaleFactor, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Draw pulse rings
    const aliveRings = [];
    for (const ring of pulseRings) {
      ring.age += ring.speed;
      if (ring.age >= ring.maxAge) continue;

      const point = map.latLngToContainerPoint([ring.lat, ring.lon]);
      const progress = ring.age / ring.maxAge;
      const radius = progress * RING_MAX_RADIUS * scaleFactor;
      const alpha = 1 - progress;

      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = ring.isAnomaly
        ? `rgba(255, 34, 68, ${alpha * 0.6})`
        : `rgba(255, 255, 255, ${alpha * 0.5})`;
      ctx.lineWidth = RING_LINE_WIDTH * (1 - progress * 0.5);
      ctx.stroke();

      aliveRings.push(ring);
    }
    pulseRings = aliveRings;
  }

  function frame() {
    if (!running) return;
    render();
    animFrame = requestAnimationFrame(frame);
  }

  function resizeCanvas() {
    if (!canvas || !map) return;
    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
  }

  // Detect new train arrivals by comparing stop IDs across updates
  function detectArrivals(trains) {
    const currentStops = new Set();
    const arrivals = [];

    for (const train of trains) {
      if (train.status === 'At Station' || train.status === 'Incoming') {
        const stopId = train.stopId?.replace(/[NS]$/, '');
        if (stopId) currentStops.add(stopId);
      }
    }

    // Find new arrivals (stops that weren't active before)
    for (const stopId of currentStops) {
      if (!previousTrainStops.has(stopId)) {
        arrivals.push(stopId);
      }
    }

    previousTrainStops = currentStops;
    return arrivals;
  }

  // Build a lookup from station ID to station data
  function buildStationLookup() {
    const lookup = {};
    for (const s of stationData) {
      lookup[s.id] = s;
    }
    return lookup;
  }

  return {
    init(leafletMap) {
      map = leafletMap;
      canvas = document.getElementById('stationCanvas');
      if (!canvas) return;
      ctx = canvas.getContext('2d');

      resizeCanvas();
      map.on('zoomend', resizeCanvas);
      map.on('resize', resizeCanvas);

      running = true;
      frame();
    },

    setStations(stations) {
      stationData = stations;
    },

    // Called when new train data arrives - detect arrivals and trigger rings
    onTrainUpdate(trains) {
      const arrivals = detectArrivals(trains);
      if (arrivals.length === 0) return;

      const lookup = buildStationLookup();

      for (const stopId of arrivals) {
        // Try to find this stop in our station data
        // Station IDs from ridership model may differ from GTFS stop IDs
        // Look for nearby stations
        let found = null;
        for (const s of stationData) {
          if (s.id === stopId) {
            found = s;
            break;
          }
        }

        if (!found) {
          // Try matching by proximity to any known station
          // GTFS stops may not map 1:1 to ridership model station complexes
          continue;
        }

        pulseRings.push(createRing(found.lat, found.lon, found.isAnomaly));
      }
    },

    // Manually trigger a pulse at a station (e.g., from GTFS detection)
    pulse(lat, lon, isAnomaly) {
      pulseRings.push(createRing(lat, lon, isAnomaly || false));
    },

    // Get station at a click point for popup interaction
    getStationAt(latlng, radiusPx) {
      if (!map) return null;
      const clickPoint = map.latLngToContainerPoint(latlng);
      const threshold = radiusPx || 20;
      let closest = null;
      let closestDist = Infinity;

      for (const station of stationData) {
        const stationPoint = map.latLngToContainerPoint([station.lat, station.lon]);
        const dx = clickPoint.x - stationPoint.x;
        const dy = clickPoint.y - stationPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < threshold && dist < closestDist) {
          closest = station;
          closestDist = dist;
        }
      }

      return closest;
    },

    stop() {
      running = false;
      if (animFrame) cancelAnimationFrame(animFrame);
    },

    start() {
      if (running) return;
      running = true;
      frame();
    }
  };
})();
