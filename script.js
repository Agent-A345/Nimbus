/* ==========================================
   NIMBUS LIVE WEATHER — script.js
   APIs used (all free, no key required):
   • Geocoding: open-meteo.com/v1/search
   • Weather:   api.open-meteo.com/v1/forecast
   • Reverse:   nominatim.openstreetmap.org
   ========================================== */

'use strict';

/* ── WMO Weather Interpretation Codes ── */
const WMO = {
  0:  { label:'Clear Sky',           icon:'☀️' },
  1:  { label:'Mainly Clear',        icon:'🌤' },
  2:  { label:'Partly Cloudy',       icon:'⛅' },
  3:  { label:'Overcast',            icon:'☁️' },
  45: { label:'Foggy',               icon:'🌫️' },
  48: { label:'Icy Fog',             icon:'🌫️' },
  51: { label:'Light Drizzle',       icon:'🌦️' },
  53: { label:'Drizzle',             icon:'🌦️' },
  55: { label:'Heavy Drizzle',       icon:'🌧️' },
  61: { label:'Slight Rain',         icon:'🌧️' },
  63: { label:'Rain',                icon:'🌧️' },
  65: { label:'Heavy Rain',          icon:'🌧️' },
  66: { label:'Freezing Rain',       icon:'🌨️' },
  67: { label:'Heavy Freezing Rain', icon:'🌨️' },
  71: { label:'Slight Snow',         icon:'🌨️' },
  73: { label:'Snow',                icon:'❄️' },
  75: { label:'Heavy Snow',          icon:'❄️' },
  77: { label:'Snow Grains',         icon:'🌨️' },
  80: { label:'Slight Showers',      icon:'🌦️' },
  81: { label:'Showers',             icon:'🌧️' },
  82: { label:'Violent Showers',     icon:'⛈️' },
  85: { label:'Snow Showers',        icon:'🌨️' },
  86: { label:'Heavy Snow Showers',  icon:'❄️' },
  95: { label:'Thunderstorm',        icon:'⛈️' },
  96: { label:'Thunderstorm w/ Hail',icon:'⛈️' },
  99: { label:'Thunderstorm w/ Heavy Hail',icon:'⛈️' },
};
function wmo(code) { return WMO[code] || { label:'Unknown', icon:'🌡️' }; }

/* ── State ── */
const state = {
  unit:        localStorage.getItem('nimbus_unit')    || 'C',
  theme:       localStorage.getItem('nimbus_theme')   || 'dark',
  recents:     JSON.parse(localStorage.getItem('nimbus_recents') || '[]'),
  multiCities: JSON.parse(localStorage.getItem('nimbus_multi')   || '[]'),
  currentCity: null,
  currentWeather: null,
  currentLat: null,
  currentLon: null,
  currentTz: null,
  lastSearch: null,
  chart24: null,
  clockTimer: null,
};

/* ── DOM helpers ── */
const $  = id => document.getElementById(id);
const fmtTemp = c => state.unit === 'C' ? Math.round(c) : Math.round(c * 9/5 + 32);

function show(id) { const e=$(id); if(e) e.style.display=''; }
function hide(id) { const e=$(id); if(e) e.style.display='none'; }
function vis(id, v) { const e=$(id); if(e) e.style.visibility = v ? 'visible':'hidden'; }

/* ── Geocoding (Open-Meteo) ── */
async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
  const r = await fetch(url);
  const d = await r.json();
  return d.results || [];
}

/* ── Reverse Geocode (Nominatim) ── */
async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
  const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const d = await r.json();
  const city = d.address?.city || d.address?.town || d.address?.village || d.address?.county || 'Unknown';
  const country = d.address?.country || '';
  return { city, country };
}

/* ── Fetch Live Weather (Open-Meteo) ── */
async function fetchWeather(lat, lon, tzName) {
  const tz = tzName || 'auto';
  const url = [
    `https://api.open-meteo.com/v1/forecast?`,
    `latitude=${lat}&longitude=${lon}`,
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code`,
    `,wind_speed_10m,surface_pressure,visibility,uv_index`,
    `&hourly=temperature_2m,weather_code`,
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum`,
    `&wind_speed_unit=kmh`,
    `&forecast_days=8`,
    `&timezone=${encodeURIComponent(tz)}`,
  ].join('');
  const r = await fetch(url);
  if (!r.ok) throw new Error('Weather fetch failed');
  return r.json();
}

