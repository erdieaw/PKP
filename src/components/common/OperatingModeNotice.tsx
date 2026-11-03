import { useSyncExternalStore } from 'react';
import { pkpStore } from '../../services/apiStore';

export function OperatingModeNotice() {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const policy = pkpStore.getReportingPolicy();
  if (policy?.operatingMode !== 'INTERNAL_PHASED') return null;

  return <section aria-label="Mode operasional" className="mb-4 border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
    <h2 className="font-semibold text-slate-900">Untuk evaluasi internal</h2>
    <p className="mt-1">Isian bulanan dan rekap yang Anda konfirmasi digunakan untuk evaluasi internal, bukan penilaian resmi Dinkes. Pengisian tetap mengikuti hak akses dan periode yang terbuka.</p>
    <details className="mt-2">
      <summary className="cursor-pointer text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">Panduan input dan batas penilaian</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Baca Definisi Operasional (DO) sebelum mengisi. Untuk perhitungan bulanan yang tersedia, gunakan sasaran riil pada bulan tersebut.</li>
        <li>Gunakan Rekap Kumulatif &amp; Tahunan untuk rekap Januari sampai akhir periode. Periksa sumber, sampel, periode, dan kemungkinan data ganda sebelum mengonfirmasi.</li>
        <li>Angka lengkap belum berarti penilaian tahunan lengkap. Cara hitung berbeda antarindikator; sebagian aturan sumber masih perlu klarifikasi dan belum dapat dihitung.</li>
        <li>Kategori lama tetap ditampilkan untuk membaca riwayat. Kategori resmi belum ditetapkan; pengajuan dan verifikasi baru untuk 2026 dan setelahnya belum dibuka.</li>
      </ol>
    </details>
  </section>;
}
