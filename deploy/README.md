# Deployment Compose Di Dokploy

Gunakan `compose.dokploy.yml` dari **root repository**, terpisah dari `backend/compose.yml` untuk development. File ini menyiapkan FE, BE dan Redis berpassword, lalu memakai **container PostgreSQL Dokploy yang sudah ada** (lihat bagian *Database PostgreSQL Existing*) alih-alih membuat container database baru. Storage memakai **MinIO/SILO eksternal privat yang wajib dikonfigurasi**, bukan service MinIO lokal. FE, app, dan job `migrate`/`ops` bergabung ke `dokploy-network` (backend/job untuk menjangkau database existing, tanpa routing Traefik); tidak ada published port host atau `container_name` tetap. Biarkan nama project Compose stabil agar volume Redis tetap sama saat redeploy.

## Urutan Deploy Dari Awal

1. Tentukan apakah ini **instalasi baru** atau **pemindahan/redeploy data existing**. Untuk existing, gunakan secret, project name, volume dan nama bucket existing; jangan jalankan generator atau seed. Backup/restore dan migrasi object adalah pekerjaan terpisah di bagian akhir panduan.
2. Siapkan server Dokploy dengan Docker Compose plugin, DNS domain FE, TLS, akses keluar Cloudflare, serta rute Tailscale ke SILO. Node.js **22+** hanya diperlukan pada mesin tempat menjalankan generator; script tidak memerlukan `npm install` dan boleh dijalankan di laptop operator.
3. Di Dokploy, buat project/environment lalu service **Docker Compose** dari repository Git ini. Pilih branch/commit rilis, context root repository dan Compose path `./compose.dokploy.yml`. Simpan konfigurasi sumber **tanpa Deploy dulu**. Pastikan repository dapat diakses oleh integrasi Git Dokploy.
4. Temukan nama project Compose aktual yang akan dipakai Dokploy (`-p`/`--project-name` pada konfigurasi/perintah deployment), bukan hanya display name. Jika belum terlihat, gunakan preview/configuration deployment; jangan membuat project name kedua untuk job CLI. Nama ini menjadi argumen `--project` generator.
5. Untuk instalasi baru, jalankan generator di bagian berikut, lalu lengkapi field layanan eksternal. Isi editor **Environment** Dokploy dengan isi file privat melalui editor/clipboard lokal tepercaya, bukan lewat chat, issue, log CI atau output terminal publik. Simpan salinan privat yang sama di server untuk job CLI; jangan commit file tersebut.
6. Gunakan routing labels bawaan file ini: **jangan tambahkan domain otomatis di UI Dokploy**. Untuk kontrak network saat ini, nonaktifkan **Isolated Deployments** Dokploy; file sudah membuat bridge privat sendiri. Periksa **Preview Compose** untuk memastikan hanya frontend memiliki routing Traefik, backend/job mengakses database melalui `dokploy-network` tanpa routing publik, tidak ada port publik DB/Redis/MinIO, serta entrypoint/resolver cocok dengan Traefik server. Jangan menyalin preview yang memuat secret ke log/chat.
7. Ambil IP Traefik sesuai bagian **IP Proxy Dan Rate Limit**, isi `TRAEFIK_TRUSTED_PROXY`, lalu validasi Compose. Dari checkout rilis yang benar pada server target, build dan jalankan dependency/job operator sesuai bagian **Provisioning Pertama**. Jalankan migrasi sekali, seed hanya untuk DB baru yang disetujui, kemudian hidupkan app/frontend.
8. Tekan **Deploy** di Dokploy dengan commit, environment dan project name yang sama, lalu jalankan checklist **Update Dan Verifikasi**. Jangan membuka layanan untuk pengguna sebelum login Turnstile, readiness, upload/finalize/download dan ekspor berhasil.

Dokploy menulis Environment ke file `.env` untuk interpolasi Compose, bukan otomatis mengirim seluruh variabel ke setiap container. File ini sudah memilih variabel yang diperlukan melalui `${VAR_NAME}`; **jangan menambahkan `env_file: .env` ke frontend**. Untuk pekerjaan CLI, gunakan `--env-file deploy/dokploy.env` seperti contoh; jangan `source` file env atau menyisipkan password sebagai argumen command. Environment shell yang sudah diekspor dapat mengalahkan nilai `--env-file`; gunakan sesi operator tanpa override lama.

