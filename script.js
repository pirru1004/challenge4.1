/* =========================================
   ISS DASHBOARD — script.js
   MSS26 Challenge 4.1
   ========================================= */

// ── APIs ──────────────────────────────────────────────────────
const ISS_API     = 'https://api.wheretheiss.at/v1/satellites/25544';
// Crew: try open-notify via CORS proxy, fallback to hardcoded manifest
const CREW_API    = 'https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json';
const CREW_ALT    = 'http://api.open-notify.org/astros.json'; // fallback (may be blocked by CORS on Pages)

const REFRESH_INTERVAL = 5000; // ms

// ── State ─────────────────────────────────────────────────────
let map, issMarker, groundTrackLine, footprintCircle;
let trackPoints = [];        // array of [lat, lng]
let refreshTimer   = null;
let countdownTimer = null;
let countdownValue = REFRESH_INTERVAL / 1000;

// ISS habitation start: Nov 2, 2000
const ISS_EPOCH = new Date('2000-11-02T09:21:00Z');

// ── Helpers ───────────────────────────────────────────────────
const el = id => document.getElementById(id);

function pad(n, len = 2) { return String(Math.floor(n)).padStart(len, '0'); }

function setStatus(state, msg) {
  const dot  = el('status-dot');
  const text = el('status-text');
  dot.className  = 'status-dot ' + state;
  text.textContent = msg;
  if (state === 'live') text.style.color = '#00ffa3';
  if (state === 'error') text.style.color = '#ff6b2b';
}

