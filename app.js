const map = L.map('map').setView([-2.97, 104.75], 9);
const base = {
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom: 18, attribution: 'Citra &copy; Esri, Maxar, Earthstar Geographics'}),
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'})
};
// Tile Macrostrat ("carto") tidak selalu tersedia di zoom tinggi (server sering mengembalikan galat).
// Jika tile gagal, batas zoom asli diturunkan otomatis dan tile diperbesar (overzoom) agar peta tetap tampil.
const MIN_NATIVE = 5;
let cap = +(sessionStorage.getItem('geoCap2') || 5);
const geo = L.tileLayer('https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png', {maxZoom: 18, maxNativeZoom: cap, opacity: .6, attribution: 'Geologi &copy; Macrostrat'});
base.sat.addTo(map); geo.addTo(map);
let marker, aoi, lastPlace = '', currentS = null;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '-').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

document.querySelectorAll('[name=base]').forEach(r => r.onchange = () => {
  Object.values(base).forEach(l => map.removeLayer(l)); base[r.value].addTo(map).bringToBack();
});
$('geo').onchange = e => e.target.checked ? geo.addTo(map) : map.removeLayer(geo);
if (!$('cap')) { const l = document.createElement('label'); l.innerHTML = 'Detail data geologi (zoom maks): <b id="capv">5</b> <input type="range" id="cap" min="5" max="12" step="1" value="5">'; $('op').parentElement.after(l); }
{ const v = document.createElement('p'); v.className = 'muted'; v.textContent = 'Versi aplikasi: 3.1'; $('panel').appendChild(v); }
$('cap').value = cap; $('capv').textContent = cap;
$('cap').oninput = e => { cap = geo.options.maxNativeZoom = +e.target.value; $('capv').textContent = cap; try { sessionStorage.setItem('geoCap2', cap); } catch {} geo.redraw(); };
$('op').oninput = e => geo.setOpacity(+e.target.value);


geo.on('tileerror', e => {
  const z = e.coords.z;
  if (z > MIN_NATIVE && geo.options.maxNativeZoom >= z) {
    cap = geo.options.maxNativeZoom = z - 1;
    try { sessionStorage.setItem('geoCap2', cap); } catch {}
    $('status').textContent = `Detail layer geologi dibatasi sampai zoom ${cap} (server Macrostrat tidak menyediakan tile lebih rinci di sini). Tampilan diperbesar dari data regional.`;
    geo.redraw();
  }
});

const ageOf = u => { const b = u.b_int_name || u.b_int, t = u.t_int_name || u.t_int; return u.age || (b && t && b !== t ? `${b} – ${t}` : (b || t)); };
async function enrichSources() {
  const els = [...document.querySelectorAll('[data-src]')], ids = [...new Set(els.map(e => e.dataset.src))].filter(x => x && x !== 'undefined');
  if (!ids.length) return;
  try {
    const d = (await (await fetch(`https://macrostrat.org/api/v2/defs/sources?source_id=${ids.join(',')}`)).json()).success?.data ?? [];
    els.forEach(el => { const s = d.find(x => String(x.source_id) === el.dataset.src); if (s) el.textContent = [s.name, s.ref_title, s.authors, s.ref_year, s.scale && 'skala ' + s.scale].filter(Boolean).join(' · '); });
  } catch {}
}

// Macrostrat: coba beberapa kombinasi parameter, karena respons endpoint bisa berbeda antar wilayah/skala
async function macroPoint(lat, lng) {
  const tries = ['', '&scale=small', '&scale=medium', '&scale=large', '&response=long'];
  let lastErr = '', empty = false;
  for (const t of tries) {
    const url = `https://macrostrat.org/api/v2/geologic_units/map?lat=${lat}&lng=${lng}${t}`;
    try {
      const r = await fetch(url);
      if (!r.ok) { lastErr = `HTTP ${r.status} untuk ${url}`; continue; }
      const d = (await r.json()).success?.data ?? [];
      if (d.length) return d;
      empty = true;
    } catch (e) { lastErr = e.message; }
  }
  if (empty) return [];
  throw new Error(lastErr);
}

