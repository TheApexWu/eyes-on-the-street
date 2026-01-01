# NYC MTA Live Subway Map

Real-time visualization of NYC subway train positions using MTA's GTFS-RT feeds.

![Live NYC Subway Map](https://img.shields.io/badge/MTA-Live%20Data-blue)

## Features

- Real-time train positions updated every 30 seconds
- All subway lines (1-7, A-G, J/Z, L, N/Q/R/W, S, SIR)
- Interactive map with station markers
- Dark mode UI
- No API key required (MTA feeds are now public)

## Quick Start

```bash
npm install
npm start
```

Then open http://localhost:3000

## Data Sources

- **Real-time feeds**: [MTA GTFS-RT](https://api.mta.info/) (no API key required)
- **Station data**: [NY Open Data](https://data.ny.gov/Transportation/MTA-Subway-Stations/39hk-dx4f)
- **Map tiles**: [CARTO Dark](https://carto.com/basemaps/)

## Feed URLs

| Lines | Feed URL |
|-------|----------|
| 1,2,3,4,5,6,7,S | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs` |
| A,C,E | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace` |
| B,D,F,M | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm` |
| G | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g` |
| J,Z | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz` |
| L | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l` |
| N,Q,R,W | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw` |
| SIR | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si` |

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Leaflet.js
- **Data Format**: GTFS-RT (Protocol Buffers)

## How It Works

1. Backend fetches GTFS-RT protobuf feeds from MTA
2. Decodes vehicle positions using gtfs-realtime-bindings
3. Frontend polls `/api/trains` every 30 seconds
4. Trains displayed on Leaflet map with official MTA colors

## Notes

- MTA GTFS-RT feeds contain vehicle positions when available
- Not all trains report real-time positions (depends on equipment)
- Some lines may show fewer trains due to data availability

## License

MIT