// ── Starfield ────────────────────────────────────────────────
(function initStarfield() {
  const canvas = el('starfield');
  const ctx    = canvas.getContext('2d');
  let stars    = [];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = Array.from({ length: 200 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.3,
      o: Math.random() * 0.6 + 0.2,
      speed: Math.random() * 0.3 + 0.05,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach(s => {
      s.o += Math.sin(Date.now() * s.speed * 0.001) * 0.01;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,220,255,${Math.max(0, Math.min(1, s.o))})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
})();

// ── UTC Clock ─────────────────────────────────────────────────
function tickClock() {
  const now = new Date();
  el('utc-clock').textContent = `UTC ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}
setInterval(tickClock, 1000);
tickClock();

// ── Mission Elapsed Time ──────────────────────────────────────
function tickMET() {
  const elapsed = Date.now() - ISS_EPOCH.getTime();
  const s = Math.floor(elapsed / 1000) % 60;
  const m = Math.floor(elapsed / 60000) % 60;
  const h = Math.floor(elapsed / 3600000) % 24;
  const d = Math.floor(elapsed / 86400000);
  el('met-d').textContent = pad(d, 4);
  el('met-h').textContent = pad(h);
  el('met-m').textContent = pad(m);
  el('met-s').textContent = pad(s);
}
setInterval(tickMET, 1000);
tickMET();

// ── Leaflet Map ───────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [30, 0],
    zoom: 2,
    minZoom: 2,
    maxZoom: 8,
    attributionControl: false,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  L.control.attribution({ position: 'bottomright', prefix: false })
    .addAttribution('<span style="color:#555">CartoDB · wheretheiss.at</span>')
    .addTo(map);

  // Ground track polyline
  groundTrackLine = L.polyline([], {
    color: '#00d4ff',
    weight: 2,
    opacity: 0.55,
    smoothFactor: 1,
  }).addTo(map);

  // Footprint circle (placeholder)
  footprintCircle = L.circle([0, 0], {
    radius: 1000000,
    color: '#00d4ff',
    weight: 1,
    fillColor: '#00d4ff',
    fillOpacity: 0.05,
    dashArray: '6 4',
  }).addTo(map);

  // ISS Marker
  const icon = L.divIcon({
    className: 'iss-marker-icon',
    html: '<div class="iss-marker-inner">🛰️</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });

  issMarker = L.marker([0, 0], { icon, zIndexOffset: 1000 }).addTo(map);
  issMarker.bindTooltip('ISS — International Space Station', {
    permanent: false,
    direction: 'top',
    className: 'iss-tooltip',
    offset: [0, -20],
  });
}

// ── Nationality → Flag Emoji ──────────────────────────────────
const flagMap = {
  Russia:        '🇷🇺',
  United_States: '🇺🇸',
  'United States': '🇺🇸',
  Japan:         '🇯🇵',
  Germany:       '🇩🇪',
  France:        '🇫🇷',
  Italy:         '🇮🇹',
  Canada:        '🇨🇦',
  China:         '🇨🇳',
  UK:            '🇬🇧',
  Denmark:       '🇩🇰',
  Belarus:       '🇧🇾',
  UAE:           '🇦🇪',
  Saudi_Arabia:  '🇸🇦',
};

const nationEmojis = [
  '👩‍🚀','👨‍🚀','🧑‍🚀',
];

function getFlag(name) {
  for (const [key, val] of Object.entries(flagMap)) {
    if (name.includes(key)) return val;
  }
  return '🌍';
}

// Derive rough nationality from name (fallback heuristic)
function guessFlag(name) {
  const rxRU = /ov$|ev$|ova$|eva$|enko$|nko$|iy$|yev$/i;
  const rxJP = /a$|o$|yuki|hiro|toshi|masa|yosh/i;
  if (rxRU.test(name)) return '🇷🇺';
  return '🌍';
}

// ── Crew Fetch ────────────────────────────────────────────────
async function fetchCrew() {
  try {
    const res  = await fetch(CREW_API);
    const data = await res.json();

    // corquaid API shape: { number, people: [{id, name, country, flag_code, title, ...}] }
    let people = [];
    if (data.people) {
      people = data.people.filter(p => p.title === 'ISS' || !p.title || p.location?.includes('ISS') || true);
    }

    renderCrew(people);
  } catch (e) {
    console.warn('Crew API failed, retrying open-notify…', e);
    await fetchCrewFallback();
  }
}

async function fetchCrewFallback() {
  // Use a CORS proxy for open-notify
  const proxies = [
    'https://api.allorigins.win/raw?url=' + encodeURIComponent('http://api.open-notify.org/astros.json'),
    'https://corsproxy.io/?' + encodeURIComponent('http://api.open-notify.org/astros.json'),
  ];

  for (const proxy of proxies) {
    try {
      const res  = await fetch(proxy);
      const data = await res.json();
      if (data.people) {
        const issPeople = data.people.filter(p => p.craft === 'ISS');
        const formatted = issPeople.map(p => ({
          name:  p.name,
          country: guessCountryFromName(p.name),
          flag_code: '',
        }));
        renderCrew(formatted);
        return;
      }
    } catch (e2) {
      console.warn('Proxy failed:', proxy);
    }
  }
  renderCrewError();
}

function guessCountryFromName(name) {
  const rxRU = /ov |ev |sky |ski |ova |eva |Oleg|Sergey|Pavel|Anton|Nikolai|Alexander Gor|Alexei|Andrey/i;
  const rxUS = /Nick|Stephen|Tracy|Butch|Sunita|Don|Barry|Frank|Scott|Karen|Matthew|Michael|Mark/i;
  const rxJP = /Koichi|Soichi|Satoshi|Akihiko|Yui|Norishige/i;
  const rxDE = /Alexander Gerst|Matthias/i;
  if (rxRU.test(name)) return 'Russia';
  if (rxUS.test(name)) return 'United States';
  if (rxJP.test(name)) return 'Japan';
  if (rxDE.test(name)) return 'Germany';
  return 'Earth';
}

function renderCrew(people) {
  const list  = el('crew-list');
  const count = el('crew-count');

  if (!people || people.length === 0) {
    renderCrewError();
    return;
  }

  count.textContent = `${people.length} aboard`;
  list.innerHTML = '';

  people.forEach((p, i) => {
    const card   = document.createElement('div');
    card.className = 'crew-card';
    card.style.animationDelay = `${i * 0.07}s`;

    const avatar = nationEmojis[i % nationEmojis.length];
    const flag   = p.flag_code
      ? String.fromCodePoint(...[...p.flag_code.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)))
      : (flagMap[p.country] || guessFlag(p.name));

    const craft = p.title || p.location || 'ISS';

    card.innerHTML = `
      <div class="crew-avatar">${avatar}</div>
      <div class="crew-info">
        <div class="crew-name">${p.name}</div>
        <div class="crew-craft">${p.country || 'ISS'} · ${craft}</div>
      </div>
      <div class="crew-flag">${flag}</div>
    `;
    list.appendChild(card);
  });
}

function renderCrewError() {
  el('crew-list').innerHTML = `
    <div class="crew-loading" style="color:#ff6b2b">
      <span>⚠️ Could not retrieve crew manifest. <br>Check network or CORS policy.</span>
    </div>`;
  el('crew-count').textContent = '? aboard';
}

// ── ISS Position Fetch ────────────────────────────────────────
async function fetchISS() {
  try {
    const res  = await fetch(ISS_API + '?units=kilometers&timestamp=' + Date.now());
    const d    = await res.json();

    const lat   = d.latitude;
    const lon   = d.longitude;
    const alt   = d.altitude;          // km
    const vel   = d.velocity;          // km/h
    const vis   = d.visibility;        // 'eclipsed' | 'daylight'
    const foot  = d.footprint;         // km diameter → radius
    const units = d.units;

    // Update map
    issMarker.setLatLng([lat, lon]);
    footprintCircle.setLatLng([lat, lon]);
    footprintCircle.setRadius((foot / 2) * 1000); // m

    // Pan map smoothly
    map.panTo([lat, lon], { animate: true, duration: 1.2 });

    // Ground track (keep last 80 points)
    trackPoints.push([lat, lon]);
    if (trackPoints.length > 80) trackPoints.shift();
    groundTrackLine.setLatLngs(trackPoints);

    // Header coords
    const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N':'S'}`;
    const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E':'W'}`;
    el('map-coords').textContent = `${latStr}  ${lonStr}`;

    // Orbital parameters
    const period   = (2 * Math.PI * (6371 + alt)) / vel * 60; // minutes
    const orbitsDay = 1440 / period;

    el('altitude-val').textContent   = alt.toFixed(1);
    el('velocity-val').textContent   = Math.round(vel).toLocaleString();
    el('period-val').textContent     = period.toFixed(1);
    el('inclination-val').textContent = '51.6';
    el('footprint-val').textContent  = Math.round(foot).toLocaleString();
    el('daynight-val').textContent   = vis === 'daylight' ? '☀️ Daylight' : '🌑 Eclipsed';

    // Progress bars (normalized)
    el('alt-bar').style.width = `${((alt - 380) / 40 * 100).toFixed(1)}%`;
    el('vel-bar').style.width = `${((vel - 25000) / 3000 * 100).toFixed(1)}%`;
    el('per-bar').style.width = `${((period - 89) / 5 * 100).toFixed(1)}%`;
    el('inc-bar').style.width = '80%';

    // Stat panel
    el('stat-lat').textContent = latStr;
    el('stat-lon').textContent = lonStr;
    el('stat-orbits').textContent = `~${orbitsDay.toFixed(1)}`;

    // Country overflight (reverse-geocode via nominatim occasionally)
    el('overflight-country').textContent = `${latStr}, ${lonStr}`;

    setStatus('live', 'UPLINK LIVE');
  } catch (e) {
    console.error('ISS API error:', e);
    setStatus('error', 'SIGNAL LOST');
  }
}

// ── Refresh Countdown ─────────────────────────────────────────
function startCountdown() {
  countdownValue = REFRESH_INTERVAL / 1000;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdownValue--;
    el('countdown-refresh').textContent = countdownValue;
    if (countdownValue <= 0) {
      clearInterval(countdownTimer);
      fetchISS().then(() => startCountdown());
    }
  }, 1000);
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  initMap();
  setStatus('', 'CONNECTING…');

  // Parallel: fetch ISS + crew
  await Promise.allSettled([fetchISS(), fetchCrew()]);

  // Start live update loop
  startCountdown();
}

document.addEventListener('DOMContentLoaded', init);