## Generate Secret Instalasi Baru

Script [generate-env.mjs](generate-env.mjs) membaca **hanya template repository**, bukan `.env` existing atau secret dari shell. Default output adalah `deploy/dokploy.env`, relatif terhadap lokasi script, dengan permission `0600` pada Linux. Script memakai create-exclusive: file/symlink yang sudah ada ditolak, tanpa opsi overwrite/force. Tidak ada koneksi ke DB, Docker, SILO atau Cloudflare, dan tidak ada secret yang dicetak.

Dari root repository, ganti `nama-project-compose-aktual` dengan nilai Dokploy yang sudah diverifikasi:

```bash
node deploy/generate-env.mjs --help
node deploy/generate-env.mjs --project nama-project-compose-aktual --domain pkp.pkm-ujungpangkah.online --bootstrap-user dinkes.admin
```

Perintah kedua adalah **alternatif satu kali untuk instalasi baru**, bukan langkah setiap deploy. Jangan menjalankannya jika akan memakai DB/backup existing. Hasilnya:

- `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`: masing-masing 32 byte acak independen dalam hex (64 karakter).
- `DATABASE_URL` dan `REDIS_URL`: otomatis cocok dengan password yang dibuat, hostname internal `postgres`/`redis`, serta user/database default `sipkp`. Jika mengubah user/database/password, ubah URL pasangannya juga; password pada URL harus URL-encoded.
- `PROVINCE_CREDENTIAL_KEY`: tepat 32 byte acak dalam canonical base64. Ini key enkripsi kredensial provinsi, bukan API key yang didapat dari layanan provinsi. Simpan bersama backup secara aman tetapi terpisah dari data; key hilang/salah membuat kredensial tersimpan tidak bisa didekripsi.
- Dengan `--bootstrap-user`, username itu dan password acak 64 karakter diisi untuk admin Dinkes pertama. Tanpa opsi ini, kedua field bootstrap tetap kosong. Password ada di file privat, bukan di output generator.
- `COMPOSE_PROJECT_NAME` dan `PKP_DOMAIN` diisi dari argumen. Field eksternal tetap kosong agar konfigurasi yang belum lengkap tidak terlihat siap deploy.

`deploy/dokploy.env` sudah diabaikan Git. Opsi `--output /path/privat/dokploy.env` tersedia jika parent directory sudah ada; path custom **tidak otomatis diabaikan Git**, jadi pilih lokasi privat di luar repository. Lindungi juga direktori, editor backup, clipboard dan backup file; permission Linux bukan pengganti enkripsi disk/backup. Jangan menghapus file existing untuk sekadar membuat ulang key saat redeploy. Rotasi JWT mencabut validitas token, rotasi key provinsi butuh migrasi enkripsi, dan perubahan env password PostgreSQL **tidak** mengganti password role dalam volume DB existing.

### Key Yang Harus Dibuat Pada Layanan

**Cloudflare Turnstile:** buka dashboard Cloudflare > Turnstile > Add widget, beri nama aplikasi, pilih **Managed**, dan daftarkan hostname FE tanpa `https://` atau path. Salin Site Key ke `TURNSTILE_SITE_KEY` dan Secret Key ke `TURNSTILE_SECRET_KEY` dalam file/editor privat. Script acak tidak dapat menggantikan pasangan key Cloudflare; jangan gunakan testing keys untuk produksi. Tidak perlu API token Cloudflare dalam env aplikasi ini.

**SILO/MinIO:** masuk console melalui akses operator privat dan pilih instance yang benar untuk bucket `pkponline` di API port **9100**. Buat akun runtime/access key/service account khusus PKP sesuai fitur SILO yang tersedia, pasang policy bucket/prefix terbatas sesuai bagian **Environment Dokploy**, lalu masukkan pasangan yang diterbitkan ke `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`. Jangan memakai login admin/root console. Bucket harus tetap PRIVATE; jangan menambah policy anonymous/public-read.

Jika console mendukung input access key dan secret sendiri, generator punya opsi **calon kredensial** berikut sebagai pengganti perintah generate sebelumnya:

```bash
node deploy/generate-env.mjs --project nama-project-compose-aktual --bootstrap-user dinkes.admin --minio-credentials
```

Opsi tersebut membuat `MINIO_ACCESS_KEY` 20 karakter dengan prefix `PKP` dan secret dari 30 byte acak dalam base64 (40 karakter, 240 bit) di file output yang sama. **Belum ada akun/izin yang dibuat di SILO.** Daftarkan pasangan itu lewat console/operator privat dan pasang policy dahulu; bila SILO hanya menerbitkan key sendiri, ganti kedua nilai dengan hasil SILO. Jangan menganggap random key langsung dapat login S3. Console dan key MinIO tidak dibagikan ke browser pengguna.

Lengkapi juga `MINIO_ENDPOINT` dengan scheme/hostname/port privat yang diverifikasi, misalnya `http://pkm-u-pangka-01.tail1897af.ts.net:9100` **hanya jika HTTP dan MagicDNS dari container sudah dipastikan**. Jangan menyalin alamat console atau mengganti 9100 menjadi 9000. `TRAEFIK_TRUSTED_PROXY` berasal dari inspect network server, bukan random key. Setelah seluruh field wajib terisi, jalankan `config --quiet` dan probe pada bagian selanjutnya; generator bukan validator kredensial maupun persetujuan cutover.

### Policy Runtime PKP

Template non-secret [minio-pkp-runtime-policy.json](minio-pkp-runtime-policy.json) adalah policy `pkp-runtime` untuk **bucket `pkponline` saja**. Pasang hanya policy ini pada akun aplikasi, tanpa group atau policy tambahan yang memperluas izin. Jika nama bucket berubah, review resource ARN secara eksplisit; jangan memakai wildcard semua bucket.

- `s3:ListBucket` pada bucket dipakai `HeadBucket` readiness; izin ini juga memungkinkan listing nama object dalam bucket khusus PKP, bukan membaca isi semua object.
- `s3:GetObject` dan `s3:PutObject` hanya untuk `staging/*`, `evidence/*`, `reports/*`. Copy memakai izin baca sumber/tulis tujuan, tanpa izin admin khusus.
- `s3:DeleteObject` hanya untuk `staging/*` dan `evidence/*`, sesuai cleanup upload gagal/duplikat backend. Akun runtime tidak bisa menghapus laporan atau versi historis object.
- Tidak ada izin membuat/menghapus bucket, membaca/mengubah bucket policy, mengelola IAM, atau mengakses bucket lain. Jangan mengganti dengan policy built-in `readwrite`/`consoleAdmin`.

Provisioning operator melalui SILO pada 1 November 2026 telah membuat policy dan akun khusus tersebut. Pasangan key disimpan **hanya pada file privat lokal `deploy/pkp-storage.env`**, permission `0600`, diabaikan Git dan tidak disertakan build context frontend. File ini bukan environment aktif aplikasi, tidak dibaca otomatis oleh Compose dan tidak dikirim otomatis ke Dokploy. Buka dengan editor privat untuk memasukkan lima variabel storage ke Environment Dokploy; jangan mencetak isi file ke terminal, chat, screenshot atau log. Jangan menimpa env aktif atau merotasi key lain.

Uji akun dari mesin operator berhasil untuk bucket HEAD, conditional PUT (overwrite ditolak 412), copy/baca evidence dan tulis/baca laporan. Uji akses anonim, bucket lain, prefix di luar aplikasi, pembacaan bucket policy dan penghapusan laporan ditolak 403. Seluruh object uji disposable dibersihkan. **Ini bukan uji dari server Dokploy atau bukti produksi end-to-end**; ulangi konektivitas dan smoke test dari deployment target. Versioning, enkripsi bucket, backup, ACL/firewall dan migrasi object tidak diubah oleh provisioning akun ini.

## Domain Dan Routing

- FE: `https://pkp.pkm-ujungpangkah.online` -> Traefik -> Nginx **8080**.
- BE: `https://pkp.pkm-ujungpangkah.online/api/v1` -> Nginx -> `app:4000`. Tidak memerlukan subdomain API atau router Traefik backend.
- Storage: browser -> API backend -> endpoint S3 privat. Tidak ada domain storage publik, router Traefik storage, presigned URL, atau akses browser langsung ke MinIO.

