# Spesifikasi Implementasi Backend SIPKP

Dokumen ini mendeskripsikan implementasi repository saat ini, bukan kontrak resmi pemerintah atau jaminan siap produksi. Kode, DTO, dan migrasi tertaut menjadi sumber kebenaran; skema dan kode lengkap tidak diduplikasi di sini.

> **Perlu persetujuan produk/domain:** prorata sasaran tahunan, rumus `ILP_2026_V1`, ambang khusus, bobot agregasi, penanganan target nol, dan kebijakan dependency reopen masih merupakan aturan implementasi provisional. Belum ada dasar untuk menyatakan aturan ini telah divalidasi klinis atau disahkan secara resmi.

## 1. Arsitektur Dan Sumber

- Runtime Node.js 22; NestJS 11 dengan Express; Prisma CLI/client **6.19.3**; PostgreSQL; Redis 7; BullMQ 5; MinIO kompatibel S3.
- [Compose aktual](backend/compose.yml) mematok **PostgreSQL16.10-alpine**, Redis7.4.5-alpine, dan MinIO `quay.io/minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`.
- [AppModule](backend/src/app.module.ts) menyusun Core, Auth, Operations, Masters, Analytics, Integrations. Guard global berjalan Auth -> rate limit -> role.
- [Operations](backend/src/operations/operations.service.ts) menangani master baca, Puskesmas/tahun/pengguna, reset password terkelola, target, assignment, input, workflow, rekomendasi, dan audit. [Masters](backend/src/master/masters.service.ts) menangani mutasi katalog global.
- [Analytics](backend/src/analytics/analytics.service.ts) membaca live DB/snapshot dan menghitung skor; tidak memakai cache Redis atau tabel skor agregat prahitung.
- [Integrations](backend/src/integrations/integrations.service.ts) menangani signed URL dan readiness; [ExportService](backend/src/integrations/export.service.ts) menjalankan producer dan worker dalam proses aplikasi yang sama, concurrency 2.
- Redis dipakai untuk fixed-window rate limit dan antrean ekspor, bukan penyimpanan session atau refresh-token blacklist.
- Frontend React/Vite sudah terintegrasi melalui [apiClient](src/services/apiClient.ts) dan [apiStore](src/services/apiStore.ts): auth, master, target, assignment, input bulanan, workflow, rekomendasi, audit, analytics, evidence dan export menggunakan API nyata. Boundary menormalisasi Decimal tanpa mengubah null menjadi nol; skor dihitung backend, bukan mock browser.
- Panduan eksekusi aplikasi/deployment: [README root](README.md), detail backend: [backend/README.md](backend/README.md). Rincian lokal: [database](backend/prisma/README.md), [operations](backend/src/operations/README.md), [analytics](backend/src/analytics/README.md).

### Integrasi Frontend

- Prasyarat lokal Node.js22+, npm dan Docker Compose. Root memiliki `bun.lock`, bukan `package-lock.json`: gunakan `bun install --frozen-lockfile`, atau `npm install` (membuat npm lockfile baru), bukan `npm ci` root. Backend memakai `npm --prefix backend ci`.
- Dari root: `node backend/scripts/local.mjs`, lalu script backend `prisma:generate`, `db:deploy`, `db:seed`, `build` dan `start`. Script lokal membuat env privat/secrets acak hanya bila belum ada, menyalakan dependency dan menyiapkan bucket privat, bukan membuat akun default. Admin pertama memerlukan `BOOTSTRAP_ADMIN_USERNAME` dan `BOOTSTRAP_ADMIN_PASSWORD` eksplisit minimal12karakter pada env privat sebelum seed ulang; tidak ada password bootstrap/demo default.
- `npm run dev` root menjalankan Vite pada **5175 strict port**, proxy `/api/v1` ke backend **4000**. API `/api/v1`, Swagger opsional `/api/docs`. App container alternatif: `docker compose --env-file backend/.env -f backend/compose.yml --profile app up -d --build`, setelah migrasi/seed host; jangan jalankan bersama server host pada port sama.
- [`VITE_API_BASE_URL`](.env.example) default `/api/v1`. Deployment harus reverse-proxy path ini ke backend dan melayani `dist/` dengan SPA fallback untuk frontend, bukan API; proxy dev Vite tidak terbawa build. URL absolut opsional memerlukan CORS backend `FRONTEND_URL` exact origin. Endpoint storage publik dan CORS storage tetap harus dikonfigurasi untuk signed upload/download. Contoh Nginx dan batas trust proxy ada di README root.
- Client menyimpan **refresh token saja di sessionStorage**, access token hanya di memori. Restore memakai refresh dan `/auth/me`; refresh/retry401, logout dan ganti password memakai session backend. Runtime tidak menyimpan password plaintext atau skor/data operasional di browser storage. Argumen remember bukan persistensi tambahan. Backend tetap authoritative untuk identity/role.
- Store membersihkan data scoped dan abort read lama saat user/tenant/tahun berubah, memakai generation/scope identity untuk menolak respons stale. Pending write memblokir pergantian lingkup. Error, loading, missing/null dan status snapshot diteruskan ke UI, bukan diganti data mock/sukses palsu.
- Dinkes bootstrap tanpa tenant dapat membuka master global dan membuat Puskesmas pertama, lalu memilih tenant untuk manajemen akun. Ini perilaku implementasi, bukan klaim cakupan test bootstrap UI lingkungan kosong.
- CRUD indikator/section global tersedia bagi `ADMIN_PUSKESMAS` dan `DINKES_ADMIN`, termasuk archive/restore. Dinkes membuat/mengarsipkan Puskesmas; admin mengedit profil tenant sendiri. Kedua administrator membuat tahun/mengedit cutoff; lock/delete hanya Dinkes. Hapus akun berarti deaktivasi `INACTIVE`. Rollover belum tersedia; bridge tidak diubah menjadi sukses simulasi atau status SYNCED.
- [`mockState.ts`](src/services/mockState.ts) tidak diimpor runtime aplikasi. File legacy dipertahankan sebagai sumber metadata section importer katalog offline bersama `src/data/indicators.ts`; importer menghasilkan JSON seed tanpa history/pencapaian mock. Import ulang katalog bukan startup rutin.

