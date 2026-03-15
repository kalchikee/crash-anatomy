/* ────────────────────────────────────────────────────────────
   Crash Anatomy  —  app.js
   Data: NHTSA FARS 2019-2023  (185,552 crashes)
   Map:  MapLibre GL JS + Carto Dark Matter
────────────────────────────────────────────────────────────── */

'use strict';

// ── CONFIG ───────────────────────────────────────────────────
const DATA_URL   = 'data/processed/crashes.geojson.gz';
const STATS_URL  = 'data/processed/summary_stats.json';
const MAP_STYLE  = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TYPE_LABELS = {
  pedestrian: 'Pedestrian', cyclist: 'Cyclist', night: 'Night-time',
  weather: 'Adverse Weather', intersection: 'Intersection', workzone: 'Work Zone', other: 'Other'
};
const ROAD_COLORS = {
  Interstate: '#e84141', Freeway: '#ff7b00', 'Principal Arterial': '#ffcc00',
  'Minor Arterial': '#44cc88', Collector: '#4488ff', Local: '#aa88ff', Unknown: '#888'
};

// ── STATE ────────────────────────────────────────────────────
let map, popup;
let allFeatures = [];
let filteredGeoJSON = { type: 'FeatureCollection', features: [] };
let summaryStats = {};
let activeFilters = { year: 'all', type: 'all', road: 'all', rur: 'all' };

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Init map first (shows background while data loads)
  initMap();

  // Load stats and data in parallel
  const [stats, geojson] = await Promise.all([
    loadJSON(STATS_URL),
    loadGzippedGeoJSON(DATA_URL)
  ]);

  summaryStats = stats;
  allFeatures  = geojson.features;
  filteredGeoJSON.features = allFeatures;

  updateHeaderStats(allFeatures, stats);
  renderCharts(stats);
  addMapData(filteredGeoJSON);
  hideLoading();
  bindFilters();
}

// ── MAP INIT ─────────────────────────────────────────────────
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLE,
    center: [-96, 38],
    zoom: 4,
    minZoom: 2,
    maxZoom: 17,
    hash: true,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

  popup = new maplibregl.Popup({ closeButton: false, maxWidth: '280px', offset: 10 });

  // Show pointer cursor on hover
  map.on('mouseenter', 'crashes-points', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'crashes-points', () => { map.getCanvas().style.cursor = ''; });

  // Click popup
  map.on('click', 'crashes-points', showCrashPopup);

  // Close popup on map click (empty area)
  map.on('click', (e) => {
    const feats = map.queryRenderedFeatures(e.point, { layers: ['crashes-points'] });
    if (!feats.length) popup.remove();
  });
}

// ── ADD DATA LAYERS ──────────────────────────────────────────
function addMapData(geojson) {
  // Remove existing source/layers if re-adding after filter
  ['crashes-heat', 'crashes-clusters', 'crashes-cluster-count', 'crashes-points']
    .forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
  if (map.getSource('crashes'))      map.removeSource('crashes');
  if (map.getSource('crashes-heat-src')) map.removeSource('crashes-heat-src');

  // Separate unclustered source for heatmap (clustering hides individual points at low zoom)
  map.addSource('crashes-heat-src', {
    type: 'geojson',
    data: geojson,
  });

  // Clustered source for circle layers
  map.addSource('crashes', {
    type: 'geojson',
    data: geojson,
    cluster: true,
    clusterMaxZoom: 11,
    clusterRadius: 40,
  });

  // ── Heatmap layer (z 0–12) — uses unclustered source ─
  map.addLayer({
    id: 'crashes-heat',
    type: 'heatmap',
    source: 'crashes-heat-src',
    maxzoom: 13,
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'fat'], 1, 0.5, 5, 1],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, 1, 6, 3, 12, 6],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 18, 6, 30, 10, 40, 13, 20],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.85, 13, 0],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,80,0)',
        0.1,  'rgba(20,80,200,0.6)',
        0.3,  'rgba(0,200,120,0.85)',
        0.55, 'rgba(255,200,0,0.9)',
        0.75, 'rgba(255,90,0,0.95)',
        1.0,  'rgba(220,20,20,1)',
      ],
    }
  });

  // ── Cluster circles (z 9–12) ─────────────────────────
  map.addLayer({
    id: 'crashes-clusters',
    type: 'circle',
    source: 'crashes',
    filter: ['has', 'point_count'],
    minzoom: 8, maxzoom: 13,
    paint: {
      'circle-color': [
        'step', ['get', 'point_count'],
        '#ff7b00', 25,
        '#e84141', 100,
        '#cc1111'
      ],
      'circle-radius': ['step', ['get', 'point_count'], 14, 25, 20, 100, 28, 500, 36],
      'circle-opacity': 0.75,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': 'rgba(255,255,255,0.25)',
    }
  });

  // ── Cluster count labels ─────────────────────────────
  map.addLayer({
    id: 'crashes-cluster-count',
    type: 'symbol',
    source: 'crashes',
    filter: ['has', 'point_count'],
    minzoom: 8, maxzoom: 13,
    layout: {
      'text-field': ['number-format', ['get', 'point_count'], { 'max-fraction-digits': 0 }],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
    },
    paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,0.4)', 'text-halo-width': 1 }
  });

  // ── Individual crash dots (z 11+) ────────────────────
  map.addLayer({
    id: 'crashes-points',
    type: 'circle',
    source: 'crashes',
    filter: ['!', ['has', 'point_count']],
    minzoom: 11,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 6, 17, 10],
      'circle-color': [
        'match', ['get', 'rd'],
        'Interstate',        '#e84141',
        'Freeway',           '#ff7b00',
        'Principal Arterial','#ffcc00',
        'Minor Arterial',    '#44cc88',
        'Collector',         '#4488ff',
        'Local',             '#aa88ff',
        '#aaaaaa'
      ],
      'circle-opacity': 0.85,
      'circle-stroke-width': 0.8,
      'circle-stroke-color': 'rgba(0,0,0,0.5)',
    }
  });

  // Expand cluster on click
  map.on('click', 'crashes-clusters', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['crashes-clusters'] });
    const clusterId = features[0].properties.point_count > 0 ? features[0].id : null;
    map.getSource('crashes').getClusterExpansionZoom(features[0].properties.cluster_id, (err, zoom) => {
      if (err) return;
      map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom + 0.5 });
    });
  });

  map.on('mouseenter', 'crashes-clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'crashes-clusters', () => { map.getCanvas().style.cursor = ''; });
}