Buat DNS A/AAAA **hanya untuk domain FE/API** ke server Dokploy; jangan memasang AAAA ke alamat yang tidak melayani server. Pastikan `dokploy-network` tersedia dan Traefik mempunyai entrypoint `web`, `websecure`, serta resolver `letsencrypt` sesuai contoh konfigurasi Anda. Jangan sekaligus membuat router domain otomatis Dokploy yang berbenturan dengan labels file ini.

Frontend tetap memakai `VITE_API_BASE_URL=/api/v1`, ditetapkan saat build dalam Dockerfile. Tidak memerlukan `env_file` runtime frontend, `VITE_API_URL`, atau API secret. **Semua `VITE_*` bersifat publik**; jangan memasukkan `VITE_API_SECRET_KEY`, JWT secret, atau kredensial storage ke frontend.

## Database PostgreSQL Existing

Produksi memakai **container PostgreSQL Dokploy yang sudah ada** (`database-postgresmain-hoc5kd`, PostgreSQL 18, nama task bisa berubah saat redeploy) dan **bukan** database baru di dalam project ini:

- `compose.dokploy.yml` sengaja **tidak** mendeklarasikan service `postgres`. Menambahkannya kembali akan membuat container dan volume kedua yang kosong.
- Database `sipkp` dan role `sipkp` dibuat **sekali** di container itu oleh operator, dengan password `POSTGRES_PASSWORD` yang sama seperti di env. Contoh (tanpa mencetak password ke log):

```bash
docker exec -i database-postgresmain-hoc5kd.1.<task> psql -U postgres_erd -d main_db <<'SQL'
CREATE ROLE sipkp LOGIN PASSWORD '<POSTGRES_PASSWORD>';
CREATE DATABASE sipkp OWNER sipkp;
REVOKE CONNECT ON DATABASE sipkp FROM PUBLIC;
GRANT CONNECT ON DATABASE sipkp TO sipkp;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
```

- `DATABASE_URL` memakai hostname service Compose Swarm di `dokploy-network`: `postgresql://sipkp:<url-encoded-password>@database-postgresmain-hoc5kd:5432/sipkp?schema=public` (bukan `postgres`, bukan `127.0.0.1`, dan loopback proxy `15432` tidak dipakai container).
- Service `app` dan job `migrate`/`ops` bergabung ke `dokploy-network` **hanya** untuk menjangkau database; semuanya tetap `traefik.enable=false` dan tanpa published port. Jangan menambahkan label router untuk backend/job.
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` tidak lagi dipakai service mana pun: nilainya hanya mendokumentasikan role di database existing. Jangan dihapus — `DATABASE_URL` memakai password yang sama.
- Backup/restore mengikuti service database Dokploy yang existing (volume dan jadwalnya milik service itu). Jangan `down -v` dan jangan menghapus volume project ini untuk memindahkan data.
- Bila container database diganti nama/pindah oleh Dokploy, perbarui `DATABASE_URL` dan `MIGRATION_DATABASE_URL` bila dipakai, lalu redeploy; migrasi berjalan lewat job `migrate`, sedangkan seed tetap manual melalui `ops` hanya untuk provisioning database baru yang disetujui.

## Environment Dokploy

Isi Environment dari `deploy/dokploy.env.example`, lalu lengkapi semua nilai wajib yang kosong. Untuk CLI di server, gunakan file privat `deploy/dokploy.env` (diabaikan Git, batasi permission `0600`) dan `--env-file deploy/dokploy.env`. File contoh sengaja bukan konfigurasi siap deploy: Compose akan menolak secret wajib yang kosong.

**`COMPOSE_PROJECT_NAME` wajib sama persis dengan project Compose yang digunakan aplikasi Dokploy**, bukan sekadar nama folder repository. Dapatkan nama project dari konfigurasi/log deployment Dokploy, lalu gunakan nilai yang sama di Environment Dokploy dan file env CLI. Semua perintah berikut mewarisi nama tersebut melalui `name:` Compose. Jika Dokploy menyuplai `-p`, nilainya harus sama. Salah project berarti membuat network/volume baru yang berbeda dari database yang diprovisioning.

- `DATABASE_URL`: URL **internal**, contoh format `postgresql://sipkp:<password-URL-encoded>@postgres:5432/sipkp?schema=public`. User/database/password harus cocok dengan `POSTGRES_*`.
- `REDIS_URL`: `redis://:<password-URL-encoded>@redis:6379`, cocok dengan `REDIS_PASSWORD`.
- `JWT_SECRET`: secret acak minimal 32 karakter; generator di atas membuat 64 karakter hex. Buat secret PostgreSQL/Redis/MinIO secara independen.
- `PROVINCE_CREDENTIAL_KEY`: canonical base64 dari tepat 32 byte acak, dibuat oleh generator di atas. Pertahankan key jika memindahkan data terenkripsi existing, simpan backup terpisah. Jangan rotasi tanpa prosedur migrasi kredensial.
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

