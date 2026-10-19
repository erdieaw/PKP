# Backend SIPKP

Implementasi NestJS11 / Prisma6.19.3 dengan PostgreSQL, Redis7/BullMQ, dan MinIO. Kontrak API dan batasannya ada pada [spesifikasi implementasi](../BACKEND_SPECIFICATION_NESTJS_PRISMA.md), bukan spesifikasi resmi pemerintah. Frontend React/Vite sudah terintegrasi melalui [apiClient](../src/services/apiClient.ts) dan [apiStore](../src/services/apiStore.ts). Quickstart aplikasi dan contoh reverse proxy ada di [README root](../README.md).

> Aturan scoring/prorata `ILP_2026_V1` masih provisional dan memerlukan persetujuan produk/domain. Flag `isOfficial` hanya menandai snapshot VERIFIED yang lengkap, bukan validasi klinis atau pengesahan regulasi.

## Prasyarat

- Node.js22+, npm, Docker dengan Compose plugin; jalankan perintah berikut dari **root repository**, kecuali disebutkan lain.
- [compose.yml](compose.yml) memakai PostgreSQL **16.10-alpine**, Redis7.4.5-alpine dan MinIO `quay.io/minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`.
- [schema.prisma](prisma/schema.prisma) dan [migrasi SQL](prisma/migrations/) adalah sumber skema. Migrasi `20261019000000_section_is_active` telah dideploy; environment lain tetap memerlukan `db:deploy`. CHECK dan trigger SQL tidak boleh diganti dengan `db push`.

## Konfigurasi Lokal

Quickstart di bawah dapat membuat `backend/.env` lokal otomatis dengan secrets acak. Alternatif manual: gunakan [`.env.example`](.env.example) dan isi semua secret/placeholder sebelum menjalankan layanan. Jangan commit env atau memakai kredensial pengujian sebagai default.

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`: cocokkan dengan `DATABASE_URL`; URL-encode username/password di URL PostgreSQL.
- `DATABASE_URL` untuk aplikasi **host** harus memakai `127.0.0.1` dan published port PostgreSQL (default55432), bukan hostname Docker `postgres`.
- `REDIS_URL` host default `redis://127.0.0.1:56379`; cocokkan `REDIS_PORT` bila diubah.
- `JWT_SECRET` minimal32 karakter; `ACCESS_TOKEN_SECONDS` default900, `REFRESH_TOKEN_DAYS` default7.
- `MINIO_ACCESS_KEY` dan `MINIO_SECRET_KEY` wajib diisi sendiri; scaffold memakainya sebagai akun root MinIO, bukan contoh policy produksi.
- `MINIO_ENDPOINT` host default `http://127.0.0.1:59000`; `MINIO_PUBLIC_ENDPOINT` harus alamat yang dapat diakses **client/browser**, dengan scheme/host/port final yang sama dengan signed URL.
- `EVIDENCE_BUCKET=evidence`, `REPORTS_BUCKET=reports`: script lokal memastikan bucket **privat** melalui `init-storage.mjs`; alternatif manual melalui console/tooling operator. Console lokal default `http://127.0.0.1:59001`. Runtime aplikasi tidak auto-create bucket.
- `FRONTEND_URL` exact origin tanpa path/trailing slash: default config `http://localhost:3000`, env buatan local.mjs memakai `http://localhost:5175`; sesuaikan origin frontend aktual. `PORT` default4000; `NODE_ENV=development` untuk host dev.
- `ENABLE_SWAGGER=true` opsional membuka `/api/docs`; jangan mengekspos dokumentasi tanpa review akses produksi.

Scaffold binding port dependency ke loopback. Port MinIO publik dapat berbeda dari endpoint internal, tetapi URL bertanda tangan tidak boleh diganti hostname setelah diterbitkan. Untuk client remote, atur endpoint publik/reverse proxy dan bucket CORS/policy yang diperlukan secara eksplisit.