## 2. Database Dan Katalog

Sumber struktur: [schema.prisma](backend/prisma/schema.prisma). Sumber CHECK/trigger: [migrasi initial](backend/prisma/migrations/20261018000000_initial/migration.sql). Migrasi tambahan [`20261019000000_section_is_active`](backend/prisma/migrations/20261019000000_section_is_active/migration.sql) telah dideploy, menambahkan status aktif section. Jalankan `migrate deploy` di setiap environment, bukan `db push` yang tidak membawa proteksi SQL-only.

- Ada 14 tabel: `health_centers`, `users`, `sessions`, `year_periods`, `sections`, `indicators`, `annual_targets`, `pic_assignments`, `monthly_records`, `period_locks`, `uploads`, `recommendations`, `audit_logs`, `export_jobs`.
- Nama tabel snake_case; kolom camelCase. UUID dibuat Prisma. ID indikator dan kode section adalah string, bukan UUID.
- Baseline awal katalog seed berisi **272 indikator operasional**, **68 sections: 29 top-level + 39 nested**, dalam 5 klaster. Sepuluh artefak header Excel tidak diimpor. Jumlah runtime dan kelengkapan submit mengikuti katalog aktif secara dinamis, bukan hardcoded272.
- Tidak ada indikator head persisten. Head klaster pada Sheet 7 adalah baris presentasi sintetis; top-level section memiliki `parentCode=null`, bukan node root klaster.
- [Importer](backend/scripts/import-catalogue.mjs) menghasilkan [catalogue.json](backend/prisma/seed-data/catalogue.json), membuang pencapaian/history mock. Leluhur tanpa label memakai `Subbagian <code>`.
- Katalog API global dapat dibuat/diedit/diarsipkan/dipulihkan oleh kedua role administrator. Seed existing section/indikator menggunakan `update: {}`: perubahan manual, label dan arsip tidak direset; hanya identity yang belum ada ditambahkan. Perubahan definisi lewat API tetap memerlukan review domain dan aturan versi di bawah.
- Unique identity: target/assignment per tenant-indikator-tahun; record per tenant-indikator-tahun-bulan; lock per tenant-tahun-nomor-jenis; rekomendasi per tenant-tahun-quarter-section.
- CHECK SQL mencakup tenant sesuai role, angka nonnegatif, bulan 1..12, quarter 1..4, tahun 2000..9999, cutoff 1..28, score 0..100; persentase capaian boleh >100. Ekspor menyimpan quarter 0 untuk ANNUAL.
- Foreign key umumnya RESTRICT; session CASCADE saat pengguna dihapus. `updatedBy`/`reviewedBy` adalah string, bukan FK pengguna.
- Trigger mencegah perubahan identity target, record, assignment, lock, rekomendasi, upload; reassignment PIC tetap diizinkan. Audit menolak UPDATE, DELETE, **TRUNCATE**.
- **Tidak ada RLS** atau Prisma middleware tenant otomatis; isolasi tenant tetap melalui scope service eksplisit. Trigger `monthly_records_guard` menolak INSERT/UPDATE/DELETE pada tahun terkunci atau bulan terlindungi SUBMITTED/VERIFIED, dengan row lock tahun lalu periode.
- Trigger `annual_targets_guard` melindungi target locked dan tahun/periode terlindungi; perubahan lock-only false->true diizinkan khusus tanpa perubahan isi. Service hanya mengunci target `isLocked=false`, sehingga lock berulang dan submit periode berikutnya tidak mencoba mengubah target yang sudah locked.
- Trigger assignment memvalidasi PIC aktif tenant sama. Trigger upload membolehkan perubahan key/etag hanya pada PENDING->READY dan status berikutnya READY->ATTACHED; identitas file tetap immutable. Tidak ada trigger yang membuat seluruh snapshot/semua tabel otomatis WORM.
- Snapshot terlindungi lewat API dan pembacaan historis, bukan jaminan anti-perubahan oleh pemilik DB. Role runtime wajib non-owner/least-privilege, tanpa hak menonaktifkan trigger atau mengubah skema.

## 3. Konvensi HTTP, Validasi, Dan Error

Semua route endpoint di bawah ditulis **relatif terhadap base `/api/v1`**: misalnya `/auth/login` berarti `http://localhost:4000/api/v1/auth/login`. Prefix global juga berlaku untuk health. Swagger tetap `/api/docs` ketika `ENABLE_SWAGGER=true`, bukan `/api/v1/api/docs`; anotasi bukan pengganti DTO dan service aktual.

Semua route kecuali login, refresh, `/health`, `/health/ready` memerlukan `Authorization: Bearer <accessToken>`. GET/PATCH/PUT normal 200; POST normal 201 kecuali override yang disebutkan.

```json
{"success":true,"statusCode":200,"data":{},"meta":{"timestamp":"ISO-8601"}}
```

```json
{"success":false,"statusCode":409,"message":"...","error":"ConflictException","meta":{"timestamp":"ISO-8601"}}
```

`data` di bagian endpoint adalah payload **di dalam envelope**. `message` error bisa string atau array validasi; nama `error` mengikuti exception/mapping, tidak selalu label HTTP standar. Decimal Prisma pada resource mentah dapat berupa string JSON; metrik analytics yang diformat berupa number/null.

