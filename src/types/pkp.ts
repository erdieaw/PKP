/**
 * TYPES DEFINITION FOR PENILAIAN KINERJA PUSKESMAS (PKP)
 * INTEGRASI PELAYANAN PRIMER (ILP) 2026
 * 
 * JAMINAN: KODE PROVINSI TIDAK DIUBAH (STRICT PROVINCIAL CODE INTEGRITY)
 */

export type KlasterId = 1 | 2 | 3 | 4 | 5;

export type TargetPolarity = 
  | 'HIGHER_IS_BETTER'   // Normal coverage (K1, K6, Imunisasi, SPM)
  | 'LOWER_IS_BETTER'    // Inverse indicator (Stunting <=15.04%, Wasting <=8%)
  | 'TIERED_BRACKETS'    // Multi-tier rubric (Drop out KB <15%, Komplikasi KB <3.5%, POR ISPA <=20%, Polifarmasi <=2.6)
  | 'BINARY';            // Available / Not available (100 or 0)

export interface OfficialIndicator {
  id: string;                    // Unique identifier (e.g. K1-R8, K2-R50)
  klasterId: KlasterId;          // 1, 2, 3, 4, 5
  klasterName: string;          // Klaster Pelayanan Manajemen, dll.
  section: string;              // Exact section from province (e.g. "1.1.Manajemen Inti Puskesmas")
  sectionCode: string;          // Exact code (e.g. "1.1", "2.2.5", "3.1.6", "4.1.2", "5.3")
  no: string;                   // Exact number from Excel (e.g. "1.", "2.", "15.")
  kegiatan: string;             // Exact kegiatan from Excel
  indikator: string;            // Exact indicator name from Excel
  targetDisplay: string;        // Raw target display (e.g. "1.0", "≥ 90%", "< 15 %")
  targetNumeric: number;        // Parsed target ratio (e.g. 1.0, 0.9, 0.15)
  satuan: string;               // Satuan sasaran (bumil, balita, persen, dokumen, resep)
  totalSasaranDefault: number;  // Default total sasaran
  targetSasaranDefault: number; // Default target sasaran
  capaianTw1Raw?: string | null; // Original Q1 achievement from template
  formulaKinerjaRaw?: string | null; // Original Excel formula
  notes?: string | null;        // Technical instructions / Column L notes
  polarity: TargetPolarity;     // Detected polarity
  isHead?: boolean;             // True jika merupakan Head Penilaian (nilai dihitung dari child)
  isTableArtifact?: boolean;    // True jika merupakan header tabel excel asli
  childIds?: string[];          // ID elemen turunan (child)
}

export type UserRole = 'DINKES_ADMIN' | 'ADMIN_PUSKESMAS' | 'PIC';