## Install, Migrasi, Seed, Run

Quickstart **dari root repository**, dengan Docker tersedia:

```bash
npm --prefix backend ci
node backend/scripts/local.mjs
npm --prefix backend run prisma:generate
npm --prefix backend run db:deploy
npm --prefix backend run db:seed
npm --prefix backend run build
npm --prefix backend start
```

[local.mjs](scripts/local.mjs) menentukan direktori backend dari lokasi script, sehingga pemanggilan dari root benar. Jika env belum ada, script membuat random password/JWT/storage secret dengan mode0600, tidak mencetak secret, tanpa default user atau akun demo; env existing **tidak ditimpa**. Script menjalankan Compose `up --wait` untuk dependency lalu [init-storage.mjs](scripts/init-storage.mjs) dari cwd backend untuk menyiapkan bucket. Env existing harus sudah valid; script tidak memperbaiki placeholder atau mengganti kredensial volume existing.

`npm --prefix backend run ...` menjalankan script dari direktori backend sehingga `dotenv/config` dan Prisma menemukan `backend/.env`; tidak sama dengan mengeksekusi `node backend/dist/src/main.js` langsung dari root. `--env-file backend/.env` pada Compose diperlukan untuk interpolasi dari root; `env_file: .env` service app saja tidak mengisi interpolasi Compose.

Untuk provisioning manual dengan env yang telah diisi:

```bash
docker compose --env-file backend/.env -f backend/compose.yml up -d --wait postgres redis minio
```

