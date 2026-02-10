// EYES ON THE STREET v2 - Density Heatmap + Subtle Movement Flickers
// Shows aggregate crowd presence as warm glowing zones, not individual particles.
// Busy corridors burn bright. Dead blocks go dark. The city breathes.

const ParticleEngine = (() => {
  let canvas, ctx;
  let map;
  let stationData = [];
  let running = false;
  let animFrame = null;
  let frameCount = 0;

  // Flicker particles (sparse, short-lived, no trails)
  let flickers = [];
  const MAX_FLICKERS = 300;
  const FLICKER_LIFETIME = 30; // very short - just a brief spark

  // Heatmap tuning
  const BASE_RADIUS = 18;       // base glow radius at zoom 12
  const MAX_RADIUS = 80;        // cap so huge stations don't cover everything
  const GLOW_INTENSITY = 0.6;   // peak alpha for a maxed-out station
  const BREATHE_SPEED = 0.002;  // sinusoidal pulse rate
  const BREATHE_DEPTH = 0.08;   // how much the glow pulses (+/- this fraction)

  // Manhattan grid for flicker directions
  const GRID_RAD = 29 * Math.PI / 180;
  const GRID_DIRS = [
    { dx: -Math.sin(GRID_RAD), dy: -Math.cos(GRID_RAD) },
    { dx:  Math.sin(GRID_RAD), dy:  Math.cos(GRID_RAD) },
    { dx:  Math.cos(GRID_RAD), dy: -Math.sin(GRID_RAD) },
    { dx: -Math.cos(GRID_RAD), dy:  Math.sin(GRID_RAD) },
  ];

  function isManhattan(lat, lon) {
    return lat > 40.700 && lat < 40.880 && lon > -74.025 && lon < -73.905;
  }

  // Determine the max ridership for normalization
  function getMaxRidership() {
    let max = 1;
    for (const s of stationData) {
      if (s.ridership > max) max = s.ridership;
    }
    return max;
  }

  function drawHeatmap() {
    const zoom = map.getZoom();
    const zoomScale = Math.pow(1.4, zoom - 12);
    const maxRidership = getMaxRidership();
    const breathe = 1 + Math.sin(frameCount * BREATHE_SPEED) * BREATHE_DEPTH;

    // Use additive blending so overlapping stations create brighter corridors
    ctx.globalCompositeOperation = 'lighter';

    for (const station of stationData) {
      const ridership = station.ridership || 0;
      if (ridership < 5) continue; // skip dead stations

      const point = map.latLngToContainerPoint([station.lat, station.lon]);

      // Radius: sqrt scale so it grows slower for huge stations
      const normalized = ridership / maxRidership;
      const radius = Math.min(MAX_RADIUS, BASE_RADIUS * Math.sqrt(normalized) * zoomScale * 2.5) * breathe;

      // Intensity based on ridership
      const intensity = Math.min(GLOW_INTENSITY, 0.08 + normalized * GLOW_INTENSITY) * breathe;

      // Color: warm amber for normal, shift toward bright white for very busy
      let r, g, b;
      if (station.isAnomaly && station.anomalyScore > 0) {
        // Surge anomaly: hot red-orange
        r = 255;
        g = Math.round(60 + normalized * 40);
        b = Math.round(20 + normalized * 20);
      } else if (station.isAnomaly && station.anomalyScore < 0) {
        // Dead anomaly: cold blue
        r = Math.round(40 + normalized * 60);
        g = Math.round(80 + normalized * 80);
        b = Math.round(160 + normalized * 60);
      } else if (normalized > 0.6) {
        // Very busy: warm white-amber
        r = 255;
        g = Math.round(180 + normalized * 60);
        b = Math.round(100 + normalized * 80);
      } else {
        // Normal: amber-orange
        r = 255;
        g = Math.round(120 + normalized * 80);
        b = Math.round(40 + normalized * 40);
      }

      // Draw radial gradient blob
      const gradient = ctx.createRadialGradient(
        point.x, point.y, 0,
        point.x, point.y, radius
      );
      gradient.addColorStop(0, `rgba(${r},${g},${b},${intensity})`);
      gradient.addColorStop(0.3, `rgba(${r},${g},${b},${intensity * 0.5})`);
      gradient.addColorStop(0.7, `rgba(${r},${g},${b},${intensity * 0.12})`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);

      ctx.fillStyle = gradient;
      ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  function emitFlickers() {
    if (stationData.length === 0 || flickers.length >= MAX_FLICKERS) return;

    // Only emit from top ~40 busiest stations
    const topStations = stationData.slice(0, 40);
    let totalRider = 0;
    for (const s of topStations) totalRider += s.ridership || 0;
    if (totalRider === 0) return;

    // Emit ~2-4 flickers per frame total
    const emitCount = 2 + Math.random() * 2;
    let emitted = 0;

    for (const station of topStations) {
      if (emitted >= emitCount) break;
      const fraction = (station.ridership || 0) / totalRider;
      if (Math.random() > fraction * 10) continue; // probabilistic

      const point = map.latLngToContainerPoint([station.lat, station.lon]);
      const zoom = map.getZoom();
      const zoomScale = Math.pow(1.3, zoom - 12);

      // Pick a grid-aligned direction
      const dirs = isManhattan(station.lat, station.lon) ? GRID_DIRS :
        [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
      const dir = dirs[Math.floor(Math.random() * dirs.length)];

      // Spawn offset from station (simulating an exit)
      const exitDist = (4 + Math.random() * 6) * zoomScale;
      const exitAngle = Math.random() * Math.PI * 2;

      flickers.push({
        x: point.x + Math.cos(exitAngle) * exitDist,
        y: point.y + Math.sin(exitAngle) * exitDist,
        vx: dir.dx * (0.3 + Math.random() * 0.4),
        vy: dir.dy * (0.3 + Math.random() * 0.4),
        age: 0,
        maxAge: FLICKER_LIFETIME + Math.random() * 20,
        bright: 0.15 + (station.ridership / (stationData[0]?.ridership || 1)) * 0.35
      });
      emitted++;
    }
  }

  function updateFlickers() {
    const alive = [];
    for (const f of flickers) {
      f.age++;
      if (f.age >= f.maxAge) continue;
      f.x += f.vx;
      f.y += f.vy;
      alive.push(f);
    }
    flickers = alive;
  }

  function drawFlickers() {
    for (const f of flickers) {
      const t = f.age / f.maxAge;
      // Fade in fast, fade out slow
      const alpha = t < 0.15 ? (t / 0.15) * f.bright : f.bright * (1 - (t - 0.15) / 0.85);
      ctx.fillStyle = `rgba(255,220,180,${Math.max(0, alpha).toFixed(2)})`;
      ctx.fillRect(f.x, f.y, 1, 1);
    }
  }

  function render() {
    if (!ctx || !canvas) return;
    frameCount++;

    // Clear completely each frame (no fade trails)
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw density heatmap
    drawHeatmap();

    // Draw movement flickers on top
    emitFlickers();
    updateFlickers();
    drawFlickers();
  }

  function frame() {
    if (!running) return;
    render();
    animFrame = requestAnimationFrame(frame);
  }

  function resyncParticles() {
    flickers = [];
  }

  function resizeCanvas() {
    if (!canvas || !map) return;
    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
  }

  return {
    init(leafletMap) {
      map = leafletMap;
      canvas = document.getElementById('particleCanvas');
      if (!canvas) return;
      ctx = canvas.getContext('2d');

      resizeCanvas();

      map.on('moveend', resyncParticles);
      map.on('zoomend', () => {
        resizeCanvas();
        resyncParticles();
      });
      map.on('resize', resizeCanvas);

      running = true;
      frame();
    },

    setStations(stations) {
      stationData = stations;
    },

    getParticleCount() {
      return flickers.length;
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
