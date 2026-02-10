# Eyes on the Street

**Live**: [eyes-on-the-street.vercel.app](https://eyes-on-the-street.vercel.app)

Real-time crowd presence and safety intelligence for NYC. Models the flow of human bodies through 428 subway stations using MTA ridership data, GTFS-RT train feeds, crime risk analysis, weather conditions, and Claude-generated intelligence reports.

Jane Jacobs said a safe street is one with eyes on it. This system estimates that presence.

## How it works

1. **Ridership model**: 4 weeks of MTA hourly ridership data (1M+ rows) aggregated into per-station profiles by hour and day-of-week, with standard deviation for anomaly detection. Pre-computed via `npm run build-model`.
2. **Crime model**: 6 months of NYPD complaint data (personal safety crimes only) mapped to nearby stations with recency-weighted scoring and absolute risk tiers. Pre-computed via `npm run build-crime`.
3. **Real-time modulation**: GTFS-RT feeds report actual train arrivals. The server compares live train frequency against expected frequency and scales ridership estimates up or down.
4. **Weather integration**: OpenWeatherMap data modulates ridership estimates (rain -20%, snow -30%, extreme temps -15%).
5. **Z-score anomaly detection**: Stations deviating beyond 2 standard deviations from baseline get flagged. Surges glow red-hot. Dead zones go cold blue.
6. **Safety levels**: Combines ridership presence with crime risk to classify each station as safe/caution/avoid, calibrated by time of day.
7. **Intelligence reports**: Claude generates structured situation reports (SITUATION / ASSESSMENT / RECOMMENDATION) using station data, anomalies, service alerts, weather, crime risk, and temporal memory from previous reports.

## Quick start

```bash
npm install
npm run build-model   # fetches 4 weeks of MTA ridership data
npm run build-crime   # fetches 6 months of NYPD crime data
```

Create `.env`:
```
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
MAPBOX_TOKEN=pk.your-mapbox-token
OPENWEATHER_API_KEY=your-key          # optional, degrades gracefully
KV_REST_API_URL=your-upstash-url      # optional, for persistent history
KV_REST_API_TOKEN=your-upstash-token  # optional, for persistent history
```

```bash
npm start
# http://localhost:3000
```

## Architecture

```
eyes-on-the-street/
  scripts/
    build-model.js          # MTA Socrata API -> ridership-model.json (hourly + stddev)
    build-crime-model.js    # NYPD Open Data -> crime-model.json (recency-weighted risk)
  server.js                 # Express server, intelligence pipeline, security middleware
  api/
    index.js                # Vercel serverless entry point
  public/
    index.html              # HUD, intelligence panel, canvas overlays
    app.js                  # Orchestration, data fetching, station interaction
    data/
      ridership-model.json  # Per-station hourly profiles with stddev (428 stations)
      crime-model.json      # Per-station crime risk by time window
  vercel.json               # Deployment config, security headers, rewrites
```

## API endpoints

| Endpoint | What it does | Cache |
|----------|-------------|-------|
| `GET /api/presence` | Per-station ridership estimate, weather-modulated, with safety levels and anomaly scores | 30s |
| `GET /api/intelligence` | Structured situation report from Claude with temporal trend detection | 5 min |
| `GET /api/alerts` | MTA service disruptions, sorted by severity | 60s |
| `GET /api/config` | Client configuration (Mapbox token) | 5 min |
| `GET /api/stations` | Station coordinates | static |
| `GET /health` | Health check | none |

## Data sources

- **Hourly ridership**: [MTA Subway Hourly Ridership](https://data.ny.gov/resource/5wq4-mkjj.json) (Socrata, no auth)
- **Crime data**: [NYPD Complaint Data](https://data.cityofnewyork.us/resource/5uac-w243.json) (NYC Open Data, no auth)
- **Real-time trains**: [MTA GTFS-RT feeds](https://api.mta.info/) (protobuf, no auth)
- **Service alerts**: [MTA GTFS-RT alerts](https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts)
- **Weather**: [OpenWeatherMap](https://openweathermap.org/api) (optional)
- **Map tiles**: [Mapbox GL JS](https://www.mapbox.com/)

## Security

- CORS restricted to production origins only
- CSP, X-Frame-Options, X-Content-Type-Options, Permissions-Policy, Referrer-Policy on all routes
- Rate limiting on intelligence endpoint (20 req/5min)
- Debug endpoint blocked in production
- gzip compression on all API responses
- No server fingerprinting (x-powered-by disabled)

## The math

**Ridership**: The heatmap normalizes ridership across all stations, drawing radial gradients with `sqrt` scaling on radius. `globalCompositeOperation = 'lighter'` means overlapping blobs add their light values — dense clusters automatically form bright corridors.

**Anomaly detection**: Z-score based. Each station has per-hour/day standard deviation from 4 weeks of data. Deviations beyond 2 sigma with a baseline above 50 riders trigger anomaly flags.

**Crime risk**: Recency-weighted with a 30-day half-life exponential decay. Absolute risk tiers (critical/elevated/moderate/low) based on weighted incident count. Late-night incidents weighted 2x in overall risk score.

**Weather modulation**: Rain reduces street-level ridership estimates by 20%, snow by 30%, extreme temperatures by 15%.

## License

MIT