- ValidationPipe melakukan transform eksplisit, whitelist, menolak field asing dan unknown object. Tidak ada konversi implicit umum untuk boolean/angka body.
- Operations: field opsional menolak null kecuali `evidenceId`; bulk1..2000, ID unik; pagination maksimum500; angka finite nonnegatif maksimum4 desimal. DTO Masters mengizinkan null pada formulaRaw/notes dan parentCode sesuai kontraknya. DTO auth/analytics/integrations memakai beberapa `IsOptional`, jadi jangan mengasumsikan aturan null identik lintas modul.
- `healthCenterId`, user/resource ID memakai UUID; `indicatorId`/`sectionCode` string 1..100. Tahun operations DTO 1..9999, tetapi CHECK SQL mulai 2000; analytics/storage/export 2000..2100. Jangan bergantung pada range DTO yang lebih longgar daripada DB.
- 400: DTO/field asing, tenant eksplisit hilang, referensi/indikator invalid, target turunan tidak konsisten, file invalid, versi scoring tidak didukung.
- 401: kredensial/token/session invalid, expired/revoked, pengguna/tenant tidak aktif. 403: role/tenant/assignment tidak berhak.
- 404: resource scoped tidak ditemukan atau tahun belum dibuat. 409: duplicate, tahun/periode/target terkunci, target sudah memiliki record, revision stale, dependency overlap, snapshot invalid, upload expired/belum ready.
- 413: parser request >1 MiB; 429: rate limit; 503: DB/Redis/storage/queue unavailable atau bridge belum tersedia; error tak terpetakan 500 dengan pesan generik.
- Filter memetakan Prisma P2002 ->409, P2003 ->400, P2025 ->404, P2034 ->409. Error CHECK/trigger lain tidak memiliki kontrak domain spesifik dan bisa dipetakan generik.
- Konflik workflow memakai filter khusus yang meneruskan daftar `dependencies` terstruktur pada respons409.

## 4. Tenant Dan Otorisasi

Alias dokumentasi: **D**=`DINKES_ADMIN`, **A**=`ADMIN_PUSKESMAS`, **P**=`PIC`; **T**=`healthCenterId?`; **Y**=`year`; tanda `?` berarti opsional pada DTO, bukan otomatis opsional menurut otorisasi.

- [tenantFor](backend/src/core/tenant.ts) fail-closed: D wajib UUID tenant eksplisit; A/P boleh menghilangkan T untuk tenant sendiri, tetapi tidak boleh memilih tenant lain atau beroperasi tanpa tenant valid.
- D tanpa T hanya mendapat cakupan semua tenant pada **GET health-centers** dan **GET audit-logs**. Daftar pengguna, bulk writes, export polling, bridge, dan analytics biasa tetap wajib T eksplisit; tidak ada pengecualian daftar semua pengguna.
- Pengecualian lintas tenant lain adalah dashboard `compare=true`, hanya D: tetap memilih tenant utama eksplisit, lalu service sengaja mengiterasi semua health center aktif.
- Pemeriksaan role ada di guard dan banyak service. Query tenant-owned menggunakan scope eksplisit; worker ekspor memuat ulang identity dan otorisasi dari DB.
- P dapat membaca katalog/target/record tenant, tetapi hanya menulis indikator yang di-assign di tahun tersebut. Assignment diperiksa di transaksi input.
- Pengguna dikembalikan melalui safe select, tanpa password hash, tokenVersion, refreshHash atau session detail. A hanya mengubah PIC; D dapat mengubah admin/PIC, bukan D lewat endpoint ini.

## 5. Endpoint Auth Dan Health

Sumber: [auth DTO](backend/src/auth/auth.dto.ts), [controller](backend/src/auth/auth.controller.ts), [service](backend/src/auth/auth.service.ts).

- `POST /auth/login` publik, 200: `{username,password,role?}`; role opsional harus cocok. Output `{accessToken,refreshToken,tokenType:"Bearer",expiresIn,user}`.
- `POST /auth/refresh` publik, 200: `{refreshToken}` dengan bentuk UUID session + `.` + secret base64url 43 karakter; output token pair dan safe user yang sama.
- `GET /auth/me`: safe user `{id,username,email,name,nip,role,status,healthCenterId,phone}`.
- `POST /auth/logout` 200: tanpa DTO body; `{loggedOut:true}`, revoke session aktif tersebut.
- `POST /auth/change-password` 200: `{currentPassword,newPassword}`; baru 12..128 karakter; `{passwordChanged:true,requiresLogin:true}`.
- `GET /health` publik: `{status:"ok"}`, liveness saja, tidak memeriksa dependency.
- `GET /health/ready` publik: ping DB, Redis, HEAD kedua bucket; `{status:"ready"}` atau 503. Detail `not_ready` tidak dipertahankan sebagai data oleh filter error.

Password Argon2id. Access JWT HS256 berisi sub/sid/tokenVersion, issuer `sipkp`, audience `sipkp-api`; default 900 detik, konfigurabel. Refresh opaque disimpan **hash SHA-256 dalam PostgreSQL Session**, default expiry tetap 7 hari sejak login.

Refresh diserialisasi row lock session dan mengganti hash; token lama ditolak, tidak mencabut keluarga session pemenang pada refresh paralel. Refresh tidak memperpanjang expiry session. Setiap autentikasi memeriksa session DB, status user/tenant, tokenVersion. Ganti password revoke semua session dan increment versi; PATCH status pengguna juga revoke semua session, termasuk jika field status dikirim ulang.

Login/refresh/me menggunakan `Cache-Control: no-store`. Tidak ada cookie auth otomatis, register publik atau MFA. Reset password terkelola tersedia pada endpoint pengguna di bawah; self-service recovery/forgot-password tidak tersedia dan tidak direncanakan, sesuai kebutuhan pengguna eksplisit.

Rate limit Redis memakai Lua INCR dan EXPIRE **60 detik sejak request pertama**, bukan sliding window: login 5 per IP, route lain 120 per actor ID atau IP jika publik. `/health` saja dibebaskan; readiness/refresh tetap dibatasi. Redis gagal ->503, tidak fail-open. Trust proxy tidak dikonfigurasi, sehingga IP di balik proxy perlu ditinjau sebelum produksi.

## 6. Endpoint Operasional

Sumber field/validasi: [operations.dto.ts](backend/src/operations/operations.dto.ts); route/role: [controller](backend/src/operations/operations.controller.ts).

### Master Dan Pengguna