/* ── Background themes ── */
const BG = {
  sunny:  { a:'#1a0800', b:'#3d1f00', p:'rgba(255,170,40,0.22)',  type:'dust' },
  cloud:  { a:'#0e1520', b:'#1a2035', p:'rgba(160,175,220,0.12)', type:'none' },
  rain:   { a:'#060d18', b:'#091828', p:'rgba(80,130,220,0.40)',  type:'rain' },
  storm:  { a:'#04060f', b:'#0c1228', p:'rgba(60,100,200,0.45)',  type:'rain' },
  snow:   { a:'#0a1020', b:'#162040', p:'rgba(200,220,255,0.65)', type:'snow' },
  fog:    { a:'#111210', b:'#1e1e16', p:'rgba(200,190,150,0.15)', type:'dust' },
  default:{ a:'#0a1628', b:'#0d2444', p:'rgba(120,180,255,0.18)', type:'none' },
};

function wmoToBg(code) {
  if (code === 0 || code === 1) return 'sunny';
  if (code === 2 || code === 3) return 'cloud';
  if ([45,48].includes(code)) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'default';
}

let particleClear = null;
function applyBackground(code) {
  const t = BG[wmoToBg(code)];
  $('bgGradient').style.background =
    `radial-gradient(ellipse at 20% 30%, ${t.a} 0%, transparent 65%),
     radial-gradient(ellipse at 80% 70%, ${t.b} 0%, transparent 65%)`;
  spawnParticles(t.type, t.p);
}

function spawnParticles(type, color) {
  const c = $('weatherParticles');
  c.innerHTML = '';
  if (particleClear) { clearInterval(particleClear); particleClear = null; }
  if (type === 'none') return;

  function makeOne() {
    const el = document.createElement('div');
    const left = Math.random() * 100;
    const dur  = type==='rain' ? 0.5+Math.random()*0.5 : 3+Math.random()*5;
    const delay = Math.random()*dur;
    if (type === 'snow') {
      el.className = 'snowflake';
      el.textContent = '❄';
      const sz = 8+Math.random()*10;
      el.style.cssText = `left:${left}%;font-size:${sz}px;animation-duration:${dur}s;animation-delay:-${delay}s;color:${color}`;
    } else {
      el.className = 'particle';
      const w = type==='rain' ? 1.5 : 2+Math.random()*3;
      const h = type==='rain' ? 10 : w;
      el.style.cssText = `left:${left}%;width:${w}px;height:${h}px;background:${color};
        border-radius:${type==='rain'?'2px':'50%'};
        animation-duration:${dur}s;animation-delay:-${delay}s;`;
    }
    c.appendChild(el);
    setTimeout(() => el.remove(), (dur+delay)*1000+300);
  }
  for(let i=0;i<50;i++) makeOne();
  particleClear = setInterval(makeOne, 180);
}

/* ── Smart Tips ── */
function getTip(temp, code) {
  if (code >= 95) return { icon:'⚡', text:'Severe thunderstorm — stay indoors and away from windows!' };
  if (code >= 80) return { icon:'☂️', text:'Heavy showers expected. An umbrella is a must!' };
  if (code >= 51 && code <= 67) return { icon:'🌂', text:'Rainy conditions — carry a waterproof jacket.' };
  if (code >= 71 && code <= 77) return { icon:'🧣', text:'Snowfall likely — dress warmly and watch for icy roads.' };
  if ([45,48].includes(code)) return { icon:'🌫️', text:'Foggy conditions — drive slowly with headlights on.' };
  if (temp >= 38) return { icon:'🥵', text:'Extreme heat! Stay hydrated and limit outdoor activity.' };
  if (temp >= 30) return { icon:'🏖️', text:'Great beach weather! Apply sunscreen SPF 50+.' };
  if (temp <= 0)  return { icon:'🧊', text:'Below freezing — roads may be icy. Bundle up!' };
  if (temp <= 10) return { icon:'🧥', text:'Cold and brisk — a warm jacket will serve you well.' };
  if (code <= 1)  return { icon:'☀️', text:'Beautiful clear skies — perfect for outdoor activities!' };
  return { icon:'🌿', text:'Mild and pleasant — a lovely day to step outside.' };
}