async function queryGeology(lat, lng) {
  if (marker) map.removeLayer(marker);
  marker = L.marker([lat, lng]).addTo(map);
  $('status').textContent = `Mengambil data di ${lat.toFixed(4)}, ${lng.toFixed(4)}…`;
  $('result').innerHTML = localHits(lat, lng);
  try {
    const ck = 'ms2:' + lat.toFixed(3) + ',' + lng.toFixed(3);
    let units; try { units = JSON.parse(sessionStorage.getItem(ck)); } catch {}
    if (!units) { units = await macroPoint(lat, lng); try { sessionStorage.setItem(ck, JSON.stringify(units)); } catch {} }
    if (!units.length) { $('status').textContent = 'Tidak ada satuan geologi pada titik ini (mungkin laut atau di luar cakupan data).'; return; }
    document.dispatchEvent(new CustomEvent('geo:units', {detail: {lat, lng, units, place: lastPlace}}));
    $('status').textContent = `${units.length} satuan ditemukan di ${lat.toFixed(4)}, ${lng.toFixed(4)}.`;
    $('result').innerHTML += '<h3>Macrostrat (skala regional)</h3>' + units.map(u => `
      <div class="unit" style="--c:${esc(u.color || '#888')}">
        <b>${esc(u.name || u.strat_name)}</b>
        <dl><dt>Litologi</dt><dd>${esc(u.lith)}</dd>
        <dt>Umur</dt><dd>${esc(ageOf(u))}</dd>
        <dt>Deskripsi</dt><dd>${esc(u.descrip || u.comments)}</dd>
        <dt>Sumber</dt><dd data-src="${esc(u.source_id)}">${esc(u.source_id)}</dd></dl>
      </div>`).join('');
    enrichSources();
  } catch (err) {
    $('status').textContent = 'Gagal mengambil data geologi (' + err.message + '). Periksa koneksi lalu coba lagi.';
  }
}
map.on('click', e => { lastPlace = ''; queryGeology(e.latlng.lat, e.latlng.lng); });

$('search').onsubmit = async e => {
  e.preventDefault();
  const q = $('q').value.trim(); if (!q) return;
  const m = q.match(/^(-?\d+(\.\d+)?)\s*[, ]\s*(-?\d+(\.\d+)?)$/);
  if (m) { lastPlace = ''; map.setView([+m[1], +m[3]], 12); return queryGeology(+m[1], +m[3]); }
  $('status').textContent = 'Mencari lokasi…';
  try {
    const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q))).json();
    if (!r.length) { $('status').textContent = `Lokasi "${q}" tidak ditemukan. Coba nama lain atau koordinat.`; return; }
    const bb = r[0].boundingbox.map(Number);
    map.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]]);
    lastPlace = r[0].display_name.split(',').slice(0, 3).join(',');
    queryGeology(+r[0].lat, +r[0].lon);
  } catch { $('status').textContent = 'Pencarian gagal. Periksa koneksi lalu coba lagi.'; }
};

$('file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const gj = f.name.toLowerCase().endsWith('.zip') ? await shp(await f.arrayBuffer()) : JSON.parse(await f.text());
    if (aoi) map.removeLayer(aoi);
    aoi = L.geoJSON(gj, {style: {color: '#3dd6c6', weight: 2, fillOpacity: .05}}).addTo(map);
    map.fitBounds(aoi.getBounds());
    const c = aoi.getBounds().getCenter();
    lastPlace = f.name;
    queryGeology(c.lat, c.lng);
    $('status').textContent += ' (pratinjau titik pusat. Untuk statistik luas, taruh file di folder input/ repo)';
  } catch { $('status').textContent = 'File tidak terbaca. Unggah .zip berisi .shp/.dbf/.shx/.prj atau file .geojson (disarankan CRS WGS84).'; }
};