- `GET /master/indicators` D/A/P: query `{klasterId?,section?,subKlasterCode?,search?,page?,limit?,includeArchived?}`; klaster0 berarti semua, section exact atau descendant bertanda titik; pencarian id/kegiatan/indikator case-insensitive. Output `{items,total,page,limit}`, item Indicator + `section`; tanpa page/limit seluruh hasil, dengan pagination maksimum500. Default hanya indikator aktif dalam section aktif; `includeArchived=true` opsional hanya D/A.
- `GET /master/sections`: array Section `{code,name,klasterId,parentCode,order,isActive}`; default aktif, query `includeArchived=true` hanya D/A. `GET /master/years`: array YearPeriod, urut tahun menurun.
- `POST /master/indicators` D/A: `{id,klasterId,sectionCode,no,kegiatan,indikator,satuan,targetDisplay,targetNumeric,totalSasaranDefault,targetSasaranDefault,polarity,formulaRaw?,notes?,isActive?}`. Section harus aktif/klaster sama; scoringVersion ditetapkan server. `PATCH /master/indicators/:id` D/A menerima field editable tersebut selain id, plus `expectedUpdatedAt?` (stale409). `DELETE /master/indicators/:id` D/A soft archive; PATCH `{isActive:true}` restore, bukan hard delete.
- `POST /master/sections` D/A: `{code,name,klasterId,parentCode?,order?,isActive?}`; kode harus cocok klaster dan immediate parent aktif. `PATCH /master/sections/:code` D/A hanya `{name?,order?,isActive?}`; identity/hierarki immutable. DELETE soft archive ditolak409 jika masih ada descendant section/indikator aktif; restore memerlukan parent aktif.
- Mutasi indikator/section di atas adalah **global lintas seluruh tenant**, bukan salinan milik admin Puskesmas. Natural ID seperti `K1-R1` dan kode `1.1` harus di-encode sebagai segmen URL (`encodeURIComponent`), bukan UUID. Key arsip tetap reserved, duplicate409; restore dengan PATCH.
- Setelah indikator memiliki monthly record di tenant/tahun mana pun, perubahan `klasterId`, `sectionCode`, `targetNumeric`, `totalSasaranDefault`, `targetSasaranDefault` atau `polarity` ditolak409; buat ID/versi indikator baru. `scoringVersion` tidak dapat diedit; `formulaRaw` metadata inert. Mutasi diaudit; draft/live dapat berubah, tetapi snapshot terlindungi tidak ditulis ulang.
- `POST /master/years` D/A: `{year,cutoffDay?}` (default10), output YearPeriod. DTO cutoff sampai31, SQL sampai28; gunakan1..28. `cutoffDay` belum menjadi deadline otomatis.
- `PATCH /master/years/:year` D/A: `{cutoffDay?,isLocked?}`, minimal satu field; `isLocked` hanya D. Output YearPeriod, row lock tahun global lintas tenant. `DELETE /master/years/:year` hanya D, output `{year}`;409 bila direferensikan target, assignment, record, periode, rekomendasi, upload atau export job.
- `GET /health-centers` D/A/P: query T; array HealthCenter. D boleh omit T untuk semua. `POST /health-centers` D: `{code,name,district,address?,headName?,headNip?,phone?,email?}`, output resource.
- Code health center `[A-Za-z0-9_-]` 1..50; name/district 1..200; address<=1000; headName<=200; headNip/phone<=50; email valid<=254.
- `PATCH /health-centers/:id` D/A: profil `{name?,district?,address?,headName?,headNip?,phone?,email?,isActive?}`; A hanya tenant sendiri, `isActive:false` hanya D. `DELETE /health-centers/:id` D soft-deactivate dan mencabut seluruh session tenant, bukan menghapus histori.
- `GET /users/admin-puskesmas` D; `GET /users/pics` D/A: query `{T,page?,limit?}`; output `{items,total,page,limit}` safe users. Default page1/limit50, maksimum500; **D wajib T**.
- `POST /users/admin-puskesmas` D; `POST /users/pics` D/A: `{T,username,password,name,nip?,phone?,email?}`; output safe user + createdAt/updatedAt. Tenant harus aktif; username regex `[A-Za-z0-9._-]` 3..100, password12..256, name1..200, nip/phone<=50, email<=254.
- `PATCH /users/:id` D/A: `{T,name?,nip?,phone?,email?,status?}`; minimal satu editable field. Status `ACTIVE|INACTIVE|SUSPENDED`; SUSPENDED hanya D. Tidak menerima role/username/password atau perpindahan tenant. Output safe user + timestamps. `DELETE /users/:id` D/A query T melakukan soft-deactivate `INACTIVE` dengan batas role/tenant yang sama dan pencabutan session.
- `POST /users/:id/reset-password` D/A: `{T,newPassword,reason}`; password12..256 karakter dan alasan trimmed nonblank1..1000 wajib. A hanya PIC tenant sendiri; D admin/PIC tenant eksplisit, bukan Dinkes lain. Reset peer admin atau diri sendiri dilarang; gunakan `/auth/change-password` untuk password sendiri. Argon2id, kenaikan tokenVersion, revoke semua session target dan audit `PASSWORD_RESET` atomic; audit hanya target/role/alasan, tanpa password/hash/token. Output `{id,username,sessionsRevoked}`, bukan secret. Ini reset terkelola, bukan pemulihan mandiri.

### Target, Assignment, Dan Record

- `GET /targets/annual/:year` D/A/P query T -> `{healthCenterId,year,items}`. Item memuat `indicator`, `rawTargetNumeric`, field AnnualTarget, `source:PERSISTED|DEFAULT`, `hasExplicitTarget`; DEFAULT bukan target eksplisit yang dapat dipakai submit. Default targetPct=`round4(targetSasaranDefault/totalSasaranDefault*100)` bila total>0, selain itu0; bukan threshold polarity. Nilai katalog asli tetap tersedia sebagai rawTargetNumeric.
- `PUT /targets/annual/:year/bulk` A: `{T,targets:[{indicatorId,targetPct,totalSasaran,targetSasaran?}]}` -> `{healthCenterId,year,updated}`. targetPct/totalSasaran 0..999999999; targetSasaran opsional0..9999999999.
- `POST /targets/annual/:year/lock` A body T -> `{healthCenterId,year,locked}`; menghitung target yang baru dikunci, pemanggilan ulang menghasilkan0 bila semuanya sudah locked; bukan membuat target yang hilang. Tidak ada route unlock target.
- `GET /pic-assignments` D/A/P query `{T,year}` -> array assignment + `picUser` safe select.
- `PUT /pic-assignments/bulk` D/A: `{T,year,picUserId,indicatorIds? ,sectionCode?}`; tepat satu selector, PIC aktif tenant sama -> `{healthCenterId,year,assigned}`. Upsert assignment. `DELETE /pic-assignments/:indicatorId` D/A query `{T,year}` melepas assignment sesuai proteksi tahun/periode.
- `GET /records/monthly` D/A/P query `{T,year,month,klasterId?}` -> `{healthCenterId,year,month,denominatorMode:"ANNUAL_DIVIDED_BY_12",items}`.
- Item record memuat `indicator`, field MonthlyRecord, `source:PERSISTED|MISSING`, `isMissing`, `hasExplicitTarget`, `isAssignedToMe`; input/metrik missing bernilai null, bukan zero.
- `PUT /records/monthly` A/P: `{T,year,month,records:[{indicatorId,pencapaianRiil,notes?,evidenceId?}]}` -> `{healthCenterId,year,month,updated,syncStatus:"NOT_SYNCED"}`. Pencapaian0..999999999, notes<=4000, evidence UUID atau null.

