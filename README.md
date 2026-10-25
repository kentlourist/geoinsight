# GeoInsight – Platform Data Geologi

Situs statis (Leaflet) di GitHub Pages, dengan pemrosesan data otomatis lewat GitHub Actions. Tanpa server.

## Struktur
| Folder/file | Fungsi |
|---|---|
| `index.html`, `app.js`, `style.css` | Antarmuka peta, pencarian, klik satuan geologi, layer, filter, hasil, laporan |
| `sources/<id>/` | Shapefile sumber (mis. GeoMap) + `source.json` (metadata dan pemetaan kolom) |
| `data/` | Hasil normalisasi (`<id>.geojson`) dan `catalog.json` (otomatis) |
| `input/` | Batas wilayah kajian (.zip shapefile atau .geojson) yang akan dianalisis |
| `results/` | Hasil analisis per area (CSV, JSON, GeoJSON irisan) (otomatis) |
| `scripts/` | `ingest.py` (normalisasi sumber), `analyze.py` (irisan dan statistik) |
| `.github/workflows/analyze.yml` | Menjalankan kedua skrip saat `sources/` atau `input/` berubah, atau manual |

## Menjalankan
1. Buat repo, unggah semua isi folder ini ke `main`. Aktifkan Settings → Pages (`main`, root).
2. Settings → Actions → General → Workflow permissions: pilih **Read and write permissions**.
3. Buka situs. Fase 1 langsung bekerja (peta, pencarian, klik satuan geologi Macrostrat).
4. Tambah sumber lokal: salin `sources/contoh-geomap/` ke nama baru, taruh .zip GeoMap, isi `source.json`.
5. Tambah area kajian: unggah ke `input/`. Workflow berjalan otomatis (tab Actions).
6. Setelah workflow hijau, muat ulang situs: pilih hasil di panel "Hasil analisis SHP".
7. Untuk menghitung ulang semua area (mis. setelah menambah sumber): Actions → workflow → Run workflow.

## Catatan
- Perbedaan antar sumber mencerminkan skala, tahun, dan klasifikasi, bukan perubahan kondisi geologi.
- Macrostrat berskala regional. Peta GeoMap adalah milik Pusat Survei Geologi: baca Syarat dan Ketentuan GeoMap sebelum memublikasikan data turunannya.
- Sisi bounding box area kajian maksimal 5°. Jika Macrostrat tidak bisa dijangkau, analisis memakai sampling titik (perkiraan kasar).
- Data geofisika berbentuk poligon/titik/garis GeoJSON bisa ditampilkan lewat `data/catalog.json`. Penampang, 3D, dan penyaringan bahaya belum dibangun.