// Fase 3: katalog sumber lokal (data/catalog.json) dengan metadata, filter, dan perbandingan antar sumber
const localLayers = [];
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const inPoly = (x, y, rs) => inRing(x, y, rs[0]) && !rs.slice(1).some(r => inRing(x, y, r));
const inGeom = (x, y, g) => g.type === 'Polygon' ? inPoly(x, y, g.coordinates) : g.type === 'MultiPolygon' && g.coordinates.some(p => inPoly(x, y, p));
function localHits(lat, lng) {
  const on = localLayers.filter(l => map.hasLayer(l.layer) && lng >= l.meta.bbox[0] && lng <= l.meta.bbox[2] && lat >= l.meta.bbox[1] && lat <= l.meta.bbox[3]);
  if (!on.length) return '';
  return on.map(l => {
    const hit = l.data.features.filter(f => inGeom(lng, lat, f.geometry));
    return `<h3>${esc(l.meta.title)}<br><small>skala ${esc(l.meta.scale)} · ${esc(l.meta.year)}</small></h3>` + (hit.length ? hit.map(f => `<div class="unit" style="--c:${esc(f.properties.color)}"><b>${esc(f.properties.name)}</b><dl><dt>Litologi</dt><dd>${esc(f.properties.lith)}</dd><dt>Umur</dt><dd>${esc(f.properties.age)}</dd></dl></div>`).join('') : '<p class="muted">Tidak ada satuan di titik ini.</p>');
  }).join('') + '<p class="muted">Perbedaan antar sumber mencerminkan perbedaan skala, tahun, dan klasifikasi, bukan perubahan kondisi geologi.</p>';
}
$('flt').oninput = e => {
  const q = e.target.value.trim().toLowerCase();
  localLayers.forEach(l => l.layer.eachLayer(f => { const p = f.feature.properties, ok = !q || [p.name, p.lith, p.age].join(' ').toLowerCase().includes(q); f.setStyle({fillOpacity: ok ? .55 : 0, opacity: ok ? 1 : 0}); }));
};
fetch('data/catalog.json').then(r => r.ok ? r.json() : []).then(list => list.forEach(m => {
  const lbl = document.createElement('label');
  lbl.innerHTML = `<input type="checkbox"> ${esc(m.title)}<br><small class="muted" title="${esc(m.citation)}">${esc(m.scale)} · ${esc(m.year)} · ${esc(m.publisher)} · ${m.features} fitur</small>`;
  lbl.firstChild.onchange = async ev => {
    let l = localLayers.find(x => x.meta.id === m.id);
    if (!l) {
      const data = await (await fetch(m.file)).json();
      l = {meta: m, data, layer: L.geoJSON(data, {style: f => ({color: '#fff', weight: .5, fillColor: f.properties.color, fillOpacity: .55}),
        onEachFeature: (f, ly) => ly.bindPopup(`<b>${esc(f.properties.name)}</b><br>${esc(f.properties.lith)}<br>${esc(f.properties.age)}`)})};
      localLayers.push(l);
    }
    ev.target.checked ? l.layer.addTo(map) : map.removeLayer(l.layer);
  };
  $('local').appendChild(lbl);
})).catch(() => {});