Target turunan selalu `round4(totalSasaran * targetPct / 100)`; jika client mengirim targetSasaran harus persis cocok. Target dengan record bulanan existing untuk indikator/tahun itu **read-only**, bahkan PUT nilai sama ditolak409; rescoring otomatis tidak tersedia. Target juga ditolak jika ada target tenant-tahun terkunci atau periode submitted/verified mana pun dalam tahun itu.

Setiap record wajib memiliki target tahunan **persisted**. `saveMonthly` membagi populasi dan target fisik tahunan dengan12, round4 untuk penyimpanan, tetapi argumen `target` scorer adalah **annual.targetPct (persentase), bukan targetSasaran fisik**. Populasi, target fisik, atau targetPct nol -> kedua metrik null. Target nol boleh disimpan, tetapi membuat periode tidak lolos submit; belum ada aturan pengecualian not-applicable.

Evidence harus READY/ATTACHED, memiliki etag, dan cocok tenant-tahun-bulan. Menghilangkan evidenceId mempertahankan relasi, null melepas relasi; attach menjadi ATTACHED. Pelepasan tidak otomatis menurunkan status upload. Setiap edit reset NOT_SYNCED; bukan tanda sync remote berhasil. Bulk data dan audit atomic.

### Workflow, Rekomendasi, Audit

- `GET /workflow/periods` query `{T,year}` -> array PeriodLock, termasuk snapshot/revision bila ada; periode belum dibuat tidak otomatis muncul sebagai row DRAFT.
- `POST /workflow/submit` A; `/workflow/verify`, `/workflow/revise`, `/workflow/reopen` D: body `{T,year,periodNumber,isQuarter,expectedRevision?,revisionNote?,reason?,cascadeDependencies?}`; output PeriodLock persisted + `invalidatedPeriods:[{id,status,revision}]` (kosong bila tidak ada invalidasi).
- `periodNumber` month1..12 atau quarter1..4, `isQuarter` boolean wajib. Verify/revise/reopen **wajib expectedRevision**; hanya submit opsional; revision integer>=0, note/reason1..4000. `cascadeDependencies` boolean defaultfalse, bukan string, dipakai revise/reopen.
- `GET /recommendations` query `{T,year,quarter?}` -> array Recommendation + section.
- `POST /recommendations/feedback` D: `{T,year,quarter,sectionCode,recommendationText}` (1..10000); upsert berdasarkan tenant/tahun/quarter/section, output resource.
- `PATCH /recommendations/:id/action-plan` A: `{T,analisisPenyebab?,actionPlanText?,targetPenyelesaian?,picName?,statusFollowUp?}`; minimal satu field, teks analisis/plan<=10000, target/pic<=200; status `PENDING|IN_PROGRESS|RESOLVED`; output resource.
- `GET /audit-logs` D/A: query `{T,page?,limit?,from?,to?}`; ISO timestamps, from<=to; output `{items,total,page,limit}` urut terbaru. D boleh semua tenant; P tidak mendapat akses audit.

## 7. Penguncian, State Machine, Snapshot

[lockYear/assertWritable](backend/src/core/period.ts) mengambil `SELECT ... FOR UPDATE` pada `year_periods` sebelum pemeriksaan/mutasi. Ini serialisasi **per tahun global**, bukan SQL isolation SERIALIZABLE dan bukan hanya per tenant. Tahun terkunci menolak target, assignment, record, workflow (termasuk verify), rekomendasi, dan upload baru/finalize pending.

State machine yang tersedia:

```text
DRAFT -> SUBMITTED                 submit A
REVISION_REQUIRED -> SUBMITTED     submit A
SUBMITTED -> VERIFIED              verify D
SUBMITTED -> REVISION_REQUIRED     revise D + revisionNote
VERIFIED -> REVISION_REQUIRED      reopen D + reason
```

Tidak ada `SUBMITTED -> DRAFT` atau withdraw. Semua transisi menambah revision; expectedRevision stale ->409. Unlock tahun tidak membuka period lock atau annual target secara otomatis; cascade melepaskan proteksi periode melalui REVISION_REQUIRED, bukan membuka annual target.

