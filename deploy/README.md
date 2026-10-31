# Deployment Compose Di Dokploy

Gunakan `compose.dokploy.yml` dari **root repository**, terpisah dari `backend/compose.yml` untuk development. File ini menyiapkan FE, BE, PostgreSQL dan Redis berpassword. Storage memakai **MinIO/SILO eksternal privat yang wajib dikonfigurasi**, bukan service MinIO lokal. Hanya FE bergabung ke `dokploy-network`; app dan job operator `ops` mengakses storage lewat jaringan privat. Tidak ada published port host atau `container_name` tetap. Biarkan nama project Compose stabil agar volume DB/Redis tetap sama saat redeploy. Definisi `minio_data` lama sengaja dipertahankan tanpa dipasang ke runtime baru; jangan hapus volumenya.

## Domain Dan Routing

- FE: `https://pkp.pkm-ujungpangkah.online` -> Traefik -> Nginx **8080**.
- BE: `https://pkp.pkm-ujungpangkah.online/api/v1` -> Nginx -> `app:4000`. Tidak memerlukan subdomain API atau router Traefik backend.
- Storage: browser -> API backend -> endpoint S3 privat. Tidak ada domain storage publik, router Traefik storage, presigned URL, atau akses browser langsung ke MinIO.

Buat DNS A/AAAA **hanya untuk domain FE/API** ke server Dokploy; jangan memasang AAAA ke alamat yang tidak melayani server. Pastikan `dokploy-network` tersedia dan Traefik mempunyai entrypoint `web`, `websecure`, serta resolver `letsencrypt` sesuai contoh konfigurasi Anda. Jangan sekaligus membuat router domain otomatis Dokploy yang berbenturan dengan labels file ini.

Frontend tetap memakai `VITE_API_BASE_URL=/api/v1`, ditetapkan saat build dalam Dockerfile. Tidak memerlukan `env_file` runtime frontend, `VITE_API_URL`, atau API secret. **Semua `VITE_*` bersifat publik**; jangan memasukkan `VITE_API_SECRET_KEY`, JWT secret, atau kredensial storage ke frontend.

## Environment Dokploy

Isi Environment dari `deploy/dokploy.env.example`, lalu lengkapi semua nilai wajib yang kosong. Untuk CLI di server, gunakan file privat `deploy/dokploy.env` (diabaikan Git, batasi permission `0600`) dan `--env-file deploy/dokploy.env`. File contoh sengaja bukan konfigurasi siap deploy: Compose akan menolak secret wajib yang kosong.

**`COMPOSE_PROJECT_NAME` wajib sama persis dengan project Compose yang digunakan aplikasi Dokploy**, bukan sekadar nama folder repository. Dapatkan nama project dari konfigurasi/log deployment Dokploy, lalu gunakan nilai yang sama di Environment Dokploy dan file env CLI. Semua perintah berikut mewarisi nama tersebut melalui `name:` Compose. Jika Dokploy menyuplai `-p`, nilainya harus sama. Salah project berarti membuat network/volume baru yang berbeda dari database yang diprovisioning.

