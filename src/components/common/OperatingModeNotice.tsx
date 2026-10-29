import { useSyncExternalStore } from 'react';
import { pkpStore } from '../../services/apiStore';

export function OperatingModeNotice() {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const policy = pkpStore.getReportingPolicy();
  if (policy?.operatingMode !== 'INTERNAL_PHASED') return null;

  return <section aria-label="Mode operasional" className="mb-4 border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
    <h2 className="font-semibold text-slate-900">Operasional internal bertahap</h2>
    <p className="mt-1">Input bulanan dan rekap terkonfirmasi digunakan untuk evaluasi internal, bukan penilaian resmi Dinkes. Hak akses dan kunci periode tetap berlaku.</p>
    <details className="mt-2">
      <summary className="cursor-pointer text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">Panduan input dan batas penilaian</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Baca definisi operasional sebelum mengisi. Gunakan sasaran riil bulan tersebut untuk profil DO yang didukung.</li>
        <li>Untuk rekap Januari–akhir periode, gunakan Rekap Kumulatif &amp; Tahunan. Periksa sumber, sampel, periode dan duplikasi sebelum konfirmasi.</li>
        <li>Angka lengkap belum berarti penilaian tahunan lengkap. Rumus yang belum tersedia tidak diganti dengan satu rumus umum.</li>
        <li>Kategori lama hanya untuk kompatibilitas histori. Kategori resmi dan pengajuan baru 2026+ tetap ditahan.</li>
      </ol>
    </details>
  </section>;
}
