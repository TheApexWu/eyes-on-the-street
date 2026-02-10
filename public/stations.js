// EYES ON THE STREET v2 - Station Pulse Rings (Mapbox GL)
// Draws expanding ring animations on a canvas overlay when trains arrive at stations.
// Station dots and click detection are handled by Mapbox GL's native layers in app.js.

const StationLayer = (() => {
  let canvas, ctx;
  let map;
  let stationData = [];
  let pulseRings = [];
  let previousTrainStops = new Set();
  let animFrame = null;
  let running = false;

  const RING_DURATION = 90;
  const RING_MAX_RADIUS = 40;
  const RING_LINE_WIDTH = 1.5;
  const ANOMALY_PULSE_SPEED = 2;

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
    const scaleFactor = Math.pow(1.2, zoom - 12);

    const aliveRings = [];
    for (const ring of pulseRings) {
      ring.age += ring.speed;
      if (ring.age >= ring.maxAge) continue;

      // Mapbox GL: project([lng, lat]) returns {x, y}
      const point = map.project([ring.lon, ring.lat]);
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
    const container = map.getContainer();
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
  }

  function detectArrivals(trains) {
    const currentStops = new Set();
    const arrivals = [];

    for (const train of trains) {
      if (train.status === 'At Station' || train.status === 'Incoming') {
        const stopId = train.stopId?.replace(/[NS]$/, '');
        if (stopId) currentStops.add(stopId);
      }
    }

    for (const stopId of currentStops) {
      if (!previousTrainStops.has(stopId)) {
        arrivals.push(stopId);
      }
    }

    previousTrainStops = currentStops;
    return arrivals;
  }

  return {
    init(mapboxMap) {
      map = mapboxMap;
      canvas = document.getElementById('pulseCanvas');
      if (!canvas) return;
      ctx = canvas.getContext('2d');

      resizeCanvas();
      map.on('resize', resizeCanvas);

      running = true;
      frame();
    },

    setStations(stations) {
      stationData = stations;
    },

    onTrainUpdate(trains) {
      const arrivals = detectArrivals(trains);
      if (arrivals.length === 0) return;

      for (const stopId of arrivals) {
        let found = null;
        for (const s of stationData) {
          if (s.id === stopId) {
            found = s;
            break;
          }
        }
        if (!found) continue;
        pulseRings.push(createRing(found.lat, found.lon, found.isAnomaly));
      }
    },

    pulse(lat, lon, isAnomaly) {
      pulseRings.push(createRing(lat, lon, isAnomaly || false));
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