Lalu jalankan `node scripts/init-storage.mjs` **dengan working directory backend/** sebelum generate/deploy/seed/build/start seperti di atas. Tidak ada migrasi/seed otomatis saat runtime mulai. `/api/v1/health` hanya liveness; `/api/v1/health/ready` menguji DB, Redis, dan kedua bucket. Startup worker juga memerlukan Redis dan akses DB.

API memakai prefix global **`/api/v1`**: contoh `/api/v1/auth/login`, `/api/v1/master/indicators`, `/api/v1/analytics/sheet7`; Swagger opsional tetap `/api/docs`. `npm --prefix backend run dev` saat ini compile TypeScript **sekali** lalu `node --watch` pada output JS; bukan hot reload/rebuild source TS. Setelah edit TS, lakukan build ulang atau gunakan build/start; jangan jalankan dua server pada port sama.

## Bootstrap Dan Demo

[Seed](prisma/seed.ts) normal menyediakan **baseline awal 272 indikator operasional, 68 sections (29 top-level +39 nested), dan tahun2026**. Jumlah runtime mengikuti katalog aktif, bukan batas tetap272. Tidak ada indikator head persisten atau riwayat pencapaian mock. Tanpa flag akun, DB kosong tetap tidak memiliki pengguna/health center sehingga login belum mungkin.

- Untuk admin pertama, konfigurasi **keduanya** di env privat: `BOOTSTRAP_ADMIN_USERNAME` dan `BOOTSTRAP_ADMIN_PASSWORD` (minimal12 karakter), lalu jalankan ulang `npm --prefix backend run db:seed`.
- Bootstrap membuat `DINKES_ADMIN` tanpa tenant. Tidak mereset password/status akun existing; benturan username dengan akun role/tenant lain gagal, bukan menaikkan hak akses.
- Untuk demo lokal saja, set `SEED_DEMO=true` dan `SEED_DEMO_PASSWORD` buatan sendiri minimal12 karakter; hanya aktif jika `NODE_ENV` bukan production.
- Demo membuat `DEMO-001`, `demo.dinkes`, `demo.admin`, `demo.pic`, tanpa password default dan tanpa record/skor sintetis. Username bootstrap tidak boleh bertabrakan dengan username demo saat demo aktif.
- Hilangkan flag/secret bootstrap dan demo dari konfigurasi runtime setelah provisioning sesuai kebijakan operator. Upsert section/indikator existing memakai **`update: {}`**: seed ulang mempertahankan perubahan manual, label, status arsip, data operasional dan password/status akun. Seed hanya menambahkan identity yang belum ada, bukan mereset katalog.
- Import ulang katalog bukan langkah startup biasa. Jika sumber katalog sengaja berubah, dari root jalankan `node backend/scripts/import-catalogue.mjs`, review JSON dan versi scoring sebelum seed.

Dinkes bootstrap dapat masuk tanpa tenant dan membuat Puskesmas pertama melalui master global UI, lalu memilihnya untuk membuat akun admin/PIC dengan kredensial eksplisit. Ini perilaku implementasi, bukan klaim browser test khusus bootstrap kosong telah lulus. Frontend membaca katalog/identity dari API; `src/services/mockState.ts` tidak diimpor runtime, hanya dipertahankan sebagai sumber metadata section untuk importer katalog offline bersama `src/data/indicators.ts`. Histori mock tidak diimpor.

## Frontend Terintegrasi

Instal dependency root dengan `bun install --frozen-lockfile` (root memiliki `bun.lock`), atau `npm install` bila tidak memakai Bun. Alternatif npm membuat `package-lock.json` baru; `npm ci` root tidak dapat dipakai tanpa npm lockfile. Backend tetap memakai `npm --prefix backend ci`. Jalankan `npm run dev` di root: Vite membuka **http://localhost:5175** dengan strict port dan proxy `/api/v1` ke **http://localhost:4000**.

Default frontend `VITE_API_BASE_URL=/api/v1` ada di [env example root](../.env.example). Deployment `dist/` perlu reverse proxy same-origin `/api/v1` ke backend dan SPA fallback untuk frontend; proxy Vite bukan bagian build produksi. URL API absolut opsional memerlukan CORS `FRONTEND_URL` exact origin frontend. Signed URL storage tetap harus dapat dijangkau browser; contoh deployment ada di README root.

Refresh token disimpan hanya di `sessionStorage`, access token hanya di memori; reload memakai refresh lalu `/auth/me`. Tidak ada password plaintext atau skor operasional yang disimpan di browser storage pada jalur runtime. Opsi remember tidak menyediakan persistensi tambahan. Identity/role backend authoritative; store membersihkan scope dan membatalkan read lama saat user/tenant/tahun berubah, menolak respons stale, serta memblokir pergantian scope selama pending write.

Input, analytics, workflow, evidence dan export memakai backend nyata. CRUD indikator/section tersedia bagi `ADMIN_PUSKESMAS` dan `DINKES_ADMIN` pada **master global bersama seluruh tenant**. DELETE mengarsipkan (`isActive:false`), PATCH `isActive:true` memulihkan; tidak ada hard delete katalog. GET default aktif, `includeArchived=true` opsional hanya untuk pengelola. Natural ID indikator/kode section harus di-encode sebagai segmen URL, bukan divalidasi sebagai UUID. Rollover dan sync yang belum didukung tidak disimulasikan lokal. Backend tetap menegakkan role, tenant, assignment dan periode terkunci terlepas dari kontrol UI.

Mutasi katalog diaudit dan tidak mengubah snapshot historis terlindungi. Laporan draft/live dapat berubah. Setelah indikator memiliki record, perubahan `klasterId`, `sectionCode`, `targetNumeric`, `totalSasaranDefault`, `targetSasaranDefault` atau `polarity` ditolak409; buat ID/versi indikator baru. Section hanya dapat diarsipkan setelah indikator dan descendant section aktif diarsipkan; restore memerlukan parent aktif. Identitas/hierarki section tidak dapat diubah lewat PATCH.

Dinkes membuat dan mengarsipkan Puskesmas; admin mengedit profil Puskesmas sendiri. Kedua administrator dapat membuat tahun/mengedit cutoff (gunakan1..28); lock/unlock dan DELETE tahun hanya Dinkes, dengan DELETE ditolak409 bila ada referensi. DELETE pengguna adalah deaktivasi `INACTIVE` dan mencabut session, bukan penghapusan histori.

`POST /users/:id/reset-password` menerima `{healthCenterId?,newPassword,reason}`. Admin hanya reset PIC tenant sendiri; Dinkes admin/PIC tenant eksplisit. Peer admin dan diri sendiri tidak boleh direset; password sendiri melalui `/auth/change-password`. Password baru12..256 karakter, alasan nonblank1..1000 wajib; Argon2id, kenaikan tokenVersion dan pencabutan semua session target dilakukan atomically. Audit mencatat target/role/alasan tanpa password/hash/token. Self-service recovery/forgot-password tidak tersedia dan tidak direncanakan, sesuai kebutuhan pengguna eksplisit.

## App Dalam Container

Migrasikan DB dan lakukan seed yang memang disetujui **dari host terlebih dahulu**. Runtime image non-root `node`, dependency dev dipangkas; jangan mengandalkan image runtime untuk menjalankan Prisma CLI/tsx atau seed.

```bash
docker compose --env-file backend/.env -f backend/compose.yml --profile app up -d --build
```

Compose override alamat internal aplikasi menjadi `postgres:5432`, `redis:6379`, `http://minio:9000`; pertahankan alamat loopback published port pada env host untuk CLI migrasi. `MINIO_PUBLIC_ENDPOINT` **tidak** dioverride: tetap harus alamat yang dapat dijangkau browser, bukan `http://minio:9000` untuk browser host.

URL PostgreSQL internal Compose menginterpolasi username/password **tanpa URL encoding**. Jika kredensial mengandung karakter reserved URL, override `app.environment.DATABASE_URL` dengan URL internal yang sudah di-encode melalui konfigurasi lokal operator; jangan mengubahnya menjadi password lemah untuk menghindari encoding.

`NODE_ENV=production` pada service app tidak menjadikan Compose deployment produksi. Compose hanya menunggu service_started untuk MinIO; periksa readiness/bucket setelah startup. Migrations/seed tidak dijalankan oleh entrypoint.

## Kontrak Penting

- Tenant scope eksplisit ada di aplikasi, **tidak ada RLS**. Dinkes wajib `healthCenterId` pada data tenant, termasuk daftar user dan job. Pengecualian omit tenant hanya daftar health center/audit; dashboard compare adalah operasi lintas tenant eksplisit khusus Dinkes.
- Session dan refresh hash disimpan PostgreSQL; refresh rotation, logout dan ganti password mencabut akses sesuai session/tokenVersion. Redis bukan session store.
- Bulk maksimum2000 item; pagination maksimum500 (default daftar user/audit50). Katalog tanpa page/limit mengembalikan semua hasil sesuai filter; kelengkapan submit mengikuti indikator aktif secara dinamis.
- Mutasi periode mengambil row lock tahun. Quarter YTD melindungi Januari..3*q; quarter submitted yang lebih akhir juga mengunci bulan awal.
- Reopen VERIFIED menghasilkan REVISION_REQUIRED, bukan DRAFT; verify/revise/reopen wajib expectedRevision. Tanpa cascade, dependency overlap ditolak409. Dinkes dapat mengirim `cascadeDependencies:true` pada revise/reopen untuk melepas seluruh dependency transitif atomically ke REVISION_REQUIRED dengan revision naik dan audit snapshot penuh; output `invalidatedPeriods` menyebut ID/status/revision. Annual target tetap locked dan resubmit/reverify tidak otomatis.
- SQL trigger melindungi monthly record dari mutasi tahun/periode terkunci, annual target dari perubahan locked/protected, serta PIC assignment tenant sama. Target lock berulang hanya memproses row unlocked; `locked=0` bila sudah semuanya locked.
- Default targetPct dihitung dari target fisik default/populasi default*100, round4 (nol jika populasi nol), bukan threshold polarity; `rawTargetNumeric` mempertahankan nilai katalog. Analytics prorata round4 sebelum scoring agar cocok record bulanan; tanpa exact monthly protected snapshot, analytics memakai snapshot quarter terlindungi terkecil yang mencakup bulan, bukan master live.
- Target tidak dapat diedit lagi jika indikator itu sudah punya record tahun tersebut. Target nol menghasilkan score null dan tidak dapat memenuhi submit seluruh indikator; belum ada kebijakan not-applicable.
- Signed PUT300 detik mengikat ContentLength/MIME. Finalize dirancang menyalin staging ke key evidence baru dan memeriksa ukuran, metadata, ETag, magic; bukan malware scanning atau WORM.
- Konflik finalization key/trigger telah diperbaiki dan dicakup e2e nyata: perubahan key/etag hanya diizinkan PENDING->READY; READY->ATTACHED diizinkan, key final tidak boleh diubah setelah finalize. Ini bukan malware scanner atau Object Lock.
- Ekspor XLSX/PDF memakai antrean BullMQ dengan3 attempts dan data saat generate. COMPLETED hanya setelah object tersimpan; polling tenant-scoped memberikan signed download. Bridge sengaja unavailable503 menunggu kontrak resmi eksternal, tanpa URL/secret rekaan.

## Verifikasi

Hasil terbaru yang dilaporkan: **16 test default backend dan build frontend lulus**, termasuk test arsip section baru. **8 subtest API CRUD/reset dengan DB nyata lulus** pada run terpisah setelah koreksi fixture. Dua suite backend lama lulus pada run saat fixture suite baru masih gagal; belum ada klaim seluruh run gabungan backend terbaru lulus. Run final `node tests/master-browser.e2e.mjs` dari root kini lulus seluruh flow dengan console bersih. Hasil integrasi sebelumnya mencatat ketiga suite browser gabungan, migrasi/seed idempotent dan image non-root lulus. Ini hasil lokal yang dilaporkan, bukan sertifikasi produksi atau test yang dijalankan ulang pada pembaruan dokumentasi ini.

```bash
node --test backend/scripts/catalogue.test.mjs
npm --prefix backend run test
npm --prefix backend run build
```

Untuk validasi skema, jalankan `npm exec -- prisma validate` **dengan working directory `backend/`**, agar Prisma menemukan `.env` backend seperti script lainnya.

Unit tests mencakup `test/scoring.test.ts`, `test/storage.test.ts` serta test master/operations di `src/`. E2e nyata ada di `test/backend.e2e.ts`, `test/workflow.e2e.ts` dan `test/master-management.e2e.ts`, mencakup tenant/auth, CRUD/reset, workflow/cascade/history, SQL protection, storage signed PUT/finalize, analytics frozen inputs, dan export jobs. Gunakan PostgreSQL/Redis/MinIO **khusus disposable**, migrasi dan katalog seed yang sesuai; **jangan DB produksi**.

`npm --prefix backend run test` hanya memakai glob `test/*.test.ts`:8 focused master tests dan5 operations tests di `src/` **tidak termasuk**. Jalankan secara eksplisit dengan working directory **backend/**:

```bash
npx tsx --test src/master/masters.test.ts src/operations/operations.service.test.ts
```

Script e2e didefinisikan sebagai:

```bash
TEST_E2E=true npm --prefix backend run test:e2e
```

Script mengompilasi `tsc -p tsconfig.test.json` lalu menjalankan `node --test --test-concurrency=1 dist-test/test/*.e2e.js`; bukan tsx, karena Nest DI memerlukan decorator metadata hasil tsc. Tanpa `TEST_E2E=true` tes di-skip. Konfigurasi memakai env backend biasa (`DATABASE_URL`, Redis, MinIO), **bukan otomatis `TEST_DATABASE_URL`**. Fixtures tenant unik tetapi data/audit dipertahankan; tidak ada truncate/reset audit. Tahun global tersedia terbatas: workflow2060..2079, komprehensif2080..2099; rerun dapat menghabiskan slot sehingga perlu lingkungan disposable baru, bukan menghapus audit untuk reuse tahun.

Browser integration dari root, setelah dependency root/backend, migrasi/katalog seed, Vite development dan backend/dependency nyata sudah berjalan:

```bash
npm run build
npx playwright install chromium
npm run test:e2e
node tests/master-browser.e2e.mjs
```

Runner [run-browser-e2e.mjs](../tests/run-browser-e2e.mjs) membuat password acak jika `FE_E2E_PASSWORD` tidak disediakan, seed fixtures, lalu menjalankan tiga suite tanpa mencetak kredensial. URL default `FE_E2E_URL=http://localhost:5175`, `FE_E2E_API_URL=http://localhost:4000/api/v1`. Fixtures/data/audit/object dipertahankan, bukan rollback otomatis; jangan gunakan produksi. Session suite membaca JWT secret backend test dari environment/`backend/.env` dan bergantung pada modul source Vite development.

- [frontend.e2e.mjs](../tests/frontend.e2e.mjs): login, target/input bulanan persisten, evidence signed PUT/finalize/download, session restore, izin PIC dan isolasi tenant.
- [workflow-browser.e2e.mjs](../tests/workflow-browser.e2e.mjs): submit/verify/reopen UI, lock tersimpan, worker XLSX/PDF dan navigasi/overflow mobile.
- [session-browser.e2e.mjs](../tests/session-browser.e2e.mjs): JWT expired sungguhan dengan signature valid (bukan mock HTTP), refresh/retry, pending-write scope guard, logout, password-change revocation dan stale-refresh isolation.
- [master-browser.e2e.mjs](../tests/master-browser.e2e.mjs): **terpisah, belum masuk runner gabungan**. Run final lulus CRUD global Admin/Dinkes, visibilitas lintas Puskesmas, reset PIC, revoke session lama, password lama401/login baru200, cleanup arsip, dan console bersih.

Rate limit aktual tetap login5/IP dan request lain120/actor atau IP publik per60detik; runner menunggu61detik antar suite browser. Siklus workflow sekarang memakai9 request (1 mutasi +8 read periode/target/analytics), bukan reload full scope sekitar26 request. Hindari reload penuh berulang atau test paralel yang menghabiskan budget. Coverage ini tidak membuktikan seluruh form master, bootstrap UI pertama atau seluruh viewport/security/concurrency telah diuji.

`npm audit` dilaporkan **0 vulnerabilities** setelah explicit overrides pada package.json/lock: js-yaml5 untuk Swagger, deepmerge-ts8 untuk Prisma config, uuid11 untuk ExcelJS. Ini override major transitive, bukan update rutin tanpa risiko: review API/kompatibilitas dan jalankan regression tests terkait pada setiap pembaruan. Audit0 bukan bukti semua perilaku/security sudah benar.

## Sebelum Produksi

Pisahkan role migrator dan runtime PostgreSQL least-privilege/non-owner agar trigger audit/identity tidak dapat dinonaktifkan aplikasi. Siapkan TLS/reverse proxy/trust-proxy yang teruji, vault/rotation secret, akun storage least-privilege, Redis auth/TLS, backup dan restore drill DB+object, retention/lifecycle staging/report/session/audit, malware scanner/quarantine, monitoring/alert queue dan storage, kapasitas/HA/disaster recovery.

Selesaikan validasi domain scoring/target dan kebijakan cascade, review keamanan deployment frontend/API terintegrasi, kontrak bridge eksternal yang diverifikasi, SLA dan persetujuan keamanan/privasi sebelum menyatakan siap produksi. Dokumen ini tidak menjanjikan WAF, RLS, approval digital, atau automatic cutoff/rollover.