/* ── Local time helper ── */
function getLocalTime(tzName) {
  try {
    return new Date().toLocaleTimeString('en-US', { timeZone: tzName, hour:'2-digit', minute:'2-digit', hour12:true });
  } catch { return '--:--'; }
}

function fmt12(iso) {
  // iso like "2025-06-01T06:15"
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });
  } catch { return iso?.slice(11,16) || '--'; }
}

/* ── Animate number ── */
function animNum(id, target) {
  const el = $(id);
  const start = parseFloat(el.textContent) || 0;
  const diff = target - start;
  let i = 0;
  const t = setInterval(() => {
    i++;
    el.textContent = Math.round(start + diff * (i/20));
    if(i >= 20) { el.textContent = target; clearInterval(t); }
  }, 18);
}

/* ── Render chart ── */
function renderChart(hourly, tzName) {
  const canvas = $('tempChart');
  const ctx = canvas.getContext('2d');
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

  // Get next 24 hours
  const now = new Date();
  const times = hourly.time;
  const temps = hourly.temperature_2m;
  const startIdx = times.findIndex(t => new Date(t) >= now);
  const slice = temps.slice(startIdx, startIdx + 24).map(v => fmtTemp(v));
  const labels = times.slice(startIdx, startIdx + 24).map(t => {
    const h = new Date(t).getHours();
    return h % 6 === 0 ? `${h}:00` : '';
  });

  state.chart24 = { hourly, tzName };

  const W = canvas.parentElement.clientWidth - 48;
  canvas.width = W; canvas.height = 130;
  ctx.clearRect(0, 0, W, 130);

  if (!slice.length) return;

  const min = Math.min(...slice) - 2;
  const max = Math.max(...slice) + 2;
  const toY = v => 105 - (v - min) / (max - min) * 85;
  const toX = i => i * (W / (slice.length - 1));

  // Fill gradient
  const grad = ctx.createLinearGradient(0, 0, 0, 130);
  grad.addColorStop(0, 'rgba(126,184,247,0.28)');
  grad.addColorStop(1, 'rgba(126,184,247,0)');
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(slice[0]));
  for (let i = 1; i < slice.length; i++) {
    const cpx = (toX(i-1) + toX(i)) / 2;
    ctx.bezierCurveTo(cpx, toY(slice[i-1]), cpx, toY(slice[i]), toX(i), toY(slice[i]));
  }
  ctx.lineTo(W, 130); ctx.lineTo(0, 130); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(slice[0]));
  for (let i = 1; i < slice.length; i++) {
    const cpx = (toX(i-1) + toX(i)) / 2;
    ctx.bezierCurveTo(cpx, toY(slice[i-1]), cpx, toY(slice[i]), toX(i), toY(slice[i]));
  }
  ctx.strokeStyle = '#7eb8f7'; ctx.lineWidth = 2.5; ctx.stroke();

  // Labels
  ctx.fillStyle = isDark ? 'rgba(238,242,255,0.38)' : 'rgba(13,27,51,0.38)';
  ctx.font = '10px DM Sans'; ctx.textAlign = 'center';
  labels.forEach((l, i) => { if(l) ctx.fillText(l, toX(i), 125); });
}

