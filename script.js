/* =========================================
   ISS DASHBOARD — script.js
   MSS26 Challenge 4.1
   ========================================= */

// ── APIs ──────────────────────────────────────────────────────
const ISS_API_PRIMARY = 'https://api.wheretheiss.at/v1/satellites/25544';
const ISS_API_FALLBACK = 'http://api.open-notify.org/iss-now.json';
const POSITIONS_API    = 'https://api.wheretheiss.at/v1/satellites/25544/positions';
// Crew: try corquaid API first, fallback to open-notify via CORS proxy
const CREW_API    = 'https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json';
const CREW_ALT    = 'http://api.open-notify.org/astros.json';

const REFRESH_INTERVAL = 5000; // ms

// ── State ─────────────────────────────────────────────────────
let map, issMarker, groundTrackLine, futureTrackLine, footprintCircle, terminator;
let trackPoints = [];        // array of [lat, lng]
let refreshTimer   = null;
let countdownTimer = null;
let countdownValue = REFRESH_INTERVAL / 1000;
let lastFutureUpdate = 0;    // timestamp of last future path fetch

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

  // Ground track (past)
  groundTrackLine = L.polyline([], {
    color: '#00d4ff',
    weight: 2,
    opacity: 0.55,
    smoothFactor: 1,
  }).addTo(map);

  // Future track (going to)
  futureTrackLine = L.polyline([], {
    color: '#00d4ff',
    weight: 2,
    opacity: 0.4,
    dashArray: '10, 10',
    smoothFactor: 1,
  }).addTo(map);

  // Day/Night Terminator
  terminator = L.terminator({
    fillOpacity: 0.35,
    color: '#03070f',
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

  // ISS Marker Icon
  const issIcon = L.icon({
    iconUrl: 'iss-model.png?v=6',
    iconSize: [60, 60],
    iconAnchor: [30, 30],
    className: 'iss-marker-image'
  });

  issMarker = L.marker([0, 0], { icon: issIcon, zIndexOffset: 1000 }).addTo(map);
  issMarker.bindTooltip('ISS — International Space Station', {
    permanent: false,
    direction: 'top',
    className: 'iss-tooltip',
    offset: [0, -30],
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

    // corquaid API shape: { number, people: [{id, name, country, flag_code, iss: bool, ...}] }
    let people = [];
    if (data.people) {
      // Filter to only show ISS crew members (not Tiangong, Artemis, etc.)
      people = data.people.filter(p => p.iss === true);
    }

    if (people.length > 0) {
      renderCrew(people);
    } else {
      console.warn('No ISS crew found in corquaid API, trying fallback…');
      await fetchCrewFallback();
    }
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
async function fetchISSPrimary() {
  const res = await fetch(ISS_API_PRIMARY + '?units=kilometers&timestamp=' + Date.now());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return {
    lat:  d.latitude,
    lon:  d.longitude,
    alt:  d.altitude,
    vel:  d.velocity,
    vis:  d.visibility,
    foot: d.footprint,
  };
}

async function fetchISSFallback() {
  // open-notify only gives lat/lon; compute approximate orbital params
  const proxies = [
    'https://api.allorigins.win/raw?url=' + encodeURIComponent('http://api.open-notify.org/iss-now.json'),
    'https://corsproxy.io/?' + encodeURIComponent('http://api.open-notify.org/iss-now.json'),
  ];
  for (const url of proxies) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const d = await res.json();
      if (d.iss_position) {
        return {
          lat:  parseFloat(d.iss_position.latitude),
          lon:  parseFloat(d.iss_position.longitude),
          alt:  420,        // typical ISS altitude
          vel:  27580,      // typical ISS velocity km/h
          vis:  'unknown',
          foot: 4500,       // typical footprint km
        };
      }
    } catch (e) {
      console.warn('Fallback proxy failed:', url);
    }
  }
  throw new Error('All ISS APIs failed');
}

async function fetchISS() {
  let data;
  try {
    data = await fetchISSPrimary();
  } catch (e1) {
    console.warn('Primary ISS API failed, trying fallback…', e1);
    try {
      data = await fetchISSFallback();
    } catch (e2) {
      console.error('All ISS APIs failed:', e2);
      setStatus('error', 'SIGNAL LOST');
      return;
    }
  }

  const { lat, lon, alt, vel, vis, foot } = data;

  // Update map
  issMarker.setLatLng([lat, lon]);
  footprintCircle.setLatLng([lat, lon]);
  footprintCircle.setRadius((foot / 2) * 1000); // m

  // Pan map smoothly
  map.panTo([lat, lon], { animate: true, duration: 1.2 });

  // Ground track (past)
  trackPoints.push([lat, lon]);
  if (trackPoints.length > 80) trackPoints.shift();
  
  // Split past track if it wraps
  const pastSegments = [];
  let currentPastSeg = [trackPoints[0]];
  for (let i = 1; i < trackPoints.length; i++) {
    if (Math.abs(trackPoints[i][1] - trackPoints[i-1][1]) > 200) {
      pastSegments.push(currentPastSeg);
      currentPastSeg = [trackPoints[i]];
    } else {
      currentPastSeg.push(trackPoints[i]);
    }
  }
  pastSegments.push(currentPastSeg);
  groundTrackLine.setLatLngs(pastSegments);

  // Header coords
  const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N':'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E':'W'}`;
  el('map-coords').textContent = `${latStr}  ${lonStr}`;

  // Orbital parameters
  const period    = (2 * Math.PI * (6371 + alt)) / vel * 60; // minutes
  const orbitsDay = 1440 / period;

  el('altitude-val').textContent   = alt.toFixed(1);
  el('velocity-val').textContent   = Math.round(vel).toLocaleString();
  el('period-val').textContent     = period.toFixed(1);
  el('inclination-val').textContent = '51.6';
  el('footprint-val').textContent  = Math.round(foot).toLocaleString();
  el('daynight-val').textContent   = vis === 'daylight' ? '☀️ Daylight'
                                   : vis === 'eclipsed' ? '🌑 Eclipsed'
                                   : '🌗 Calculating…';

  // Progress bars (normalized)
  el('alt-bar').style.width = `${Math.min(100, Math.max(5, (alt - 380) / 40 * 100)).toFixed(1)}%`;
  el('vel-bar').style.width = `${Math.min(100, Math.max(5, (vel - 25000) / 3000 * 100)).toFixed(1)}%`;
  el('per-bar').style.width = `${Math.min(100, Math.max(5, (period - 89) / 5 * 100)).toFixed(1)}%`;
  el('inc-bar').style.width = '80%';

  // Stat panel
  el('stat-lat').textContent = latStr;
  el('stat-lon').textContent = lonStr;
  el('stat-orbits').textContent = `~${orbitsDay.toFixed(1)}`;

  // Country overflight
  el('overflight-country').textContent = `${latStr}, ${lonStr}`;

  // Update terminator time
  if (terminator) terminator.setTime();

  // Fetch future path every 2 minutes or on first load
  const now = Date.now();
  if (now - lastFutureUpdate > 120000) {
    fetchFuturePath(lat, lon);
    lastFutureUpdate = now;
  }

  setStatus('live', 'UPLINK LIVE');
}

// ── Future Path Fetch ─────────────────────────────────────────
async function fetchFuturePath(currentLat, currentLon) {
  try {
    const batches = [];
    const nowSecs = Math.floor(Date.now() / 1000);
    
    // Extreme high-res: 50 points over 90 mins (~1.8 min spacing)
    for (let b = 0; b < 5; b++) {
      const batch = [];
      for (let i = 1; i <= 10; i++) {
        batch.push(nowSecs + ((b * 10 + i) * 1.8 * 60));
      }
      batches.push(batch);
    }

    const responses = await Promise.all(batches.map(b => 
      fetch(`${POSITIONS_API}?timestamps=${b.join(',')}&units=kilometers`).then(r => r.json())
    ));
    
    const combinedData = responses.flat();

    if (Array.isArray(combinedData)) {
      const allPoints = [[currentLat, currentLon]];
      combinedData.forEach(p => {
        allPoints.push([p.latitude, p.longitude]);
      });

      // Split segments that cross the 180/-180 meridian to avoid map-spanning lines
      const multiSegments = [];
      let currentSegment = [allPoints[0]];

      for (let i = 1; i < allPoints.length; i++) {
        const prev = allPoints[i-1];
        const curr = allPoints[i];
        
        // Use a threshold of 200 to be safe for dateline wrapping
        if (Math.abs(curr[1] - prev[1]) > 200) {
          multiSegments.push(currentSegment);
          currentSegment = [curr];
        } else {
          currentSegment.push(curr);
        }
      }
      multiSegments.push(currentSegment);

      // setLatLngs with nested array creates separate segments
      futureTrackLine.setLatLngs(multiSegments);

      // Rotate marker based on heading to first future point
      if (combinedData.length > 0) {
        const angle = calculateHeading(currentLat, currentLon, combinedData[0].latitude, combinedData[0].longitude);
        const markerEl = document.querySelector('.iss-marker-image');
        if (markerEl) {
          // Adjust rotation (0 = North, most images are North-aligned)
          markerEl.style.transform += ` rotate(${angle}deg)`;
          markerEl.style.mixBlendMode = 'screen';
        }
      }
    }
  } catch (e) {
    console.warn('Could not fetch future path:', e);
  }
}

function calculateHeading(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
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
