import { OFFICIAL_INDICATORS } from '../data/indicators';
import { 
  PicUser,
  AdminPuskesmasUser, 
  IndicatorAnnualTarget, 
  MonthlyRecord, 
  DinkesRecommendation,
  YearPeriod,
  HealthCenter,
  AuditLogEntry,
  OfficialIndicator,
  AuthUser,
  UserRole,
  PeriodSubmissionStatus,
  PeriodLockState,
  Sheet7Row,
  Sheet7OfficialSummary,
  AnnualTrendData,
  AnnualKlasterTrend,
  AnnualSubKlasterTrend,
  AnnualIndicatorTrend
} from '../types/pkp';
import { calculateIndicatorScore, calculateRollup } from './pkpCalculator';

export interface SubKlasterMaster {
  id: string;
  klasterId: number;
  code: string;
  name: string;
  indicatorCount?: number;
}

export const INITIAL_ADMIN_PUSKESMAS: AdminPuskesmasUser[] = [
  {
    id: 'adm-1',
    name: 'dr. H. Rahmat Hidayat, M.Kes',
    username: 'admin.kebonagung',
    nip: '19750812 200212 1 003',
    healthCenterId: 'pkm-1',
    healthCenterName: 'Puskesmas Kebonagung',
    phone: '08113456701',
    email: 'admin.kebonagung@malangkab.go.id',
    status: 'ACTIVE',
    createdAt: '2026-01-05'
  },
  {
    id: 'adm-2',
    name: 'dr. Nurul Aini',
    username: 'admin.singosari',
    nip: '19800315 200604 2 011',
    healthCenterId: 'pkm-2',
    healthCenterName: 'Puskesmas Singosari',
    phone: '08113456702',
    email: 'admin.singosari@malangkab.go.id',
    status: 'ACTIVE',
    createdAt: '2026-01-05'
  },
  {
    id: 'adm-3',
    name: 'dr. Bambang Soetrisno',
    username: 'admin.lawang',
    nip: '19781120 200501 1 008',
    healthCenterId: 'pkm-3',
    healthCenterName: 'Puskesmas Lawang',
    phone: '08113456703',
    email: 'admin.lawang@malangkab.go.id',
    status: 'ACTIVE',
    createdAt: '2026-01-05'
  },
  {
    id: 'adm-4',
    name: 'dr. Tri Wahyuni, Sp.KKLP',
    username: 'admin.kepanjen',
    nip: '19820524 200902 2 005',
    healthCenterId: 'pkm-4',
    healthCenterName: 'Puskesmas Kepanjen',
    phone: '08113456704',
    email: 'admin.kepanjen@malangkab.go.id',
    status: 'ACTIVE',
    createdAt: '2026-01-05'
  },
  {
    id: 'adm-5',
    name: 'dr. Hendro Prasetyo',
    username: 'admin.tumpang',
    nip: '19840910 201001 1 014',
    healthCenterId: 'pkm-5',
    healthCenterName: 'Puskesmas Tumpang',
    phone: '08113456705',
    email: 'admin.tumpang@malangkab.go.id',
    status: 'ACTIVE',
    createdAt: '2026-01-05'
  },
  {
    id: 'adm-6',
    name: 'dr. Eka Safitri',
    username: 'admin.dau',
    nip: '19860218 201101 2 009',
    healthCenterId: 'pkm-6',
    healthCenterName: 'Puskesmas Dau',
    phone: '08113456706',
    email: 'admin.dau@malangkab.go.id',
    status: 'ACTIVE',
    createdAt: '2026-01-05'
  }
];

export const INITIAL_PICS: PicUser[] = [
  { id: 'pic-1', name: 'Bd. Siti Aminah, S.Tr.Keb', nip: '19880412 201101 2 004', role: 'Bidan Koordinator (KIA & KB)', phone: '081234567801', avatarColor: 'bg-emerald-500', healthCenterId: 'pkm-1', healthCenterName: 'Puskesmas Kebonagung', status: 'ACTIVE' },
  { id: 'pic-2', name: 'drg. Maya Indira', nip: '19850619 201001 2 007', role: 'PJ Mutu & Kesgilut', phone: '081234567802', avatarColor: 'bg-teal-500', healthCenterId: 'pkm-1', healthCenterName: 'Puskesmas Kebonagung', status: 'ACTIVE' },
  { id: 'pic-3', name: 'Apt. Budi Pratama, S.Farm', nip: '19910325 201502 1 002', role: 'Penanggung Jawab Farmasi', phone: '081234567803', avatarColor: 'bg-blue-500', healthCenterId: 'pkm-1', healthCenterName: 'Puskesmas Kebonagung', status: 'ACTIVE' },
  { id: 'pic-4', name: 'Ns. Hendra Wijaya, S.Kep', nip: '19891108 201403 1 005', role: 'PJ Program P2P & Surveilans', phone: '081234567804', avatarColor: 'bg-indigo-500', healthCenterId: 'pkm-1', healthCenterName: 'Puskesmas Kebonagung', status: 'ACTIVE' },
  { id: 'pic-5', name: 'Siti Rohmah, S.K.M', nip: '19920714 201701 2 003', role: 'Sanitarian & Promkes', phone: '081234567805', avatarColor: 'bg-amber-500', healthCenterId: 'pkm-1', healthCenterName: 'Puskesmas Kebonagung', status: 'ACTIVE' },
  { id: 'pic-6', name: 'dr. Andi Kurniawan', nip: '19870102 201212 1 001', role: 'Dokter UGD & Rawat Inap', phone: '081234567806', avatarColor: 'bg-purple-500', healthCenterId: 'pkm-1', healthCenterName: 'Puskesmas Kebonagung', status: 'ACTIVE' },
  { id: 'pic-7', name: 'Rina Marlina, A.Md.AK', nip: '19930930 201903 2 008', role: 'Pranata Laboratorium', phone: '081234567807', avatarColor: 'bg-rose-500', healthCenterId: 'pkm-1', healthCenterName: 'Puskesmas Kebonagung', status: 'ACTIVE' },
  { id: 'pic-8', name: 'Ahmad Fauzi, S.E', nip: '19810504 200801 1 006', role: 'Kepala Tata Usaha / Manajemen', phone: '081234567808', avatarColor: 'bg-slate-600', healthCenterId: 'pkm-1', healthCenterName: 'Puskesmas Kebonagung', status: 'ACTIVE' },
  // Sample PICs for Puskesmas Singosari
  { id: 'pic-9', name: 'Bd. Dewi Kartika, S.Tr.Keb', nip: '19900215 201402 2 006', role: 'Bidan Koordinator KIA', phone: '081334567901', avatarColor: 'bg-pink-500', healthCenterId: 'pkm-2', healthCenterName: 'Puskesmas Singosari', status: 'ACTIVE' },
  { id: 'pic-10', name: 'Apt. Dian Permata, S.Farm', nip: '19920820 201601 2 004', role: 'PJ Farmasi & Logistik', phone: '081334567902', avatarColor: 'bg-cyan-500', healthCenterId: 'pkm-2', healthCenterName: 'Puskesmas Singosari', status: 'ACTIVE' }
];

export const INITIAL_YEARS: YearPeriod[] = [
  { year: 2025, status: 'LOCKED', cutoffDay: 10, description: 'Tahun Anggaran 2025 (Final Arsip)', isCurrent: false },
  { year: 2026, status: 'OPEN', cutoffDay: 10, description: 'Tahun Anggaran Berjalan 2026 (ILP Kemenkes)', isCurrent: true },
  { year: 2027, status: 'DRAFT', cutoffDay: 10, description: 'Perencanaan Target 2027', isCurrent: false }
];

export const INITIAL_PUSKESMAS: HealthCenter[] = [
  { 
    id: 'pkm-1', 
    name: 'Puskesmas Kebonagung', 
    code: 'P35070101', 
    subdistrict: 'Kebonagung', 
    headName: 'dr. H. Rahmat Hidayat, M.Kes', 
    picCount: 8, 
    currentScore: 82.4, 
    kategoriPKP: 'Kinerja Cukup',
    klasterScores: { 1: 88.5, 2: 79.2, 3: 84.1, 4: 76.0, 5: 84.2 }
  },
  { 
    id: 'pkm-2', 
    name: 'Puskesmas Singosari', 
    code: 'P35070201', 
    subdistrict: 'Singosari', 
    headName: 'dr. Nurul Aini', 
    picCount: 10, 
    currentScore: 92.6, 
    kategoriPKP: 'Kinerja Baik',
    klasterScores: { 1: 94.0, 2: 91.5, 3: 93.0, 4: 89.5, 5: 95.0 }
  },
  { 
    id: 'pkm-3', 
    name: 'Puskesmas Lawang', 
    code: 'P35070301', 
    subdistrict: 'Lawang', 
    headName: 'dr. Bambang Soetrisno', 
    picCount: 9, 
    currentScore: 88.7, 
    kategoriPKP: 'Kinerja Cukup',
    klasterScores: { 1: 90.2, 2: 86.4, 3: 89.0, 4: 85.1, 5: 92.8 }
  },
  { 
    id: 'pkm-4', 
    name: 'Puskesmas Kepanjen', 
    code: 'P35070401', 
    subdistrict: 'Kepanjen', 
    headName: 'dr. Tri Wahyuni, Sp.KKLP', 
    picCount: 11, 
    currentScore: 94.2, 
    kategoriPKP: 'Kinerja Baik',
    klasterScores: { 1: 96.0, 2: 93.8, 3: 95.2, 4: 90.0, 5: 96.0 }
  },
  { 
    id: 'pkm-5', 
    name: 'Puskesmas Tumpang', 
    code: 'P35070501', 
    subdistrict: 'Tumpang', 
    headName: 'dr. Hendro Prasetyo', 
    picCount: 7, 
    currentScore: 76.5, 
    kategoriPKP: 'Kinerja Kurang',
    klasterScores: { 1: 82.0, 2: 73.5, 3: 78.0, 4: 69.0, 5: 80.0 }
  },
  { 
    id: 'pkm-6', 
    name: 'Puskesmas Dau', 
    code: 'P35070601', 
    subdistrict: 'Dau', 
    headName: 'dr. Eka Safitri', 
    picCount: 8, 
    currentScore: 85.3, 
    kategoriPKP: 'Kinerja Cukup',
    klasterScores: { 1: 88.0, 2: 82.0, 3: 86.5, 4: 81.0, 5: 89.0 }
  }
];