/* ── Main render from weather data ── */
function renderWeather(data, cityName, country, lat, lon, tzName) {
  const cur    = data.current;
  const daily  = data.daily;
  const hourly = data.hourly;

  state.currentWeather = data;
  state.currentCity    = cityName;
  state.currentLat     = lat;
  state.currentLon     = lon;
  state.currentTz      = tzName;

  const code  = cur.weather_code;
  const info  = wmo(code);
  const tempC = cur.temperature_2m;
  const feelC = cur.apparent_temperature;

  hide('skeletonWrap');
  hide('errorCard');

  // Hero
  $('cityName').textContent = cityName;
  $('cityCountry').textContent = country;
  $('localTime').textContent = getLocalTime(tzName);
  animNum('tempValue', fmtTemp(tempC));
  $('tempUnit').textContent = `°${state.unit}`;
  $('conditionIcon').textContent = info.icon;
  $('conditionLabel').textContent = info.label;
  $('feelsLike').textContent = `${fmtTemp(feelC)}°${state.unit}`;
  $('animatedIcon').textContent = info.icon;
  $('sunriseTime').textContent = fmt12(daily.sunrise?.[0]);
  $('sunsetTime').textContent  = fmt12(daily.sunset?.[0]);
  $('heroCard').style.display = 'flex';

  // Metrics
  $('humidity').textContent  = `${cur.relative_humidity_2m}%`;
  $('windSpeed').textContent = `${Math.round(cur.wind_speed_10m)}`;
  $('pressure').textContent  = `${Math.round(cur.surface_pressure)}`;
  const visMi = cur.visibility != null ? (cur.visibility / 1000).toFixed(1) : '--';
  $('visibility').textContent = visMi;
  $('precip').textContent    = `${(cur.precipitation || 0).toFixed(1)}`;
  $('uvIndex').textContent   = `${Math.round(cur.uv_index ?? 0)}`;
  $('metricsRow').style.display = 'grid';

  // Tip
  const tip = getTip(tempC, code);
  $('tipIcon').textContent = tip.icon;
  $('tipText').textContent = tip.text;
  $('smartTip').style.display = 'flex';

  // Forecast
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  $('forecastScroll').innerHTML = daily.time.slice(1).map((t,i) => {
    const d = wmo(daily.weather_code[i+1]);
    const hi = fmtTemp(daily.temperature_2m_max[i+1]);
    const lo = fmtTemp(daily.temperature_2m_min[i+1]);
    const dayName = days[new Date(t).getDay()];
    return `<div class="forecast-card">
      <div class="forecast-day">${dayName}</div>
      <div class="forecast-icon">${d.icon}</div>
      <div class="forecast-temps"><span class="forecast-high">${hi}°</span><span class="forecast-low">${lo}°</span></div>
      <div class="forecast-label">${d.label}</div>
    </div>`;
  }).join('');
  $('forecastSection').style.display = 'block';

  // Chart
  renderChart(hourly, tzName);
  $('chartSection').style.display = 'block';

  // Alerts — extreme conditions
  if (code >= 95) {
    $('alertText').textContent = `⛈️ Thunderstorm warning active for ${cityName}. Take shelter immediately.`;
    $('alertBanner').style.display = 'flex';
  } else if (code >= 80 && code < 95) {
    $('alertText').textContent = `🌧️ Heavy rain / shower warning for ${cityName}.`;
    $('alertBanner').style.display = 'flex';
  } else if (tempC >= 40) {
    $('alertText').textContent = `🔆 Extreme heat alert in ${cityName} — ${Math.round(tempC)}°C. Avoid outdoor activity.`;
    $('alertBanner').style.display = 'flex';
  } else {
    $('alertBanner').style.display = 'none';
  }

  // Background
  applyBackground(code);

  // Live badge
  $('updatedAt').textContent = new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  vis('liveBadge', true);

  // Recents
  addRecent(cityName, country, lat, lon, tzName);

  // Clock
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = setInterval(() => {
    const el = document.getElementById('localTime');
    if (el) el.textContent = getLocalTime(state.currentTz);
  }, 1000);
}

/* ── Search city ── */
async function searchCity(name, lat, lon, country, tzName) {
  showLoading();
  state.lastSearch = { name, lat, lon, country, tzName };
  try {
    let resolvedLat = lat, resolvedLon = lon, resolvedTz = tzName, resolvedCountry = country;
    if (!resolvedLat) {
      const results = await geocode(name);
      if (!results.length) throw new Error(`"${name}" not found. Try a different spelling.`);
      const r = results[0];
      resolvedLat = r.latitude;
      resolvedLon = r.longitude;
      resolvedTz  = r.timezone;
      resolvedCountry = r.country || '';
      name = r.name;
    }
    const data = await fetchWeather(resolvedLat, resolvedLon, resolvedTz || 'auto');
    renderWeather(data, name, resolvedCountry, resolvedLat, resolvedLon, resolvedTz || data.timezone);
  } catch(err) {
    console.error(err);
    showError(err.message || 'Failed to load weather. Check your connection.');
  }
}

/* ── Detect location ── */
function detectLocation() {
  $('locationBtn').textContent = '⏳';
  if (!navigator.geolocation) { searchCity('Mumbai'); return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    $('locationBtn').textContent = '📍';
    const { latitude:lat, longitude:lon } = pos.coords;
    try {
      const geo = await reverseGeocode(lat, lon);
      const data = await fetchWeather(lat, lon, 'auto');
      renderWeather(data, geo.city, geo.country, lat, lon, data.timezone);
      state.lastSearch = { name:geo.city, lat, lon, country:geo.country, tzName:data.timezone };
    } catch(e) {
      searchCity('Mumbai');
    }
  }, () => { $('locationBtn').textContent = '📍'; searchCity('Mumbai'); });
}

