import { pkpStore } from './apiStore';

export function monthPeriodLabel(year: number, month: number) {
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

export function getMonthlyInputBlockReason(year: number, month: number, indicatorId?: string): string | null {
  const user = pkpStore.getSessionUser();
  if (!user) return 'Sesi berakhir. Silakan masuk kembali.';
  if (user.role === 'DINKES_ADMIN') return 'Hanya baca: Dinkes meninjau capaian; input dilakukan Puskesmas.';
  const load = pkpStore.getLoadState();
  if (load.loading || load.error) return 'Input ditahan sampai data periode selesai dimuat. Coba muat ulang jika gagal.';
  const activeYear = pkpStore.getActivePeriod()?.year;
  if (!pkpStore.isActiveYear(year)) return activeYear == null
    ? 'Hanya baca: tahun aktif belum ditetapkan Dinkes.'
    : `Hanya baca: tahun input aktif ${activeYear}. Pilih tahun tersebut untuk mengisi.`;
  if (!pkpStore.canInputOwnPeriod(year)) return 'Hanya baca: pilih Puskesmas tempat Anda bertugas.';
  if (pkpStore.isPeriodLocked(year, month)) return `Hanya baca: periode ${monthPeriodLabel(year, month)} terkunci.`;
  if (user.role === 'PIC' && indicatorId && pkpStore.getAssignments(year)[indicatorId] !== user.id) {
    return 'Hanya baca: indikator ini tidak ditugaskan kepada Anda.';
  }
  if (user.role !== 'PIC' && user.role !== 'ADMIN_PUSKESMAS') return 'Hanya baca: akun ini tidak memiliki izin input.';
  return null;
}