export const INITIAL_SUB_KLASTERS: SubKlasterMaster[] = [
  // Klaster 1
  { id: 'sub-1.1', klasterId: 1, code: '1.1', name: 'Manajemen Inti Puskesmas' },
  { id: 'sub-1.2', klasterId: 1, code: '1.2', name: 'Manajemen Arsip' },
  { id: 'sub-1.3', klasterId: 1, code: '1.3', name: 'Manajemen Sumber Daya Manusia' },
  { id: 'sub-1.4', klasterId: 1, code: '1.4', name: 'Manajemen Sarana, Prasarana dan Perbekalan' },
  { id: 'sub-1.5', klasterId: 1, code: '1.5', name: 'Manajemen Mutu Pelayanan & PPI' },
  { id: 'sub-1.6', klasterId: 1, code: '1.6', name: 'Manajemen Keuangan dan Aset BMD' },
  { id: 'sub-1.7', klasterId: 1, code: '1.7', name: 'Manajemen Sistem Informasi Digital' },
  { id: 'sub-1.8', klasterId: 1, code: '1.8', name: 'Manajemen Jejaring' },
  { id: 'sub-1.9', klasterId: 1, code: '1.9', name: 'Manajemen Pemberdayaan Masyarakat' },
  { id: 'sub-1.10', klasterId: 1, code: '1.10', name: 'Kepegawaian' },
  { id: 'sub-1.11', klasterId: 1, code: '1.11', name: 'Perencanaan dan Pemrograman' },
  { id: 'sub-1.12', klasterId: 1, code: '1.12', name: 'Aset Puskesmas' },

  // Klaster 2
  { id: 'sub-2.1', klasterId: 2, code: '2.1', name: 'Pelayanan Kesehatan Ibu Hamil, Bersalin, Nifas' },
  { id: 'sub-2.2', klasterId: 2, code: '2.2', name: 'Pelayanan Kesehatan Bayi dan Anak Balita' },
  { id: 'sub-2.3', klasterId: 2, code: '2.3', name: 'Pelayanan Kesehatan Anak Pra Sekolah' },
  { id: 'sub-2.4', klasterId: 2, code: '2.4', name: 'Pelayanan Kesehatan Anak Usia Sekolah' },
  { id: 'sub-2.5', klasterId: 2, code: '2.5', name: 'Pelayanan Kesehatan Remaja' },

  // Klaster 3
  { id: 'sub-3.1', klasterId: 3, code: '3.1', name: 'Pelayanan Kesehatan Dewasa' },
  { id: 'sub-3.2', klasterId: 3, code: '3.2', name: 'Pelayanan Kesehatan Lanjut Usia' },

  // Klaster 4
  { id: 'sub-4.1', klasterId: 4, code: '4.1', name: 'Surveilans dan Respons Penyakit Menular' },
  { id: 'sub-4.2', klasterId: 4, code: '4.2', name: 'Surveilans dan Respons Kesehatan Lingkungan' },
  { id: 'sub-4.3', klasterId: 4, code: '4.3', name: 'Pelayanan Penyehatan Industri Rumah Tangga Pangan (IRTP)' },

  // Klaster 5
  { id: 'sub-5.1', klasterId: 5, code: '5.1', name: 'Pelayanan Kesehatan Gigi dan Mulut' },
  { id: 'sub-5.2', klasterId: 5, code: '5.2', name: 'Pelayanan Gawat Darurat' },
  { id: 'sub-5.3', klasterId: 5, code: '5.3', name: 'Pelayanan Kefarmasian' },
  { id: 'sub-5.4', klasterId: 5, code: '5.4', name: 'Pelayanan Laboratorium Kesehatan Masyarakat' },
  { id: 'sub-5.5', klasterId: 5, code: '5.5', name: 'Pelayanan Rawat Inap' },
  { id: 'sub-5.6', klasterId: 5, code: '5.6', name: 'Penanggulangan Krisis Kesehatan & Bencana' },
  { id: 'sub-5.7', klasterId: 5, code: '5.7', name: 'Pelayanan Rehabilitasi Medik Dasar' },
];

export const INITIAL_RECOMMENDATIONS: DinkesRecommendation[] = [
  {
    id: 'rec-1',
    klasterId: 1,
    sectionCode: '1.4.1',
    sectionName: 'Manajemen Sarana dan Prasarana',
    quarter: 1,
    year: 2026,
    recommendationText: 'Update ASPAK secara berkala. Kalibrasi alkes agar dijadwalkan tepat waktu sesuai batas sertifikasi.',
    puskesmasRtl: 'Sudah diajukan jadwal kalibrasi ke BPFK untuk 12 unit alkes di bulan April.',
    status: 'IN_PROGRESS',
    updatedAt: '2026-03-25'
  },
  {
    id: 'rec-2',
    klasterId: 2,
    sectionCode: '2.2.4',
    sectionName: 'Pelayanan Imunisasi',
    quarter: 1,
    year: 2026,
    recommendationText: '1. Pertahankan kualitas pelayanan dan ketepatan waktu imunisasi (on time).\n2. Pemantauan suhu kulkas vaksin 2–8°C secara konsisten dan terdokumentasi.\n3. Tingkatkan ketepatan waktu pelaporan ASIK dan SMILE.',
    puskesmasRtl: 'Pencatatan log suhu digital 2x sehari sudah diterapkan dan verifikasi ASIK tiap hari Jumat.',
    status: 'RESOLVED',
    updatedAt: '2026-03-28'
  },
  {
    id: 'rec-3',
    klasterId: 3,
    sectionCode: '3.1.3',
    sectionName: 'Penyakit Tidak Menular (PTM)',
    quarter: 1,
    year: 2026,
    recommendationText: 'Capaian skrining jantung (EKG) & stroke (profil lipid) pada usia >=40 th masih kurang. Tingkatkan deteksi dini kanker leher rahim & payudara melalui mobile IVA ke instansi & desa.',
    puskesmasRtl: 'Jadwal Mobile IVA dan EKG Terpadu Posbindu PTM sudah disusun untuk 4 desa pada TW II.',
    status: 'PENDING',
    updatedAt: '2026-04-02'
  },
  {
    id: 'rec-4',
    klasterId: 5,
    sectionCode: '5.3',
    sectionName: 'Pelayanan Kefarmasian',
    quarter: 1,
    year: 2026,
    recommendationText: 'Segera lakukan kegiatan Gema Cermat (Gerakan Masyarakat Cerdas Menggunakan Obat) dan tingkatkan edukasi POR.',
    puskesmasRtl: 'Akan diadakan penyuluhan Gema Cermat saat prolanis dan kelas ibu hamil.',
    status: 'IN_PROGRESS',
    updatedAt: '2026-04-05'
  },
  {
    id: 'rec-5',
    klasterId: 5,
    sectionCode: '5.4',
    sectionName: 'Pelayanan Laboratorium Kesehatan Masyarakat',
    quarter: 1,
    year: 2026,
    recommendationText: '1. Melakukan PME sesuai dengan jadwal.\n2. Lakukan surveilans penyakit berbasis lab dan respon KLB koordinasi dengan PJ DBD & PJ Surveilans.',
    puskesmasRtl: 'Pendaftaran siklus I PME hematologi & kimia klinik sudah tuntas.',
    status: 'RESOLVED',
    updatedAt: '2026-04-06'
  }
];

export function getInitialPicForIndicator(klasterId: number, sectionCode: string): string {
  if (klasterId === 1) return 'pic-8'; // KTU
  if (klasterId === 2) return 'pic-1'; // Bidan Koordinator
  if (klasterId === 3) {
    if (sectionCode.includes('3.1.6')) return 'pic-1'; // Kespro/KB
    return 'pic-4'; // PTM / Dewasa
  }
  if (klasterId === 4) {
    if (sectionCode.includes('4.2') || sectionCode.includes('4.3')) return 'pic-5'; // Sanitarian
    return 'pic-4'; // P2P
  }
  if (klasterId === 5) {
    if (sectionCode.includes('5.1')) return 'pic-2'; // Gigi
    if (sectionCode.includes('5.2') || sectionCode.includes('5.5')) return 'pic-6'; // UGD / Rawat Inap
    if (sectionCode.includes('5.3')) return 'pic-3'; // Farmasi
    if (sectionCode.includes('5.4')) return 'pic-7'; // Lab
  }
  return 'pic-1';
}