Ulangi probe yang sama dengan `run --rm --no-deps app node -e ...` untuk jalur app (ops di network `data` dan `dokploy-network`, app juga di `proxy`). Probe ini hanya DNS/rute/TLS/HTTP health, **bukan bukti izin bucket atau instance/data yang benar**. Jangan memakai `curl -k` atau mematikan validasi TLS. Jika endpoint SILO tidak menyediakan health path tersebut, gunakan probe S3 terautentikasi yang disetujui operator tanpa mencetak key atau signed request. Setelah schema siap, readiness app menguji akses bucket dengan kredensial runtime; lanjutkan smoke test tulis/finalize/baca dan ekspor disposable sesuai izin.

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

Nginx hanya menerima client IP dari proxy tepercaya tersebut, lalu **menimpa** `X-Forwarded-For` ke satu IP terverifikasi, `X-Forwarded-Host` ke host, dan proto ke `https`. Backend bergabung ke `dokploy-network` untuk database, tetapi tidak memiliki routing Traefik atau published port. Traefik harus tetap menolak forwarding header dari client langsung; jangan gunakan `forwardedHeaders.insecure=true`. Jika menambahkan CDN/proxy lain, validasi rantai trusted IP lagi, jangan mempercayai header begitu saja.

Default kuota: login 5/IP/menit, publik 120/IP/menit, baca 600/user/menit, tulis 120/user/menit. Redis gagal tetap menghasilkan 503. Uji identitas IP dari dua koneksi client nyata sebelum membuka layanan; unit test lokal tidak membuktikan konfigurasi jaringan server Anda.

## Provisioning Pertama

Seed tidak otomatis. Migrasi schema sekarang dijalankan job `migrate` pada deployment Compose, **bukan di startup/restart backend**. Perintah berikut dari root repository di **server target**, dengan secret tersimpan privat; contoh memakai file env CLI. Di terminal Dokploy dengan environment sudah diekspor, flag `--env-file` dapat dihilangkan. Pastikan backup database tersedia dan pemulihannya sudah diuji sebelum deployment; Compose ini tidak membuat backup otomatis.

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml config --quiet
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml build migrate app frontend ops
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml up -d --wait redis
```

Operator storage harus memastikan bucket privat eksternal sudah ada, akun runtime least-privilege tersedia, dan probe container di atas berhasil. Tidak ada dependency Compose ke storage eksternal; readiness app akan gagal jika storage/bucket tidak dapat diakses. **Pada provisioning pertama, wajib jalankan migrasi berikut dan pastikan exit code 0 sebelum seed atau menyalakan aplikasi.** Jika migrasi gagal, hentikan urutan provisioning dan perbaiki penyebabnya; jangan lanjut ke seed. Jangan menjalankan deployment/migrasi paralel. Deployment normal setelah provisioning menjalankan job yang sama secara otomatis melalui `up` dan aman mengulang pemeriksaan migrasi yang sudah diterapkan:

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml run --rm --no-deps migrate
```

Jangan menjalankan `init-storage.mjs` produksi dengan akun runtime atau memperluas policy menjadi admin agar script berhasil. Jika provisioning bucket baru memang disetujui, lakukan terpisah dengan akun operator, gunakan nilai `EVIDENCE_BUCKET`/`REPORTS_BUCKET` yang memang disetujui, dan cek policy existing tetap privat. Script pembuat bucket bukan pemeriksa/penghapus policy publik existing.

