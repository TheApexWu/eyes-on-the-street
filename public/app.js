// EYES ON THE STREET v2 - Main Application
// Orchestrates particle simulation, station rings, intelligence panel, HUD

(() => {
  // ---------------------------------------------------------------------------
  // MAP INIT
  // ---------------------------------------------------------------------------
  const map = L.map('map', {
    zoomControl: true,
    attributionControl: true
  }).setView([40.7580, -73.9855], 12);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19
  }).addTo(map);

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  const $ = id => document.getElementById(id);

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

  // ---------------------------------------------------------------------------
  // STATUS + CLOCK
  // ---------------------------------------------------------------------------
  function setStatus(state, text) {
    const dot = $('statusDot');
    dot.className = 'hud-dot' + (state === 'error' ? ' error' : state === 'loading' ? ' loading' : '');
    $('statusText').textContent = text;
  }

  // City rhythm phases - what's happening in the city right now
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

  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    $('clock').textContent = `${h}:${m}:${s}`;
    $('cityPhase').textContent = getCityPhase(now.getHours());
  }

  // ---------------------------------------------------------------------------
  // LINE COLORS (for alert badges)
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
  // PRESENCE DATA
  // ---------------------------------------------------------------------------
  let presenceData = null;

  async function fetchPresence() {
    try {
      const resp = await fetch('/api/presence');
      presenceData = await resp.json();

      // Update HUD
      $('presenceCount').textContent = formatNumber(presenceData.totalPresence);
      $('stationCount').textContent = presenceData.stations.length;
      $('anomalyCount').textContent = presenceData.anomalyCount || 0;

      // Feed data to particle engine and station layer
      ParticleEngine.setStations(presenceData.stations);
      StationLayer.setStations(presenceData.stations);

      return presenceData;
    } catch (err) {
      console.error('[presence] error:', err);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // TRAIN DATA (for station pulse detection)
  // ---------------------------------------------------------------------------
  async function fetchTrains() {
    try {
      const resp = await fetch('/api/trains');
      const data = await resp.json();

      // Feed to station layer for pulse ring detection
      StationLayer.onTrainUpdate(data.trains);

      // Also trigger pulses for stations where trains are arriving
      for (const train of data.trains) {
        if (train.status === 'At Station' && train.latitude && train.longitude) {
          StationLayer.pulse(train.latitude, train.longitude, false);
        }
      }

      return data;
    } catch (err) {
      console.error('[trains] error:', err);
      return null;
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
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        timeEl.textContent = `${h}:${m}`;
      }

      // Render anomaly list
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
  // STATION CLICK INTERACTION
  // ---------------------------------------------------------------------------
  let activePopup = null;

  map.on('click', (e) => {
    if (activePopup) {
      map.closePopup(activePopup);
      activePopup = null;
    }

    const station = StationLayer.getStationAt(e.latlng, 25);
    if (!station) return;

    const anomalyPct = Math.round(station.anomalyScore * 100);
    const anomalySign = anomalyPct > 0 ? '+' : '';
    let anomalyHtml = '';
    if (station.isAnomaly) {
      const cls = anomalyPct > 0 ? 'surge' : 'quiet';
      const label = anomalyPct > 0 ? 'SURGE' : 'QUIET';
      anomalyHtml = `<div class="popup-anomaly ${cls}">${label} ${anomalySign}${anomalyPct}% vs baseline</div>`;
    }

    const html = `
      <div class="popup-station-name">${escapeHtml(station.name)}</div>
      <div class="popup-row">
        <span class="popup-label">Current</span>
        <span class="popup-value">${station.ridership.toLocaleString()} riders/hr</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Baseline</span>
        <span class="popup-value">${station.baseline.toLocaleString()} riders/hr</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Deviation</span>
        <span class="popup-value">${anomalySign}${anomalyPct}%</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Trains nearby</span>
        <span class="popup-value">${station.trainCount || 0}</span>
      </div>
      ${anomalyHtml}
    `;

    activePopup = L.popup({
      closeButton: true,
      className: 'station-popup'
    })
      .setLatLng([station.lat, station.lon])
      .setContent(html)
      .openOn(map);
  });

  // ---------------------------------------------------------------------------
  // BOOT
  // ---------------------------------------------------------------------------
  async function boot() {
    setStatus('loading', 'LOADING');
    updateClock();
    setInterval(updateClock, 1000);

    // Init canvas engines
    ParticleEngine.init(map);
    StationLayer.init(map);

    // Initial data load
    setStatus('loading', 'FETCHING');
    await fetchPresence();
    setStatus('live', 'LIVE');

    // Stagger other fetches
    fetchTrains();
    fetchAlerts();
    fetchIntelligence();

    // Refresh intervals
    setInterval(fetchPresence, 30000);       // Presence: 30s
    setInterval(fetchTrains, 30000);         // Trains: 30s (for pulse detection)
    setInterval(fetchAlerts, 60000);         // Alerts: 1min
    setInterval(fetchIntelligence, 300000);  // Intelligence: 5min
  }

  boot();
})();