- `DATABASE_URL`: URL **internal**, contoh format `postgresql://sipkp:<password-URL-encoded>@postgres:5432/sipkp?schema=public`. User/database/password harus cocok dengan `POSTGRES_*`.
- `REDIS_URL`: `redis://:<password-URL-encoded>@redis:6379`, cocok dengan `REDIS_PASSWORD`.
- `JWT_SECRET`: secret acak minimal 32 karakter. Contoh generator: `openssl rand -hex 32`; buat secret PostgreSQL/Redis/MinIO secara independen.
- `PROVINCE_CREDENTIAL_KEY`: canonical base64 dari tepat 32 byte acak, misalnya `openssl rand -base64 32`. Pertahankan key jika memindahkan data terenkripsi existing, simpan backup terpisah. Jangan rotasi tanpa prosedur migrasi kredensial.
- `MINIO_ENDPOINT`: URL S3 privat **wajib eksplisit**, termasuk scheme dan port yang diverifikasi operator. Endpoint yang dilaporkan untuk bucket yang disetujui adalah SILO `pkm-u-pangka-01.tail1897af.ts.net:9100`, bucket `pkponline`. Ini bukan hasil uji koneksi dari container; verifikasi HTTP/HTTPS dan sertifikat sebelum mengisi URL. **Jangan menggantinya dengan port 9000**: belum terbukti instance atau datanya sama. Contoh env sengaja membiarkan endpoint kosong.
- `MINIO_ACCESS_KEY` minimal 3 karakter dan `MINIO_SECRET_KEY` minimal 8 karakter: akun runtime khusus, secret panjang acak, **bukan root/admin SILO**. Batasi policy ke bucket/prefix yang diperlukan serta operasi aktual backend: pemeriksaan bucket, baca/tulis object, copy staging ke evidence (read source + write destination), dan hapus staging bila dipakai cleanup. Jangan berikan admin, perubahan bucket policy, penghapusan bucket atau pembuatan bucket pada akun runtime. Review kebutuhan `HeadBucket` (izin `s3:ListBucket` bucket-scoped pada MinIO) dan kondisi prefix agar readiness tetap berfungsi; jangan menganggap policy object-only cukup.
- `EVIDENCE_BUCKET=pkponline`, `REPORTS_BUCKET=pkponline`: kedua bucket boleh sama. Pemisahan key memakai `staging/`, `evidence/`, dan `reports/`, bukan akses publik. Runtime tidak membuat bucket. Pertahankan nama variabel dan nilai bucket pada konfigurasi existing; nilai contoh bukan instruksi mengalihkan data. Perubahan nilai bucket memerlukan migrasi object terpisah.
- Lima variabel storage backend adalah `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `EVIDENCE_BUCKET`, dan `REPORTS_BUCKET`. Nama bucket tetap sama dengan runtime dan script provisioning existing, tanpa rename atau alias baru. Jangan gunakan `MINIO_PUBLIC_ENDPOINT` atau `PKP_STORAGE_DOMAIN`. `FRONTEND_URL` saja yang diturunkan otomatis dari domain FE.
- `TURNSTILE_SITE_KEY` dan `TURNSTILE_SECRET_KEY`: buat widget **Managed** di Cloudflare Turnstile, daftarkan hostname `pkp.pkm-ujungpangkah.online` (tanpa scheme/path), lalu isi pasangan key asli. Jika domain diganti, sesuaikan hostname widget. Dokploy mewajibkan Turnstile; dummy test keys ditolak dalam production. Izinkan koneksi keluar backend ke `https://challenges.cloudflare.com`.

Jangan salin `backend/.env` lokal mentah ke server: hostname/port internal berbeda. Jangan tampilkan output `docker compose config` penuh di log publik karena memuat secret; pakai `config --quiet`.

Frontend mengambil **site key publik saja** dari `/api/v1/auth/login-config` saat membuka login, sehingga tidak memerlukan key dalam `VITE_*` atau rebuild frontend saat rotasi key. Secret hanya dikirim backend ke Siteverify Cloudflare. Backend memvalidasi hostname sesuai `FRONTEND_URL` dan action `login` sebelum memeriksa akun; token sekali pakai berlaku maksimal lima menit. Gagal/missing/expired token ditolak 422; gangguan verifier ditolak 503, tidak melewati verifikasi. Rate limit login tetap berlaku. Refresh sesi tidak meminta challenge. Jika menerapkan CSP sendiri, izinkan script dan frame `https://challenges.cloudflare.com` sesuai panduan Cloudflare; jangan self-host/cache script widget.

## Gateway Storage Dan Batas Proxy

Kontrak gateway yang harus tersedia pada image backend sebelum cutover:

- `POST /api/v1/storage/uploads`: buat upload intent dengan metadata evidence; request JSON tetap dibatasi **1m** oleh Nginx.
- `PUT /api/v1/storage/uploads/<UUID>/content`: kirim byte mentah dengan autentikasi, `Content-Type: application/octet-stream` dan `Content-Length` tepat sesuai intent, bukan multipart/base64 JSON atau body terkompresi. MIME objek ditetapkan backend dari intent. Hanya path UUID tepat ini menerima batas **10m**. Metode selain PUT ditolak pada location ini. Conditional PUT menolak penggantian staging (409); setelah respons ambigu, coba finalize atau buat intent baru, jangan menimpa objek lama.
- `POST /api/v1/storage/uploads/<UUID>/finalize`: verifikasi staging dan finalisasi evidence; jangan lampirkan evidence sebelum berhasil.
- `GET /api/v1/storage/download`: unduh evidence sebagai **respons biner** terautentikasi, bukan JSON berisi URL atau redirect storage. Parameter tenant/object mengikuti DTO backend.
- `GET /api/v1/export/jobs/<id>/content`: unduh hasil job sebagai **respons biner** terautentikasi setelah selesai. Polling status job bukan signed download.