**Hanya database baru dan dengan persetujuan provisioning, setelah migrasi di atas berhasil**: isi `BOOTSTRAP_ADMIN_USERNAME` dan `BOOTSTRAP_ADMIN_PASSWORD` (minimal 12 karakter), lalu jalankan:

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml run --rm --no-deps ops npm run db:seed
```

Ini menulis baseline katalog/tahun dan akun awal, bukan sekadar membuat user. **Jangan jalankan untuk redeploy database existing.** Hapus env bootstrap setelah provisioning. Definisi operasional berversi/aktivasi existing bukan bagian seed startup; pertahankan database, histori, object, dan key enkripsi saat memindahkan environment. Penggunaan internal bertahap bukan pengesahan penilaian resmi.

Setelah schema dan bucket siap:

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml up -d --no-build --wait app frontend
```

Di Dokploy pilih tipe Docker Compose dengan compose path `compose.dokploy.yml`, environment yang sama, lalu Deploy. Job `migrate` selalu termasuk deployment normal. Backend menunggu `service_completed_successfully` dari migrasi dan Redis sehat; frontend menunggu backend sehat. Jika schema gagal dimigrasi, backend baru tidak mulai. Jika bucket belum siap, readiness backend gagal dan frontend menunggu. Profile `tools` memastikan service `ops` (termasuk seed) tidak ikut startup normal.

## Gerbang Migrasi Otomatis

- `migrate` memakai target Dockerfile khusus, berjalan sebagai user `node`, dengan `npm run db:deploy` yang hanya memanggil `prisma migrate deploy`. Tidak menjalankan seed, `db push`, reset, penghitungan histori atau inisialisasi storage.
- Environment job hanya `NODE_ENV` dan koneksi database; tidak menerima JWT, key integrasi, kredensial storage atau bootstrap admin. Jaringan hanya `dokploy-network` untuk mengakses PostgreSQL existing, tanpa port publik, routing Traefik, volume data atau restart otomatis.
- Opsional `MIGRATION_DATABASE_URL` menyediakan koneksi langsung dengan role migrator. Jika kosong, job memakai `DATABASE_URL` existing agar konfigurasi lama tetap dapat dipakai. Role migrator sebaiknya memiliki hak DDL yang diperlukan, sedangkan role runtime cukup hak aplikasi. **Kedua URL wajib menuju database dan schema yang sama**, dengan host yang merujuk instance yang sama. Jangan membuat role/merotasi kredensial existing tanpa persetujuan operator.
- `compose up` normal menjalankan ulang job yang sudah selesai, termasuk ketika image tidak berubah. Prisma hanya menerapkan migrasi yang masih pending. Setelah job manual berhasil, deploy berikutnya boleh mengulang pemeriksaan yang sama. Gunakan Compose yang mendukung kondisi tersebut; runtime lokal teruji pada **Compose v5.1.0**, bukan bukti versi Dokploy server sudah sama.
- Jangan memakai custom command Dokploy `--no-deps`, `--no-start`, atau `start`/`restart` untuk rilis kode baru: perintah itu dapat melewati gerbang. Gunakan deployment `up` normal tanpa pembatas service yang menghilangkan `migrate`; lihat Preview Compose Dokploy dan pastikan dependency ini tidak hilang. Restart Docker backend saja tidak memanggil job migrasi.
- Kegagalan job mengembalikan exit nonzero pada deployment. Periksa log `migrate`, koreksi penyebabnya, lalu deploy ulang. Migrasi SQL yang gagal dapat memerlukan penanganan Prisma terkontrol; jangan otomatis menjalankan `migrate resolve`, menandai sukses, seed atau reset.
- Dependency startup bukan transaksi deployment atau rollback otomatis. Backend lama yang masih berjalan dan tidak direcreate dapat tetap melayani; Compose juga dapat menghentikan/merecreate container sebelum seluruh deployment selesai. **Tidak ada jaminan zero downtime atau pemulihan otomatis versi lama.** Gunakan migrasi aditif/backward-compatible, serialkan deployment, dan rencanakan maintenance serta rollback kode terpisah dari pemulihan database.