- Month melindungi satu bulan. Quarter **YTD Januari..3*q**, bukan tiga bulan quarter saja: Q2 melindungi1..6, Q4 melindungi1..12.
- Karena itu submitted/verified quarter yang lebih akhir juga mengunci bulan terdahulu, termasuk sebelum quarter bulan input tersebut. Pending/revision_required sendiri tidak mengunci bulan, tetapi dependency lain tetap mengunci.
- Submit wajib semua indikator aktif punya target eksplisit dan record untuk **setiap bulan cakupan**, kedua metrik non-null. Evidence/assignment tidak menjadi syarat kelengkapan submit.
- Submit mengunci seluruh annual target tenant-tahun dan membuat JSON snapshot schemaVersion1 berisi identity/cakupan, health center metadata, **semua section hierarchy dan seluruh metadata katalog** (termasuk polarity/versi), target, record, actor, timestamp server.
- Verified child month/quarter tidak menghalangi submit YTD induk. Verify mempertahankan snapshot submitted; revise/reopen juga menyimpan snapshot lama di row. Resubmit mengganti snapshot, sementara audit menyimpan previousSnapshot penuh.
- Analytics memprioritaskan snapshot periode SUBMITTED/VERIFIED persis; pembacaan bulanan juga dapat memakai snapshot quarter pelindung sebagaimana bagian8. Snapshot invalid ->409. Perubahan metadata katalog live tidak mengubah input sejarah yang dibekukan tersebut.
- Revise/reopen menghitung **transitive closure** overlap semua periode lain SUBMITTED/VERIFIED tenant-tahun, termasuk quarter masa depan YTD. Quarter dapat menghubungkan dua monthly period yang awalnya tidak overlap langsung. Default tanpa cascade tetap409 bila ada dependency.
- D dapat mengirim `cascadeDependencies:true` secara eksplisit: semua dependency transitif menjadi REVISION_REQUIRED, revision masing-masing naik, verified actor/time dibersihkan, snapshot lama dipertahankan. Seluruh invalidasi dan transisi asal atomic di bawah lock tahun, bukan serangkaian request terpisah.
- Setiap dependency mendapat audit `PERIOD_CASCADE_INVALIDATED` berisi previousSnapshot penuh, previous status/revision, reason, dan cascadeOrigin; audit transisi asal mencatat invalidatedPeriods. ExpectedRevision memeriksa periode asal, bukan revision client untuk setiap dependency. Tahun locked tetap menolak cascade; resubmit dan verifikasi ulang dilakukan eksplisit, tidak otomatis.
- Snapshot bukan tanda tangan digital, WORM DB, atau bukti approval eksternal; akses DB administratif tetap perlu dikendalikan.

## 8. Scoring Dan Analytics

Sumber formula tunggal: [scoring.ts](backend/src/analytics/scoring.ts). `formulaRaw` katalog bukan evaluator kode Excel. Scorer hanya menerima `ILP_2026_V1`; input finite nonnegative, polarity/ID tiered tidak dikenal ->400.

Misalkan `a=pencapaianRiil`, `d=population denominator`, `t=annual targetPct`, `r=a/d`, `p=100*r`. Semua polarity memerlukan d>0 dan t>0. Analytics juga mensyaratkan target fisik prorata positif.

- HIGHER_IS_BETTER: `min(100, p/t*100)`.
- LOWER_IS_BETTER:100 bila p<=threshold, selain itu0. K2-R50 threshold15.04; K2-R52 threshold8; lainnya `indicator.targetNumeric*100`. Bukan kurva penalti gradual.
- BINARY:100 bila **a>=t**, selain itu0; membandingkan achievement dengan argumen persentase target seperti kode saat ini, bukan dengan target fisik. Ini khususnya memerlukan signoff domain.
- TIERED_BRACKETS memakai batas `[15,17.5,20,22.5]` untuk K3-R40, `[3.5,4.5,7.5,10]` K3-R41, `[20,40,60,80]` K5-R23, `[8,20,40,60]` K5-R24, `[1,10,20,30]` K5-R25, `[2.6,4,7,9]` K5-R26.
- Tiered mengevaluasi p kecuali K5-R26 memakai r. Batas pertama K3-R40/R41 strict `<`; seluruh batas lain `<=`. Skor berturut100,75,50,25 lalu0; **K3-R40 slot keempat22.5**, bukan25.
- Perbandingan Decimal sebelum pembulatan; capaian dan skor internal4 desimal, output analytics2 desimal. Skor dibatasi0..100; capaian persentase bisa>100. Tidak ada null->100.
- Kategori score>=91 `Kinerja Baik`, >=81 `Kinerja Cukup`, selain itu `Kinerja Kurang`; null tetap null.

Agregasi hirarkis: section merata-ratakan satu grup mean indikator langsung (jika ada) dan setiap child section dengan bobot setara; klaster mean top-level sections; overall mean lima slot klaster. Bukan mean datar semua indikator aktif; jumlahnya dinamis. Mean mengabaikan null, tetapi grup hilang membuat `isComplete=false`; nilai/kategori parsial hanya deskriptif.

Sheet7 q menghitung jumlah numerator Januari..3*q, denominator/target fisik tahunan dikali q/4, target persentase tetap tahunan. ANNUAL memakai **lock quarter4 persis**, bukan month4/month12. Indikator tanpa semua bulan ->score null, tanpa target/target nol ->NO_TARGET. `completionRate` menghitung record hadir, bukan jaminan semua record punya score valid.

`isOfficial=true` hanya jika exact-period snapshot VERIFIED dan aggregate lengkap. SUBMITTED snapshot tetap provisional; nilai live/DRAFT/REVISION_REQUIRED/partial tidak resmi. Kata official ini hanya label workflow internal, **tidak mengesahkan formula secara klinis/regulasi**.

- `GET /analytics/sheet7` D/A/P: query `{T,year,quarter?}`; quarter1..4 atau ANNUAL(default). Output identity/nama/kepala tenant, `rows` head+sections, `klasterScores`, `nilaiKinerjaPuskesmas`, `kategoriPKP`, `totalIndikator`, `completionRate`, `isComplete`, `isOfficial`, `status`, `periodStatus`, `source`, `scoringVersion`, `basis`, `aggregation`, `aggregateStatus`, `targetFraction`, `denominatorMode`, `indicators` dengan input/metrik/status/populatedMonths/expectedMonths.
- `GET /analytics/annual-trend`: query `{T,year,klasterId?}` (0..5, default0); output12 `monthlyOverallScores`, `monthlyComplete`, `monthlySubmittedCount`, categories/statuses, `annualAveragePKP`, category, `completedMonths`, highest/lowestMonth, `klasters`, `subKlasters`, serta metadata basis/source/completeness; `isOfficial=false`.
- `GET /analytics/indicator-trends`: query sama; output identity/metadata dan `items` berisi indicator, monthlyValues/Pct/Scores, annualAverageScore/Pct, category, isComplete, monthlyStatus, monthlyIndicators frozen per bulan. Top-level completeness masih seluruh dataset, bukan hanya klaster filter.
- `GET /dashboard/summary` dan alias `/analytics/dashboard/summary`: query Sheet7 + `compare?` string true/false(defaultfalse); output Sheet7, ditambah `comparison` semua tenant aktif jika D meminta compare.