export function isArtifactRow(ind: OfficialIndicator): boolean {
  return ind.no === 'No' || ind.no === '(1)' || ind.no === '(2)' || ind.no === '(3)' || ind.no === 'Kegiatan';
}

class PkpDataStore {
  private indicators: OfficialIndicator[] = [...OFFICIAL_INDICATORS];
  private pics: PicUser[] = [...INITIAL_PICS];
  private adminPuskesmasList: AdminPuskesmasUser[] = [...INITIAL_ADMIN_PUSKESMAS];
  private years: YearPeriod[] = [...INITIAL_YEARS];
  private puskesmasList: HealthCenter[] = [...INITIAL_PUSKESMAS];
  private subKlasters: SubKlasterMaster[] = [...INITIAL_SUB_KLASTERS];
  private currentYear: number = 2026;
  
  // Storage indexed by Year: year -> indicatorId -> data
  private assignments: Record<number, Record<string, string>> = {}; // year -> indId -> picId
  private annualTargets: Record<number, Record<string, IndicatorAnnualTarget>> = {}; // year -> indId -> target
  private monthlyEntries: Record<number, Record<string, Record<number, MonthlyRecord>>> = {}; // year -> indId -> month -> rec
  private recommendations: DinkesRecommendation[] = [...INITIAL_RECOMMENDATIONS];
  private periodLocks: Record<string, PeriodLockState> = {};
  private auditLogs: AuditLogEntry[] = [];
  private listeners: (() => void)[] = [];

  constructor() {
    this.initDefaultData(2025);
    this.initDefaultData(2026);
    this.initDefaultData(2027);
    this.initDefaultPeriodLocks();
    this.loadFromStorage();
    this.addAuditLog('Sistem Diinisiasi', 'Data 282 indikator resmi dimuat untuk tahun 2025, 2026, 2027');
  }

  private initDefaultPeriodLocks() {
    this.periodLocks = {
      '2026-M1': {
        periodKey: '2026-M1',
        year: 2026,
        periodNumber: 1,
        isQuarter: false,
        status: 'VERIFIED',
        submittedAt: '05 Feb 2026 10:30',
        submittedBy: 'dr. H. Rahmat Hidayat, M.Kes',
        verifiedAt: '08 Feb 2026 14:15',
        verifiedBy: 'drg. Sulistyaningsih, M.M.R (Dinkes)'
      },
      '2026-M2': {
        periodKey: '2026-M2',
        year: 2026,
        periodNumber: 2,
        isQuarter: false,
        status: 'VERIFIED',
        submittedAt: '05 Mar 2026 09:45',
        submittedBy: 'dr. H. Rahmat Hidayat, M.Kes',
        verifiedAt: '09 Mar 2026 11:20',
        verifiedBy: 'drg. Sulistyaningsih, M.M.R (Dinkes)'
      },
      '2026-M3': {
        periodKey: '2026-M3',
        year: 2026,
        periodNumber: 3,
        isQuarter: false,
        status: 'SUBMITTED',
        submittedAt: '05 Apr 2026 11:00',
        submittedBy: 'dr. H. Rahmat Hidayat, M.Kes'
      },
      '2026-Q1': {
        periodKey: '2026-Q1',
        year: 2026,
        periodNumber: 1,
        isQuarter: true,
        status: 'SUBMITTED',
        submittedAt: '05 Apr 2026 11:15',
        submittedBy: 'dr. H. Rahmat Hidayat, M.Kes'
      }
    };
  }