## Update Dan Verifikasi

Validasi struktur Compose, contoh env dan aturan proxy dengan fixture tanpa membaca `.env` aktual:

```bash
node --test tests/deploy-env.test.mjs tests/dokploy.test.mjs tests/deployment-nginx.test.mjs
```

Tes Compose memerlukan Docker Compose plugin dan tidak menyalakan service; `--env-file /dev/null` serta `--no-env-resolution` pada Compose lokal mencegah pembacaan env aktual. Dua tes Nginx runtime di-skip kecuali `NGINX_TEST_IMAGE` menunjuk image frontend **yang sudah ada lokal**. Contoh (ganti tag lokal, tidak pull/build image):

```bash
NGINX_TEST_IMAGE=pkp-frontend-test:local node --test tests/deployment-nginx.test.mjs
```

Tes runtime membuat container Nginx disposable dengan upstream fixture di container yang sama dan port host loopback acak, memeriksa sintaks, raw PUT 2/10 MiB termasuk transfer chunked, penolakan lebih dari 10 MiB, batas JSON umum 1 MiB, metode non-PUT, serta byte download evidence/export. Tidak memakai backend/DB/MinIO asli atau kredensial. Pemeriksaan directive memastikan buffering off; fixture ini **bukan** pengukuran streaming end-to-end melalui Traefik/Tailscale/SILO.

Pengujian gerbang migrasi tambahan, tidak memakai database aplikasi atau file env privat:

```bash
node --test tests/dokploy-migration-runtime.test.mjs
node backend/test/disposable-dokploy-migration.mjs
```

Suite pertama menyalin hanya dependency/restart dari Compose nyata ke fixture offline, memakai image Node lokal tanpa pull/build dan container tanpa jaringan. Delapan skenario memeriksa urutan sukses, kegagalan, job tertunda, pemulihan, restart backend, pengulangan image/config sama, serta penolakan exit sukses usang untuk backend baru. Jika daemon/image lokal tidak tersedia, tes ini skip secara eksplisit. Suite kedua membangun target `migrate` sebenarnya dan menjalankan Prisma terhadap PostgreSQL disposable, memeriksa seluruh delapan migrasi termasuk JSONB `structuredInput`, dua pengulangan tanpa perubahan schema/ledger/data penanda, tidak ada user seed, dan exit gagal pada autentikasi salah. Semua resource test milik UUID dibersihkan. Ini bukan uji produksi, konektivitas server Dokploy atau bukti backup existing sudah tersedia.

