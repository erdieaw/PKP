# DOKUMEN SPESIFIKASI TEKNIS BACKEND & SPESIFIKASI API RESMI
## Sistem Informasi Penilaian Kinerja Puskesmas (SIPKP PULSE) Berbasis ILP 2026
**Framework**: NestJS (v11+ / v10.4+) • **ORM**: Prisma ORM (v6+) • **Database**: PostgreSQL 16+ • **Cache & Queue**: Redis 7+ (BullMQ) • **Object Storage**: MinIO (S3-Compatible)

---

## DAFTAR ISI
1. [Arsitektur Sistem & Blueprint Keamanan](#1-arsitektur-sistem--blueprint-keamanan)
2. [Prisma Schema Lengkap (`schema.prisma`)](#2-prisma-schema-lengkap-schemaprisma)
3. [Arsitektur Keamanan & Isolasi Multi-Tenant](#3-arsitektur-keamanan--isolasi-multi-tenant)
4. [Integrasi Redis (Caching & Background Queue)](#4-integrasi-redis-caching--background-queue)
5. [Integrasi Object Storage MinIO](#5-integrasi-object-storage-minio)
6. [Spesifikasi Lengkap REST API (OpenAPI/Swagger Format)](#6-spesifikasi-lengkap-rest-api)
   * [6.1 Authentication & Profile Module](#61-authentication--profile-module)
   * [6.2 Master Data Management Module](#62-master-data-management-module)
   * [6.3 User, Admin PKM & Staff PIC Module](#63-user-admin-pkm--staff-pic-module)
   * [6.4 Target Sasaran Tahunan Module](#64-target-sasaran-tahunan-module)
   * [6.5 Input Capaian & Rekam Kinerja Bulanan Module](#65-input-capaian--rekam-kinerja-bulanan-module)
   * [6.6 Workflow Verifikasi & Penguncian Periode Module](#66-workflow-verifikasi--penguncian-periode-module)
   * [6.7 Analitik Skor, Nilai Resmi Sheet 7 & Dasbor Tahunan 12 Bulan](#67-analitik-skor-nilai-resmi-sheet-7--dasbor-tahunan-12-bulan)
   * [6.8 Supervisi Dinkes, Rekomendasi & RTL Module](#68-supervisi-dinkes-rekomendasi--rtl-module)
   * [6.9 Object Storage & Bukti Dukung (MinIO) Module](#69-object-storage--bukti-dukung-minio-module)
   * [6.10 Ekspor Laporan & Background Jobs Module](#610-ekspor-laporan--background-jobs-module)
   * [6.11 Provincial Bridge Sync Module](#611-provincial-bridge-sync-module)
   * [6.12 Audit Log & Aktivitas Module](#612-audit-log--aktivitas-module)
7. [Struktur Direktori NestJS & Konfigurasi Docker Compose](#7-struktur-direktori-nestjs--konfigurasi-docker-compose)

---

## 1. Arsitektur Sistem & Blueprint Keamanan

```mermaid
flowchart TD
    Client["Frontend SPA (React + Vite)"] -->|HTTPS / TLS 1.3| Nginx["Nginx Reverse Proxy & WAF"]
    Nginx -->|Proxy Pass| NestJS["NestJS Backend Application (Node.js/Bun)"]
    
    subgraph "NestJS Application Core"
        Guard["Auth & Multi-Tenant Guard"]
        Throttler["Redis Throttler (Rate Limit)"]
        Modules["Controllers & Services"]
        PrismaService["Prisma ORM Client"]
        QueueProducer["BullMQ Queue Producer"]
    end
    
    NestJS --> Guard
    Guard --> Throttler
    Throttler --> Modules
    Modules --> PrismaService
    Modules --> QueueProducer
    
    subgraph "Data & Infrastructure Tier"
        Postgres[("PostgreSQL 16 (Master DB)")]
        Redis[("Redis 7 (Cache, Sessions & BullMQ)")]
        MinIO[("MinIO Cluster (S3 Storage)")]
        BullWorker["BullMQ Worker (PDF/Excel Generator)"]
    end
    
    PrismaService -->|Connection Pool| Postgres
    Modules -->|Cache & Rate Limit| Redis
    QueueProducer -->|Dispatch Jobs| Redis
    Redis -->|Consume Jobs| BullWorker
    BullWorker -->|Save Generated Files| MinIO
    Modules -->|Presigned URLs| MinIO
    
    subgraph "External Integration"
        ProvincialAPI["Server Bridge SIPKP Provinsi Jatim"]
    end
    
    BullWorker -->|Batch REST Sync| ProvincialAPI
```

### Standar Kepatuhan & Jaminan Keamanan:
1. **Multi-Tenancy Isolation**: Pengguna Puskesmas (Admin PKM & PIC) secara ketat dibatasi hanya pada data `healthCenterId` masing-masing melalui Prisma Middleware & NestJS ExecutionContext Scope. Dinas Kesehatan memiliki cakupan supervisi lintas wilayah (*cross-tenant read & review*).
2. **Immutability of Historical Audits**: Periode yang berstatus `SUBMITTED` atau `VERIFIED` dikunci secara otomatis di tingkat database. Mutasi data ditolak oleh *State Machine Guard*.
3. **Protection of Credentials**: Password di-hash menggunakan **Argon2id**. Token otorisasi menggunakan *dual-token pattern*: Access Token JWT (masa aktif 15 menit) dan Refresh Token terenkripsi dengan daftar pencabutan (*revocation list*) di Redis.
4. **Presigned Object Security**: File bukti dukung PDF/Gambar tidak diunggah langsung melalui thread HTTP NestJS, melainkan menggunakan presigned URL MinIO bertanda tangan waktu singkat (300 detik) untuk menghemat memori server dan membatasi ukuran payload maksimal 10 MB per berkas.

---

## 2. Prisma Schema Lengkap (`schema.prisma`)

Berikut adalah berkas `schema.prisma` yang siap digunakan untuk produksi:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// ==================== ENUMS ====================

enum UserRole {
  DINKES_ADMIN
  ADMIN_PUSKESMAS
  PIC
}

enum UserStatus {
  ACTIVE
  INACTIVE
  SUSPENDED
}

enum TargetPolarity {
  HIGHER_IS_BETTER
  LOWER_IS_BETTER
  TIERED_BRACKETS
  BINARY
}

enum PeriodStatus {
  DRAFT
  SUBMITTED
  VERIFIED
  REVISION_REQUIRED
}

enum SyncStatus {
  NOT_SYNCED
  PENDING_SYNC
  SYNCED
  SYNC_FAILED
}

// ==================== MASTER ENTITIES ====================

model HealthCenter {
  id          String       @id @default(uuid())
  code        String       @unique // e.g. P35070101
  name        String       // e.g. Puskesmas Kebonagung
  address     String?
  district    String       // e.g. Kabupaten Malang
  headName    String?      // e.g. dr. H. Rahmat Hidayat, M.Kes
  headNip     String?      // e.g. 19750812 200212 1 003
  phone       String?
  email       String?
  isActive    Boolean      @default(true)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  users       User[]
  targets     AnnualTarget[]
  records     MonthlyRecord[]
  locks       PeriodLock[]
  assignments PicAssignment[]
  recommendations Recommendation[]
  auditLogs   AuditLog[]

  @@map("health_centers")
}

model User {
  id              String        @id @default(uuid())
  healthCenterId  String?
  healthCenter    HealthCenter? @relation(fields: [healthCenterId], references: [id], onDelete: Restrict)
  username        String        @unique
  email           String?       @unique
  name            String
  nip             String?
  passwordHash    String
  role            UserRole
  status          UserStatus    @default(ACTIVE)
  phone           String?
  avatarUrl       String?
  lastLoginAt     DateTime?
  refreshTokenHash String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  assignedPics    PicAssignment[]
  auditLogs       AuditLog[]
  submittedLocks  PeriodLock[]  @relation("SubmittedBy")
  verifiedLocks   PeriodLock[]  @relation("VerifiedBy")

  @@index([role, healthCenterId])
  @@map("users")
}

model YearPeriod {
  year        Int       @id // e.g. 2026
  description String?
  cutoffDay   Int       @default(10) // Tgl 10 per bulan
  isLocked    Boolean   @default(false)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  targets     AnnualTarget[]
  records     MonthlyRecord[]
  locks       PeriodLock[]
  assignments PicAssignment[]
  recommendations Recommendation[]

  @@map("year_periods")
}

model Klaster {
  id          Int          @id // 1, 2, 3, 4, 5
  code        String       @unique // K1, K2, K3, K4, K5
  name        String       // e.g. Klaster 1: Manajemen Puskesmas
  description String?
  order       Int          @default(0)

  subKlasters SubKlaster[]
  indicators  Indicator[]

  @@map("klasters")
}

model SubKlaster {
  id          String       @id @default(uuid())
  klasterId   Int
  klaster     Klaster      @relation(fields: [klasterId], references: [id], onDelete: Cascade)
  code        String       @unique // e.g. "1.1", "2.1", "2.2.5"
  name        String       // e.g. Manajemen Inti Puskesmas
  order       Int          @default(0)

  indicators  Indicator[]
  recommendations Recommendation[]

  @@index([klasterId])
  @@map("sub_klasters")
}

model Indicator {
  id                  String         @id // e.g. "K1-R8", "K2-R50"
  klasterId           Int
  klaster             Klaster        @relation(fields: [klasterId], references: [id], onDelete: Restrict)
  subKlasterCode      String
  subKlaster          SubKlaster     @relation(fields: [subKlasterCode], references: [code], onDelete: Restrict)
  no                  String         // e.g. "1.1.1", "1.", "15."
  kegiatan            String         // Uraian Kegiatan resmi
  indikator           String         // Nama Indikator Kinerja
  satuan              String         // dokumen, balita, %, bumil, dll
  targetDisplay       String         // "1.0", "≥ 90%", "< 15%"
  targetNumeric       Decimal        @db.Decimal(10, 4) // Nilai target baku desimal (e.g. 1.0, 0.90, 0.15)
  totalSasaranDefault Decimal        @default(0) @db.Decimal(12, 2)
  targetSasaranDefault Decimal       @default(0) @db.Decimal(12, 2)
  polarity            TargetPolarity @default(HIGHER_IS_BETTER)
  isHead              Boolean        @default(false) // Jika Head, nilai dihitung otomatis dari child
  parentIndicatorId   String?
  parentIndicator     Indicator?     @relation("ChildIndicators", fields: [parentIndicatorId], references: [id])
  childIndicators     Indicator[]    @relation("ChildIndicators")
  formulaRaw          String?        // Rumus excel provinsi asli
  notes               String?        // Petunjuk teknis kolom L
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  targets             AnnualTarget[]
  monthlyRecords      MonthlyRecord[]
  assignments         PicAssignment[]

  @@index([klasterId, subKlasterCode])
  @@map("indicators")
}

// ==================== OPERATIONAL DATA ====================

model AnnualTarget {
  id             String       @id @default(uuid())
  healthCenterId String
  healthCenter   HealthCenter @relation(fields: [healthCenterId], references: [id], onDelete: Cascade)
  indicatorId    String
  indicator      Indicator    @relation(fields: [indicatorId], references: [id], onDelete: Cascade)
  year           Int
  yearPeriod     YearPeriod   @relation(fields: [year], references: [year], onDelete: Cascade)
  targetPct      Decimal      @db.Decimal(8, 2) // e.g. 100.00
  totalSasaran   Decimal      @db.Decimal(12, 2) // Sasaran riil setahun
  targetSasaran  Decimal      @db.Decimal(12, 2) // Target riil setahun
  isLocked       Boolean      @default(false)
  updatedBy      String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@unique([healthCenterId, indicatorId, year])
  @@index([healthCenterId, year])
  @@map("annual_targets")
}

model PicAssignment {
  id             String       @id @default(uuid())
  healthCenterId String
  healthCenter   HealthCenter @relation(fields: [healthCenterId], references: [id], onDelete: Cascade)
  indicatorId    String
  indicator      Indicator    @relation(fields: [indicatorId], references: [id], onDelete: Cascade)
  year           Int
  yearPeriod     YearPeriod   @relation(fields: [year], references: [year], onDelete: Cascade)
  picUserId      String
  picUser        User         @relation(fields: [picUserId], references: [id], onDelete: Restrict)
  assignedAt     DateTime     @default(now())
  assignedBy     String?

  @@unique([healthCenterId, indicatorId, year])
  @@index([healthCenterId, year, picUserId])
  @@map("pic_assignments")
}

model MonthlyRecord {
  id              String       @id @default(uuid())
  healthCenterId  String
  healthCenter    HealthCenter @relation(fields: [healthCenterId], references: [id], onDelete: Cascade)
  indicatorId     String
  indicator       Indicator    @relation(fields: [indicatorId], references: [id], onDelete: Restrict)
  year            Int
  yearPeriod      YearPeriod   @relation(fields: [year], references: [year], onDelete: Cascade)
  month           Int          // 1..12
  
  // Realisasi
  pencapaianRiil  Decimal      @default(0) @db.Decimal(12, 2) // Numerator input
  totalSasaran    Decimal      @default(0) @db.Decimal(12, 2) // Denominator alokasi bulan
  targetSasaran   Decimal      @default(0) @db.Decimal(12, 2) // Target sasaran bulan
  capaianRiilPct  Decimal      @default(0) @db.Decimal(8, 2)  // % Capaian terhadap target
  nilaiKinerja    Decimal      @default(0) @db.Decimal(8, 2)  // Nilai resmi berbobot (0-100)
  
  // Bukti Dukung & Catatan
  evidenceUrl     String?      // MinIO S3 Object Key
  evidenceName    String?      // Original file name
  evidenceSize    Int?         // File size in bytes
  notes           String?      // Keterangan kendala / analisa masalah

  // Integrasi & Status
  isSubmitted     Boolean      @default(false)
  syncStatus      SyncStatus   @default(NOT_SYNCED)
  syncedAt        DateTime?
  syncBatchId     String?
  updatedBy       String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@unique([healthCenterId, indicatorId, year, month])
  @@index([healthCenterId, year, month])
  @@index([indicatorId, year, month])
  @@map("monthly_records")
}

model PeriodLock {
  id              String       @id @default(uuid())
  healthCenterId  String
  healthCenter    HealthCenter @relation(fields: [healthCenterId], references: [id], onDelete: Cascade)
  year            Int
  yearPeriod      YearPeriod   @relation(fields: [year], references: [year], onDelete: Cascade)
  periodNumber    Int          // Bulan 1..12 atau Triwulan 1..4
  isQuarter       Boolean      @default(false)
  status          PeriodStatus @default(DRAFT)
  
  submittedAt     DateTime?
  submittedById   String?
  submittedBy     User?        @relation("SubmittedBy", fields: [submittedById], references: [id])
  
  verifiedAt      DateTime?
  verifiedById    String?
  verifiedBy      User?        @relation("VerifiedBy", fields: [verifiedById], references: [id])
  
  revisionNote    String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@unique([healthCenterId, year, periodNumber, isQuarter])
  @@map("period_locks")
}

model Recommendation {
  id                  String       @id @default(uuid())
  healthCenterId      String
  healthCenter        HealthCenter @relation(fields: [healthCenterId], references: [id], onDelete: Cascade)
  year                Int
  yearPeriod          YearPeriod   @relation(fields: [year], references: [year], onDelete: Cascade)
  quarter             Int          // 1, 2, 3, 4
  subKlasterCode      String
  subKlaster          SubKlaster   @relation(fields: [subKlasterCode], references: [code], onDelete: Restrict)
  scoreAchieved       Decimal      @db.Decimal(8, 2)
  recommendationText  String       // Umpan balik tim pembina Dinkes
  analisisPenyebab    String?      // Root Cause Analysis Puskesmas
  actionPlanText      String?      // Rencana Tindak Lanjut (RTL) Puskesmas
  targetPenyelesaian  String?
  picName             String?
  statusFollowUp      String       @default("Belum Ditindaklanjuti") // Belum Ditindaklanjuti, Sedang Berjalan, Selesai
  reviewedBy          String?      // Auditor Dinkes
  reviewedAt          DateTime?
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt

  @@unique([healthCenterId, year, quarter, subKlasterCode])
  @@map("recommendations")
}

model AuditLog {
  id              String        @id @default(uuid())
  healthCenterId  String?
  healthCenter    HealthCenter? @relation(fields: [healthCenterId], references: [id], onDelete: SetNull)
  userId          String?
  user            User?         @relation(fields: [userId], references: [id], onDelete: SetNull)
  actorName       String
  action          String        // e.g. "Input Capaian", "Pengajuan Verifikasi", "Ubah Password"
  details         String
  ipAddress       String?
  userAgent       String?
  createdAt       DateTime      @default(now())

  @@index([healthCenterId, createdAt])
  @@index([userId, createdAt])
  @@map("audit_logs")
}
```

---

## 3. Arsitektur Keamanan & Isolasi Multi-Tenant

### 3.1 Multi-Tenant Isolation Middleware (Prisma Extension)
Untuk memastikan staf Puskesmas tidak dapat melihat atau memanipulasi data Puskesmas lain secara tidak sengaja (*data leakage*), digunakan **Prisma Client Extension** yang memanfaatkan `AsyncLocalStorage` (NestJS `ClsModule`):

```typescript
// src/common/prisma/tenant-scope.extension.ts
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';

export const createTenantScopeExtension = (cls: ClsService) => {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const tenantId = cls.get<string>('tenantId');
            const userRole = cls.get<string>('userRole');

            // Model dengan isolasi per Puskesmas
            const tenantScopedModels = [
              'MonthlyRecord',
              'AnnualTarget',
              'PicAssignment',
              'PeriodLock',
              'Recommendation'
            ];

            if (userRole !== 'DINKES_ADMIN' && tenantScopedModels.includes(model)) {
              if (operation === 'findMany' || operation === 'findFirst' || operation === 'count') {
                args.where = { ...args.where, healthCenterId: tenantId };
              }
              if (operation === 'create' || operation === 'createMany') {
                if (args.data) {
                  args.data = Array.isArray(args.data) 
                    ? args.data.map(d => ({ ...d, healthCenterId: tenantId }))
                    : { ...args.data, healthCenterId: tenantId };
                }
              }
              if (operation === 'update' || operation === 'updateMany' || operation === 'delete') {
                args.where = { ...args.where, healthCenterId: tenantId };
              }
            }

            return query(args);
          },
        },
      },
    });
  });
};
```

### 3.2 Period Lock Guard (State Machine)
Mencegah mutasi data ketika periode telah diajukan ke Dinkes atau telah diverifikasi:

```typescript
// src/common/guards/period-not-locked.guard.ts
@Injectable()
export class PeriodNotLockedGuard implements CanActivate {
  constructor(private prisma: PrismaService, private cls: ClsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const { year, month } = req.body || req.query;
    const healthCenterId = this.cls.get<string>('tenantId');

    const lock = await this.prisma.periodLock.findUnique({
      where: {
        healthCenterId_year_periodNumber_isQuarter: {
          healthCenterId,
          year: Number(year),
          periodNumber: Number(month),
          isQuarter: false
        }
      }
    });

    if (lock && (lock.status === 'SUBMITTED' || lock.status === 'VERIFIED')) {
      throw new ForbiddenException(
        `Periode ${year} Bulan ${month} sedang berstatus [${lock.status}] dan terkunci. Perubahan data ditolak.`
      );
    }

    return true;
  }
}
```

---

## 4. Integrasi Redis (Caching & Background Queue)

### 4.1 Caching Layer
* **Indikator Master & Formula**: Disimpan di Redis dengan TTL 24 jam (`pkp:cache:master:indicators`). Di-invalidate secara manual hanya bila Dinkes melakukan perubahan master.
* **Sheet 7 Precomputed Scores**: Disimpan di Redis dengan key `pkp:cache:sheet7:{pkmId}:{year}:{quarter}` (TTL 1 jam). Dihapus seketika saat ada input capaian baru (`monthly_records.upsert`).
* **Rate Limiting (DDoS Prevention)**: Menggunakan `@nestjs/throttler` berbasis Redis:
  * Route `/auth/login`: Maksimal 5 percobaan per menit per IP.
  * Route Operasional Data: Maksimal 120 request per menit per User.

### 4.2 BullMQ Queue Architecture
Memisahkan proses berat (PDF generation, Excel workbook assembly, dan Provinsi HTTP Bridge) dari event loop utama:

```typescript
// src/jobs/queues.ts
export const QUEUES = {
  EXCEL_EXPORT: 'pkp-excel-export-queue',
  PDF_BERITA_ACARA: 'pkp-pdf-export-queue',
  PROVINCIAL_SYNC: 'pkp-provincial-sync-queue',
};
```

---

## 5. Integrasi Object Storage MinIO

### 5.1 MinIO Service Specification
Backend menyediakan upload bukti dukung (*evidence*) menggunakan **Presigned S3 URLs**:

1. Klien mengirim `POST /api/v1/storage/presigned-upload` dengan metadata berkas (nama, ukuran, MIME type).
2. Backend memvalidasi ekstensi (hanya `.pdf`, `.jpg`, `.jpeg`, `.png`, `.xlsx`), ukuran maksimal (10 MB), dan hak akses.
3. Backend mengembalikan Presigned PUT URL bertanda tangan HMAC-SHA256 dengan masa berlaku 300 detik.
4. Klien mengunggah berkas biner secara langsung ke MinIO via HTTP PUT.
5. Klien mengirim `PUT /api/v1/records/monthly` dengan menyertakan `evidenceKey` yang valid.

```typescript
// src/modules/storage/storage.service.ts
@Injectable()
export class StorageService {
  private s3Client: S3Client;
  private bucketName = process.env.MINIO_BUCKET_NAME || 'pkp-evidence';

  constructor() {
    this.s3Client = new S3Client({
      endpoint: process.env.MINIO_ENDPOINT, // e.g. http://minio:9000
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY,
        secretAccessKey: process.env.MINIO_SECRET_KEY,
      },
      forcePathStyle: true,
    });
  }

  async generatePresignedUploadUrl(healthCenterCode: string, year: number, month: number, filename: string, mimeType: string) {
    const cleanName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const objectKey = `${year}/${healthCenterCode}/M${month}/${Date.now()}_${cleanName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 300 });
    return { uploadUrl, objectKey };
  }
}
```

---

## 6. Spesifikasi Lengkap REST API

Semua respons API menggunakan standar amplop JSON terpadu:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operasi berhasil dieksekusi",
  "data": { ... },
  "meta": { "timestamp": "2026-10-18T20:30:00.000Z" }
}
```

---

### 6.1 Authentication & Profile Module

#### 1. `POST /api/v1/auth/login`
* **Deskripsi**: Autentikasi kredensial pengguna (Dinkes, Admin Puskesmas, PIC).
* **Akses**: Publik (Dibatasi Throttler: 5 request/menit).
* **Request Body**:
```json
{
  "username": "admin.kebonagung",
  "password": "PasswordResmi2026!",
  "role": "ADMIN_PUSKESMAS"
}
```
* **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
    "refreshToken": "d8e9f2a1b3c4...",
    "expiresIn": 900,
    "user": {
      "id": "usr-1234",
      "name": "dr. H. Rahmat Hidayat, M.Kes",
      "username": "admin.kebonagung",
      "nip": "19750812 200212 1 003",
      "role": "ADMIN_PUSKESMAS",
      "healthCenter": {
        "id": "pkm-1",
        "code": "P35070101",
        "name": "Puskesmas Kebonagung"
      }
    }
  }
}
```

#### 2. `POST /api/v1/auth/refresh`
* **Deskripsi**: Rotasi Access Token menggunakan Refresh Token.
* **Request Body**: `{ "refreshToken": "d8e9f2a1b3c4..." }`
* **Response (200 OK)**: Mengembalikan pair token baru.

#### 3. `PATCH /api/v1/auth/change-password`
* **Deskripsi**: Mengubah kata sandi pengguna yang sedang login.
* **Auth**: Bearer JWT.
* **Request Body**:
```json
{
  "oldPassword": "PasswordLama123!",
  "newPassword": "PasswordBaruKuat2026#",
  "confirmNewPassword": "PasswordBaruKuat2026#"
}
```

---

### 6.2 Master Data Management Module

#### 1. `GET /api/v1/master/indicators`
* **Deskripsi**: Mengambil daftar lengkap 272 Indikator Baku ILP (sesuai hierarki provinsi).
* **Query Params**:
  * `klasterId` (Opsional, 1..5)
  * `subKlasterCode` (Opsional, e.g. "1.1", "2.1")
  * `search` (Opsional, kata kunci pencarian)
* **Cache**: Cached di Redis selama 24 jam.

#### 2. `POST /api/v1/master/indicators`
* **Deskripsi**: Menambah indikator evaluasi baru (Khusus Dinkes).
* **Auth**: `DINKES_ADMIN`.
* **Request Body**:
```json
{
  "id": "K2-R99",
  "klasterId": 2,
  "subKlasterCode": "2.1",
  "no": "2.1.8",
  "kegiatan": "Pelayanan Skrining Hipotiroid Kongenital (SHK)",
  "indikator": "Persentase bayi baru lahir yang dilakukan SHK",
  "targetDisplay": "≥ 95%",
  "targetNumeric": 0.95,
  "satuan": "bayi",
  "polarity": "HIGHER_IS_BETTER",
  "isHead": false
}
```

#### 3. `GET /api/v1/master/years` & `POST /api/v1/master/years`
* **Deskripsi**: Mengelola Periode Tahun Anggaran dan tanggal batas entri (*Cut-off Day*).

---

### 6.3 User, Admin PKM & Staff PIC Module

#### 1. `GET /api/v1/users/admin-puskesmas`
* **Deskripsi**: Daftar seluruh Administrator Puskesmas di wilayah (Dinkes Only).
* **Auth**: `DINKES_ADMIN`.

#### 2. `POST /api/v1/users/admin-puskesmas`
* **Deskripsi**: Dinkes membuat akun Administrator Puskesmas baru.
* **Auth**: `DINKES_ADMIN`.
* **Request Body**:
```json
{
  "name": "dr. Nurul Aini",
  "username": "admin.singosari",
  "nip": "19800315 200604 2 011",
  "healthCenterId": "pkm-2",
  "phone": "08113456702",
  "email": "admin.singosari@malangkab.go.id",
  "password": "PasswordAwal123!"
}
```

#### 3. `GET /api/v1/users/pics` & `POST /api/v1/users/pics`
* **Deskripsi**: Puskesmas mengelola dan membuat akun Staf PIC masing-masing.
* **Auth**: `ADMIN_PUSKESMAS` (terisolasi ke Puskesmas-nya) atau `DINKES_ADMIN`.

#### 4. `PUT /api/v1/pic-assignments/bulk`
* **Deskripsi**: Menetapkan penugasan PIC pada indikator atau seluruh sub-klaster sekaligus.

---

### 6.4 Target Sasaran Tahunan Module

#### 1. `GET /api/v1/targets/annual/:year`
* **Deskripsi**: Mengambil target sasaran tahunan faskes (Total Sasaran & Target Sasaran per elemen).
* **Auth**: All Authenticated.

#### 2. `PUT /api/v1/targets/annual/:year/bulk`
* **Deskripsi**: Mengisi atau memperbarui target sasaran tahunan (sebelum dikunci).
* **Auth**: `ADMIN_PUSKESMAS`.
* **Request Body**:
```json
{
  "targets": [
    {
      "indicatorId": "K1-R8",
      "targetPct": 100.0,
      "totalSasaran": 1.0,
      "targetSasaran": 1.0
    },
    {
      "indicatorId": "K2-R10",
      "targetPct": 100.0,
      "totalSasaran": 328.0,
      "targetSasaran": 328.0
    }
  ]
}
```

---

### 6.5 Input Capaian & Rekam Kinerja Bulanan Module

#### 1. `GET /api/v1/records/monthly`
* **Query Params**: `year=2026`, `month=3`, `klasterId=0`
* **Response (200 OK)**:
Mengembalikan 272 elemen beserta numerators, persentase capaian riil, skor nilai kinerja, status bukti dukung, dan status sinkronisasi.

#### 2. `PUT /api/v1/records/monthly`
* **Deskripsi**: Input atau update numerator capaian bulanan oleh PIC / Admin PKM.
* **Guards**: `PeriodNotLockedGuard`.
* **Request Body**:
```json
{
  "year": 2026,
  "month": 3,
  "records": [
    {
      "indicatorId": "K2-R10",
      "pencapaianRiil": 28.0,
      "notes": "Target TW1 terpenuhi 100% tanpa kendala",
      "evidenceObjectKey": "2026/P35070101/M3/17712399_Laporan_KIA_Maret.pdf"
    }
  ]
}
```
* **Logika Backend**: Menghitung secara otomatis `capaianRiilPct` dan `nilaiKinerja` menggunakan modul kalkulator resmi, melakukan re-kalkulasi Head Penilaian, menginvalidasi cache Sheet 7 di Redis, dan mencatat ke `audit_logs`.

---

### 6.6 Workflow Verifikasi & Penguncian Periode Module

```mermaid
stateDiagram-v2
    [*] --> DRAFT : Periode Baru
    DRAFT --> SUBMITTED : Admin PKM Klik "Ajukan ke Dinkes"
    SUBMITTED --> DRAFT : (Terkunci untuk Faskes)
    SUBMITTED --> VERIFIED : Dinkes Setujui & Sahkan
    SUBMITTED --> REVISION_REQUIRED : Dinkes Tolak / Minta Perbaikan
    REVISION_REQUIRED --> SUBMITTED : Faskes Selesaikan Catatan & Ajukan Ulang
    VERIFIED --> [*] : Berita Acara Ditandatangani
```

#### 1. `POST /api/v1/workflow/submit`
* **Deskripsi**: Puskesmas mengajukan laporan capaian bulanan/triwulanan ke Dinas Kesehatan. Data otomatis terkunci.
* **Auth**: `ADMIN_PUSKESMAS`.
* **Request Body**: `{ "year": 2026, "periodNumber": 3, "isQuarter": false }`

#### 2. `POST /api/v1/workflow/verify`
* **Deskripsi**: Dinas Kesehatan memverifikasi dan mengesahkan laporan faskes.
* **Auth**: `DINKES_ADMIN`.

#### 3. `POST /api/v1/workflow/revise`
* **Deskripsi**: Dinas Kesehatan mengembalikan laporan dengan catatan revisi perbaikan.
* **Auth**: `DINKES_ADMIN`.
* **Request Body**:
```json
{
  "healthCenterId": "pkm-1",
  "year": 2026,
  "periodNumber": 3,
  "isQuarter": false,
  "revisionNote": "Mohon periksa kembali numerator indikator 2.1.3 karena melebihi total sasaran balita."
}
```

---

### 6.7 Analitik Skor, Nilai Resmi Sheet 7 & Dasbor Tahunan 12 Bulan

#### 1. `GET /api/v1/analytics/sheet7`
* **Deskripsi**: Mengambil formulir resmi Sheet 7 (Nilai Kinerja 2026) lengkap 5 Klaster, 29 Sub-klaster, rata-rata akumulatif, dan Berita Acara.
* **Query Params**: `year=2026`, `quarter=1` (atau `quarter=ANNUAL`)

#### 2. `GET /api/v1/analytics/annual-trend`
* **Deskripsi**: Mengambil data matriks komparasi 12 bulan (Januari s/d Desember) untuk seluruh klaster, sub-klaster, dan indikator (kompatibel dengan `AnnualTrendDashboard.tsx`).
* **Query Params**: `year=2026`, `klasterId=0`
* **Response Structure**:
```json
{
  "success": true,
  "data": {
    "year": 2026,
    "annualAveragePKP": 78.45,
    "annualCategoryPKP": "Kinerja Kurang",
    "monthlyOverallScores": [75.2, 75.8, 77.45, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "highestMonth": { "month": 3, "name": "Maret", "score": 77.45 },
    "lowestMonth": { "month": 1, "name": "Januari", "score": 75.2 },
    "klasters": [
      {
        "klasterId": 1,
        "name": "Klaster 1: Manajemen Puskesmas",
        "monthlyScores": [76.0, 76.2, 76.6, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        "annualAverage": 76.27,
        "category": "Kinerja Kurang"
      }
    ],
    "subKlasters": [ ... ]
  }
}
```

---

### 6.8 Supervisi Dinkes, Rekomendasi & RTL Module

#### 1. `GET /api/v1/recommendations`
* **Query Params**: `year=2026`, `quarter=1`
* Mengambil daftar umpan balik pembinaan, akar masalah, dan Rencana Tindak Lanjut (RTL).

#### 2. `POST /api/v1/recommendations/feedback`
* **Auth**: `DINKES_ADMIN` (Dinkes menginput rekomendasi pembinaan pada sub-klaster yang belum optimal).

#### 3. `PATCH /api/v1/recommendations/:id/action-plan`
* **Auth**: `ADMIN_PUSKESMAS` (Puskesmas menginput analisa akar masalah dan RTL perbaikan).

---

### 6.9 Object Storage & Bukti Dukung (MinIO) Module

#### 1. `POST /api/v1/storage/presigned-upload`
* **Auth**: All Authenticated.
* **Request Body**:
```json
{
  "filename": "Notulen_Lokmin_Maret_2026.pdf",
  "mimeType": "application/pdf",
  "fileSizeBytes": 1420500,
  "year": 2026,
  "month": 3
}
```
* **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://storage.sipkp.faskes.id/pkp-evidence/2026/P35070101/M3/17712399_Notulen.pdf?X-Amz-Signature=...",
    "objectKey": "2026/P35070101/M3/17712399_Notulen.pdf",
    "expiresInSeconds": 300
  }
}
```

#### 2. `GET /api/v1/storage/presigned-download`
* **Query Params**: `objectKey=2026/P35070101/M3/17712399_Notulen.pdf`
* Mengembalikan URL bertanda tangan aman untuk mengunduh bukti dukung.

---

### 6.10 Ekspor Laporan & Background Jobs Module

#### 1. `POST /api/v1/export/excel/sheet7`
* **Deskripsi**: Mengirim pekerjaan render Excel Sheet 7 ke BullMQ Queue.
* **Response (202 Accepted)**:
```json
{
  "success": true,
  "message": "Pekerjaan ekspor Excel sedang diproses di antrean latar belakang",
  "data": { "jobId": "job-excel-98213" }
}
```

#### 2. `GET /api/v1/export/jobs/:jobId`
* **Deskripsi**: Memeriksa status pekerjaan render file (Polling status atau via SSE/WebSocket).
* **Response (Status Completed)**:
```json
{
  "success": true,
  "data": {
    "status": "COMPLETED",
    "downloadUrl": "https://storage.sipkp.faskes.id/pkp-reports/..."
  }
}
```

---

### 6.11 Provincial Bridge Sync Module

#### 1. `POST /api/v1/bridge/sync-batch`
* **Deskripsi**: Mengirim paket data capaian 272 indikator ke server SIPKP Provinsi Jawa Timur sesuai kode baku Kemenkes.
* **Auth**: `ADMIN_PUSKESMAS` atau `DINKES_ADMIN`.

#### 2. `GET /api/v1/bridge/status`
* **Deskripsi**: Memeriksa status konektivitas TLS, batch ID pengiriman terakhir, dan verifikasi hash integritas data provinsi.

---

### 6.12 Audit Log & Aktivitas Module

#### 1. `GET /api/v1/audit-logs`
* **Query Params**: `page=1`, `limit=20`, `startDate=2026-01-01`
* **Auth**: `ADMIN_PUSKESMAS` (hanya log faskes sendiri) atau `DINKES_ADMIN` (seluruh log wilayah).

---

## 7. Struktur Direktori NestJS & Konfigurasi Docker Compose

### 7.1 Struktur Direktori Proyek NestJS Rekomendasi

```text
sipkp-backend/
├── src/
│   ├── app.module.ts
│   ├── main.ts
│   ├── common/
│   │   ├── decorators/         # @CurrentUser, @Roles, @TenantId
│   │   ├── filters/            # GlobalExceptionFilter (RFC 7807)
│   │   ├── guards/             # JwtAuthGuard, RolesGuard, PeriodLockGuard
│   │   ├── interceptors/       # TransformInterceptor, AuditLogInterceptor
│   │   ├── pipes/              # ValidationPipe (strip unknown, strict types)
│   │   └── prisma/             # PrismaService & Tenant Scope Extensions
│   ├── modules/
│   │   ├── auth/               # Login, Refresh, Change Password, Argon2
│   │   ├── master/             # Indikator (272 items), Klaster, Sub-klaster, Tahun
│   │   ├── users/              # Dinkes, Admin PKM, PIC Management
│   │   ├── targets/            # Target Sasaran Tahunan
│   │   ├── records/            # Input Capaian Bulanan, Normalisasi Polaritas
│   │   ├── workflow/           # State Machine Pengajuan, Verifikasi, Penguncian
│   │   ├── analytics/          # Rollup Engine, Sheet 7 Excel, Dasbor 12 Bulan
│   │   ├── recommendations/    # RTL & Pembinaan Dinkes
│   │   ├── storage/            # MinIO Client, Presigned Upload/Download
│   │   ├── export/             # BullMQ Producer & Workers (Excel/PDF)
│   │   ├── bridge/             # Konektor API Provinsi Jawa Timur
│   │   └── audit-log/          # Audit Trails
│   └── jobs/                   # BullMQ Worker Processors
├── prisma/
│   ├── schema.prisma           # Prisma Schema
│   └── seed.ts                 # Seeder 272 Indikator Baku & Akun Demo
├── docker-compose.yml          # Postgres, Redis, MinIO, App
├── .env.example
└── package.json
```

---

### 7.2 Docker Compose untuk Pengembangan & Produksi

Berikut adalah berkas `docker-compose.yml` lengkap yang menyatukan PostgreSQL, Redis, MinIO, dan NestJS:

```yaml
version: '3.8'

services:
  # ==================== DATABASE ====================
  postgres:
    image: postgres:16-alpine
    container_name: sipkp_postgres
    restart: always
    environment:
      POSTGRES_USER: sipkp_user
      POSTGRES_PASSWORD: SecretPostgres2026!
      POSTGRES_DB: sipkp_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sipkp_user -d sipkp_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ==================== REDIS (CACHE & QUEUE) ====================
  redis:
    image: redis:7-alpine
    container_name: sipkp_redis
    restart: always
    command: redis-server --requirepass SecretRedis2026! --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "SecretRedis2026!", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ==================== OBJECT STORAGE (MINIO) ====================
  minio:
    image: minio/minio:RELEASE.2024-03-05T04-48-44Z
    container_name: sipkp_minio
    restart: always
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio_admin
      MINIO_ROOT_PASSWORD: MinioSecretKey2026!
    ports:
      - "9000:9000"   # API S3
      - "9001:9001"   # Web Console UI
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Auto Create Bucket Script for MinIO
  minio-init:
    image: minio/mc:latest
    container_name: sipkp_minio_init
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      /usr/bin/mc alias set local http://minio:9000 minio_admin MinioSecretKey2026!;
      /usr/bin/mc mb --ignore-existing local/pkp-evidence;
      /usr/bin/mc mb --ignore-existing local/pkp-reports;
      exit 0;
      "

  # ==================== NESTJS APPLICATION ====================
  backend:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: sipkp_backend
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: 4000
      DATABASE_URL: "postgresql://sipkp_user:SecretPostgres2026!@postgres:5432/sipkp_db?schema=public&connection_limit=25"
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: SecretRedis2026!
      MINIO_ENDPOINT: "http://minio:9000"
      MINIO_PUBLIC_ENDPOINT: "http://localhost:9000"
      MINIO_ACCESS_KEY: minio_admin
      MINIO_SECRET_KEY: MinioSecretKey2026!
      MINIO_BUCKET_NAME: pkp-evidence
      JWT_SECRET: "kemenkes_sipkp_pulse_ultra_secret_jwt_key_2026"
      JWT_EXPIRATION: "900s"
      REFRESH_TOKEN_SECRET: "kemenkes_sipkp_pulse_ultra_refresh_secret_2026"
      REFRESH_TOKEN_EXPIRATION: "7d"
    ports:
      - "4000:4000"

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

---

### 7.3 Berkas Variabel Lingkungan (`.env.example`)

```env
# Application
NODE_ENV=development
PORT=4000
APP_NAME="SIPKP PULSE Backend"
APP_URL=http://localhost:4000
FRONTEND_URL=http://localhost:5175

# PostgreSQL Database (Prisma)
DATABASE_URL="postgresql://sipkp_user:SecretPostgres2026!@localhost:5432/sipkp_db?schema=public&connection_limit=20"

# Redis Cache & Queue
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=SecretRedis2026!
REDIS_DB=0

# Object Storage (MinIO / S3)
MINIO_ENDPOINT="http://localhost:9000"
MINIO_PUBLIC_ENDPOINT="http://localhost:9000"
MINIO_ACCESS_KEY=minio_admin
MINIO_SECRET_KEY=MinioSecretKey2026!
MINIO_BUCKET_NAME=pkp-evidence
MINIO_BUCKET_REPORTS=pkp-reports

# Authentication Security (JWT & Argon2)
JWT_SECRET="ganti_dengan_random_string_minimal_64_karakter_untuk_produksi"
JWT_EXPIRATION="900s"
REFRESH_TOKEN_SECRET="ganti_dengan_random_refresh_string_minimal_64_karakter"
REFRESH_TOKEN_EXPIRATION="7d"

# Rate Limiting (Throttler)
THROTTLE_TTL=60
THROTTLE_LIMIT=120

# Provincial Bridge (Jawa Timur)
PROVINCIAL_BRIDGE_URL="https://sipkp.dinkes.jatimprov.go.id/api/v2"
PROVINCIAL_BRIDGE_CLIENT_ID="kab_malang_faskes_bridge"
PROVINCIAL_BRIDGE_CLIENT_SECRET="secret_provinsi_2026"
```