Nginx mematikan `proxy_request_buffering` dan `proxy_buffering` pada raw PUT; respons API lain, termasuk kedua download, juga memakai `proxy_buffering off`. Timeout koneksi 10 detik, send/read 120 detik dan jeda body upload 60 detik adalah batas jeda I/O, bukan jaminan total durasi. Batas ukuran/izin/MIME backend tetap authoritative. Header proxy, sanitasi IP dan Docker resolver Dokploy tetap dipakai. Review batas body dan buffering Traefik/CDN tambahan agar tidak membatalkan streaming atau menolak upload yang valid. Tidak perlu CORS browser pada MinIO untuk alur ini.

**Gerbang rilis:** rilis image backend dan frontend bersama; endpoint presigned lama sudah dihapus. Sebelum cutover, verifikasi kedua image melayani endpoint gateway di atas tanpa akses browser langsung ke MinIO. Nama variabel bucket tetap `EVIDENCE_BUCKET`/`REPORTS_BUCKET`; tidak diperlukan migrasi nama konfigurasi atau schema DB untuk gateway ini. Download frontend memakai Blob saat diklik, sehingga file ditampung di memori browser; backend tetap streaming dengan batas total transfer 120 detik dan pembatalan pada koneksi terputus. Pembuatan laporan Excel/PDF tetap memakai buffer di worker.

## Jaringan Privat Dan Tailscale

Tailscale pada host tidak otomatis menyediakan DNS/rute/izin yang sama untuk container Docker. Sebelum deploy, operator harus menguji **dari network container app dan ops**, bukan hanya `curl` host. Dengan image ops sudah dibangun dan environment privat telah diisi, contoh probe tanpa kredensial (ganti scheme dengan yang telah diverifikasi):

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml run --rm --no-deps ops node -e 'const u = new URL(process.env.MINIO_ENDPOINT); require("node:dns").lookup(u.hostname, (e) => { if (e) { console.error(e.code); process.exit(1); } }); fetch(new URL("/minio/health/live", u), {signal: AbortSignal.timeout(10000)}).then(r => { console.log("S3 health HTTP", r.status); process.exitCode = r.ok ? 0 : 1; }).catch(e => { console.error(e.code || e.name); process.exitCode = 1; });'
```

Ulangi probe yang sama dengan `run --rm --no-deps app node -e ...` untuk jalur app (ops hanya di network `data`, app di `data` dan `proxy`). Probe ini hanya DNS/rute/TLS/HTTP health, **bukan bukti izin bucket atau instance/data yang benar**. Jangan memakai `curl -k` atau mematikan validasi TLS. Jika endpoint SILO tidak menyediakan health path tersebut, gunakan probe S3 terautentikasi yang disetujui operator tanpa mencetak key atau signed request. Setelah schema siap, readiness app menguji akses bucket dengan kredensial runtime; lanjutkan smoke test tulis/finalize/baca dan ekspor disposable sesuai izin.

- Atur MagicDNS/DNS container, forwarding/rute host ke tailnet, serta identitas sumber hasil bridge/SNAT berdasarkan hasil pengujian. Jangan menambahkan host networking, `privileged`, atau mount socket Docker ke aplikasi sebagai jalan pintas.
- Batasi ACL/grants Tailscale ke identitas/tag backend yang diperlukan dan port **9100** pada peer SILO yang tepat (serta operator terotorisasi secara terpisah). Policy default yang mengizinkan semua tetap memberi akses: **hapus/persempit aturan broad yang overlap**, bukan sekadar menambah grant sempit. Uji sumber yang diizinkan dan sumber yang harus ditolak, termasuk console/port lain.
- Bucket private hanya membatasi otorisasi S3; **tidak mengamankan socket jaringan**. Bind listener S3 ke interface privat/tailnet atau loopback dengan jalur privat yang dirancang. Jangan bind/publish ke semua interface tanpa pembatasan. Periksa port mapping Docker, host firewall dan aturan forwarding Docker (`DOCKER-USER` atau ekuivalen nftables) serta IPv4/IPv6; aturan host INPUT saja dapat dilewati port Docker yang dipublikasikan.
- Jangan sediakan public reverse proxy, Traefik router storage, Tailscale Funnel, NAT/port-forward internet, atau console MinIO/SILO publik. Console tetap terpisah dan hanya untuk operator pada jalur privat terbatas. Audit router/domain/storage container lama sebelum cutover; menghapus service dari YAML **tidak menghapus orphan container/router yang sedang berjalan**. Penonaktifan ingress lama adalah pekerjaan operator terpisah, bukan `down -v` atau penghapusan volume.

Tidak ada perubahan tailnet, firewall, DNS, bucket, kredensial, atau server yang dilakukan oleh pembaruan repository ini.

## IP Proxy Dan Rate Limit

Backend tidak mempercayai forwarding header secara default. File Dokploy menetapkan `TRUSTED_PROXY_IPS` ke **IP frontend saja**, pada bridge `proxy` khusus FE/BE. Default subnet `172.30.92.0/29`, IP frontend `172.30.92.2`, dan backend `172.30.92.3`; keduanya statis agar backend yang mulai lebih dulu tidak mengambil IP frontend. Pastikan tidak bentrok dengan jaringan host/Docker. Jika diubah, sesuaikan `PKP_PROXY_SUBNET`, `PKP_FRONTEND_PROXY_IP`, dan `PKP_BACKEND_PROXY_IP` bersama.

Isi `TRAEFIK_TRUSTED_PROXY` dengan **IP container Traefik yang sebenarnya pada `dokploy-network`**, bukan IP publik server atau `0.0.0.0/0`. Untuk melihat IP tanpa menampilkan secret, setelah menemukan nama container proxy:

```bash
docker network inspect dokploy-network --format '{{range .Containers}}{{println .Name .IPv4Address}}{{end}}'
```

Gunakan alamat IP saja (misalnya hasil inspect tanpa `/16`), atau `/32` untuk satu alamat IPv4. **Jangan menyalin prefix subnet interface `/16` sebagai trust range**: itu dapat mempercayai seluruh aplikasi lain pada jaringan Dokploy. CIDR hanya untuk jaringan proxy terisolasi yang memang seluruh anggotanya dipercaya. Setelah Traefik direcreate/IP berubah, perbarui env dan recreate frontend.

Nginx hanya menerima client IP dari proxy tepercaya tersebut, lalu **menimpa** `X-Forwarded-For` ke satu IP terverifikasi, `X-Forwarded-Host` ke host, dan proto ke `https`. Backend tidak dihubungkan ke network publik Dokploy. Traefik harus tetap menolak forwarding header dari client langsung; jangan gunakan `forwardedHeaders.insecure=true`. Jika menambahkan CDN/proxy lain, validasi rantai trusted IP lagi, jangan mempercayai header begitu saja.

Default kuota: login 5/IP/menit, publik 120/IP/menit, baca 600/user/menit, tulis 120/user/menit. Redis gagal tetap menghasilkan 503. Uji identitas IP dari dua koneksi client nyata sebelum membuka layanan; unit test lokal tidak membuktikan konfigurasi jaringan server Anda.

## Provisioning Pertama

Tidak ada seed/migrasi otomatis saat aplikasi mulai. Perintah berikut dari root repository di **server target**, dengan secret tersimpan privat; contoh memakai file env CLI. Di terminal Dokploy dengan environment sudah diekspor, flag `--env-file` dapat dihilangkan.

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml config --quiet
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml build app frontend ops
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml up -d --wait postgres redis
```