Backup DB dan object sebelum migrasi. Untuk update, pastikan kode dan seluruh berkas migrasi tersedia di source yang dibuild Dokploy, lalu gunakan Deploy/Redeploy normal. Padanan CLI di root repository target:

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml up -d --build --wait app frontend
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml ps --all migrate app frontend
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml logs --tail 100 migrate
curl --fail https://pkp.pkm-ujungpangkah.online/api/v1/health/ready
```

Hasil normal job `migrate` adalah **Exited (0)**, bukan service yang harus tetap running. Pastikan exit code tersebut dan backend/frontend sehat sebelum menyatakan deployment berhasil; jangan hanya melihat build sukses. Readiness mengecek DB, Redis dan kedua bucket; bukan bukti policy least-privilege, isolasi jaringan, identitas instance/data, katalog, atau seluruh workflow. Uji login, refresh halaman/deep link, raw PUT evidence lebih dari 1 MiB tetapi di bawah 10 MiB, finalize, download evidence dan hasil export melalui browser dengan autentikasi. Pastikan Network browser hanya mengakses origin FE/API, tanpa presigned URL, redirect atau request MinIO. Uji penolakan body di atas 10 MiB dan JSON di atas 1 MiB, serta penolakan download lintas tenant. Periksa HTTP dialihkan ke HTTPS di domain FE/API. Nginx memakai Docker DNS dan me-resolve ulang backend setelah container diganti.

Jangan gunakan `down -v`, menghapus volume, mengganti project name, atau seed ulang untuk memperbarui kode. Stack ini **tidak mengimpor otomatis database/berkas laptop**. Pemindahan existing memerlukan backup/restore DB+object serta key yang sesuai. Tetap diperlukan backup/restore drill, pemisahan akun DB migrator/runtime, policy storage, monitoring dan review keamanan sebelum menyatakan siap produksi. DNS, TLS dan deployment publik belum dijalankan oleh perubahan konfigurasi ini.

## Migrasi Data Terpisah

Peralihan dari bucket `evidence`/`reports` pada MinIO lama ke `pkponline` pada SILO adalah **migrasi data tersendiri yang perlu persetujuan**, bukan efek mengganti endpoint/env. Inventarisasi instance, bucket, ukuran/checksum/versioning dan referensi `objectKey` di DB terlebih dahulu; pertahankan backup volume `minio_data`, DB, object, dan key enkripsi. Salin object dengan key/prefix persis, verifikasi collision jika bucket digabung, kecocokan metadata yang dipakai validasi backend, serta seluruh referensi DB sebelum cutover. Jangan mengasumsikan prefix lama boleh diganti atau object pada port 9000 juga ada di 9100. Rencanakan freeze write/rekonsiliasi dan rollback untuk mencegah data terbelah. Jangan menghapus sumber setelah hanya melihat health/readiness hijau.

Jangan mengubah `objectKey`, re-seed, menghitung ulang histori bulanan/tahunan, memigrasikan aturan PKP, atau mengganti snapshot untuk menyelesaikan perpindahan storage. Deploy kode dan migrasi DB schema bukan izin migrasi object/data historis. Catat blocker endpoint/scheme, kredensial/policy, konektivitas container, kesiapan gateway backend/frontend, dan data migration yang belum diverifikasi sebelum menyatakan siap cutover.

## Troubleshooting Singkat

- **Generator menolak file existing:** ini pengaman, bukan error yang perlu diatasi dengan menghapus file. Edit field eksternal yang belum diisi; untuk redeploy pakai kembali secret existing. Gunakan path baru hanya untuk instalasi baru yang benar-benar terpisah.
- **Compose meminta field wajib:** isi field kosong pada Environment dan file privat CLI yang sama. Generator sengaja tidak membuat key Turnstile, IP proxy atau endpoint. Jangan menjalankan `docker compose config` tanpa `--quiet` pada terminal/log bersama.
- **Migrasi gagal/backend baru tidak mulai:** periksa log service `migrate`, akses PostgreSQL existing, role DDL dan kesamaan target database/schema pada URL migrator/runtime. Setelah penyebab diperbaiki, Deploy ulang tanpa `--no-deps`. Jangan menghapus histori migrasi atau menandai migrasi berhasil tanpa pemeriksaan.
- **App unhealthy/frontend menunggu:** pastikan `migrate` Exited (0), lalu periksa kecocokan DB/Redis credentials, DNS/rute/TLS SILO dari container dan izin `HeadBucket`. Health HTTP MinIO 200 tidak membuktikan kredensial benar. Jangan memperbaiki dengan seed ulang, mengganti volume, membuka bucket publik atau menonaktifkan TLS validation.
- **Login challenge ditolak:** cocokkan pasangan key, hostname widget dan `PKP_DOMAIN`/`FRONTEND_URL`, waktu server serta akses keluar Cloudflare. Jangan mematikan `TURNSTILE_REQUIRED` pada produksi.
- **502/TLS/routing salah:** cocokkan port frontend 8080, network Traefik dan entrypoint/resolver; hapus konflik router domain otomatis. Jika IP Traefik berubah, perbarui trust IP dan recreate frontend. Jangan mempercayai `0.0.0.0/0`.
- **Data terlihat kosong setelah deploy:** hentikan write dan periksa project name/volume/database/endpoint/bucket, jangan seed untuk menutupi kesalahan target. Perubahan endpoint tidak memindahkan object atau histori.

Rujukan perilaku Dokploy: [Docker Compose dan Environment](https://docs.dokploy.com/docs/core/docker-compose), [Domains dan Preview Compose](https://docs.dokploy.com/docs/core/docker-compose/domains), serta [Isolated Deployments](https://docs.dokploy.com/docs/core/docker-compose/utilities). Panduan ini memilih labels/network repository yang eksplisit, bukan domain/network otomatis Dokploy; cek preview pada versi server Anda.
