// Antarmuka: tab, menu, legenda, kartu informasi, donat litologi (data berasal dari app.js)
const $$ = s => [...document.querySelectorAll(s)], E = s => String(s ?? '-').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function tab(n) { $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === n)); $$('.tab').forEach(t => t.classList.toggle('on', t.id === 't-' + n)); }
$$('.tabs button').forEach(b => b.onclick = () => tab(b.dataset.tab));
$$('.side [data-go]').forEach(b => b.onclick = () => {
  const g = b.dataset.go;
  if (g === 'unggah') return $('file').click();
  $$('.side button').forEach(x => x.classList.toggle('on', x === b));
  if (g === 'laporan') { if (currentS) report(currentS); else { tab('ana'); $('resOut').textContent = 'Pilih hasil analisis dulu untuk membuat laporan.'; } return; }
  tab({peta: 'strat', layer: 'layer', analisis: 'ana'}[g]);
});
const legend = $('legend'); L.DomEvent.disableClickPropagation(legend); L.DomEvent.disableScrollPropagation(legend);
function setLegend(title, items) {
  legend.hidden = !items.length;
  legend.innerHTML = `<b>${E(title)}</b>` + items.map(i => `<div><i style="background:${E(i.color)}"></i>${E(i.name)}</div>`).join('');
}
const ageText = u => ageOf(u) || '-';
document.addEventListener('geo:units', ev => {
  const {lat, lng, units, place} = ev.detail, u = units[0];
  setLegend('Satuan geologi di titik ini', units.map(x => ({color: x.color || '#888', name: x.name || x.strat_name})));
  $('c-loc').innerHTML = `<h3>${E(place || 'Informasi lokasi')}</h3><dl class="kv"><dt>Koordinat</dt><dd>${lat.toFixed(4)}, ${lng.toFixed(4)}</dd><dt>Satuan</dt><dd>${E(u.name || u.strat_name)}</dd><dt>Litologi</dt><dd>${E(u.lith)}</dd><dt>Umur</dt><dd>${E(ageText(u))}</dd><dt>Jumlah satuan</dt><dd>${units.length}</dd></dl>`;
  $('summary').innerHTML = `<h3>Ringkasan</h3><p>Titik ${lat.toFixed(4)}, ${lng.toFixed(4)} berada pada <b>${E(u.name || u.strat_name)}</b> (litologi ${E(u.lith)}, umur ${E(ageText(u))}). Data berasal dari peta regional Macrostrat; peta detail dapat berbeda.</p><button class="act" id="sumrep">Unduh laporan</button>`;
  $('sumrep').onclick = () => currentS ? report(currentS) : ($('resOut').textContent = 'Pilih hasil analisis dulu untuk membuat laporan.', tab('ana'));
});
document.addEventListener('geo:analysis', ev => {
  const s = ev.detail, by = {};
  s.units.forEach(u => { const k = u.lith || '-'; by[k] = by[k] || {name: k, v: 0, color: u.color}; by[k].v += u.area_km2; });
  const arr = Object.values(by).sort((a, b) => b.v - a.v), tot = arr.reduce((t, x) => t + x.v, 0) || 1;
  let off = 0;
  const arcs = arr.map(x => { const f = x.v / tot * 251.3, c = `<circle r="40" cx="60" cy="60" fill="none" stroke="${E(x.color)}" stroke-width="20" stroke-dasharray="${f} ${251.3 - f}" stroke-dashoffset="${-off}"/>`; off += f; return c; }).join('');
  $('c-lith').innerHTML = `<h3>Distribusi litologi – ${E(s.id)}</h3><div class="donut"><svg viewBox="0 0 120 120" width="120" height="120" style="transform:rotate(-90deg)">${arcs}</svg><ul>${arr.slice(0, 6).map(x => `<li><i style="background:${E(x.color)}"></i>${(x.v / tot * 100).toFixed(1)}% ${E(x.name)}</li>`).join('')}</ul></div><p class="muted">Luas area ${s.total_km2} km² · ${E(s.method)}</p>`;
  setLegend('Satuan di area kajian', s.units.slice(0, 12).map(x => ({color: x.color, name: x.name})));
});
