# SIPKP

Aplikasi penilaian kinerja Puskesmas dengan frontend React 19/Vite dan backend NestJS 11/Prisma 6.19.3. Frontend terintegrasi dengan API nyata. PostgreSQL menyimpan data dan session; Redis menyediakan rate limit dan antrean BullMQ; MinIO menyimpan bukti dan laporan.

> Scoring/prorata `ILP_2026_V1` masih provisional dan memerlukan signoff produk/domain. VERIFIED/`isOfficial` adalah status workflow internal, bukan pengesahan klinis atau regulasi. Bridge eksternal belum tersedia dan mengembalikan 503, bukan sukses simulasi.

## Quickstart Lokal

Prasyarat: Node.js **22+**, npm, Docker dengan Compose plugin, dan port lokal yang tersedia. Semua perintah berikut dari **root repository**, untuk lingkungan development, bukan database produksi.

Root memiliki `bun.lock`, tetapi belum memiliki `package-lock.json`: **jangan memakai `npm ci` di root**. Pilihan instalasi root dengan lockfile existing (memerlukan Bun):

```bash
bun install --frozen-lockfile
```

Alternatif tanpa Bun adalah `npm install` di root; ini membuat `package-lock.json` baru dan tidak memakai `bun.lock`. Backend memiliki npm lockfile sendiri:

```bash
npm --prefix backend ci
node backend/scripts/local.mjs
npm --prefix backend run prisma:generate
npm --prefix backend run db:deploy
npm --prefix backend run db:seed
npm --prefix backend run build
```

`local.mjs` membuat `backend/.env` privat (mode 0600) dengan password dependency/JWT/storage secret acak **hanya jika belum ada**, tanpa mencetak secret atau membuat akun. Script menyalakan PostgreSQL, Redis, MinIO dan menginisialisasi bucket privat `evidence`/`reports`. Env existing tidak ditimpa dan kredensial volume existing tidak diperbaiki otomatis. Jangan commit env. Gunakan migrasi SQL, bukan `db push`, karena ada CHECK/trigger yang diperlukan.

Seed normal menyediakan baseline awal 272 indikator, 68 sections dan tahun 2026, tanpa akun, Puskesmas, pencapaian atau skor sintetis. Upsert katalog existing memakai `update: {}`: perubahan manual, label dan status arsip dipertahankan, bukan direset. Jumlah indikator runtime mengikuti katalog aktif secara dinamis, bukan wajib 272. Untuk admin pertama, tambahkan kedua variabel berikut ke **`backend/.env` privat**, dengan nilai pilihan operator, lalu seed ulang:

```dotenv
BOOTSTRAP_ADMIN_USERNAME=<username-admin-pilihan-operator>
BOOTSTRAP_ADMIN_PASSWORD=<secret-unik-minimal-12-karakter>
```

Placeholder di atas bukan nilai siap pakai atau kredensial default.

```bash
npm --prefix backend run db:seed
npm --prefix backend start
```

Bootstrap membuat `DINKES_ADMIN` tanpa tenant, tidak mereset akun existing atau menaikkan role akun yang bertabrakan. Hapus variabel bootstrap dari konfigurasi runtime setelah provisioning. Di terminal lain, jalankan frontend dari root:

```bash
npm run dev
```

- Frontend: **http://localhost:5175**. Vite memakai `strictPort: true`, sehingga gagal jika port terpakai, bukan pindah port diam-diam.
- API: **http://localhost:4000/api/v1**. Vite meneruskan `/api/v1` ke `http://localhost:4000`.
- Liveness: http://localhost:4000/api/v1/health; readiness DB/Redis/kedua bucket: http://localhost:4000/api/v1/health/ready.
- Swagger: http://localhost:4000/api/docs ketika `ENABLE_SWAGGER=true` (diaktifkan env baru dari script lokal).
- MinIO console lokal: http://127.0.0.1:59001. Kredensial ada di env privat, bukan akun demo.

