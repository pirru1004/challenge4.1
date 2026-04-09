# ISS Dashboard — Challenge 4.1

**MSS26 · Round 4: Mission Critical**

Live web dashboard tracking the International Space Station in real-time.

🔗 **Live:** [GitHub Pages URL — add after deploy]

## Features
- 🗺️ **Live ISS position** on a dark-mode world map (Leaflet + CartoDB)
- 👨‍🚀 **Crew manifest** with names and nationalities
- 📡 **Orbital parameters** — altitude, velocity, period, inclination, footprint
- 🌑 **Solar condition** — daylight vs. eclipsed
- ⏱️ **Mission Elapsed Time** since continuous habitation (Nov 2, 2000)
- ✨ **Animated starfield**, glassmorphism panels, live refresh ticker

## APIs
| Source | URL |
|--------|-----|
| Position + orbital | `https://api.wheretheiss.at/v1/satellites/25544` |
| Crew manifest | `https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json` |

## Stack
- Vanilla HTML, CSS, JavaScript
- Leaflet.js (map)
- GitHub Pages (deploy)

## Run Locally
Open `index.html` in any browser. No build step required.

## Deploy
Push to `main` — GitHub Actions deploys automatically via `.github/workflows/deploy.yml`.