Operator storage harus memastikan bucket privat eksternal sudah ada, akun runtime least-privilege tersedia, dan probe container di atas berhasil. Tidak ada dependency Compose ke storage eksternal; readiness app akan gagal jika storage/bucket tidak dapat diakses. Jalankan migrasi **sekali per operator**, bukan paralel:

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml run --rm --no-deps ops npm run db:deploy
```

Jangan menjalankan `init-storage.mjs` produksi dengan akun runtime atau memperluas policy menjadi admin agar script berhasil. Jika provisioning bucket baru memang disetujui, lakukan terpisah dengan akun operator, gunakan nilai `EVIDENCE_BUCKET`/`REPORTS_BUCKET` yang memang disetujui, dan cek policy existing tetap privat. Script pembuat bucket bukan pemeriksa/penghapus policy publik existing.

**Hanya database baru dan dengan persetujuan provisioning**: isi `BOOTSTRAP_ADMIN_USERNAME` dan `BOOTSTRAP_ADMIN_PASSWORD` (minimal 12 karakter), lalu jalankan:

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml run --rm --no-deps ops npm run db:seed
```

Ini menulis baseline katalog/tahun dan akun awal, bukan sekadar membuat user. **Jangan jalankan untuk redeploy database existing.** Hapus env bootstrap setelah provisioning. Definisi operasional berversi/aktivasi existing bukan bagian seed startup; pertahankan database, histori, object, dan key enkripsi saat memindahkan environment. Penggunaan internal bertahap bukan pengesahan penilaian resmi.