Masuk sebagai Dinkes dengan akun bootstrap. Dinkes tanpa tenant tetap dapat membuka master global dan membuat Puskesmas pertama melalui **Pusat Data Master**; pembuatan ini tidak memerlukan tenant terpilih. Setelah itu pilih Puskesmas dan buat admin/PIC dengan username serta password eksplisit. Kedua role administrator dapat membuat tahun dan mengedit cutoff; hanya Dinkes mengunci/membuka atau menghapus tahun yang belum direferensikan. Target diisi admin Puskesmas, dan PIC hanya menulis indikator yang ditugaskan. Bootstrap UI ini adalah perilaku implementasi, bukan klaim browser test khusus lingkungan kosong sudah lulus.

Demo opsional hanya untuk development: `SEED_DEMO=true` dan `SEED_DEMO_PASSWORD` pilihan operator minimal 12 karakter, lalu seed ulang. Akun `demo.dinkes`, `demo.admin`, `demo.pic` dan tenant `DEMO-001` tidak memiliki password default; seed demo tidak membuat histori/skor sintetis. Detail ada di [panduan backend](backend/README.md).

## Backend Container

Setelah dependency, bucket, migrasi dan seed disiapkan dari host seperti di atas, backend dapat dijalankan dalam container **sebagai alternatif** server host (jangan menjalankan keduanya pada port 4000):

```bash
docker compose --env-file backend/.env -f backend/compose.yml --profile app up -d --build
```

Compose mengganti alamat dependency internal app; env host tetap memakai published port loopback untuk CLI migrasi. `MINIO_PUBLIC_ENDPOINT` harus tetap dapat dijangkau browser. Image runtime tidak menjalankan migrasi/seed otomatis. Compose ini scaffold development, bukan deployment produksi yang sudah hardened.

## API Dan Deployment

[`.env.example`](.env.example) mendokumentasikan `VITE_API_BASE_URL=/api/v1`; ini default dan tidak perlu env frontend untuk quickstart. Nilai `VITE_*` masuk bundle saat build, bukan secret. URL absolut opsional, misalnya `https://api.example.invalid/api/v1`, memerlukan backend `FRONTEND_URL` yang cocok **exact origin** frontend serta CORS/storage yang sesuai. Restart Vite/rebuild setelah perubahan env frontend.

```bash
npm run build
```

Hasil frontend ada di `dist/`. Proxy Vite hanya untuk development; deployment harus meneruskan `/api/v1` ke backend dan melayani frontend dengan SPA fallback. Contoh fragmen Nginx untuk **same-origin** berikut bukan file konfigurasi yang disertakan atau setup TLS lengkap:

```nginx
server {
    listen 80;
    server_name sipkp.example.invalid;
    root /srv/sipkp/dist;
    index index.html;

    location /api/v1 {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`proxy_pass` tanpa trailing URI mempertahankan `/api/v1`; jangan mengarahkan error API ke `index.html`. Swagger tidak ikut diproxy contoh ini. Tambahkan TLS dan review trust-proxy/IP rate limit sebelum produksi; backend belum mengonfigurasi trust proxy. Signed upload/download menuju endpoint storage publik langsung, bukan otomatis lewat proxy API: sediakan TLS, endpoint browser dan CORS storage yang benar, tanpa mengganti host signed URL setelah diterbitkan. `FRONTEND_URL` env lokal baru adalah `http://localhost:5175`; ubah ke origin deployment saat berpindah lingkungan.

## Perilaku Integrasi