/* ── Loading / Error ── */
function showLoading() {
  hide('heroCard'); hide('metricsRow'); hide('smartTip');
  hide('forecastSection'); hide('chartSection'); hide('errorCard');
  show('skeletonWrap');
  vis('liveBadge', false);
}
function showError(msg) {
  hide('skeletonWrap');
  $('errorMsg').textContent = msg;
  show('errorCard');
}
function retryLast() { if(state.lastSearch) searchCity(...Object.values(state.lastSearch)); }

/* ── Recents ── */
function addRecent(name, country, lat, lon, tz) {
  state.recents = [
    { name, country, lat, lon, tz },
    ...state.recents.filter(r => r.name !== name)
  ].slice(0, 5);
  localStorage.setItem('nimbus_recents', JSON.stringify(state.recents));
  renderRecents();
}
function renderRecents() {
  const row = $('recentsRow');
  if (!state.recents.length) { row.innerHTML = ''; return; }
  row.innerHTML = state.recents.map(r =>
    `<button class="recent-chip" data-name="${r.name}" data-lat="${r.lat}" data-lon="${r.lon}" data-country="${r.country}" data-tz="${r.tz}">${r.name}</button>`
  ).join('');
}

/* ── Unit toggle ── */
function toggleUnit() {
  state.unit = state.unit === 'C' ? 'F' : 'C';
  localStorage.setItem('nimbus_unit', state.unit);
  $('unitToggle').textContent = `°${state.unit}`;
  if (state.currentWeather) {
    renderWeather(state.currentWeather, state.currentCity, '', state.currentLat, state.currentLon, state.currentTz);
  }
  if (state.view === 'multi') renderMultiCards();
}

/* ── Theme toggle ── */
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  $('themeToggle').textContent = state.theme === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('nimbus_theme', state.theme);
  if (state.chart24) renderChart(state.chart24.hourly, state.chart24.tzName);
}

/* ── View switching ── */
state.view = 'single';
function setView(v) {
  state.view = v;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $('singleView').style.display  = v === 'single' ? '' : 'none';
  $('multiView').style.display   = v === 'multi'  ? '' : 'none';
  if (v === 'multi') renderMultiCards();
}

/* ── Multi-city ── */
function renderMultiCards() {
  const grid = $('multiGrid');
  grid.innerHTML = '';

  state.multiCities.forEach((city, idx) => {
    const card = document.createElement('div');
    card.className = 'multi-city-card glass';
    if (city.data) {
      const cur  = city.data.current;
      const info = wmo(cur.weather_code);
      card.innerHTML = `
        <button class="multi-remove" data-idx="${idx}">✕</button>
        <div class="multi-city-name">${city.name}</div>
        <div class="multi-country">${city.country}</div>
        <div class="multi-icon">${info.icon}</div>
        <div class="multi-temp">${fmtTemp(cur.temperature_2m)}<span style="font-size:1.2rem;color:var(--accent)">°${state.unit}</span></div>
        <div class="multi-cond">${info.label}</div>
        <div class="multi-meta">
          <span>💧${cur.relative_humidity_2m}%</span>
          <span>💨${Math.round(cur.wind_speed_10m)}km/h</span>
        </div>`;
    } else {
      card.innerHTML = `
        <button class="multi-remove" data-idx="${idx}">✕</button>
        <div class="multi-city-name">${city.name}</div>
        <div class="multi-country">${city.country}</div>
        <div class="multi-loading">Loading…</div>`;
      fetchWeather(city.lat, city.lon, city.tz).then(data => {
        city.data = data;
        saveMulti();
        renderMultiCards();
      }).catch(() => {});
    }
    card.addEventListener('click', e => {
      if(e.target.classList.contains('multi-remove')) return;
      setView('single');
      searchCity(city.name, city.lat, city.lon, city.country, city.tz);
    });
    grid.appendChild(card);
  });

  // Remove buttons
  grid.querySelectorAll('.multi-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      state.multiCities.splice(+btn.dataset.idx, 1);
      saveMulti();
      renderMultiCards();
    });
  });

  // Placeholder
  if (state.multiCities.length < 4) {
    const ph = document.createElement('div');
    ph.className = 'add-city-placeholder';
    ph.textContent = '+ Add city';
    ph.addEventListener('click', () => $('addCityModal').style.display='block');
    grid.appendChild(ph);
  }
}