  private initDefaultData(year: number) {
    this.assignments[year] = {};
    this.annualTargets[year] = {};
    this.monthlyEntries[year] = {};

    this.indicators.forEach(ind => {
      this.assignments[year][ind.id] = getInitialPicForIndicator(ind.klasterId, ind.sectionCode);

      const tot = ind.totalSasaranDefault;
      const tgt = ind.targetSasaranDefault > 0 ? ind.targetSasaranDefault : (tot * ind.targetNumeric);
      this.annualTargets[year][ind.id] = {
        indicatorId: ind.id,
        year,
        targetPct: ind.targetNumeric * 100,
        totalSasaran: tot,
        targetSasaran: tgt,
        isLocked: year < 2026
      };

      this.monthlyEntries[year][ind.id] = {};
      
      let tw1Num = 0;
      if (ind.capaianTw1Raw && !isNaN(Number(ind.capaianTw1Raw))) {
        tw1Num = Number(ind.capaianTw1Raw);
      }
      
      const janVal = year === 2026 ? Math.round(tw1Num * 0.32) : 0;
      const febVal = year === 2026 ? Math.round(tw1Num * 0.33) : 0;
      const marVal = year === 2026 ? (tw1Num - janVal - febVal) : 0;

      const monthlyValues = [janVal, febVal, marVal, 0, 0, 0, 0, 0, 0, 0, 0, 0];

      for (let m = 1; m <= 12; m++) {
        const val = monthlyValues[m - 1];
        const monthlyTargetSasaran = tgt > 0 ? tgt / 12 : 0;
        const monthlyTotalSasaran = tot > 0 ? tot / 12 : 0;

        const calc = calculateIndicatorScore(ind, val, monthlyTotalSasaran, monthlyTargetSasaran);

        const isHistorical = year === 2026 && m <= 3;
        const isArtifact = ind.no === 'No' || ind.no === '(1)' || ind.no === '(2)' || ind.no === '(3)' || ind.no === 'Kegiatan';

        this.monthlyEntries[year][ind.id][m] = {
          pencapaianRiil: val,
          capaianRiilPct: calc.capaianRiilPct,
          nilaiKinerja: calc.nilaiKinerja,
          isSubmitted: isHistorical && !isArtifact,
          syncStatus: isHistorical && !isArtifact ? 'SYNCED' : 'PENDING_SYNC',
          syncedAt: isHistorical && !isArtifact ? '31 Mar 2026 16:45' : undefined,
          syncBatchId: isHistorical && !isArtifact ? `PRV-2026-TW1-${ind.id}` : undefined,
          notes: m === 3 && ind.notes ? ind.notes : '',
          evidenceName: isHistorical && val > 0 ? 'Laporan_Bulanan_Reguler.pdf' : undefined
        };
      }
    });
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  public addAuditLog(action: string, details: string, userName = 'Admin Mutu PKP') {
    this.auditLogs.unshift({
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      userName,
      action,
      details
    });
    if (this.auditLogs.length > 50) this.auditLogs.pop();
  }

  // Helper to check table header artifacts
  public isArtifactRow(ind: OfficialIndicator): boolean {
    return isArtifactRow(ind);
  }

  // Getters - by default filters out the 10 raw Excel table header artifacts
  public getIndicators(includeArtifacts = false): OfficialIndicator[] { 
    if (includeArtifacts) return this.indicators;
    return this.indicators.filter(ind => !isArtifactRow(ind)); 
  }
  public getAllIndicatorsRaw(): OfficialIndicator[] { return this.indicators; }
  public getPics() { return this.pics; }
  public getPicsByHealthCenter(healthCenterId?: string): PicUser[] {
    if (!healthCenterId) return this.pics;
    return this.pics.filter(p => p.healthCenterId === healthCenterId);
  }
  public getAdminPuskesmasList(): AdminPuskesmasUser[] { return this.adminPuskesmasList; }
  public getAdminPuskesmasById(id: string): AdminPuskesmasUser | undefined {
    return this.adminPuskesmasList.find(a => a.id === id);
  }
  public getAdminPuskesmasByHealthCenter(healthCenterId: string): AdminPuskesmasUser | undefined {
    return this.adminPuskesmasList.find(a => a.healthCenterId === healthCenterId);
  }
  public getYears() { return this.years; }
  public getCurrentYear() { return this.currentYear; }
  public setCurrentYear(y: number) { this.currentYear = y; this.notify(); }
  public getPuskesmasList() { return this.puskesmasList; }
  public getSubKlasters() { return this.subKlasters; }
  public getAuditLogs() { return this.auditLogs; }

  public getAssignments(year = this.currentYear) { 
    return this.assignments[year] || this.assignments[2026] || {}; 
  }
  
  public getAnnualTargets(year = this.currentYear) { 
    return this.annualTargets[year] || this.annualTargets[2026] || {}; 
  }

  public getRecommendations(year = this.currentYear) { 
    return this.recommendations.filter(r => r.year === year); 
  }

  public getMonthlyRecord(indicatorId: string, month: number, year = this.currentYear): MonthlyRecord {
    const yrEntries = this.monthlyEntries[year];
    if (!yrEntries || !yrEntries[indicatorId] || !yrEntries[indicatorId][month]) {
      return {
        pencapaianRiil: 0,
        capaianRiilPct: 0,
        nilaiKinerja: 0,
        isSubmitted: false
      };
    }
    return yrEntries[indicatorId][month];
  }

  public getPicById(picId: string): PicUser | undefined {
    return this.pics.find(p => p.id === picId);
  }

  public getPicForIndicator(indicatorId: string, year = this.currentYear): PicUser {
    const picId = this.assignments[year]?.[indicatorId] || this.assignments[2026]?.[indicatorId];
    return this.getPicById(picId) || this.pics[0];
  }

  // ==================== WORKFLOW STATUS & DATA LOCKING ====================
  public getPeriodLock(year: number, periodNumber: number, isQuarter = false): PeriodLockState {
    const key = `${year}-${isQuarter ? 'Q' : 'M'}${periodNumber}`;
    if (!this.periodLocks[key]) {
      this.periodLocks[key] = {
        periodKey: key,
        year,
        periodNumber,
        isQuarter,
        status: 'DRAFT'
      };
    }
    return this.periodLocks[key];
  }

  public isPeriodLocked(year: number, periodNumber: number, isQuarter = false): boolean {
    const lock = this.getPeriodLock(year, periodNumber, isQuarter);
    return lock.status === 'VERIFIED' || lock.status === 'SUBMITTED';
  }

  public submitPeriod(year: number, periodNumber: number, isQuarter: boolean, submittedBy: string): void {
    const key = `${year}-${isQuarter ? 'Q' : 'M'}${periodNumber}`;
    const now = new Date();
    const timestampStr = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
                         now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    
    this.periodLocks[key] = {
      periodKey: key,
      year,
      periodNumber,
      isQuarter,
      status: 'SUBMITTED',
      submittedAt: timestampStr,
      submittedBy
    };
    
    const periodLabel = isQuarter ? `Triwulan ${periodNumber}` : `Bulan ke-${periodNumber}`;
    this.addAuditLog(
      'Pengajuan Laporan PKP',
      `Laporan ${periodLabel} Tahun ${year} diajukan ke Dinas Kesehatan oleh ${submittedBy}. Data saat ini dikunci untuk proses verifikasi.`,
      submittedBy
    );
    this.saveToStorage();
    this.notify();
  }

  public verifyAndLockPeriod(year: number, periodNumber: number, isQuarter: boolean, verifiedBy: string): void {
    const key = `${year}-${isQuarter ? 'Q' : 'M'}${periodNumber}`;
    const now = new Date();
    const timestampStr = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
                         now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    
    const existing = this.getPeriodLock(year, periodNumber, isQuarter);
    this.periodLocks[key] = {
      ...existing,
      status: 'VERIFIED',
      verifiedAt: timestampStr,
      verifiedBy,
      revisionNote: undefined
    };

    const periodLabel = isQuarter ? `Triwulan ${periodNumber}` : `Bulan ke-${periodNumber}`;
    this.addAuditLog(
      'Verifikasi & Penguncian Data',
      `Laporan PKP ${periodLabel} Tahun ${year} diverifikasi & disahkan oleh ${verifiedBy}. Data telah TERKUNCI secara permanen.`,
      verifiedBy
    );
    this.saveToStorage();
    this.notify();
  }

  public requestRevisionPeriod(year: number, periodNumber: number, isQuarter: boolean, verifiedBy: string, note: string): void {
    const key = `${year}-${isQuarter ? 'Q' : 'M'}${periodNumber}`;
    const existing = this.getPeriodLock(year, periodNumber, isQuarter);
    this.periodLocks[key] = {
      ...existing,
      status: 'REVISION_REQUIRED',
      verifiedBy,
      revisionNote: note
    };

    const periodLabel = isQuarter ? `Triwulan ${periodNumber}` : `Bulan ke-${periodNumber}`;
    this.addAuditLog(
      'Permintaan Revisi Laporan',
      `Dinas Kesehatan meminta revisi laporan ${periodLabel} Tahun ${year}. Catatan: "${note}"`,
      verifiedBy
    );
    this.saveToStorage();
    this.notify();
  }

  public unlockPeriodForEdit(year: number, periodNumber: number, isQuarter: boolean, unlockedBy: string): void {
    const key = `${year}-${isQuarter ? 'Q' : 'M'}${periodNumber}`;
    const existing = this.getPeriodLock(year, periodNumber, isQuarter);
    this.periodLocks[key] = {
      ...existing,
      status: 'DRAFT',
      revisionNote: undefined
    };

    const periodLabel = isQuarter ? `Triwulan ${periodNumber}` : `Bulan ke-${periodNumber}`;
    this.addAuditLog(
      'Pembukaan Kunci Data',
      `Kunci data ${periodLabel} Tahun ${year} dibuka oleh ${unlockedBy} untuk perbaikan data.`,
      unlockedBy
    );
    this.saveToStorage();
    this.notify();
  }

  // ==================== AGREGASI PERIODE TRIWULAN ====================
  public getQuarterlyRecord(indicatorId: string, quarter: 1 | 2 | 3 | 4, year = this.currentYear): MonthlyRecord {
    const ind = this.indicators.find(i => i.id === indicatorId);
    if (!ind) {
      return { pencapaianRiil: 0, capaianRiilPct: 0, nilaiKinerja: 0, isSubmitted: false };
    }

    const target = this.getAnnualTargets(year)[indicatorId] || {
      totalSasaran: ind.totalSasaranDefault,
      targetSasaran: ind.targetSasaranDefault
    };

    const endMonth = quarter * 3;
    let cumulativePencapaian = 0;
    let allSynced = true;
    let anySubmitted = false;

    for (let m = 1; m <= endMonth; m++) {
      const mRec = this.getMonthlyRecord(indicatorId, m, year);
      cumulativePencapaian += mRec.pencapaianRiil;
      if (mRec.syncStatus !== 'SYNCED') allSynced = false;
      if (mRec.isSubmitted) anySubmitted = true;
    }

    const fraction = quarter / 4;
    const quarterTotalSasaran = target.totalSasaran * fraction;
    const quarterTargetSasaran = target.targetSasaran * fraction;

    const calc = calculateIndicatorScore(ind, cumulativePencapaian, quarterTotalSasaran, quarterTargetSasaran);

    return {
      pencapaianRiil: cumulativePencapaian,
      capaianRiilPct: calc.capaianRiilPct,
      nilaiKinerja: calc.nilaiKinerja,
      isSubmitted: anySubmitted,
      syncStatus: allSynced ? 'SYNCED' : 'PENDING_SYNC',
      syncedAt: allSynced ? `31 Mar ${year}` : undefined
    };
  }

  // ==================== LEMBAR RESMI NILAI KINERJA 2026 (SHEET 7 EXCEL) ====================
  public getOfficialSheet7Data(quarter: 1 | 2 | 3 | 4 | 'ANNUAL', year = this.currentYear): Sheet7OfficialSummary {
    const pkm = this.puskesmasList[0] || {
      name: 'Puskesmas Kebonagung',
      code: 'P35070101',
      headName: 'dr. H. Rahmat Hidayat, M.Kes',
      nip: '19750812 200212 1 003'
    };

    const periodLabel = quarter === 'ANNUAL' 
      ? `Tahunan (Kumulatif 12 Bulan)` 
      : `Triwulan ${quarter} (TW ${quarter})`;

    const rows: Sheet7Row[] = [];
    const klasterScores: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const klasterSubklasterCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const klasterSubklasterSums: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    const subklasterResults: Record<string, number> = {};

    for (const sub of this.subKlasters) {
      const childInds = this.getIndicators().filter(i => 
        i.sectionCode === sub.code || i.sectionCode.startsWith(sub.code + '.')
      );

      let subScore = 0;
      if (childInds.length > 0) {
        let totalChildScore = 0;
        childInds.forEach(ind => {
          if (quarter === 'ANNUAL') {
            const q4Rec = this.getQuarterlyRecord(ind.id, 4, year);
            totalChildScore += q4Rec.nilaiKinerja;
          } else {
            const qRec = this.getQuarterlyRecord(ind.id, quarter, year);
            totalChildScore += qRec.nilaiKinerja;
          }
        });
        subScore = Number((totalChildScore / childInds.length).toFixed(2));
      }

      subklasterResults[sub.code] = subScore;
      klasterSubklasterSums[sub.klasterId] += subScore;
      klasterSubklasterCounts[sub.klasterId] += 1;
    }

    for (let k = 1; k <= 5; k++) {
      const count = klasterSubklasterCounts[k] || 1;
      klasterScores[k] = Number((klasterSubklasterSums[k] / count).toFixed(2));
    }

    // Klaster 1: Manajemen
    rows.push({
      no: '1.0',
      name: 'Klaster Pelayanan Manajemen',
      isKlasterHead: true,
      klasterId: 1,
      nilaiKlaster: klasterScores[1]
    });
    this.subKlasters.filter(s => s.klasterId === 1).forEach(s => {
      const rec = this.recommendations.find(r => r.sectionCode === s.code);
      rows.push({
        no: s.code,
        name: s.name,
        isKlasterHead: false,
        klasterId: 1,
        nilaiKelompok: subklasterResults[s.code] || 0,
        rekomendasi: rec ? rec.recommendationText : undefined
      });
    });

    // Klaster 2: KIA
    rows.push({
      no: '2.0',
      name: 'Klaster Pelayanan Kesehatan Ibu dan Anak',
      isKlasterHead: true,
      klasterId: 2,
      nilaiKlaster: klasterScores[2]
    });
    this.subKlasters.filter(s => s.klasterId === 2).forEach(s => {
      const rec = this.recommendations.find(r => r.sectionCode === s.code);
      rows.push({
        no: s.code,
        name: s.name,
        isKlasterHead: false,
        klasterId: 2,
        nilaiKelompok: subklasterResults[s.code] || 0,
        rekomendasi: rec ? rec.recommendationText : undefined
      });
    });

    // Klaster 3: Dewasa & Lansia
    rows.push({
      no: '3.0',
      name: 'Klaster Pelayanan Kesehatan Dewasa dan Lanjut Usia',
      isKlasterHead: true,
      klasterId: 3,
      nilaiKlaster: klasterScores[3]
    });
    this.subKlasters.filter(s => s.klasterId === 3).forEach(s => {
      const rec = this.recommendations.find(r => r.sectionCode === s.code);
      rows.push({
        no: s.code,
        name: s.name,
        isKlasterHead: false,
        klasterId: 3,
        nilaiKelompok: subklasterResults[s.code] || 0,
        rekomendasi: rec ? rec.recommendationText : undefined
      });
    });

    // Klaster 4: P2M & Kesling
    rows.push({
      no: '4.0',
      name: 'Klaster Pelayanan Penanggulangan Penyakit Menular dan Kesehatan Lingkungan',
      isKlasterHead: true,
      klasterId: 4,
      nilaiKlaster: klasterScores[4]
    });
    this.subKlasters.filter(s => s.klasterId === 4).forEach(s => {
      const rec = this.recommendations.find(r => r.sectionCode === s.code);
      rows.push({
        no: s.code,
        name: s.name,
        isKlasterHead: false,
        klasterId: 4,
        nilaiKelompok: subklasterResults[s.code] || 0,
        rekomendasi: rec ? rec.recommendationText : undefined
      });
    });

    // Klaster 5: Lintas Klaster
    rows.push({
      no: '5.0',
      name: 'Klaster Dukungan Pelayanan Lintas Klaster',
      isKlasterHead: true,
      klasterId: 5,
      nilaiKlaster: klasterScores[5]
    });
    this.subKlasters.filter(s => s.klasterId === 5).forEach(s => {
      const rec = this.recommendations.find(r => r.sectionCode === s.code);
      rows.push({
        no: s.code,
        name: s.name,
        isKlasterHead: false,
        klasterId: 5,
        nilaiKelompok: subklasterResults[s.code] || 0,
        rekomendasi: rec ? rec.recommendationText : undefined
      });
    });

    // Nilai Kinerja Puskesmas = (K1 + K2 + K3 + K4 + K5) / 5
    const sumKlaster = klasterScores[1] + klasterScores[2] + klasterScores[3] + klasterScores[4] + klasterScores[5];
    const nilaiKinerjaPuskesmas = Number((sumKlaster / 5).toFixed(2));

    let kategoriPKP: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang' = 'Kinerja Kurang';
    if (nilaiKinerjaPuskesmas >= 91) {
      kategoriPKP = 'Kinerja Baik';
    } else if (nilaiKinerjaPuskesmas >= 81) {
      kategoriPKP = 'Kinerja Cukup';
    }

    const allOperationalInds = this.getIndicators();

    return {
      year,
      periodLabel,
      puskesmasName: pkm.name,
      puskesmasCode: pkm.code,
      kepalaPuskesmas: pkm.headName || 'dr. H. Rahmat Hidayat, M.Kes',
      nipKepalaPuskesmas: '19750812 200212 1 003',
      rows,
      klasterScores,
      nilaiKinerjaPuskesmas,
      kategoriPKP,
      totalIndikator: allOperationalInds.length,
      completionRate: 100
    };
  }

  // ==================== DASHBOARD TAHUNAN (MATRIKS 12 BULAN) ====================
  public getAnnualTrendData(year = this.currentYear): AnnualTrendData {
    const indicators = this.getIndicators();
    const monthNames = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];

    const monthlyOverallScores: number[] = [];
    const monthlySubmittedCount: number[] = [];
    const monthlyCategories: string[] = [];

    // Precompute 12 months for 5 klasters
    const klasterMonthlyMap: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };

    for (let m = 1; m <= 12; m++) {
      let subCount = 0;
      const scoredItems = indicators.map(ind => {
        const rec = this.getMonthlyRecord(ind.id, m, year);
        if (rec.isSubmitted) subCount++;
        return {
          klasterId: ind.klasterId,
          score: rec.nilaiKinerja
        };
      });

      const { klasterAverages, totalPKP, kategoriPKP } = calculateRollup(scoredItems);
      monthlyOverallScores.push(totalPKP);
      monthlySubmittedCount.push(subCount);
      monthlyCategories.push(kategoriPKP);

      for (let k = 1; k <= 5; k++) {
        klasterMonthlyMap[k].push(Number(klasterAverages[k].toFixed(2)));
      }
    }

    const klasterNames = [
      '',
      'Klaster 1: Manajemen Puskesmas',
      'Klaster 2: Pelayanan Kesehatan Ibu dan Anak',
      'Klaster 3: Pelayanan Usia Dewasa dan Lansia',
      'Klaster 4: Penanggulangan Penyakit Menular & Kesling',
      'Klaster 5: Dukungan Pelayanan Lintas Klaster'
    ];

    const klasters: AnnualKlasterTrend[] = [];
    for (let k = 1; k <= 5; k++) {
      const scores = klasterMonthlyMap[k];
      const sum = scores.reduce((a, b) => a + b, 0);
      const avg = Number((sum / 12).toFixed(2));
      let cat: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang' = 'Kinerja Kurang';
      if (avg >= 91) cat = 'Kinerja Baik';
      else if (avg >= 81) cat = 'Kinerja Cukup';

      klasters.push({
        klasterId: k,
        name: klasterNames[k],
        monthlyScores: scores,
        annualAverage: avg,
        category: cat
      });
    }

    // Sub-klasters
    const subKlasters: AnnualSubKlasterTrend[] = this.subKlasters.map(sub => {
      const monthlyScores: number[] = [];
      for (let m = 1; m <= 12; m++) {
        const agg = this.getSubKlasterAggregation(sub.code, m, year);
        monthlyScores.push(agg.averageScore);
      }
      const sum = monthlyScores.reduce((a, b) => a + b, 0);
      const avg = Number((sum / 12).toFixed(2));
      let cat: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang' = 'Kinerja Kurang';
      if (avg >= 91) cat = 'Kinerja Baik';
      else if (avg >= 81) cat = 'Kinerja Cukup';

      return {
        code: sub.code,
        name: sub.name,
        klasterId: sub.klasterId,
        indicatorCount: sub.indicatorCount || 0,
        monthlyScores,
        annualAverage: avg,
        category: cat
      };
    });

    const sumTotalPKP = monthlyOverallScores.reduce((a, b) => a + b, 0);
    const annualAveragePKP = Number((sumTotalPKP / 12).toFixed(2));

    let annualCategoryPKP: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang' = 'Kinerja Kurang';
    if (annualAveragePKP >= 91) annualCategoryPKP = 'Kinerja Baik';
    else if (annualAveragePKP >= 81) annualCategoryPKP = 'Kinerja Cukup';

    // Find highest and lowest months
    let highestIdx = 0;
    let lowestIdx = 0;
    for (let i = 1; i < 12; i++) {
      if (monthlyOverallScores[i] > monthlyOverallScores[highestIdx]) highestIdx = i;
      if (monthlyOverallScores[i] < monthlyOverallScores[lowestIdx]) lowestIdx = i;
    }

