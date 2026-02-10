// Station pulse rings on canvas overlay. Train arrivals trigger expanding ring animations.
const StationLayer = (() => {
  let canvas, ctx, map;
  let stations = [];
  let rings = [];
  let prevStops = new Set();
  let animFrame = null, running = false;

  const DURATION = 90, MAX_R = 40, LINE_W = 1.5, ANOM_SPEED = 2;

  function render() {
    if (!ctx || !map) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.pow(1.2, map.getZoom() - 12);
    const alive = [];
    for (const r of rings) {
      r.age += r.speed;
      if (r.age >= r.max) continue;
      const pt = map.project([r.lon, r.lat]);
      const p = r.age / r.max;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, p * MAX_R * scale, 0, Math.PI * 2);
      ctx.strokeStyle = r.anom ? `rgba(255,34,68,${(1-p)*0.6})` : `rgba(255,255,255,${(1-p)*0.5})`;
      ctx.lineWidth = LINE_W * (1 - p * 0.5);
      ctx.stroke();
      alive.push(r);
    }
    rings = alive;
  }

  function frame() { if (!running) return; render(); animFrame = requestAnimationFrame(frame); }

  function resize() {
    if (!canvas || !map) return;
    const c = map.getContainer();
    canvas.width = c.clientWidth;
    canvas.height = c.clientHeight;
  }

  return {
    init(m) {
      map = m; canvas = document.getElementById('pulseCanvas');
      if (!canvas) return;
      ctx = canvas.getContext('2d');
      resize(); map.on('resize', resize);
      running = true; frame();
    },
    setStations(s) { stations = s; },
    onTrainUpdate(trains) {
      const cur = new Set();
      for (const t of trains) {
        if (t.status === 'At Station' || t.status === 'Incoming') {
          const id = t.stopId?.replace(/[NS]$/, '');
          if (id) cur.add(id);
        }
      }
      for (const id of cur) {
        if (prevStops.has(id)) continue;
        const s = stations.find(s => s.id === id);
        if (s) rings.push({ lat: s.lat, lon: s.lon, age: 0, max: DURATION, anom: s.isAnomaly, speed: s.isAnomaly ? ANOM_SPEED : 1 });
      }
      prevStops = cur;
    },
    pulse(lat, lon, anom) { rings.push({ lat, lon, age: 0, max: DURATION, anom: !!anom, speed: anom ? ANOM_SPEED : 1 }); }
  };
})();