- [`apiClient.ts`](src/services/apiClient.ts) menangani envelope/error API, refresh rotation dan satu retry setelah 401. Refresh token saja disimpan pada `sessionStorage` (`SIPKP_SESSION`); access token hanya di memori. Reload memulihkan session lewat refresh dan `/auth/me`. Jalur runtime tidak menyimpan password plaintext, skor atau data operasional di browser storage; argumen remember tidak menyediakan persistensi tambahan.
- [`apiStore.ts`](src/services/apiStore.ts) memakai identity/role server. Pergantian user, tenant atau tahun membersihkan data scoped, membatalkan read lama dan memakai generation/scope identity untuk menolak respons stale. Pending write memblokir pergantian lingkup; UI bukan pengganti otorisasi backend.
- Target, penugasan, input bulanan, rekomendasi/RTL, audit, Sheet 7, tren dan supervisi berasal dari API. Decimal dinormalisasi di boundary; missing/null tidak dijadikan skor nol atau sukses. Backend menghitung scoring dan mempertahankan snapshot periode terlindungi.
- Evidence memakai signed PUT ke MinIO, finalize, lalu attachment record. XLSX/PDF memakai job worker nyata, polling tenant-scoped dan signed download; kegagalan tidak diubah menjadi laporan sukses lokal.
- CRUD indikator/section tersedia untuk `ADMIN_PUSKESMAS` dan `DINKES_ADMIN` pada **katalog global bersama seluruh tenant**, bukan salinan tenant. DELETE adalah soft archive; PATCH `isActive:true` memulihkan. GET default hanya aktif; `includeArchived=true` opsional hanya untuk kedua role pengelola. ID indikator/kode section adalah natural ID, bukan UUID; encode sebagai segmen URL. Section harus kosong dari indikator/child section aktif sebelum diarsipkan; pemulihan memerlukan parent aktif.
- Perubahan scoring/denominator/hierarki indikator yang sudah memiliki record ditolak409; buat ID/versi indikator baru, bukan menghitung ulang sejarah diam-diam. Mutasi diaudit; snapshot periode terlindungi tetap immutable melalui API, sementara laporan draft/live dapat berubah. Migrasi `20261019000000_section_is_active` telah dideploy; tetap jalankan `db:deploy` untuk setiap environment.
- Dinkes membuat/mengarsipkan Puskesmas; admin Puskesmas mengedit profil tenant sendiri. DELETE akun adalah **deaktivasi** (`INACTIVE`), bukan hard delete. Bulk maksimum2000 item, pagination maksimum500. Rollover target belum tersedia; bridge belum melakukan sync dan tidak menandai data SYNCED.
- Reset terkelola tersedia lewat `POST /users/:id/reset-password`: admin hanya PIC tenant sendiri, Dinkes admin/PIC tenant terpilih; tidak boleh reset peer admin atau diri sendiri. Gunakan `/auth/change-password` untuk password sendiri. Password baru minimal12 karakter dan alasan wajib; semua session target dicabut, audit tanpa password/hash/token. Pemulihan mandiri/forgot-password tidak tersedia dan tidak direncanakan, sesuai kebutuhan pengguna eksplisit.
- [`mockState.ts`](src/services/mockState.ts) tetap ada sebagai sumber katalog legacy/offline importer, **tidak diimpor jalur runtime aplikasi**. [`import-catalogue.mjs`](backend/scripts/import-catalogue.mjs) membaca metadata section dari file itu dan indikator dari `src/data/indicators.ts`, membuang history/pencapaian mock dan menghasilkan JSON seed. Import ulang bukan langkah startup; review perubahan katalog/scoring sebelum seed DB berisi histori.

## Verifikasi

Build frontend dan pengujian backend:

```bash
npm run build
node --test backend/scripts/catalogue.test.mjs
npm --prefix backend run test
npm --prefix backend run build
TEST_E2E=true npm --prefix backend run test:e2e
```

Backend e2e memakai PostgreSQL/Redis/MinIO nyata dari konfigurasi backend, bukan otomatis `TEST_DATABASE_URL`. Gunakan environment disposable; fixtures/audit dipertahankan dan slot tahun pengujian terbatas. Tanpa `TEST_E2E=true`, backend e2e di-skip.

Browser tests memerlukan frontend development Vite dan backend/dependency nyata yang **sudah berjalan**, migrasi/katalog seed, dependency root/backend dan browser Chromium Playwright:

