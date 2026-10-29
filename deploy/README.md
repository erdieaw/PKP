# Deployment Compose Di Dokploy

Gunakan `compose.dokploy.yml` dari **root repository**, terpisah dari `backend/compose.yml` untuk lokal. File ini menyiapkan FE, BE, PostgreSQL, Redis berpassword, dan MinIO; hanya FE dan API storage yang bergabung ke `dokploy-network`. Tidak ada published port host atau `container_name` tetap. Biarkan nama project Compose stabil agar volume tetap sama saat redeploy.

## Domain Dan Routing

- FE: `https://pkp.pkm-ujungpangkah.online` -> Traefik -> Nginx **8080**.
- BE: `https://pkp.pkm-ujungpangkah.online/api/v1` -> Nginx -> `app:4000`. Tidak memerlukan subdomain API atau router Traefik backend.
- Storage: default usulan `https://pkp-storage.pkm-ujungpangkah.online` -> Traefik -> MinIO **9000**. Ubah `PKP_STORAGE_DOMAIN` bila memilih subdomain lain. Console **9001 tidak dipublikasikan**.

Buat DNS A/AAAA untuk kedua domain ke server Dokploy; jangan memasang AAAA ke alamat yang tidak melayani server. Pastikan `dokploy-network` tersedia dan Traefik mempunyai entrypoint `web`, `websecure`, serta resolver `letsencrypt` sesuai contoh konfigurasi Anda. Jangan sekaligus membuat router domain otomatis Dokploy yang berbenturan dengan labels file ini.

Frontend tetap memakai `VITE_API_BASE_URL=/api/v1`, ditetapkan saat build dalam Dockerfile. Tidak memerlukan `env_file` runtime frontend, `VITE_API_URL`, atau API secret. **Semua `VITE_*` bersifat publik**; jangan memasukkan `VITE_API_SECRET_KEY`, JWT secret, atau kredensial storage ke frontend.

## Environment Dokploy

Isi Environment dari `deploy/dokploy.env.example`, lalu lengkapi semua nilai wajib yang kosong. Untuk CLI di server, gunakan file privat `deploy/dokploy.env` (diabaikan Git, batasi permission `0600`) dan `--env-file deploy/dokploy.env`. File contoh sengaja bukan konfigurasi siap deploy: Compose akan menolak secret wajib yang kosong.

**`COMPOSE_PROJECT_NAME` wajib sama persis dengan project Compose yang digunakan aplikasi Dokploy**, bukan sekadar nama folder repository. Dapatkan nama project dari konfigurasi/log deployment Dokploy, lalu gunakan nilai yang sama di Environment Dokploy dan file env CLI. Semua perintah berikut mewarisi nama tersebut melalui `name:` Compose. Jika Dokploy menyuplai `-p`, nilainya harus sama. Salah project berarti membuat network/volume baru yang berbeda dari database yang diprovisioning.

- `DATABASE_URL`: URL **internal**, contoh format `postgresql://sipkp:<password-URL-encoded>@postgres:5432/sipkp?schema=public`. User/database/password harus cocok dengan `POSTGRES_*`.
- `REDIS_URL`: `redis://:<password-URL-encoded>@redis:6379`, cocok dengan `REDIS_PASSWORD`.
- `JWT_SECRET`: secret acak minimal 32 karakter. Contoh generator: `openssl rand -hex 32`; buat secret PostgreSQL/Redis/MinIO secara independen.
- `PROVINCE_CREDENTIAL_KEY`: canonical base64 dari tepat 32 byte acak, misalnya `openssl rand -base64 32`. Pertahankan key jika memindahkan data terenkripsi existing, simpan backup terpisah. Jangan rotasi tanpa prosedur migrasi kredensial.
- `MINIO_ACCESS_KEY` minimal 3 karakter dan `MINIO_SECRET_KEY` minimal 8 karakter; gunakan secret panjang acak. Template ini, seperti stack lokal, masih memakai akun root MinIO untuk app. Untuk hardening produksi, pisahkan akun runtime berpolicy least-privilege.
- `FRONTEND_URL`, `MINIO_ENDPOINT`, dan `MINIO_PUBLIC_ENDPOINT` diturunkan otomatis oleh Compose dari domain dan nama service, bukan dari URL lokal di `backend/.env`.

Jangan salin `backend/.env` lokal mentah ke server: hostname/port internal berbeda. Jangan tampilkan output `docker compose config` penuh di log publik karena memuat secret; pakai `config --quiet`.

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
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml up -d minio
```

Tunggu MinIO siap menerima request S3. Jalankan **sekali per operator**, bukan paralel:

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml run --rm --no-deps ops npm run db:deploy
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml run --rm --no-deps ops node scripts/init-storage.mjs
```

Perintah bucket membuat bucket yang belum ada tanpa memasang policy publik; tidak mereset data atau policy existing. MinIO CORS dibatasi ke domain FE melalui `MINIO_API_CORS_ALLOW_ORIGIN`. Domain storage harus mempertahankan host, path, query dan body signed PUT/GET, tanpa prefix/rewrite. Jangan mengganti hostname signed URL setelah diterbitkan.

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

Validasi struktur Compose dengan fixture tanpa membaca secret lokal: `node --test tests/dokploy.test.mjs` (memerlukan Docker Compose plugin, tidak menyalakan container).

Backup DB dan object sebelum migrasi. Untuk update, build image baru, jalankan `ops npm run db:deploy` secara eksplisit jika ada migrasi, lalu:

```bash
docker compose --env-file deploy/dokploy.env -f compose.dokploy.yml up -d --build --no-deps --wait app frontend
curl --fail https://pkp.pkm-ujungpangkah.online/api/v1/health/ready
```

Readiness mengecek DB, Redis dan kedua bucket; bukan validasi CORS/TLS storage, katalog, atau seluruh workflow. Uji login, refresh halaman/deep link, upload bukti, dan unduh laporan melalui browser. Periksa HTTP dialihkan ke HTTPS di kedua domain. Nginx memakai Docker DNS dan me-resolve ulang backend setelah container diganti.

Jangan gunakan `down -v`, menghapus volume, mengganti project name, atau seed ulang untuk memperbarui kode. Stack ini **tidak mengimpor otomatis database/berkas laptop**. Pemindahan existing memerlukan backup/restore DB+object serta key yang sesuai. Tetap diperlukan backup/restore drill, pemisahan akun DB migrator/runtime, policy storage, monitoring dan review keamanan sebelum menyatakan siap produksi. DNS, TLS dan deployment publik belum dijalankan oleh perubahan konfigurasi ini.
