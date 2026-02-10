(async () => {
  const $ = id => document.getElementById(id);

  // Fetch config
  let mapboxToken = '';
  try {
    const config = await (await fetch('/api/config')).json();
    mapboxToken = config.mapboxToken;
  } catch (e) {}

  if (!mapboxToken) {
    document.body.insertAdjacentHTML('beforeend',
      `<div class="token-warning">No Mapbox token found.<br>Add <code>MAPBOX_TOKEN=pk.your_token</code> to .env</div>`
    );
    return;
  }

  // Map
  mapboxgl.accessToken = mapboxToken;
  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-73.9855, 40.7580],
    zoom: 12, pitch: 50, bearing: -17.5,
    antialias: true, minZoom: 9, maxZoom: 18
  });
  map.addControl(new mapboxgl.NavigationControl(), 'top-left');

  // Helpers
  const esc = t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; };
  const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? Math.round(n).toLocaleString() : String(n);

  const LINE_COLORS = {
    '1':'#EE352E','2':'#EE352E','3':'#EE352E',
    '4':'#00933C','5':'#00933C','6':'#00933C',
    '7':'#B933AD',
    'A':'#0039A6','C':'#0039A6','E':'#0039A6',
    'B':'#FF6319','D':'#FF6319','F':'#FF6319','M':'#FF6319',
    'G':'#6CBE45','J':'#996633','Z':'#996633','L':'#A7A9AC',
    'N':'#FCCC0A','Q':'#FCCC0A','R':'#FCCC0A','W':'#FCCC0A',
    'S':'#808183','SI':'#0039A6','SIR':'#0039A6'
  };

  function getCityPhase(h) {
    if (h < 5) return 'Dead Hours';
    if (h < 7) return 'Early Risers';
    if (h < 10) return 'Morning Rush';
    if (h < 12) return 'Midday Build';
    if (h < 14) return 'Lunch Surge';
    if (h < 15) return 'Afternoon Lull';
    if (h < 16) return 'School Dismissal';
    if (h < 19) return 'Evening Rush';
    if (h < 22) return 'Night Activity';
    return 'Late Night';
  }

  // Status + clock
  function setStatus(state, text) {
    $('statusDot').className = 'hud-dot' + (state === 'error' ? ' error' : state === 'loading' ? ' loading' : '');
    $('statusText').textContent = text;
  }
  function updateClock() {
    const n = new Date();
    $('clock').textContent = [n.getHours(), n.getMinutes(), n.getSeconds()].map(v => String(v).padStart(2,'0')).join(':');
    $('cityPhase').textContent = getCityPhase(n.getHours());
  }

  // Wait for map
  await new Promise(r => map.on('load', r));

  // Strip labels
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'symbol' && layer['source-layer'] !== 'water_label')
      map.setLayoutProperty(layer.id, 'visibility', 'none');
  }

  // 3D buildings
  map.addLayer({
    id: '3d-buildings', source: 'composite', 'source-layer': 'building',
    filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 12,
    paint: {
      'fill-extrusion-color': '#12121a',
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': ['get', 'min_height'],
      'fill-extrusion-opacity': 0.5
    }
  });

  // Presence source + layers
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('presence', { type: 'geojson', data: empty });

  // Bloom glow (wide soft aura)
  map.addLayer({
    id: 'presence-bloom', type: 'heatmap', source: 'presence', maxzoom: 17,
    paint: {
      'heatmap-weight': ['get', 'weight'],
      'heatmap-intensity': ['interpolate',['linear'],['zoom'], 10,0.4, 14,0.7, 17,1.0],
      'heatmap-radius': ['interpolate',['linear'],['zoom'], 10,30, 12,55, 14,90, 16,130],
      'heatmap-color': ['interpolate',['linear'],['heatmap-density'],
        0,'rgba(0,0,0,0)', 0.05,'rgba(20,3,0,0.08)', 0.15,'rgba(60,15,0,0.12)',
        0.3,'rgba(140,40,5,0.18)', 0.5,'rgba(200,80,20,0.22)',
        0.7,'rgba(255,130,50,0.25)', 1.0,'rgba(255,180,100,0.3)'],
      'heatmap-opacity': 0.9
    }
  }, '3d-buildings');

  // Core heatmap
  map.addLayer({
    id: 'presence-heat', type: 'heatmap', source: 'presence', maxzoom: 17,
    paint: {
      'heatmap-weight': ['get', 'weight'],
      'heatmap-intensity': ['interpolate',['linear'],['zoom'], 10,0.8, 14,1.5, 17,2.5],
      'heatmap-radius': ['interpolate',['linear'],['zoom'], 10,12, 12,22, 14,40, 16,60],
      'heatmap-color': ['interpolate',['linear'],['heatmap-density'],
        0,'rgba(0,0,0,0)', 0.05,'rgba(30,5,0,0.2)', 0.15,'rgba(80,20,0,0.35)',
        0.3,'rgba(180,60,10,0.45)', 0.5,'rgba(255,120,40,0.55)',
        0.7,'rgba(255,170,80,0.65)', 0.9,'rgba(255,210,140,0.75)',
        1.0,'rgba(255,240,200,0.85)'],
      'heatmap-opacity': 0.85
    }
  });

  // Station glow halos
  map.addLayer({
    id: 'station-glow', type: 'circle', source: 'presence', minzoom: 12,
    paint: {
      'circle-radius': ['interpolate',['linear'],['get','ridership'], 0,6, 500,10, 2000,16, 5000,22],
      'circle-color': ['match',['get','safetyLevel'], 'safe','#00ff88', 'caution','#ff8800', 'avoid','#ff2244', '#ffaa44'],
      'circle-opacity': ['interpolate',['linear'],['get','ridership'], 0,0.05, 500,0.1, 2000,0.15, 5000,0.2],
      'circle-blur': 1
    }
  });

  // Station circles
  map.addLayer({
    id: 'station-circles', type: 'circle', source: 'presence', minzoom: 12,
    paint: {
      'circle-radius': ['interpolate',['linear'],['get','ridership'], 0,2, 500,3, 2000,5, 5000,7],
      'circle-color': ['match',['get','safetyLevel'], 'safe','#00ff88', 'caution','#ff8800', 'avoid','#ff2244', '#ffaa44'],
      'circle-opacity': 0.9, 'circle-blur': 0.15,
      'circle-stroke-width': ['match',['get','safetyLevel'], 'avoid',1.5, 0.5],
      'circle-stroke-color': ['match',['get','safetyLevel'],
        'avoid','rgba(255,34,68,0.6)', 'caution','rgba(255,136,0,0.3)', 'rgba(255,255,255,0.15)']
    }
  });

  // Presence data
  let presenceData = null;

  function toGeoJSON(data) {
    const max = data.stations.reduce((m, s) => Math.max(m, s.ridership || 0), 1);
    return {
      type: 'FeatureCollection',
      features: data.stations.map(s => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: {
          id: s.id, name: s.name, ridership: s.ridership || 0, baseline: s.baseline || 0,
          weight: (s.ridership || 0) / max, anomalyScore: s.anomalyScore || 0,
          isAnomaly: s.isAnomaly || false, trainCount: s.trainCount || 0,
          crimeRisk: s.crimeRisk || 0, crimeTotal: s.crimeTotal || 0,
          topCrimeType: s.topCrimeType || '', safetyLevel: s.safetyLevel || 'safe'
        }
      }))
    };
  }

  async function fetchPresence() {
    try {
      presenceData = await (await fetch('/api/presence')).json();
      $('presenceCount').textContent = fmt(presenceData.totalPresence);
      $('stationCount').textContent = presenceData.stations.length;
      $('anomalyCount').textContent = presenceData.anomalyCount || 0;

      // Night mode
      if (presenceData.isNightMode) {
        $('nightBadge').style.display = '';
        document.body.classList.add('night-mode');
      } else {
        $('nightBadge').style.display = 'none';
        document.body.classList.remove('night-mode');
      }

      // Safety stats
      if (presenceData.safetyStats) {
        const ss = presenceData.safetyStats;
        $('safetyStats').innerHTML = `<span class="safety-safe">${ss.safe}</span>/<span class="safety-caution">${ss.caution}</span>/<span class="safety-avoid">${ss.avoid}</span>`;
      }

      map.getSource('presence').setData(toGeoJSON(presenceData));
      StationLayer.setStations(presenceData.stations);
    } catch (err) {
      console.error('[presence]', err);
    }
  }

  // Breathing
  setInterval(() => {
    const b = Math.sin(performance.now() * 0.00015);
    try {
      map.setPaintProperty('presence-heat', 'heatmap-opacity', 0.80 + b * 0.08);
      map.setPaintProperty('presence-bloom', 'heatmap-opacity', 0.85 + b * 0.1);
    } catch (e) {}
  }, 2000);

  // Trains
  async function fetchTrains() {
    try {
      const data = await (await fetch('/api/trains')).json();
      StationLayer.onTrainUpdate(data.trains);
    } catch (err) {
      console.error('[trains]', err);
    }
  }

  // Intelligence
  async function fetchIntelligence() {
    try {
      const data = await (await fetch('/api/intelligence')).json();
      const reportEl = $('intelReport'), timeEl = $('intelTime'), anomEl = $('intelAnomalies');

      if (data.report) {
        reportEl.textContent = data.report;
        reportEl.classList.remove('empty');
      } else if (data.error) {
        let msg;
        if (data.error === 'No API key configured') msg = 'Set ANTHROPIC_API_KEY in .env';
        else if (data.error.includes?.('Warming up')) { msg = 'Warming up...'; setTimeout(fetchIntelligence, 15000); }
        else msg = data.debug ? `Error: ${data.debug}` : 'Analysis temporarily unavailable';
        reportEl.textContent = msg;
        reportEl.classList.add('empty');
      }

      if (data.generated) {
        const d = new Date(data.generated);
        timeEl.textContent = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      }

      if (data.anomalies?.length > 0) {
        anomEl.innerHTML = data.anomalies.slice(0, 5).map(a => {
          const pct = Math.round(a.score * 100), cls = pct > 0 ? 'positive' : 'negative';
          return `<div class="intel-anomaly"><span class="intel-anomaly-name">${esc(a.name)}</span><span class="intel-anomaly-score ${cls}">${pct > 0 ? '+' : ''}${pct}%</span></div>`;
        }).join('');
        anomEl.style.display = '';
      } else {
        anomEl.style.display = 'none';
      }
    } catch (err) { console.error('[intelligence]', err); }
  }

  // Alerts
  let alertsVisible = false;
  window.toggleAlerts = () => {
    alertsVisible = !alertsVisible;
    $('alertsPanel').classList.toggle('visible', alertsVisible);
  };

  async function fetchAlerts() {
    try {
      const data = await (await fetch('/api/alerts')).json();
      const alerts = data.alerts;
      const badge = $('alertBadge');
      const critical = alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length;
      badge.textContent = alerts.length;
      badge.className = 'alert-badge' + (critical > 0 ? ' active' : '');

      const container = $('alertsList');
      if (alerts.length === 0) { container.innerHTML = '<div class="no-alerts">No active alerts</div>'; return; }

      container.innerHTML = alerts.map(a => {
        const routes = a.affectedRoutes.slice(0, 8).map(r => {
          const c = LINE_COLORS[r] || '#666', tc = ['N','Q','R','W'].includes(r) ? '#000' : '#fff';
          return `<div class="alert-route-badge" style="background:${c};color:${tc}">${esc(r)}</div>`;
        }).join('');
        return `<div class="alert-item ${a.severity}">
          <div class="alert-item-top"><div class="alert-routes">${routes}</div><span class="alert-effect-tag">${esc(a.effect)}</span></div>
          <div class="alert-title">${esc(a.header)}</div>
          ${a.description ? `<div class="alert-desc">${esc(a.description)}</div>` : ''}
        </div>`;
      }).join('');
    } catch (e) { console.error('[alerts]', e); }
  }

  // Station click
  map.on('click', 'station-circles', e => {
    if (!e.features?.length) return;
    const p = e.features[0].properties, coords = e.features[0].geometry.coordinates;
    const apct = Math.round(p.anomalyScore * 100), asign = apct > 0 ? '+' : '';
    const sl = p.safetyLevel || 'safe';
    const slColors = { safe: 'var(--green)', caution: 'var(--amber)', avoid: 'var(--red)' };
    const crPct = Math.round((p.crimeRisk || 0) * 100);

    let anomalyHtml = '';
    if (p.isAnomaly) {
      const cls = apct > 0 ? 'surge' : 'quiet', label = apct > 0 ? 'SURGE' : 'QUIET';
      anomalyHtml = `<div class="popup-anomaly ${cls}">${label} ${asign}${apct}% vs baseline</div>`;
    }

    new mapboxgl.Popup({ closeButton: true }).setLngLat(coords).setHTML(`
      <div class="popup-station-name">${esc(p.name)}</div>
      <div style="background:${slColors[sl]}20;color:${slColors[sl]};border:1px solid ${slColors[sl]}40;padding:3px 8px;border-radius:3px;font-size:10px;font-weight:600;text-align:center;margin-bottom:6px">${sl.toUpperCase()}</div>
      <div class="popup-row"><span class="popup-label">Current</span><span class="popup-value">${p.ridership.toLocaleString()}/hr</span></div>
      <div class="popup-row"><span class="popup-label">Baseline</span><span class="popup-value">${p.baseline.toLocaleString()}/hr</span></div>
      <div class="popup-row"><span class="popup-label">Deviation</span><span class="popup-value">${asign}${apct}%</span></div>
      <div class="popup-row"><span class="popup-label">Crime Risk</span><span class="popup-value" style="color:${crPct > 50 ? 'var(--red)' : crPct > 25 ? 'var(--amber)' : 'var(--green)'}">${crPct}%</span></div>
      <div class="popup-row"><span class="popup-label">Primary Threat</span><span class="popup-value">${p.topCrimeType ? esc(p.topCrimeType.toLowerCase()) : 'none'}</span></div>
      <div class="popup-row"><span class="popup-label">Incidents (6mo)</span><span class="popup-value">${p.crimeTotal || 0}</span></div>
      <div class="popup-row"><span class="popup-label">Trains nearby</span><span class="popup-value">${p.trainCount || 0}</span></div>
      ${anomalyHtml}
    `).addTo(map);
  });
  map.on('mouseenter', 'station-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'station-circles', () => { map.getCanvas().style.cursor = ''; });

  // Rotation
  let rotateInt = null;
  const startRotate = dir => { if (rotateInt) return; rotateInt = setInterval(() => map.easeTo({ bearing: map.getBearing() + dir * 10, duration: 200 }), 200); };
  const stopRotate = () => { clearInterval(rotateInt); rotateInt = null; };
  $('rotateCCW').addEventListener('mousedown', () => startRotate(-1));
  $('rotateCCW').addEventListener('touchstart', e => { e.preventDefault(); startRotate(-1); });
  $('rotateCW').addEventListener('mousedown', () => startRotate(1));
  $('rotateCW').addEventListener('touchstart', e => { e.preventDefault(); startRotate(1); });
  window.addEventListener('mouseup', stopRotate);
  window.addEventListener('touchend', stopRotate);

  // Station search
  const searchInput = $('stationSearch'), searchResults = $('stationResults');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q || !presenceData) { searchResults.classList.remove('visible'); return; }
    const matches = presenceData.stations.filter(s => s.name.toLowerCase().includes(q))
      .sort((a, b) => (b.ridership || 0) - (a.ridership || 0)).slice(0, 10);
    if (!matches.length) { searchResults.innerHTML = '<div class="station-result-item" style="color:var(--text-dim)">No matches</div>'; searchResults.classList.add('visible'); return; }
    searchResults.innerHTML = matches.map(s => {
      const tag = s.isAnomaly ? `<span class="station-result-anomaly ${s.anomalyScore > 0 ? 'surge' : 'quiet'}">${s.anomalyScore > 0 ? 'SURGE' : 'QUIET'}</span>` : '';
      return `<div class="station-result-item" data-lon="${s.lon}" data-lat="${s.lat}" data-name="${esc(s.name)}"><span class="station-result-name">${esc(s.name)}</span><span class="station-result-riders">${fmt(s.ridership||0)}/hr</span>${tag}</div>`;
    }).join('');
    searchResults.classList.add('visible');
  });
  searchResults.addEventListener('click', e => {
    const item = e.target.closest('.station-result-item');
    if (!item?.dataset.lon) return;
    map.flyTo({ center: [+item.dataset.lon, +item.dataset.lat], zoom: 15, pitch: 55, duration: 1500 });
    searchInput.value = item.dataset.name;
    searchResults.classList.remove('visible');
  });
  document.addEventListener('click', e => { if (!e.target.closest('.station-search')) searchResults.classList.remove('visible'); });
  searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') { searchInput.value = ''; searchResults.classList.remove('visible'); searchInput.blur(); } });

  // Boot
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
  setInterval(() => { if (!document.hidden) fetchIntelligence(); }, 300000);
})();