```bash
npx playwright install chromium
npm run test:e2e
node tests/master-browser.e2e.mjs
```

[`run-browser-e2e.mjs`](tests/run-browser-e2e.mjs) membuat password test acak jika `FE_E2E_PASSWORD` tidak disediakan, menjalankan seed fixture lalu tiga suite berurutan, tanpa mencetak kredensial. `FE_E2E_URL` default `http://localhost:5175`, `FE_E2E_API_URL` default `http://localhost:4000/api/v1`. Session suite memerlukan secret JWT backend test dari `backend/.env`/environment untuk membuat fixture token expired bertanda tangan valid. Jangan gunakan secret atau DB produksi. Fixtures, object, job dan audit dipertahankan; tidak ada rollback/cleanup otomatis.

- [`frontend.e2e.mjs`](tests/frontend.e2e.mjs): login tiga role, persistensi target/input bulanan, upload/finalize/download evidence, reload session, izin PIC dan isolasi tenant Dinkes.
- [`workflow-browser.e2e.mjs`](tests/workflow-browser.e2e.mjs): fixture HTTP nyata, submit/verify/reopen via UI, persisted locks, XLSX/PDF dari worker dan navigasi/overflow mobile. Siklus mutasi workflow dan reload terarah memakai 9 request (1 mutasi + 8 read periode/target/analytics), bukan reload full scope sekitar 26 request.
- [`session-browser.e2e.mjs`](tests/session-browser.e2e.mjs): JWT benar-benar expired dengan signature valid, 401/refresh/retry nyata, scope guard saat write pending, logout revocation, ganti password yang mencabut semua session, dan stale-refresh isolation. Bukan intercept HTTP atau respons auth mock.
- [`master-browser.e2e.mjs`](tests/master-browser.e2e.mjs) dijalankan terpisah dengan perintah di atas, **belum termasuk runner gabungan**. Run final lulus seluruh flow dengan console bersih: CRUD global Admin/Dinkes, visibilitas lintas Puskesmas, reset PIC, pencabutan session lama, password lama401/password baru login200, dan cleanup melalui arsip.

Rate limit tetap aktif: login 5/IP dan route lain 120/actor atau IP publik per jendela 60 detik. Runner memberi jeda 61 detik antar suite browser; hindari reload penuh berulang dan tes paralel yang menghabiskan limit bersama. Hasil terbaru yang dilaporkan: build frontend dan16 test default backend lulus, termasuk test arsip section baru;8 subtest API CRUD/reset dengan DB nyata lulus pada run terpisah setelah koreksi fixture. Dua suite backend lama lulus pada run saat fixture suite baru masih gagal; **belum ada klaim run gabungan backend terbaru seluruhnya lulus**. Delapan focused master tests dan5 operations tests berada di `src/`, di luar glob default `test/*.test.ts`; jalankan berikut dengan working directory **backend/**:

```bash
npx tsx --test src/master/masters.test.ts src/operations/operations.service.test.ts
```

Ketiga suite browser gabungan sebelumnya lulus; run final master browser terpisah kini juga lulus, bukan pending. Hasil ini tidak dijalankan ulang dalam edit dokumentasi ini dan tidak membuktikan bootstrap pertama, seluruh ukuran layar, concurrency, keamanan atau kesiapan produksi.

## Referensi Dan Batas

[Panduan backend](backend/README.md) menjelaskan env, bootstrap, storage, container dan test disposable. [Spesifikasi implementasi](BACKEND_SPECIFICATION_NESTJS_PRISMA.md) merinci endpoint, tenant, penguncian, scoring, snapshot dan keterbatasan.

Sebelum produksi tetap diperlukan signoff domain, kontrak bridge resmi, PostgreSQL least-privilege terpisah dari migrator, TLS/trust proxy teruji, secret rotation, storage policy, backup/restore drill, retensi, malware scanning dan monitoring. Integrasi frontend nyata tidak berarti sistem sudah disertifikasi siap produksi.