// ── POPUP ────────────────────────────────────────────────────
function showCrashPopup(e) {
  const p = e.features[0].properties;
  const coords = e.features[0].geometry.coordinates.slice();

  const types = (p.typ || 'other').split(',').map(t => TYPE_LABELS[t] || t).join(', ');
  const hour  = p.hr >= 0 ? `${String(p.hr).padStart(2,'0')}:XX` : 'Unknown';
  const month = MONTH_NAMES[p.mo] || '—';

  const html = `
    <div class="popup-title">Fatal Crash — ${month} ${p.yr}</div>
    <div class="popup-row"><span class="popup-key">Fatalities</span><span class="popup-val">${p.fat}</span></div>
    <div class="popup-row"><span class="popup-key">Type</span><span class="popup-val">${types}</span></div>
    <div class="popup-row"><span class="popup-key">Road</span><span class="popup-val">${p.rd}</span></div>
    <div class="popup-row"><span class="popup-key">Setting</span><span class="popup-val">${p.rur ? 'Rural' : 'Urban'}</span></div>
    <div class="popup-row"><span class="popup-key">Hour</span><span class="popup-val">${hour}</span></div>
    <div class="popup-row"><span class="popup-key">Weather</span><span class="popup-val">${p.wth || 'Clear'}</span></div>
    <div class="popup-row"><span class="popup-key">State</span><span class="popup-val">${p.st}</span></div>
  `;

  popup.setLngLat(coords).setHTML(html).addTo(map);
}

// ── FILTERS ──────────────────────────────────────────────────
function bindFilters() {
  document.getElementById('filter-year').addEventListener('change', e => {
    activeFilters.year = e.target.value; applyFilters();
  });
  document.getElementById('filter-type').addEventListener('change', e => {
    activeFilters.type = e.target.value; applyFilters();
  });
  document.getElementById('filter-road').addEventListener('change', e => {
    activeFilters.road = e.target.value; applyFilters();
  });
  document.getElementById('filter-rur').addEventListener('change', e => {
    activeFilters.rur = e.target.value; applyFilters();
  });
  document.getElementById('reset-btn').addEventListener('click', resetFilters);
}

function applyFilters() {
  const { year, type, road, rur } = activeFilters;

  const filtered = allFeatures.filter(f => {
    const p = f.properties;
    if (year !== 'all' && String(p.yr) !== year) return false;
    if (type !== 'all' && !p.typ.split(',').includes(type)) return false;
    if (road !== 'all' && p.rd !== road) return false;
    if (rur  !== 'all' && String(p.rur) !== rur) return false;
    return true;
  });

  filteredGeoJSON = { type: 'FeatureCollection', features: filtered };

  if (map.getSource('crashes'))          map.getSource('crashes').setData(filteredGeoJSON);
  if (map.getSource('crashes-heat-src')) map.getSource('crashes-heat-src').setData(filteredGeoJSON);

  updateHeaderStats(filtered, summaryStats);
  updateChartsFromFiltered(filtered);
}

