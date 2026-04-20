# 🛰️ Orbitrack

Real-time 3D satellite tracker powered by CelesTrak. Visualize the ISS, Hubble, and thousands of other satellites on an interactive globe — or deploy your own custom orbit.

![Orbitrack Demo](./public/favicon.svg)

---

## Features

- **Live satellite tracking** — real-time positions pulled from CelesTrak for hundreds of satellites
- **Interactive 3D globe** — rotate, zoom, and follow any satellite in orbit
- **Orbital telemetry** — live altitude, velocity, orbital period, inclination, apogee/perigee, and sub-satellite point
- **Custom orbit deployment** — define your own satellite with custom altitude, velocity, inclination, and flight path
- **Time scale control** — speed up simulation up to 120× to watch orbits unfold
- **Imperial/metric toggle** — switch units on the fly
- **CelesTrak group support** — browse and load satellites by category

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/thanish312/orbitrack.git
cd orbitrack

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Usage

### Tracking a satellite
- Search by name or NORAD ID (e.g. `ISS`, `HUBBLE`, `25544`)
- Or use the **Presets** panel to load a popular satellite instantly
- Or browse by **CelesTrak group** (weather, GPS, debris, etc.)

### Deploying a custom satellite
Fill in the **Deploy Custom** panel on the right:
- **Altitude (km)** — how high above Earth
- **Velocity (km/s)** — orbital speed
- **Inclination (°)** — tilt of the orbit relative to the equator
- **Flight Path (°)** — angle of ascent/descent
- Hit **Deploy** and watch it go

### Controls
| Control | Action |
|---|---|
| Drag | Rotate the globe |
| Scroll | Zoom in/out |
| Follow toggle | Lock camera to the satellite |
| Time scale slider | Speed up or slow down simulation |

---

## Data Source

Satellite TLE and OMM data is sourced from [CelesTrak](https://celestrak.org/), maintained by Dr. T.S. Kelso.

---

## Tech Stack

- **Framework**: [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **3D Rendering**: [Three.js](https://threejs.org/)
- **Post-processing**: [Postprocessing.js](https://github.com/vanruesc/postprocessing)
- **Orbital mechanics**: [satellite.js](https://github.com/shashwatak/satellite.js)
- **Data**: CelesTrak OMM (JSON) API
- **UI**: [lil-gui](https://lil-gui.georgealways.com/) + Custom CSS

---

## License

MIT — free to use, fork, and build on.

---

*Built for fun. Not affiliated with NASA, ESA, or CelesTrak.*