Trend membaca12 dataset bulanan independen dengan transaksi RepeatableRead per dataset, bukan satu snapshot tahunan atomic. Exact monthly SUBMITTED/VERIFIED snapshot diprioritaskan; bila tidak ada, dipilih **quarter terlindungi terkecil yang mencakup bulan**, lalu record snapshot difilter ke bulan tersebut. Source fallback `SUBMITTED_QUARTER_SNAPSHOT`/`VERIFIED_QUARTER_SNAPSHOT`; metadata/target tetap frozen. Snapshot invalid tetap409, bukan fallback live. Status fallback mengikuti quarter tetapi tidak mengesahkan periode bulanan sebagai official; seluruh endpoint trend tetap `isOfficial=false`.

Annual trend = mean **bulan lengkap saja**, null bila tidak ada; indicator trend = mean bulan yang scored. Ini bukan Sheet7 tahunan kumulatif. Monthly submitted count menghitung indikator complete pada dataset berstatus SUBMITTED/VERIFIED, termasuk fallback quarter. Helper `prorated(value,months)` membulatkan `value*months/12` ke4 desimal **sebelum scoring**, selaras dengan denominator/target fisik bulanan pada saveMonthly. Analytics menghitung ulang dari input dan metadata frozen memakai versi scoring yang didukung; output tetap2 desimal.

> **Keputusan produk wajib:** mode compatibility `ANNUAL_DIVIDED_BY_12` membagi sasaran rata, belum memodelkan seasonality, indikator kumulatif/kejadian/biner, atau kebijakan not-applicable. Angka yang dapat dihitung bukan bukti ketepatan klinis atau persetujuan resmi.

## 9. Storage Dan Ekspor

- `POST /storage/presigned-upload` A/P: `{T,filename,mimeType,fileSizeBytes,year,month}` -> `{uploadId,objectKey,uploadUrl,expiresInSeconds:300,requiredHeaders:{"Content-Type":mimeType}}` (201).
- File1..10MiB, PDF/PNG/JPEG/XLSX sesuai extension+MIME; nama disanitasi. Signed PUT memakai **ContentLength**, ContentType, metadata upload-id; content-length/content-type ditandatangani. Client harus mengirim byte length tepat walau requiredHeaders hanya mencantumkan Content-Type.
- URL client ditandatangani terhadap `MINIO_PUBLIC_ENDPOINT`; HEAD/COPY/GET internal memakai `MINIO_ENDPOINT`. Hostname/port URL bertanda tangan tidak boleh diganti client.
- `POST /storage/uploads/:id/finalize` A/P,200 tanpa DTO body ->Upload resource; P hanya upload miliknya. PENDING memeriksa tahun/periode/expiry, HEAD staging, COPY kondisional ETag ke **key final acak baru**, validasi final copy, lalu commit READY dan best-effort hapus staging.
- Validasi final mencocokkan byte length, MIME, metadata, ETag dan magic awal PDF/PNG/JPEG/ZIP(XLSX). Ini **bukan malware scanner**, bukan parser XLSX penuh atau validasi seluruh dokumen. XLSX magic hanya membuktikan prefix ZIP.
- Final key tidak mendapat signed PUT, sehingga PUT staging yang masih berlaku tidak menimpa evidence final. READY/ATTACHED retry finalize mengembalikan row tanpa menyentuh object, termasuk setelah periode terkunci. Ini immutability aplikasi, bukan S3 Object Lock/WORM.
- Konflik trigger/key finalize telah diselesaikan: `uploads_identity` melindungi identitas file, sedangkan `uploads_finalization` khusus mengizinkan key/etag berubah PENDING->READY dan menolak perubahan berikutnya. Finalize dan proteksi SQL telah dicakup pengujian integrasi nyata, bukan hanya mock storage.
- `GET /storage/presigned-download` D/A/P query `{T,uploadId?,objectKey?}` tepat satu selector -> `{uploadId,objectKey,downloadUrl,expiresInSeconds:300}`; hanya READY/ATTACHED key final evidence tenant. P dibatasi upload miliknya; D wajib T.

- `POST /export/excel/sheet7` atau `/export/pdf/sheet7` D/A,202: `{T,year,quarter}` (quarter wajib1..4 atau ANNUAL) -> `{jobId,status:"QUEUED",healthCenterId,year,quarter,format:"xlsx"|"pdf"}`.
- `GET /export/jobs/:id` D/A query T ->ExportJob dengan quarter0 dikonversi ANNUAL, tambahan signed download300 detik hanya jika COMPLETED dan key sesuai prefix tenant/job. Job dibaca dalam tenant, bukan khusus pemilik saja.
- Worker hanya mempercayai ID job dari Redis; input/scope/owner role dan status dimuat ulang DB. Status QUEUED ->RUNNING ->COMPLETED/FAILED;3 attempts total, exponential backoff mulai1000ms. Retensi record antrean selesai1hari/gagal7hari, bukan kebijakan retensi laporan DB/object.
- Startup merekonsiliasi DB QUEUED/RUNNING dengan antrean. Enqueue gagal ->503 dan status FAILED bila masih QUEUED. Error generator/storage tidak menjadi fake success; COMPLETED hanya setelah object berhasil ditulis.
- Report memakai data **saat worker generate**, bukan saat enqueue; exact protected snapshot bila ada. PDF ringkasan sections/klaster; XLSX juga sheet indikator. Label VERIFIED/PROVISIONAL dan generatedAt ada, tanpa tanda tangan/approval rekaan.

## 10. Bridge, Operasi, Dan Batas Produksi