export interface AdminPuskesmasUser {
  id: string;
  name: string;
  username: string;
  nip: string;
  healthCenterId: string;
  healthCenterName: string;
  phone: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

export interface PicUser {
  id: string;
  name: string;
  nip?: string;
  role: string;                 // Bidan Koordinator, PJ Mutu, Apoteker, Sanitarian, dll.
  phone: string;
  email?: string;
  avatarColor: string;
  healthCenterId?: string;      // ID Puskesmas tempat PIC bertugas
  healthCenterName?: string;    // Nama Puskesmas
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  nip?: string;
  role: UserRole;
  roleLabel: string;
  healthCenterId?: string;
  healthCenterName?: string;
  phone?: string;
  email?: string;
  avatarColor: string;
}

export interface PicAssignment {
  indicatorId: string;
  picId: string;
  year: number;
  assignedAt: string;
}

export type ElementSyncStatus = 'SYNCED' | 'PENDING_SYNC' | 'NOT_SYNCED';

export interface MonthlyRecord {
  pencapaianRiil: number;       // Input numerator bulan berjalan
  capaianRiilPct: number;       // Realisasi terhadap Total Sasaran (%)
  nilaiKinerja: number;         // Skor kinerja akhir (0 - 100)
  notes?: string;
  evidenceName?: string;
  evidenceUrl?: string;
  isSubmitted: boolean;
  syncStatus?: ElementSyncStatus; // 'SYNCED' | 'PENDING_SYNC' | 'NOT_SYNCED'
  syncedAt?: string;            // Waktu sinkronisasi ke server SIPKP Provinsi
  syncBatchId?: string;         // ID Batch pengiriman data provinsi
  updatedAt?: string;
}

export interface IndicatorAnnualTarget {
  indicatorId: string;
  year: number;
  targetPct: number;            // Target persentase (misal 100%, 80%)
  totalSasaran: number;         // Denominator tahunan
  targetSasaran: number;        // Target fisik tahunan (targetPct/100 * totalSasaran)
  isLocked: boolean;
  approvedByKapus?: boolean;
}

export interface DinkesRecommendation {
  id: string;
  klasterId: KlasterId;
  sectionCode: string;
  sectionName: string;
  quarter: number;              // 1, 2, 3, 4
  year: number;
  recommendationText: string;   // Feedback Dinkes dari Sheet 6
  puskesmasRtl: string;         // Rencana Tindak Lanjut Puskesmas
  status: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED';
  updatedAt: string;
}

export interface YearPeriod {
  year: number;
  status: 'OPEN' | 'LOCKED' | 'DRAFT';
  cutoffDay: number;            // e.g. 10 of each month
  description: string;
  isCurrent: boolean;
}

export interface HealthCenter {
  id: string;
  name: string;
  code: string;
  subdistrict: string;
  headName: string;
  picCount: number;
  currentScore: number;
  kategoriPKP: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang';
  klasterScores: Record<number, number>;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userName: string;
  action: string;
  details: string;
}

export type PeriodSubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'REVISION_REQUIRED';

export interface PeriodLockState {
  periodKey: string;            // e.g., "2026-M1", "2026-Q1"
  year: number;
  periodNumber: number;         // 1..12 for month, 1..4 for quarter
  isQuarter: boolean;
  status: PeriodSubmissionStatus;
  submittedAt?: string;
  submittedBy?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  revisionNote?: string;
}

export interface Sheet7Row {
  no: string;                   // '1.0', '1.1', '2.0', etc.
  name: string;                 // e.g. 'Klaster Pelayanan Manajemen'
  isKlasterHead: boolean;
  klasterId: number;
  nilaiKelompok?: number;       // For subklaster
  nilaiKlaster?: number;        // For klaster head
  rekomendasi?: string;
}

export interface Sheet7OfficialSummary {
  year: number;
  periodLabel: string;
  puskesmasName: string;
  puskesmasCode: string;
  kepalaPuskesmas: string;
  nipKepalaPuskesmas: string;
  rows: Sheet7Row[];
  klasterScores: Record<number, number>; // 1..5
  nilaiKinerjaPuskesmas: number;         // Average of the 5 klasters
  kategoriPKP: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang';
  totalIndikator: number;
  completionRate: number;
}

export interface AnnualKlasterTrend {
  klasterId: number;
  name: string;
  monthlyScores: number[]; // 12 elements
  annualAverage: number;
  category: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang';
}

export interface AnnualSubKlasterTrend {
  code: string;
  name: string;
  klasterId: number;
  indicatorCount: number;
  monthlyScores: number[]; // 12 elements
  annualAverage: number;
  category: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang';
}

export interface AnnualIndicatorTrend {
  indicator: OfficialIndicator;
  monthlyValues: number[]; // 12 elements: numerator / pencapaianRiil
  monthlyPct: number[];    // 12 elements: capaianRiilPct
  monthlyScores: number[]; // 12 elements: nilaiKinerja
  annualAverageScore: number;
  annualAveragePct: number;
  category: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang';
}

export interface AnnualTrendData {
  year: number;
  monthlyOverallScores: number[];
  monthlySubmittedCount: number[];
  monthlyCategories: string[];
  annualAveragePKP: number;
  annualCategoryPKP: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang';
  highestMonth: { month: number; name: string; score: number };
  lowestMonth: { month: number; name: string; score: number };
  klasters: AnnualKlasterTrend[];
  subKlasters: AnnualSubKlasterTrend[];
}