function resetFilters() {
  activeFilters = { year: 'all', type: 'all', road: 'all', rur: 'all' };
  ['filter-year','filter-type','filter-road','filter-rur'].forEach(id => {
    document.getElementById(id).value = 'all';
  });
  applyFilters();
}

// ── HEADER STATS ─────────────────────────────────────────────
function updateHeaderStats(features, stats) {
  const crashes = features.length;
  const fatals  = features.reduce((s, f) => s + (f.properties.fat || 1), 0);
  const nights  = features.filter(f => f.properties.tod === 'night').length;
  const peds    = features.filter(f => f.properties.typ && f.properties.typ.includes('pedestrian')).length;

  document.getElementById('stat-total').textContent   = fatals.toLocaleString();
  document.getElementById('stat-crashes').textContent = crashes.toLocaleString();
  document.getElementById('stat-night').textContent   = crashes ? Math.round(nights/crashes*100) + '%' : '—';
  document.getElementById('stat-ped').textContent     = crashes ? Math.round(peds/crashes*100)   + '%' : '—';
}

// ── CHARTS ───────────────────────────────────────────────────
function renderCharts(stats) {
  renderBarChart('chart-year',
    Object.entries(stats.by_year).map(([k,v]) => [k, v]),
    d3max(Object.values(stats.by_year))
  );

  const typeEntries = Object.entries(stats.by_crash_type)
    .sort((a,b) => b[1]-a[1])
    .map(([k,v]) => [TYPE_LABELS[k] || k, v]);
  renderBarChart('chart-type', typeEntries, typeEntries[0][1]);

  const stateEntries = Object.entries(stats.by_state)
    .sort((a,b) => b[1]-a[1])
    .slice(0,10)
    .map(([k,v]) => [k.length > 12 ? k.slice(0,12) : k, v]);
  renderBarChart('chart-state', stateEntries, stateEntries[0][1]);
}

function updateChartsFromFiltered(features) {
  // Year chart
  const byYear = {};
  features.forEach(f => {
    const yr = String(f.properties.yr);
    byYear[yr] = (byYear[yr] || 0) + (f.properties.fat || 1);
  });
  const yearMax = Math.max(...Object.values(byYear), 1);
  renderBarChart('chart-year',
    Object.entries(byYear).sort((a,b)=>a[0]-b[0]).map(([k,v])=>[k,v]),
    yearMax
  );

  // Type chart
  const byType = {};
  features.forEach(f => {
    (f.properties.typ || 'other').split(',').forEach(t => {
      byType[t] = (byType[t] || 0) + 1;
    });
  });
  const typeEntries = Object.entries(byType).sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => [TYPE_LABELS[k]||k, v]);
  renderBarChart('chart-type', typeEntries, typeEntries[0]?.[1] || 1);

  // State chart (top 10)
  const byState = {};
  features.forEach(f => {
    const st = f.properties.st || 'Unknown';
    byState[st] = (byState[st] || 0) + (f.properties.fat || 1);
  });
  const stateEntries = Object.entries(byState).sort((a,b)=>b[1]-a[1])
    .slice(0,10).map(([k,v])=>[k.length>12?k.slice(0,12):k, v]);
  if (stateEntries.length)
    renderBarChart('chart-state', stateEntries, stateEntries[0][1]);
}

function renderBarChart(containerId, data, maxVal) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  data.forEach(([label, val]) => {
    const pct = maxVal ? Math.round(val / maxVal * 100) : 0;
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <span class="bar-label" title="${label}">${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="bar-val">${val >= 1000 ? (val/1000).toFixed(1)+'k' : val}</span>
    `;
    el.appendChild(row);
  });
}

function d3max(arr) { return Math.max(...arr); }

// ── DATA LOADERS ─────────────────────────────────────────────
async function loadJSON(url) {
  const r = await fetch(url);
  return r.json();
}

async function loadGzippedGeoJSON(url) {
  document.getElementById('loading-text').textContent = 'Downloading crash data…';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  document.getElementById('loading-text').textContent = 'Decompressing 185,000+ records…';

  // Use DecompressionStream API (supported in all modern browsers)
  const ds     = new DecompressionStream('gzip');
  const stream = response.body.pipeThrough(ds);
  const reader = stream.getReader();

  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalBytes += value.length;
    if (totalBytes % (1024 * 500) < 65536) {
      document.getElementById('loading-text').textContent =
        `Decompressing… ${(totalBytes/1e6).toFixed(1)} MB`;
    }
  }

  document.getElementById('loading-text').textContent = 'Parsing data…';

  const allBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    allBytes.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder().decode(allBytes);
  return JSON.parse(text);
}

// ── UI HELPERS ───────────────────────────────────────────────
function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity 0.5s';
  setTimeout(() => { overlay.style.display = 'none'; }, 500);
}