- `GET /bridge/status` D/A query T -> `{healthCenterId,status:"CONFIGURATION_REQUIRED",enabled:false,reason:"Official provincial contract not provided"}`.
- `POST /bridge/sync-batch` D/A body `{T,year?}` ->**503**, tidak enqueue atau menandai SYNCED. Year opsional divalidasi tetapi belum dipakai untuk sync.
- Bridge sengaja **belum tersedia**, menunggu kontrak eksternal resmi: endpoint, autentikasi, payload, kode referensi, retry/idempotency dan persetujuan berbagi data. Tidak ada URL provinsi, secret, SLA, atau sertifikasi integrasi yang direka.
- [Compose](backend/compose.yml) hanya scaffold development: binding host loopback, Redis tanpa auth/TLS, MinIO root credentials dari env, volume lokal; bukan HA/production deployment. App container [non-root `node`](backend/Dockerfile), tetapi ini tidak cukup untuk menyatakan hardening produksi.
- [local.mjs](backend/scripts/local.mjs) menyediakan provisioning lokal eksplisit: membuat env dengan random secrets dan mode0600 hanya jika belum ada, tidak mencetak secrets/tidak membuat akun, menjalankan Compose lalu `init-storage.mjs` untuk memastikan bucket privat. Env existing tidak ditimpa; aplikasi runtime sendiri tetap tidak membuat bucket saat startup.
- Sebelum produksi: role PostgreSQL runtime least-privilege terpisah dari migrator, TLS reverse proxy dan konfigurasi IP/rate-limit terpercaya, secret vault/rotation, policy bucket least-privilege, backup/restore drill DB+object, retensi audit/session/report/staging, malware scanning/quarantine, monitoring queue/DB/storage, alerting, kapasitas dan disaster recovery.
- CORS exact `FRONTEND_URL`, Helmet, parser1MiB sudah ada; WAF, TLS termination, RLS, HA, signed approvals, audit eksternal, automatic cutoff/rollover, dan external bridge belum disediakan oleh kode ini.
- Hasil terbaru yang dilaporkan:16 test default backend (termasuk test arsip section baru) dan build frontend lulus;8 subtest API baru dengan DB nyata lulus pada run terpisah setelah koreksi fixture. Dua suite backend lama lulus pada run saat fixture suite baru masih gagal; **belum ada klaim seluruh run gabungan backend terbaru lulus**. Run final master browser terpisah kini lulus seluruh flow dengan console bersih. Ketiga suite browser gabungan dan image non-root sebelumnya dilaporkan lulus. Pembaruan dokumentasi ini tidak menjalankan ulang test; hasil lokal ini bukan sertifikasi kesiapan produksi.
- `npm audit` dilaporkan0 temuan setelah explicit overrides js-yaml5, deepmerge-ts8, uuid11 pada package.json/lock. Override major transitive perlu review kompatibilitas dan regression tests, bukan dianggap aman hanya karena audit0. SLA, kontrak privasi dan validasi domain tetap perlu persetujuan tersendiri.

## 11. Pengujian Integrasi Dan Coverage

Dari root: `npm run build`, `node --test backend/scripts/catalogue.test.mjs`, `npm --prefix backend run test`, `npm --prefix backend run build`, dan `TEST_E2E=true npm --prefix backend run test:e2e`. Backend e2e menggunakan env backend biasa dan dependency nyata, bukan otomatis `TEST_DATABASE_URL`; tanpa flag e2e di-skip. Fixtures/audit tidak dibersihkan, slot tahun backend test terbatas; gunakan environment disposable, jangan produksi.

Suite baru [master-management.e2e.ts](backend/test/master-management.e2e.ts) mencakup CRUD/reset terkelola:8 subtest API dengan DB nyata dilaporkan lulus pada run terpisah setelah koreksi fixture. Dua suite lama lulus pada run yang masih gagal di fixture baru, bukan bukti run gabungan backend terbaru seluruhnya lulus.

Command test default backend hanya mencakup `test/*.test.ts` dan kini16 test dilaporkan lulus, termasuk test arsip section baru. Delapan focused master tests dan5 operations tests di `src/` tidak termasuk command default. Jalankan dengan working directory **backend/**:

```bash
npx tsx --test src/master/masters.test.ts src/operations/operations.service.test.ts
```

Browser runner: siapkan dependency root/backend, Chromium (`npx playwright install chromium`), migrasi dan seed katalog; nyalakan Vite development serta backend/PostgreSQL/Redis/MinIO nyata, lalu `npm run test:e2e` dari root. [Runner](tests/run-browser-e2e.mjs) membuat password acak jika `FE_E2E_PASSWORD` tidak disediakan, seed fixtures tanpa mencetak kredensial dan menjalankan tiga suite berurutan. URL default dapat dioverride lewat `FE_E2E_URL` (default `http://localhost:5175`) dan `FE_E2E_API_URL` (default `http://localhost:4000/api/v1`). Session suite memerlukan JWT secret backend **test** dari `backend/.env`/environment dan modul Vite development; ini bukan runner untuk bundle preview/produksi.

- [frontend.e2e.mjs](tests/frontend.e2e.mjs): login tiga role, target/input bulanan persisten, evidence upload/finalize/download, session restore, izin PIC dan isolasi tenant Dinkes.
- [workflow-browser.e2e.mjs](tests/workflow-browser.e2e.mjs): persiapan HTTP nyata, submit/verify/reopen UI, persisted locks, worker XLSX/PDF dan navigasi/overflow mobile.
- [session-browser.e2e.mjs](tests/session-browser.e2e.mjs): access JWT expired dengan signature valid dan session claims nyata, respons401/refresh/retry backend tanpa mock HTTP, pending-write scope guard, logout revocation, password-change all-session revocation dan stale-refresh isolation.
- [master-browser.e2e.mjs](tests/master-browser.e2e.mjs): jalankan **dari root** dengan `node tests/master-browser.e2e.mjs`; belum masuk runner gabungan. Run final kini lulus CRUD global Admin/Dinkes, visibilitas lintas Puskesmas, reset PIC, pencabutan session lama, password lama401/login baru200, cleanup arsip dan console bersih. Bukan lagi status pending; tidak dijalankan ulang dalam edit dokumentasi ini.

Fixtures, laporan/object dan audit browser dipertahankan; tidak ada rollback/cleanup otomatis atau izin memakai produksi. Rate limit120/menit tetap berlaku pada actor (IP untuk route publik), login5/IP/menit; runner memberi jeda61detik antar suite. Siklus workflow terarah memakai9 request (1 mutasi +8 read periode/target/analytics), bukan reload full scope sekitar26 request; hindari reload penuh berulang atau tes paralel yang menghabiskan budget. Coverage tidak menjamin semua form master, bootstrap pertama, seluruh viewport, concurrency atau keamanan produksi sudah diuji.