Setelah schema dan bucket siap:

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml up -d --no-build --wait app frontend
```

Di Dokploy pilih tipe Docker Compose dengan compose path `compose.dokploy.yml`, environment yang sama, lalu Deploy. Jika Deploy pertama dijalankan sebelum provisioning, readiness app akan gagal dan frontend menunggu; selesaikan job operator di atas lalu deploy ulang. Profile `tools` memastikan service `ops` tidak ikut startup normal.

## Update Dan Verifikasi

Validasi struktur Compose, contoh env dan aturan proxy dengan fixture tanpa membaca `.env` aktual:

```bash
node --test tests/dokploy.test.mjs tests/deployment-nginx.test.mjs
```

Tes Compose memerlukan Docker Compose plugin dan tidak menyalakan service; `--env-file /dev/null` serta `--no-env-resolution` pada Compose lokal mencegah pembacaan env aktual. Dua tes Nginx runtime di-skip kecuali `NGINX_TEST_IMAGE` menunjuk image frontend **yang sudah ada lokal**. Contoh (ganti tag lokal, tidak pull/build image):

```bash
NGINX_TEST_IMAGE=pkp-frontend-test:local node --test tests/deployment-nginx.test.mjs
```

Tes runtime membuat container Nginx disposable dengan upstream fixture di container yang sama dan port host loopback acak, memeriksa sintaks, raw PUT 2/10 MiB termasuk transfer chunked, penolakan lebih dari 10 MiB, batas JSON umum 1 MiB, metode non-PUT, serta byte download evidence/export. Tidak memakai backend/DB/MinIO asli atau kredensial. Pemeriksaan directive memastikan buffering off; fixture ini **bukan** pengukuran streaming end-to-end melalui Traefik/Tailscale/SILO.

Backup DB dan object sebelum migrasi. Untuk update, build image baru, jalankan `ops npm run db:deploy` secara eksplisit jika ada migrasi, lalu:

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml up -d --build --no-deps --wait app frontend
curl --fail https://pkp.pkm-ujungpangkah.online/api/v1/health/ready
```

Readiness mengecek DB, Redis dan kedua bucket; bukan bukti policy least-privilege, isolasi jaringan, identitas instance/data, katalog, atau seluruh workflow. Uji login, refresh halaman/deep link, raw PUT evidence lebih dari 1 MiB tetapi di bawah 10 MiB, finalize, download evidence dan hasil export melalui browser dengan autentikasi. Pastikan Network browser hanya mengakses origin FE/API, tanpa presigned URL, redirect atau request MinIO. Uji penolakan body di atas 10 MiB dan JSON di atas 1 MiB, serta penolakan download lintas tenant. Periksa HTTP dialihkan ke HTTPS di domain FE/API. Nginx memakai Docker DNS dan me-resolve ulang backend setelah container diganti.

Jangan gunakan `down -v`, menghapus volume, mengganti project name, atau seed ulang untuk memperbarui kode. Stack ini **tidak mengimpor otomatis database/berkas laptop**. Pemindahan existing memerlukan backup/restore DB+object serta key yang sesuai. Tetap diperlukan backup/restore drill, pemisahan akun DB migrator/runtime, policy storage, monitoring dan review keamanan sebelum menyatakan siap produksi. DNS, TLS dan deployment publik belum dijalankan oleh perubahan konfigurasi ini.

## Migrasi Data Terpisah

Peralihan dari bucket `evidence`/`reports` pada MinIO lama ke `pkponline` pada SILO adalah **migrasi data tersendiri yang perlu persetujuan**, bukan efek mengganti endpoint/env. Inventarisasi instance, bucket, ukuran/checksum/versioning dan referensi `objectKey` di DB terlebih dahulu; pertahankan backup volume `minio_data`, DB, object, dan key enkripsi. Salin object dengan key/prefix persis, verifikasi collision jika bucket digabung, kecocokan metadata yang dipakai validasi backend, serta seluruh referensi DB sebelum cutover. Jangan mengasumsikan prefix lama boleh diganti atau object pada port 9000 juga ada di 9100. Rencanakan freeze write/rekonsiliasi dan rollback untuk mencegah data terbelah. Jangan menghapus sumber setelah hanya melihat health/readiness hijau.

Jangan mengubah `objectKey`, re-seed, menghitung ulang histori bulanan/tahunan, memigrasikan aturan PKP, atau mengganti snapshot untuk menyelesaikan perpindahan storage. Deploy kode dan migrasi DB schema bukan izin migrasi object/data historis. Catat blocker endpoint/scheme, kredensial/policy, konektivitas container, kesiapan gateway backend/frontend, dan data migration yang belum diverifikasi sebelum menyatakan siap cutover.