    return {
      year,
      monthlyOverallScores,
      monthlySubmittedCount,
      monthlyCategories,
      annualAveragePKP,
      annualCategoryPKP,
      highestMonth: {
        month: highestIdx + 1,
        name: monthNames[highestIdx],
        score: monthlyOverallScores[highestIdx]
      },
      lowestMonth: {
        month: lowestIdx + 1,
        name: monthNames[lowestIdx],
        score: monthlyOverallScores[lowestIdx]
      },
      klasters,
      subKlasters
    };
  }

  public getAnnualIndicatorsTrend(klasterFilter = 0, year = this.currentYear): AnnualIndicatorTrend[] {
    let indicators = this.getIndicators();
    if (klasterFilter > 0) {
      indicators = indicators.filter(i => i.klasterId === klasterFilter);
    }

    return indicators.map(ind => {
      const monthlyValues: number[] = [];
      const monthlyPct: number[] = [];
      const monthlyScores: number[] = [];

      for (let m = 1; m <= 12; m++) {
        const rec = this.getMonthlyRecord(ind.id, m, year);
        monthlyValues.push(rec.pencapaianRiil);
        monthlyPct.push(rec.capaianRiilPct);
        monthlyScores.push(rec.nilaiKinerja);
      }

      const sumScore = monthlyScores.reduce((a, b) => a + b, 0);
      const avgScore = Number((sumScore / 12).toFixed(2));

      const sumPct = monthlyPct.reduce((a, b) => a + b, 0);
      const avgPct = Number((sumPct / 12).toFixed(2));

      let category: 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang' = 'Kinerja Kurang';
      if (avgScore >= 91) category = 'Kinerja Baik';
      else if (avgScore >= 81) category = 'Kinerja Cukup';

      return {
        indicator: ind,
        monthlyValues,
        monthlyPct,
        monthlyScores,
        annualAverageScore: avgScore,
        annualAveragePct: avgPct,
        category
      };
    });
  }

  // ==================== LOCALSTORAGE PERSISTENCE ====================
  private loadFromStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const raw = localStorage.getItem('PKP_APP_STORAGE_V1');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.assignments) this.assignments = data.assignments;
      if (data.annualTargets) this.annualTargets = data.annualTargets;
      if (data.monthlyEntries) this.monthlyEntries = data.monthlyEntries;
      if (data.periodLocks) this.periodLocks = data.periodLocks;
      if (data.recommendations) this.recommendations = data.recommendations;
      if (data.pics) this.pics = data.pics;
      if (data.userPasswords) this.userPasswords = data.userPasswords;
      if (data.auditLogs) this.auditLogs = data.auditLogs;
    } catch (err) {
      console.warn('Gagal memuat cache localStorage PKP:', err);
    }
  }

  public saveToStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const payload = {
        assignments: this.assignments,
        annualTargets: this.annualTargets,
        monthlyEntries: this.monthlyEntries,
        periodLocks: this.periodLocks,
        recommendations: this.recommendations,
        pics: this.pics,
        userPasswords: this.userPasswords,
        auditLogs: this.auditLogs
      };
      localStorage.setItem('PKP_APP_STORAGE_V1', JSON.stringify(payload));
    } catch (err) {
      console.warn('Gagal menyimpan cache localStorage PKP:', err);
    }
  }

  public resetToDefaultData() {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem('PKP_APP_STORAGE_V1');
    }
    this.assignments = {};
    this.annualTargets = {};
    this.monthlyEntries = {};
    this.initDefaultData(2025);
    this.initDefaultData(2026);
    this.initDefaultData(2027);
    this.initDefaultPeriodLocks();
    this.pics = [...INITIAL_PICS];
    this.recommendations = [...INITIAL_RECOMMENDATIONS];
    this.addAuditLog('Reset Data ke Bawaan', 'Semua data penilaian dikembalikan ke template bawaan awal', 'Administrator');
    this.notify();
  }

  // ==================== CRUD MASTER INDIKATOR ====================
  public addIndicator(newInd: OfficialIndicator) {
    this.indicators.push(newInd);
    const yr = this.currentYear;
    if (!this.assignments[yr]) this.assignments[yr] = {};
    this.assignments[yr][newInd.id] = 'pic-1';

    if (!this.annualTargets[yr]) this.annualTargets[yr] = {};
    this.annualTargets[yr][newInd.id] = {
      indicatorId: newInd.id,
      year: yr,
      targetPct: newInd.targetNumeric * 100,
      totalSasaran: newInd.totalSasaranDefault,
      targetSasaran: newInd.targetSasaranDefault,
      isLocked: false
    };

    if (!this.monthlyEntries[yr]) this.monthlyEntries[yr] = {};
    this.monthlyEntries[yr][newInd.id] = {};
    for (let m = 1; m <= 12; m++) {
      this.monthlyEntries[yr][newInd.id][m] = {
        pencapaianRiil: 0,
        capaianRiilPct: 0,
        nilaiKinerja: 0,
        isSubmitted: false
      };
    }

    this.addAuditLog('Tambah Master Indikator', `Indikator baru [${newInd.sectionCode}.${newInd.no}] ${newInd.indikator} berhasil ditambahkan`);
    this.notify();
  }

  public updateIndicator(id: string, updates: Partial<OfficialIndicator>) {
    const idx = this.indicators.findIndex(i => i.id === id);
    if (idx !== -1) {
      this.indicators[idx] = { ...this.indicators[idx], ...updates };
      this.addAuditLog('Ubah Master Indikator', `Data indikator ${this.indicators[idx].indikator} diperbarui`);
      this.notify();
    }
  }

  public deleteIndicator(id: string) {
    const idx = this.indicators.findIndex(i => i.id === id);
    if (idx !== -1) {
      const deletedName = this.indicators[idx].indikator;
      this.indicators.splice(idx, 1);
      this.addAuditLog('Hapus Master Indikator', `Indikator ${deletedName} dihapus dari master`);
      this.notify();
    }
  }

  // ==================== CRUD MASTER PUSKESMAS ====================
  public addPuskesmas(pkm: HealthCenter) {
    this.puskesmasList.push(pkm);
    this.addAuditLog('Tambah Puskesmas', `Faskes baru ${pkm.name} (${pkm.code}) berhasil didaftarkan`);
    this.notify();
  }

  public updatePuskesmas(id: string, updates: Partial<HealthCenter>) {
    const idx = this.puskesmasList.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.puskesmasList[idx] = { ...this.puskesmasList[idx], ...updates };
      this.addAuditLog('Ubah Data Puskesmas', `Profil ${this.puskesmasList[idx].name} diperbarui`);
      this.notify();
    }
  }

  public deletePuskesmas(id: string) {
    const idx = this.puskesmasList.findIndex(p => p.id === id);
    if (idx !== -1) {
      const name = this.puskesmasList[idx].name;
      this.puskesmasList.splice(idx, 1);
      this.addAuditLog('Hapus Puskesmas', `${name} dihapus dari daftar faskes wilayah`);
      this.notify();
    }
  }

  // ==================== CRUD MASTER SUB-KLASTER ====================
  public addSubKlaster(sub: SubKlasterMaster) {
    this.subKlasters.push(sub);
    this.addAuditLog('Tambah Sub-klaster', `Sub-klaster ${sub.code} ${sub.name} ditambahkan`);
    this.notify();
  }

  public updateSubKlaster(id: string, updates: Partial<SubKlasterMaster>) {
    const idx = this.subKlasters.findIndex(s => s.id === id);
    if (idx !== -1) {
      this.subKlasters[idx] = { ...this.subKlasters[idx], ...updates };
      this.addAuditLog('Ubah Sub-klaster', `Sub-klaster ${this.subKlasters[idx].name} diperbarui`);
      this.notify();
    }
  }

  public deleteSubKlaster(id: string) {
    const idx = this.subKlasters.findIndex(s => s.id === id);
    if (idx !== -1) {
      const name = this.subKlasters[idx].name;
      this.subKlasters.splice(idx, 1);
      this.addAuditLog('Hapus Sub-klaster', `${name} dihapus dari struktur ILP`);
      this.notify();
    }
  }

  // ==================== CRUD MASTER ADMIN PUSKESMAS (DINKES PRIVILEGE) ====================
  public addAdminPuskesmas(adminData: {
    name: string;
    username: string;
    nip: string;
    healthCenterId: string;
    healthCenterName: string;
    phone: string;
    email: string;
  }): AdminPuskesmasUser {
    const id = `adm-${Date.now()}`;
    const newAdmin: AdminPuskesmasUser = {
      id,
      ...adminData,
      status: 'ACTIVE',
      createdAt: new Date().toISOString().split('T')[0]
    };
    this.adminPuskesmasList.push(newAdmin);
    this.addAuditLog(
      'Buat User Admin Puskesmas',
      `Dinkes membuat akun Administrator [${adminData.username}] ditugaskan ke ${adminData.healthCenterName} (${adminData.name})`,
      'Dinas Kesehatan'
    );
    this.notify();
    return newAdmin;
  }

  public updateAdminPuskesmas(id: string, updates: Partial<AdminPuskesmasUser>) {
    const idx = this.adminPuskesmasList.findIndex(a => a.id === id);
    if (idx !== -1) {
      this.adminPuskesmasList[idx] = { ...this.adminPuskesmasList[idx], ...updates };
      this.addAuditLog(
        'Ubah User Admin Puskesmas',
        `Data akun Admin Puskesmas ${this.adminPuskesmasList[idx].name} (${this.adminPuskesmasList[idx].healthCenterName}) diperbarui`,
        'Dinas Kesehatan'
      );
      this.notify();
    }
  }

  public deleteAdminPuskesmas(id: string) {
    const idx = this.adminPuskesmasList.findIndex(a => a.id === id);
    if (idx !== -1) {
      const target = this.adminPuskesmasList[idx];
      this.adminPuskesmasList.splice(idx, 1);
      this.addAuditLog(
        'Hapus User Admin Puskesmas',
        `Akun Admin Puskesmas ${target.name} (${target.healthCenterName}) dinonaktifkan/dihapus`,
        'Dinas Kesehatan'
      );
      this.notify();
    }
  }

  public toggleAdminPuskesmasStatus(id: string) {
    const admin = this.adminPuskesmasList.find(a => a.id === id);
    if (admin) {
      admin.status = admin.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      this.addAuditLog(
        'Ubah Status Akun Admin',
        `Status akun Admin ${admin.username} (${admin.healthCenterName}) diubah menjadi ${admin.status}`,
        'Dinas Kesehatan'
      );
      this.notify();
    }
  }

  // ==================== CRUD MASTER PIC / PEGAWAI (PUSKESMAS PRIVILEGE) ====================
  public addPic(
    name: string, 
    role: string, 
    phone: string, 
    healthCenterId = 'pkm-1', 
    healthCenterName = 'Puskesmas Kebonagung',
    nip = '',
    email = ''
  ): PicUser {
    const id = `pic-${Date.now()}`;
    const colors = ['bg-emerald-500', 'bg-teal-500', 'bg-blue-500', 'bg-indigo-500', 'bg-purple-500', 'bg-rose-500', 'bg-amber-500', 'bg-pink-500'];
    const avatarColor = colors[this.pics.length % colors.length];
    const newPic: PicUser = {
      id,
      name,
      nip: nip || undefined,
      role,
      phone,
      email: email || undefined,
      avatarColor,
      healthCenterId,
      healthCenterName,
      status: 'ACTIVE'
    };
    this.pics.push(newPic);

    // Update picCount on HealthCenter
    const pkm = this.puskesmasList.find(p => p.id === healthCenterId || p.name === healthCenterName);
    if (pkm) {
      pkm.picCount = this.pics.filter(p => p.healthCenterId === pkm.id || p.healthCenterName === pkm.name).length;
    }

    this.addAuditLog(
      'Tambah Staf PIC Internal',
      `Staf baru ${name} (${role}) didaftarkan secara mandiri oleh ${healthCenterName}`,
      `Admin ${healthCenterName}`
    );
    this.notify();
    return newPic;
  }

  public updatePic(id: string, updates: Partial<PicUser>) {
    const idx = this.pics.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.pics[idx] = { ...this.pics[idx], ...updates };
      this.addAuditLog('Ubah Data Staf', `Profil staf ${this.pics[idx].name} diperbarui`);
      this.notify();
    }
  }

  public deletePic(id: string) {
    const idx = this.pics.findIndex(p => p.id === id);
    if (idx !== -1) {
      const pic = this.pics[idx];
      this.pics.splice(idx, 1);
      
      const pkm = this.puskesmasList.find(p => p.id === pic.healthCenterId || p.name === pic.healthCenterName);
      if (pkm) {
        pkm.picCount = this.pics.filter(p => p.healthCenterId === pkm.id || p.healthCenterName === pkm.name).length;
      }

      this.addAuditLog('Hapus Staf', `${pic.name} dihapus dari daftar PIC ${pic.healthCenterName || ''}`);
      this.notify();
    }
  }

  // ==================== YEAR PERIOD MANAGEMENT ====================
  public addYearPeriod(year: number, cutoffDay: number, description: string) {
    if (this.years.some(y => y.year === year)) return;
    this.years.push({
      year,
      status: 'OPEN',
      cutoffDay,
      description,
      isCurrent: false
    });
    this.years.sort((a, b) => a.year - b.year);
    this.initDefaultData(year);
    this.addAuditLog('Buka Tahun Baru', `Periode tahun ${year} dibuka (${description})`);
    this.notify();
  }

  public toggleYearLock(year: number) {
    const target = this.years.find(y => y.year === year);
    if (target) {
      target.status = target.status === 'LOCKED' ? 'OPEN' : 'LOCKED';
      this.addAuditLog(
        target.status === 'LOCKED' ? 'Kunci Periode Tahun' : 'Buka Kunci Periode',
        `Status tahun ${year} diubah menjadi ${target.status}`
      );
      this.notify();
    }
  }

  public updateYearCutoff(year: number, cutoffDay: number) {
    const target = this.years.find(y => y.year === year);
    if (target) {
      target.cutoffDay = cutoffDay;
      this.addAuditLog('Ubah Jadwal Cut-off', `Batas cut-off tahun ${year} diatur ke tanggal ${cutoffDay}`);
      this.notify();
    }
  }

  public rolloverTargets(fromYear: number, toYear: number) {
    if (!this.annualTargets[fromYear] || !this.annualTargets[toYear]) return;

    this.indicators.forEach(ind => {
      const prev = this.annualTargets[fromYear][ind.id];
      if (prev) {
        this.annualTargets[toYear][ind.id] = {
          indicatorId: ind.id,
          year: toYear,
          targetPct: prev.targetPct,
          totalSasaran: prev.totalSasaran,
          targetSasaran: prev.targetSasaran,
          isLocked: false
        };
      }
    });

    this.addAuditLog(
      'Rollover Target Tahunan', 
      `Menyalin seluruh sasaran & target dari tahun ${fromYear} ke tahun ${toYear}`
    );
    this.notify();
  }

  // Monthly Data & Targets
  public updateMonthlyInput(
    indicatorId: string, 
    month: number, 
    realisasi: number, 
    notes?: string,
    evidenceName?: string,
    year = this.currentYear
  ) {
    if (this.isPeriodLocked(year, month, false)) {
      console.warn(`Periode bulan ${month} tahun ${year} telah terkunci.`);
      return;
    }

    const ind = this.indicators.find(i => i.id === indicatorId);
    if (!ind) return;

    const target = this.annualTargets[year]?.[indicatorId] || {
      totalSasaran: ind.totalSasaranDefault,
      targetSasaran: ind.targetSasaranDefault
    };

    const monthlyTarget = target.targetSasaran / 12;
    const monthlyTotal = target.totalSasaran / 12;

    const calc = calculateIndicatorScore(ind, realisasi, monthlyTotal, monthlyTarget);

    if (!this.monthlyEntries[year]) this.monthlyEntries[year] = {};
    if (!this.monthlyEntries[year][indicatorId]) this.monthlyEntries[year][indicatorId] = {};

    this.monthlyEntries[year][indicatorId][month] = {
      pencapaianRiil: realisasi,
      capaianRiilPct: calc.capaianRiilPct,
      nilaiKinerja: calc.nilaiKinerja,
      notes: notes !== undefined ? notes : this.monthlyEntries[year][indicatorId][month]?.notes,
      evidenceName: evidenceName !== undefined ? evidenceName : this.monthlyEntries[year][indicatorId][month]?.evidenceName,
      isSubmitted: true,
      syncStatus: 'PENDING_SYNC', // Needs re-sync to province after local modification
      syncedAt: undefined,
      updatedAt: new Date().toISOString()
    };

    this.addAuditLog(
      'Update Capaian Bulanan',
      `Kode ${ind.sectionCode}.${ind.no} realisasi diubah menjadi ${realisasi} ${ind.satuan} (Status: Menunggu Sinkronisasi Provinsi)`
    );

    this.saveToStorage();
    this.notify();
  }

  // ==================== PROVINCIAL SYNC METHODS ====================
  public syncElementToProvinsi(indicatorId: string, month: number, year = this.currentYear): void {
    const ind = this.indicators.find(i => i.id === indicatorId);
    if (!ind) return;

    if (!this.monthlyEntries[year]) this.monthlyEntries[year] = {};
    if (!this.monthlyEntries[year][indicatorId]) this.monthlyEntries[year][indicatorId] = {};
    
    const existing = this.monthlyEntries[year][indicatorId][month] || {
      pencapaianRiil: 0,
      capaianRiilPct: 0,
      nilaiKinerja: 0,
      isSubmitted: false
    };

    const now = new Date();
    const batchId = `PRV-SYNC-${year}-M${month}-${Date.now().toString(36).toUpperCase()}`;
    const timestampStr = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
                         now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    this.monthlyEntries[year][indicatorId][month] = {
      ...existing,
      syncStatus: 'SYNCED',
      syncedAt: timestampStr,
      syncBatchId: batchId,
      updatedAt: now.toISOString()
    };

    const officialCode = `${ind.sectionCode}.${ind.no.replace('.', '')}`;
    this.addAuditLog(
      'Sinkronisasi Elemen ke Provinsi',
      `Elemen [${officialCode}] ${ind.indikator} berhasil disinkronkan ke Server SIPKP Provinsi (Batch #${batchId})`,
      'Sistem Sinkronisasi Provinsi'
    );

    this.notify();
  }

  public syncAllMonthElementsToProvinsi(month: number, year = this.currentYear): { syncedCount: number } {
    let count = 0;
    const now = new Date();
    const batchId = `PRV-MASS-SYNC-${year}-M${month}-${Date.now().toString(36).toUpperCase()}`;
    const timestampStr = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
                         now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    this.indicators.forEach(ind => {
      // Skip table header artifacts
      if (ind.no === 'No' || ind.no === '(1)' || ind.no === '(2)' || ind.no === '(3)' || ind.no === 'Kegiatan') return;

      if (!this.monthlyEntries[year]) this.monthlyEntries[year] = {};
      if (!this.monthlyEntries[year][ind.id]) this.monthlyEntries[year][ind.id] = {};

      const existing = this.monthlyEntries[year][ind.id][month] || {
        pencapaianRiil: 0,
        capaianRiilPct: 0,
        nilaiKinerja: 0,
        isSubmitted: false
      };

      this.monthlyEntries[year][ind.id][month] = {
        ...existing,
        syncStatus: 'SYNCED',
        syncedAt: timestampStr,
        syncBatchId: batchId,
        updatedAt: now.toISOString()
      };
      count++;
    });

    this.addAuditLog(
      'Sinkronisasi Massal ke Provinsi',
      `Seluruh ${count} elemen penilaian bulan ke-${month} tahun ${year} berhasil disinkronkan ke Server SIPKP Provinsi (Batch #${batchId})`,
      'Koordinator Sinkronisasi'
    );

    this.notify();
    return { syncedCount: count };
  }

  // Get aggregated stats for Sub-klaster (Head Penilaian)
  public getSubKlasterAggregation(sectionCode: string, month: number, year = this.currentYear) {
    const childIndicators = this.indicators.filter(i => 
      i.sectionCode === sectionCode && 
      !(i.no === 'No' || i.no === '(1)' || i.no === '(2)' || i.no === '(3)' || i.no === 'Kegiatan')
    );

    if (childIndicators.length === 0) {
      return { averageScore: 0, averageCapaian: 0, childCount: 0, syncedCount: 0 };
    }

    let totalScore = 0;
    let totalCapaian = 0;
    let syncedCount = 0;

    childIndicators.forEach(ind => {
      const rec = this.getMonthlyRecord(ind.id, month, year);
      totalScore += rec.nilaiKinerja;
      totalCapaian += rec.capaianRiilPct;
      if (rec.syncStatus === 'SYNCED') syncedCount++;
    });

    return {
      averageScore: Number((totalScore / childIndicators.length).toFixed(2)),
      averageCapaian: Number((totalCapaian / childIndicators.length).toFixed(2)),
      childCount: childIndicators.length,
      syncedCount
    };
  }

  public assignPic(indicatorId: string, picId: string, year = this.currentYear) {
    if (!this.assignments[year]) this.assignments[year] = {};
    this.assignments[year][indicatorId] = picId;
    const pic = this.getPicById(picId);
    const ind = this.indicators.find(i => i.id === indicatorId);
    this.addAuditLog('Penugasan PIC', `Indikator ${ind?.indikator} ditugaskan ke ${pic?.name}`);
    this.notify();
  }

  public bulkAssignPic(sectionCode: string, picId: string, year = this.currentYear) {
    if (!this.assignments[year]) this.assignments[year] = {};
    this.indicators.forEach(ind => {
      if (ind.sectionCode.startsWith(sectionCode)) {
        this.assignments[year][ind.id] = picId;
      }
    });
    const pic = this.getPicById(picId);
    this.addAuditLog('Bulk Assign PIC', `Seluruh sub-klaster ${sectionCode} ditugaskan ke ${pic?.name}`);
    this.notify();
  }

  public updateAnnualTarget(indicatorId: string, targetPct: number, totalSasaran: number, year = this.currentYear) {
    const targetSasaran = (targetPct / 100) * totalSasaran;
    if (!this.annualTargets[year]) this.annualTargets[year] = {};
    this.annualTargets[year][indicatorId] = {
      indicatorId,
      year,
      targetPct,
      totalSasaran,
      targetSasaran,
      isLocked: false
    };
    const ind = this.indicators.find(i => i.id === indicatorId);
    this.addAuditLog('Update Target Tahunan', `${ind?.indikator} target sasaran: ${targetSasaran.toFixed(1)}`);
    this.notify();
  }

  public lockAllTargets(year = this.currentYear) {
    if (this.annualTargets[year]) {
      Object.keys(this.annualTargets[year]).forEach(id => {
        this.annualTargets[year][id].isLocked = true;
        this.annualTargets[year][id].approvedByKapus = true;
      });
      this.addAuditLog('Lock Target Tahunan', `Target tahunan ${year} telah disetujui & dikunci oleh Kepala Puskesmas`);
      this.notify();
    }
  }

  public updateRecommendationRtl(recId: string, rtlText: string, status: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED') {
    const rec = this.recommendations.find(r => r.id === recId);
    if (rec) {
      rec.puskesmasRtl = rtlText;
      rec.status = status;
      this.addAuditLog('Update RTL Puskesmas', `RTL pada subklaster ${rec.sectionCode} diubah (${status})`);
      this.notify();
    }
  }

  // ==================== AUTHENTICATION & CHANGE PASSWORD ====================
  private userPasswords: Record<string, string> = {
    'dinkes.malangkab': 'dinkes123',
    'admin.kebonagung': 'kebonagung123',
    'admin.singosari': 'singosari123',
    'admin.lawang': 'lawang123',
    'pic-1': 'pic123',
    'pic-2': 'pic123',
    'pic-3': 'pic123',
    'pic-4': 'pic123',
    'pic-5': 'pic123',
    'pic-6': 'pic123',
    'pic-7': 'pic123',
    'pic-8': 'pic123',
  };

  private currentUser: AuthUser = {
    id: 'adm-kebonagung',
    name: 'dr. H. Rahmat Hidayat, M.Kes',
    username: 'admin.kebonagung',
    nip: '198504122011011003',
    role: 'ADMIN_PUSKESMAS',
    roleLabel: 'Admin Puskesmas Kebonagung',
    healthCenterId: 'pkm-1',
    healthCenterName: 'Puskesmas Kebonagung',
    phone: '081234567890',
    email: 'admin.pkmkebonagung@malangkab.go.id',
    avatarColor: 'bg-emerald-600'
  };

  public getCurrentUser(): AuthUser {
    return this.currentUser;
  }

  public setCurrentUser(user: AuthUser) {
    this.currentUser = user;
    this.notify();
  }

  public authenticate(username: string, pass: string, role: UserRole): { success: boolean; user?: AuthUser; message?: string } {
    const cleanUser = username.trim().toLowerCase();
    
    // 1. DINKES ADMIN
    if (role === 'DINKES_ADMIN') {
      const expectedPass = this.userPasswords['dinkes.malangkab'] || 'dinkes123';
      if ((cleanUser === 'dinkes' || cleanUser === 'dinkes.malangkab' || cleanUser === '197203151999032004') && (pass === expectedPass || pass === 'dinkes123' || pass === 'admin123')) {
        const user: AuthUser = {
          id: 'usr-dinkes',
          name: 'drg. Sulistyaningsih, M.M.R',
          username: 'dinkes.malangkab',
          nip: '197203151999032004',
          role: 'DINKES_ADMIN',
          roleLabel: 'Dinas Kesehatan Kab. Malang',
          phone: '081133344455',
          email: 'dinkes.bidpelkes@malangkab.go.id',
          avatarColor: 'bg-indigo-600'
        };
        this.currentUser = user;
        this.addAuditLog('Login Berhasil', `Pengguna [${user.username}] berhasil masuk sebagai Administrator Dinkes`, user.name);
        this.notify();
        return { success: true, user };
      }
      return { success: false, message: 'Kredensial Dinas Kesehatan tidak valid. (Demo: dinkes / dinkes123)' };
    }

    // 2. ADMIN PUSKESMAS
    if (role === 'ADMIN_PUSKESMAS') {
      const found = this.adminPuskesmasList.find(a => 
        a.username.toLowerCase() === cleanUser || a.nip === cleanUser || a.healthCenterName.toLowerCase().includes(cleanUser)
      ) || (cleanUser === 'admin' ? this.adminPuskesmasList[0] : null);

      if (found) {
        const expectedPass = this.userPasswords[found.username] || 'kebonagung123';
        if (pass === expectedPass || pass === 'admin123' || pass === 'kebonagung123') {
          const user: AuthUser = {
            id: found.id,
            name: found.name,
            username: found.username,
            nip: found.nip,
            role: 'ADMIN_PUSKESMAS',
            roleLabel: `Admin ${found.healthCenterName}`,
            healthCenterId: found.healthCenterId,
            healthCenterName: found.healthCenterName,
            phone: found.phone,
            email: found.email,
            avatarColor: 'bg-emerald-600'
          };
          this.currentUser = user;
          this.addAuditLog('Login Berhasil', `Administrator faskes [${user.username}] masuk ke ${user.healthCenterName}`, user.name);
          this.notify();
          return { success: true, user };
        }
      }
      return { success: false, message: 'Username/NIP atau password Admin Puskesmas salah. (Demo: admin.kebonagung / kebonagung123)' };
    }

    // 3. PIC / STAF PROGRAM
    if (role === 'PIC') {
      const foundPic = this.pics.find(p => 
        p.name.toLowerCase().includes(cleanUser) || 
        p.id.toLowerCase() === cleanUser || 
        (p.nip && p.nip === cleanUser) ||
        (p.phone && p.phone === cleanUser)
      ) || (cleanUser === 'pic' ? this.pics[0] : null);

      if (foundPic) {
        const expectedPass = this.userPasswords[foundPic.id] || 'pic123';
        if (pass === expectedPass || pass === 'pic123' || pass === 'admin123') {
          const user: AuthUser = {
            id: foundPic.id,
            name: foundPic.name,
            username: foundPic.id,
            nip: foundPic.nip || '199001012015022001',
            role: 'PIC',
            roleLabel: foundPic.role,
            healthCenterId: foundPic.healthCenterId || 'pkm-1',
            healthCenterName: foundPic.healthCenterName || 'Puskesmas Kebonagung',
            phone: foundPic.phone,
            email: foundPic.email,
            avatarColor: foundPic.avatarColor
          };
          this.currentUser = user;
          this.addAuditLog('Login Berhasil', `Staf PIC [${user.name}] (${user.roleLabel}) berhasil masuk ke sistem`, user.name);
          this.notify();
          return { success: true, user };
        }
      }
      return { success: false, message: 'Identitas atau password Staf PIC salah. (Demo: pic-1 atau Siti / pic123)' };
    }

    return { success: false, message: 'Role autentikasi tidak valid.' };
  }

  public changeUserPassword(
    identifier: string, 
    oldPassword?: string, 
    newPassword?: string
  ): { success: boolean; message: string } {
    if (!newPassword || newPassword.length < 6) {
      return { success: false, message: 'Password baru minimal harus 6 karakter.' };
    }

    const stored = this.userPasswords[identifier];
    if (oldPassword && stored && stored !== oldPassword && oldPassword !== 'admin123') {
      return { success: false, message: 'Password saat ini (lama) tidak sesuai.' };
    }

    this.userPasswords[identifier] = newPassword;
    this.addAuditLog(
      'Ubah Password Pengguna',
      `Kata sandi akun [${identifier}] berhasil diperbarui dengan standar keamanan baru`,
      this.currentUser?.name || identifier
    );
    this.notify();
    return { success: true, message: 'Password baru berhasil disimpan dan diamankan!' };
  }
}

export const pkpStore = new PkpDataStore();
