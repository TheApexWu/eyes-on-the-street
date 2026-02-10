# Eyes on the Street

Real-time crowd presence simulation for NYC. Models the flow of human bodies through 428 subway stations using MTA ridership data, GTFS-RT train feeds, and Claude-generated intelligence reports.

Jane Jacobs said a safe street is one with eyes on it. This system estimates that presence.

## How it works

1. **Ridership model**: 4 weeks of MTA hourly ridership data (1M+ rows) aggregated into per-station profiles by hour and day-of-week. Pre-computed once via `npm run build-model`.
2. **Real-time modulation**: GTFS-RT feeds report actual train arrivals. The server compares live train frequency against expected frequency and scales ridership estimates up or down.
3. **Anomaly detection**: If a station deviates more than 30% from its baseline for the current hour/day, it gets flagged. Surges glow red-hot. Dead zones go cold blue.
4. **Density heatmap**: Canvas overlay renders gaussian glow blobs at each station. Additive blending means overlapping stations (midtown corridor) merge into bright zones. The whole map breathes with a slow sine pulse.
5. **Intelligence reports**: Claude (Sonnet) generates a 3-5 line situation report every 15 minutes using the top 10 busiest stations and flagged anomalies as context.

## Quick start

```bash
npm install
npm run build-model   # fetches 4 weeks of MTA data, takes ~2 min
```

Create `.env`:
```
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

The intelligence panel works without a key. It just shows a placeholder.

```bash
npm start
# http://localhost:3000
```

## Architecture

```
eyes-on-the-street/
  scripts/
    build-model.js          # Fetches MTA Socrata API, outputs ridership-model.json
  server.js                 # Express server, /api/presence, /api/intelligence, /api/trains, /api/alerts
  public/
    index.html              # HUD, intelligence panel, canvas overlays
    app.js                  # Orchestration, data fetching, station click interaction
    simulation.js           # Density heatmap + movement flicker rendering
    stations.js             # Station dots, pulse ring animations, click detection
    data/
      ridership-model.json  # Pre-computed hourly ridership profiles (428 stations)
```

## API endpoints

| Endpoint | What it does | Cache |
|----------|-------------|-------|
| `GET /api/presence` | Per-station ridership estimate for current hour/day, modulated by live train data. Anomaly scores. | 30s |
| `GET /api/intelligence` | Claude-generated situation report from top stations and anomalies. | 5 min |
| `GET /api/trains` | Raw GTFS-RT train positions and stop time updates from all 8 MTA feeds. | None |
| `GET /api/alerts` | Service disruptions from MTA alerts feed, sorted by severity. | None |

## Data sources

- **Hourly ridership**: [MTA Subway Hourly Ridership](https://data.ny.gov/resource/5wq4-mkjj.json) (Socrata, no auth)
- **Real-time trains**: [MTA GTFS-RT feeds](https://api.mta.info/) (protobuf, no auth)
- **Service alerts**: [MTA GTFS-RT alerts](https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts)
- **Station coordinates**: [NY Open Data](https://data.ny.gov/Transportation/MTA-Subway-Stations/39hk-dx4f)
- **Map tiles**: [CARTO Dark](https://carto.com/basemaps/)

## The math

The heatmap normalizes ridership across all stations (`station.ridership / maxRidership`), then draws radial gradients with `sqrt` scaling on radius (so a station with 4x ridership gets 2x radius, not 4x). `globalCompositeOperation = 'lighter'` means overlapping blobs add their light values. Dense station clusters automatically form bright corridors without any special logic.

Train modulation: `ridership = baseline * (0.7 + 0.3 * actualTrains / expectedTrains)`, capped at 2x. Floor of 0.7 means ridership never drops below 70% even with zero trains, since people linger from earlier arrivals.

## License

MIT