// Fase 2 + 4: hasil analisis (Macrostrat + semua sumber lokal) dan laporan
let resLayer;
const unitCards = us => us.map(u => `<div class="unit" style="--c:${esc(u.color)}"><b>${esc(u.name)}</b><dl><dt>Litologi</dt><dd>${esc(u.lith)}</dd><dt>Umur</dt><dd>${esc(u.age)}</dd><dt>Luas</dt><dd>${u.area_km2} km² (${u.persen}%)</dd></dl></div>`).join('');
const unitTable = (title, us) => `<h2>${esc(title)}</h2><table><tr><th>Formasi</th><th>Litologi</th><th>Umur</th><th>km²</th><th>%</th></tr>${us.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.lith)}</td><td>${esc(u.age)}</td><td>${u.area_km2}</td><td>${u.persen}</td></tr>`).join('')}</table>`;
function report(s) {
  const w = window.open('', '_blank'); if (!w) { alert('Izinkan pop-up untuk membuat laporan.'); return; }
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Laporan geologi ${esc(s.id)}</title><style>body{font:14px/1.5 sans-serif;max-width:800px;margin:20px auto;padding:0 12px}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #999;padding:4px 8px;text-align:left}</style>` +
    `<h1>Laporan geologi: ${esc(s.id)}</h1><p>Luas area ${s.total_km2} km² · dibuat ${esc(s.generated)}</p>` +
    unitTable(`Macrostrat (skala regional) – ${s.method}`, s.units) +
    (s.local || []).map(l => unitTable(`${l.title} – skala ${l.scale}, tahun ${l.year}, mencakup ${l.covered_pct}% area`, l.units)).join('') +
    `<p><i>Ringkasan awal dari peta geologi, bukan pengganti kajian geoteknik atau penilaian risiko resmi. Perbedaan antar sumber mencerminkan skala, tahun, dan klasifikasi peta.</i></p><script>print()<\/script>`);
  w.document.close();
}
fetch('results/index.json').then(r => r.ok ? r.json() : []).then(list => {
  list.forEach(e => $('res').add(new Option(e.error ? `${e.id} (gagal)` : `${e.id} – ${e.total_km2} km²`, e.id)));
  $('res').onchange = async () => {
    if (resLayer) map.removeLayer(resLayer);
    const e = list.find(x => x.id === $('res').value);
    if (!e) return;
    if (e.error) { $('resOut').textContent = 'Analisis gagal: ' + e.error; return; }
    const s = await (await fetch(`results/${e.dir}/summary.json`)).json();
    currentS = s; document.dispatchEvent(new CustomEvent('geo:analysis', {detail: s}));
    const base = `results/${e.dir}/`, local = s.local || [];
    const draw = async file => {
      if (resLayer) map.removeLayer(resLayer);
      if (!file) return;
      resLayer = L.geoJSON(await (await fetch(base + file)).json(), {
        style: f => ({color: '#fff', weight: .6, fillColor: f.properties.color, fillOpacity: .7}),
        onEachFeature: (f, l) => l.bindPopup(`<b>${esc(f.properties.name)}</b><br>${esc(f.properties.lith)}<br>${f.properties.area_km2} km²`)}).addTo(map);
      map.fitBounds(resLayer.getBounds());
    };
    $('resOut').innerHTML = `<p>Dibuat: ${esc(s.generated)}${s.notes.length ? '<br>Catatan: ' + esc(s.notes.join('; ')) : ''}</p>` +
      `<label>Tampilkan di peta <select id="resSrc"><option value="intersect.geojson">Macrostrat</option>${local.map(l => `<option value="intersect_${esc(l.id)}.geojson">${esc(l.title)}</option>`).join('')}</select></label>` +
      `<h3>Macrostrat – ${esc(s.method)}</h3>${unitCards(s.units)}<p><a href="${base}summary.csv" download>Unduh CSV</a></p>` +
      local.map(l => `<h3>${esc(l.title)}<br><small>skala ${esc(l.scale)} · ${esc(l.year)} · mencakup ${l.covered_pct}% area</small></h3>${unitCards(l.units)}<p><a href="${base}summary_${esc(l.id)}.csv" download>Unduh CSV</a></p>`).join('') +
      (local.length ? '' : '<p class="muted">Belum ada sumber lokal yang mencakup area ini.</p>') +
      '<p><button id="rep">Buat laporan (cetak/PDF)</button></p>';
    $('rep').onclick = () => report(s);
    $('resSrc').onchange = ev => draw(ev.target.value);
    if (s.method.startsWith('interseksi')) draw('intersect.geojson');
  };
}).catch(() => {});