function saveMulti() {
  const slim = state.multiCities.map(c => ({ name:c.name, country:c.country, lat:c.lat, lon:c.lon, tz:c.tz }));
  localStorage.setItem('nimbus_multi', JSON.stringify(slim));
}

/* ── Suggestions (geocoding) ── */
let suggestTimer = null;
async function fetchSuggestions(q, boxId) {
  const box = $(boxId);
  if (!q || q.length < 2) { box.style.display='none'; return; }
  try {
    const results = await geocode(q);
    if (!results.length) { box.style.display='none'; return; }
    box.innerHTML = results.map(r =>
      `<div class="suggestion-item"
         data-name="${r.name}" data-lat="${r.latitude}" data-lon="${r.longitude}"
         data-country="${r.country||''}" data-tz="${r.timezone||''}">
         ${r.name}
         <span class="suggestion-country">${r.country || ''}</span>
       </div>`
    ).join('');
    box.style.display = 'block';
  } catch { box.style.display='none'; }
}

function bindSuggestions(inputId, boxId, onSelect) {
  const inp = $(inputId), box = $(boxId);
  inp.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => fetchSuggestions(inp.value, boxId), 350);
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      box.style.display = 'none';
      onSelect(inp.value, null, null, '', '');
      inp.value = '';
    }
    if (e.key === 'Escape') box.style.display = 'none';
  });
  box.addEventListener('click', e => {
    const item = e.target.closest('.suggestion-item');
    if (!item) return;
    const { name, lat, lon, country, tz } = item.dataset;
    box.style.display = 'none';
    inp.value = '';
    onSelect(name, +lat, +lon, country, tz);
  });
}

/* ── Init ── */
function init() {
  // Apply persisted prefs
  document.documentElement.setAttribute('data-theme', state.theme);
  $('themeToggle').textContent = state.theme === 'dark' ? '🌙' : '☀️';
  $('unitToggle').textContent  = `°${state.unit}`;

  // Recents
  renderRecents();

  // Bind search
  bindSuggestions('searchInput', 'suggestionsBox', (name, lat, lon, country, tz) => {
    setView('single');
    searchCity(name, lat, lon, country, tz);
  });

  // Bind add-city modal
  bindSuggestions('addCityInput', 'modalSuggestions', (name, lat, lon, country, tz) => {
    if (!state.multiCities.find(c => c.name === name)) {
      state.multiCities.push({ name, lat, lon, country, tz, data:null });
      saveMulti();
    }
    $('addCityModal').style.display = 'none';
    $('addCityInput').value = '';
    renderMultiCards();
  });

  // Recents row click delegation
  $('recentsRow').addEventListener('click', e => {
    const chip = e.target.closest('.recent-chip');
    if (!chip) return;
    setView('single');
    searchCity(chip.dataset.name, +chip.dataset.lat, +chip.dataset.lon, chip.dataset.country, chip.dataset.tz);
  });

  // Buttons
  $('locationBtn').addEventListener('click', detectLocation);
  $('unitToggle').addEventListener('click', toggleUnit);
  $('themeToggle').addEventListener('click', toggleTheme);
  $('addCityBtn').addEventListener('click', () => {
    $('addCityModal').style.display = $('addCityModal').style.display==='none' ? 'block' : 'none';
    if ($('addCityModal').style.display === 'block') $('addCityInput').focus();
  });

  // View tabs
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });

  // Close dropdowns on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) $('suggestionsBox').style.display = 'none';
    if (!e.target.closest('#addCityModal') && !e.target.closest('#addCityBtn'))
      $('addCityModal').style.display = 'none';
  });

  // Restore multi-cities from storage (without cached data — re-fetch)
  const storedMulti = JSON.parse(localStorage.getItem('nimbus_multi') || '[]');
  state.multiCities = storedMulti.map(c => ({ ...c, data:null }));

  // Chart resize
  window.addEventListener('resize', () => {
    if (state.chart24) renderChart(state.chart24.hourly, state.chart24.tzName);
  });

  // Boot: try geolocation, fallback to Mumbai
  detectLocation();

  console.log('🌤 Nimbus Live Weather ready — powered by Open-Meteo (no API key)');
}

document.addEventListener('DOMContentLoaded', init);
