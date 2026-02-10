// EYES ON THE STREET v2 - Mapbox GL
// 3D extruded buildings, pitched camera, WebGL heatmap, Claude intelligence

(async () => {
  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // FETCH MAPBOX TOKEN
  // ---------------------------------------------------------------------------
  let mapboxToken = '';
  try {
    const configResp = await fetch('/api/config');
    const config = await configResp.json();
    mapboxToken = config.mapboxToken;
  } catch (e) {}

  if (!mapboxToken) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="token-warning">
        No Mapbox token found.<br>
        Get a free one at mapbox.com and add it to .env:
        <code>MAPBOX_TOKEN=pk.your_token_here</code>
      </div>
    `);
    return;
  }

  // ---------------------------------------------------------------------------
  // MAP INIT
  // ---------------------------------------------------------------------------
  mapboxgl.accessToken = mapboxToken;

  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-73.9855, 40.7580],    // Mapbox uses [lng, lat]
    zoom: 12,
    pitch: 50,                       // tilt camera 50 degrees
    bearing: -17.5,                  // rotate to align with Manhattan grid
    antialias: true,
    minZoom: 9,
    maxZoom: 18
  });

  map.addControl(new mapboxgl.NavigationControl(), 'top-left');

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n).toLocaleString();
    return String(n);
  }

  function getCityPhase(hour) {
    if (hour >= 0 && hour < 5)   return 'Dead Hours';
    if (hour >= 5 && hour < 7)   return 'Early Risers';
    if (hour >= 7 && hour < 10)  return 'Morning Rush';
    if (hour >= 10 && hour < 12) return 'Midday Build';
    if (hour >= 12 && hour < 14) return 'Lunch Surge';
    if (hour >= 14 && hour < 15) return 'Afternoon Lull';
    if (hour >= 15 && hour < 16) return 'School Dismissal';
    if (hour >= 16 && hour < 19) return 'Evening Rush';
    if (hour >= 19 && hour < 22) return 'Night Activity';
    return 'Late Night';
  }

  // ---------------------------------------------------------------------------
  // STATUS + CLOCK
  // ---------------------------------------------------------------------------
  function setStatus(state, text) {
    const dot = $('statusDot');
    dot.className = 'hud-dot' + (state === 'error' ? ' error' : state === 'loading' ? ' loading' : '');
    $('statusText').textContent = text;
  }

  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    $('clock').textContent = `${h}:${m}:${s}`;
    $('cityPhase').textContent = getCityPhase(now.getHours());
  }

  // ---------------------------------------------------------------------------
  // LINE COLORS
  // ---------------------------------------------------------------------------
  const LINE_COLORS = {
    '1': '#EE352E', '2': '#EE352E', '3': '#EE352E',
    '4': '#00933C', '5': '#00933C', '6': '#00933C',
    '7': '#B933AD',
    'A': '#0039A6', 'C': '#0039A6', 'E': '#0039A6',
    'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'M': '#FF6319',
    'G': '#6CBE45',
    'J': '#996633', 'Z': '#996633',
    'L': '#A7A9AC',
    'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W': '#FCCC0A',
    'S': '#808183',
    'SI': '#0039A6', 'SIR': '#0039A6'
  };

  // ---------------------------------------------------------------------------
  // WAIT FOR MAP LOAD
  // ---------------------------------------------------------------------------
  await new Promise(resolve => map.on('load', resolve));

  // Strip labels for cleaner look
  const style = map.getStyle();
  for (const layer of style.layers) {
    if (layer.type === 'symbol' && layer['source-layer'] !== 'water_label') {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  }

  // ---------------------------------------------------------------------------
  // 3D BUILDINGS
  // ---------------------------------------------------------------------------
  map.addLayer({
    id: '3d-buildings',
    source: 'composite',
    'source-layer': 'building',
    filter: ['==', 'extrude', 'true'],
    type: 'fill-extrusion',
    minzoom: 12,
    paint: {
      'fill-extrusion-color': '#12121a',
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': ['get', 'min_height'],
      'fill-extrusion-opacity': 0.5
    }
  });

  // ---------------------------------------------------------------------------
  // HEATMAP + STATION SOURCES
  // ---------------------------------------------------------------------------
  const emptyGeoJSON = { type: 'FeatureCollection', features: [] };

  map.addSource('presence', { type: 'geojson', data: emptyGeoJSON });

  // Heatmap layer (renders BELOW buildings so glow bleeds through)
  map.addLayer({
    id: 'presence-heat',
    type: 'heatmap',
    source: 'presence',
    maxzoom: 17,
    paint: {
      'heatmap-weight': ['get', 'weight'],
      'heatmap-intensity': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.8,
        14, 1.5,
        17, 2.5
      ],
      'heatmap-radius': [
        'interpolate', ['linear'], ['zoom'],
        10, 12,
        12, 22,
        14, 40,
        16, 60
      ],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,   'rgba(0,0,0,0)',
        0.05, 'rgba(30,5,0,0.2)',
        0.15, 'rgba(80,20,0,0.35)',
        0.3,  'rgba(180,60,10,0.45)',
        0.5,  'rgba(255,120,40,0.55)',
        0.7,  'rgba(255,170,80,0.65)',
        0.9,  'rgba(255,210,140,0.75)',
        1.0,  'rgba(255,240,200,0.85)'
      ],
      'heatmap-opacity': 0.85
    }
  }, '3d-buildings'); // insert below buildings

  // Station circles (visible at higher zoom) - colored by safety level
  map.addLayer({
    id: 'station-circles',
    type: 'circle',
    source: 'presence',
    minzoom: 12,
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['get', 'ridership'],
        0, 2,
        500, 3,
        2000, 5,
        5000, 7
      ],
      'circle-color': [
        'match', ['get', 'safetyLevel'],
        'safe', '#00ff88',
        'caution', '#ff8800',
        'avoid', '#ff2244',
        '#ffaa44'
      ],
      'circle-opacity': 0.8,
      'circle-blur': 0.3,
      'circle-stroke-width': [
        'match', ['get', 'safetyLevel'],
        'avoid', 1.5,
        0.5
      ],
      'circle-stroke-color': [
        'match', ['get', 'safetyLevel'],
        'avoid', 'rgba(255,34,68,0.6)',
        'caution', 'rgba(255,136,0,0.3)',
        'rgba(255,255,255,0.15)'
      ]
    }
  });

  // ---------------------------------------------------------------------------
  // PRESENCE DATA
  // ---------------------------------------------------------------------------
  let presenceData = null;
  let stationLookup = {};

  function presenceToGeoJSON(data) {
    const maxRidership = data.stations.reduce((max, s) => Math.max(max, s.ridership || 0), 1);
    return {
      type: 'FeatureCollection',
      features: data.stations.map(s => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [s.lon, s.lat]
        },
        properties: {
          id: s.id,
          name: s.name,
          ridership: s.ridership || 0,
          baseline: s.baseline || 0,
          weight: (s.ridership || 0) / maxRidership,
          anomalyScore: s.anomalyScore || 0,
          isAnomaly: s.isAnomaly || false,
          trainCount: s.trainCount || 0,
          crimeRisk: s.crimeRisk || 0,
          crimeTotal: s.crimeTotal || 0,
          topCrimeType: s.topCrimeType || '',
          safetyLevel: s.safetyLevel || 'safe'
        }
      }))
    };
  }

  async function fetchPresence() {
    try {
      const resp = await fetch('/api/presence');
      presenceData = await resp.json();

      $('presenceCount').textContent = formatNumber(presenceData.totalPresence);
      $('stationCount').textContent = presenceData.stations.length;
      $('anomalyCount').textContent = presenceData.anomalyCount || 0;

      // Night mode + safety stats
      const nightBadge = $('nightBadge');
      const safetyStats = $('safetyStats');
      if (presenceData.isNightMode) {
        nightBadge.style.display = '';
        document.body.classList.add('night-mode');
      } else {
        nightBadge.style.display = 'none';
        document.body.classList.remove('night-mode');
      }
      if (presenceData.safetyStats) {
        const ss = presenceData.safetyStats;
        safetyStats.innerHTML = `<span class="safety-safe">${ss.safe}</span>/<span class="safety-caution">${ss.caution}</span>/<span class="safety-avoid">${ss.avoid}</span>`;
      }

      const geojson = presenceToGeoJSON(presenceData);
      map.getSource('presence').setData(geojson);

      // Build lookup for click interaction
      stationLookup = {};
      for (const s of presenceData.stations) {
        stationLookup[s.id] = s;
      }

      // Feed stations to pulse ring layer
      StationLayer.setStations(presenceData.stations);

      return presenceData;
    } catch (err) {
      console.error('[presence] error:', err);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // HEATMAP BREATHING (throttled to every 2 seconds, not 60fps)
  // ---------------------------------------------------------------------------
  setInterval(() => {
    const t = performance.now() * 0.001;
    try {
      map.setPaintProperty('presence-heat', 'heatmap-opacity', 0.80 + Math.sin(t * 0.12) * 0.05);
    } catch (e) {}
  }, 2000);

  // ---------------------------------------------------------------------------
  // TRAINS (for pulse rings)
  // ---------------------------------------------------------------------------
  async function fetchTrains() {
    try {
      const resp = await fetch('/api/trains');
      const data = await resp.json();
      // onTrainUpdate handles arrival detection and pulse rings internally
      // No separate pulse() loop needed (was causing double-pulsing)
      StationLayer.onTrainUpdate(data.trains);
    } catch (err) {
      console.error('[trains] error:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // INTELLIGENCE PANEL
  // ---------------------------------------------------------------------------
  async function fetchIntelligence() {
    try {
      const resp = await fetch('/api/intelligence');
      const data = await resp.json();

      const reportEl = $('intelReport');
      const timeEl = $('intelTime');
      const anomaliesEl = $('intelAnomalies');

      if (data.report) {
        reportEl.textContent = data.report;
        reportEl.classList.remove('empty');
      } else if (data.error) {
        reportEl.textContent = data.error === 'No API key configured'
          ? 'Set ANTHROPIC_API_KEY in .env for AI analysis'
          : 'Analysis unavailable';
        reportEl.classList.add('empty');
      }

      if (data.generated) {
        const date = new Date(data.generated);
        timeEl.textContent = `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
      }

      if (data.anomalies && data.anomalies.length > 0) {
        anomaliesEl.innerHTML = data.anomalies.slice(0, 5).map(a => {
          const pct = Math.round(a.score * 100);
          const cls = pct > 0 ? 'positive' : 'negative';
          const sign = pct > 0 ? '+' : '';
          return `<div class="intel-anomaly">
            <span class="intel-anomaly-name">${escapeHtml(a.name)}</span>
            <span class="intel-anomaly-score ${cls}">${sign}${pct}%</span>
          </div>`;
        }).join('');
        anomaliesEl.style.display = '';
      } else {
        anomaliesEl.style.display = 'none';
      }
    } catch (err) {
      console.error('[intelligence] error:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // ALERTS
  // ---------------------------------------------------------------------------
  let alertsVisible = false;
  window.toggleAlerts = function() {
    alertsVisible = !alertsVisible;
    $('alertsPanel').classList.toggle('visible', alertsVisible);
  };

  async function fetchAlerts() {
    try {
      const resp = await fetch('/api/alerts');
      const data = await resp.json();
      const alerts = data.alerts;

      const badge = $('alertBadge');
      const critical = alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length;
      badge.textContent = alerts.length;
      badge.className = 'alert-badge' + (critical > 0 ? ' active' : '');

      const container = $('alertsList');
      if (alerts.length === 0) {
        container.innerHTML = '<div class="no-alerts">No active alerts</div>';
        return;
      }

      container.innerHTML = alerts.map(alert => {
        const routes = alert.affectedRoutes.slice(0, 8).map(r => {
          const c = LINE_COLORS[r] || '#666';
          const tc = ['N','Q','R','W'].includes(r) ? '#000' : '#fff';
          return `<div class="alert-route-badge" style="background:${c};color:${tc}">${escapeHtml(r)}</div>`;
        }).join('');

        return `
          <div class="alert-item ${alert.severity}">
            <div class="alert-item-top">
              <div class="alert-routes">${routes}</div>
              <span class="alert-effect-tag">${escapeHtml(alert.effect)}</span>
            </div>
            <div class="alert-title">${escapeHtml(alert.header)}</div>
            ${alert.description ? `<div class="alert-desc">${escapeHtml(alert.description)}</div>` : ''}
          </div>
        `;
      }).join('');
    } catch (e) {
      console.error('[alerts] error:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // STATION CLICK
  // ---------------------------------------------------------------------------
  map.on('click', 'station-circles', (e) => {
    if (!e.features || e.features.length === 0) return;
    const props = e.features[0].properties;
    const coords = e.features[0].geometry.coordinates;

    const anomalyPct = Math.round(props.anomalyScore * 100);
    const anomalySign = anomalyPct > 0 ? '+' : '';
    let anomalyHtml = '';
    if (props.isAnomaly) {
      const cls = anomalyPct > 0 ? 'surge' : 'quiet';
      const label = anomalyPct > 0 ? 'SURGE' : 'QUIET';
      anomalyHtml = `<div class="popup-anomaly ${cls}">${label} ${anomalySign}${anomalyPct}% vs baseline</div>`;
    }

    const safetyColors = { safe: 'var(--green)', caution: 'var(--amber)', avoid: 'var(--red)' };
    const safetyLabels = { safe: 'SAFE', caution: 'CAUTION', avoid: 'AVOID' };
    const sl = props.safetyLevel || 'safe';
    const crimeRiskPct = Math.round((props.crimeRisk || 0) * 100);
    const crimeType = props.topCrimeType ? escapeHtml(props.topCrimeType.toLowerCase()) : 'none reported';

    new mapboxgl.Popup({ closeButton: true })
      .setLngLat(coords)
      .setHTML(`
        <div class="popup-station-name">${escapeHtml(props.name)}</div>
        <div class="popup-safety-badge" style="background:${safetyColors[sl]}20;color:${safetyColors[sl]};border:1px solid ${safetyColors[sl]}40;padding:3px 8px;border-radius:3px;font-size:10px;font-weight:600;text-align:center;margin-bottom:6px">${safetyLabels[sl]}</div>
        <div class="popup-row">
          <span class="popup-label">Current</span>
          <span class="popup-value">${props.ridership.toLocaleString()} riders/hr</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Baseline</span>
          <span class="popup-value">${props.baseline.toLocaleString()} riders/hr</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Deviation</span>
          <span class="popup-value">${anomalySign}${anomalyPct}%</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Crime Risk</span>
          <span class="popup-value" style="color:${crimeRiskPct > 50 ? 'var(--red)' : crimeRiskPct > 25 ? 'var(--amber)' : 'var(--green)'}">${crimeRiskPct}%</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Primary Threat</span>
          <span class="popup-value">${crimeType}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Incidents (6mo)</span>
          <span class="popup-value">${props.crimeTotal || 0}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Trains nearby</span>
          <span class="popup-value">${props.trainCount || 0}</span>
        </div>
        ${anomalyHtml}
      `)
      .addTo(map);
  });

  map.on('mouseenter', 'station-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'station-circles', () => { map.getCanvas().style.cursor = ''; });

  // ---------------------------------------------------------------------------
  // ROTATION CONTROLS
  // ---------------------------------------------------------------------------
  let rotateInterval = null;

  function startRotate(direction) {
    if (rotateInterval) return;
    rotateInterval = setInterval(() => {
      map.easeTo({ bearing: map.getBearing() + direction * 10, duration: 200 });
    }, 200);
  }

  function stopRotate() {
    if (rotateInterval) {
      clearInterval(rotateInterval);
      rotateInterval = null;
    }
  }

  $('rotateCCW').addEventListener('mousedown', () => startRotate(-1));
  $('rotateCCW').addEventListener('touchstart', (e) => { e.preventDefault(); startRotate(-1); });
  $('rotateCW').addEventListener('mousedown', () => startRotate(1));
  $('rotateCW').addEventListener('touchstart', (e) => { e.preventDefault(); startRotate(1); });
  window.addEventListener('mouseup', stopRotate);
  window.addEventListener('touchend', stopRotate);

  // ---------------------------------------------------------------------------
  // STATION SEARCH
  // ---------------------------------------------------------------------------
  const searchInput = $('stationSearch');
  const searchResults = $('stationResults');

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query || !presenceData) {
      searchResults.classList.remove('visible');
      return;
    }

    const matches = presenceData.stations
      .filter(s => s.name.toLowerCase().includes(query))
      .sort((a, b) => (b.ridership || 0) - (a.ridership || 0))
      .slice(0, 10);

    if (matches.length === 0) {
      searchResults.innerHTML = '<div class="station-result-item" style="color:var(--text-dim)">No matches</div>';
      searchResults.classList.add('visible');
      return;
    }

    searchResults.innerHTML = matches.map(s => {
      const anomalyTag = s.isAnomaly
        ? `<span class="station-result-anomaly ${s.anomalyScore > 0 ? 'surge' : 'quiet'}">${s.anomalyScore > 0 ? 'SURGE' : 'QUIET'}</span>`
        : '';
      return `<div class="station-result-item" data-lon="${s.lon}" data-lat="${s.lat}" data-name="${escapeHtml(s.name)}">
        <span class="station-result-name">${escapeHtml(s.name)}</span>
        <span class="station-result-riders">${formatNumber(s.ridership || 0)}/hr</span>
        ${anomalyTag}
      </div>`;
    }).join('');

    searchResults.classList.add('visible');
  });

  searchResults.addEventListener('click', (e) => {
    const item = e.target.closest('.station-result-item');
    if (!item || !item.dataset.lon) return;

    const lon = parseFloat(item.dataset.lon);
    const lat = parseFloat(item.dataset.lat);

    map.flyTo({
      center: [lon, lat],
      zoom: 15,
      pitch: 55,
      duration: 1500
    });

    searchInput.value = item.dataset.name;
    searchResults.classList.remove('visible');
  });

  // Close search results when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.station-search')) {
      searchResults.classList.remove('visible');
    }
  });

  // Escape key clears search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchResults.classList.remove('visible');
      searchInput.blur();
    }
  });

  // ---------------------------------------------------------------------------
  // BOOT
  // ---------------------------------------------------------------------------
  setStatus('loading', 'LOADING');
  updateClock();
  setInterval(updateClock, 1000);

  StationLayer.init(map);

  setStatus('loading', 'FETCHING');
  await fetchPresence();
  setStatus('live', 'LIVE');

  fetchTrains();
  fetchAlerts();
  fetchIntelligence();

  setInterval(fetchPresence, 30000);
  setInterval(fetchTrains, 30000);
  setInterval(fetchAlerts, 60000);
  setInterval(() => {
    if (!document.hidden) fetchIntelligence();
  }, 900000);

})();
