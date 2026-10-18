import React, { useState } from 'react';
import { pkpStore } from '../../services/mockState';
import { calculateRollup } from '../../services/pkpCalculator';
import { 
  FileSpreadsheet, 
  Printer, 
  Download, 
  CheckCircle2, 
  Building, 
  X,
  FileText
} from 'lucide-react';
import { ScoreBadge } from '../common/ScoreBadge';

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedMonth: number;
  puskesmasName: string;
}

export const ExportReportModal: React.FC<ExportReportModalProps> = ({
  isOpen,
  onClose,
  selectedMonth,
  puskesmasName
}) => {
  const [reportPeriod, setReportPeriod] = useState<string>('TW1');
  const [downloading, setDownloading] = useState<boolean>(false);
  const [downloaded, setDownloaded] = useState<boolean>(false);

  if (!isOpen) return null;

  const currentYear = pkpStore.getCurrentYear();
  const indicators = pkpStore.getIndicators();
  const scoredItems = indicators.map(ind => ({
    klasterId: ind.klasterId,
    score: pkpStore.getMonthlyRecord(ind.id, selectedMonth).nilaiKinerja
  }));
  const { klasterAverages, totalPKP, kategoriPKP } = calculateRollup(scoredItems);

  const handleExportExcel = () => {
    setDownloading(true);
    setTimeout(() => {
      setDownloading(false);
      setDownloaded(true);
      
      // Build real CSV content compatible with Excel and SIPKP format
      const headers = [
        "Kode Elemen",
        "Klaster",
        "Sub-klaster",
        "Kegiatan",
        "Indikator Kinerja",
        "Polaritas",
        "Satuan",
        "Target %",
        "Total Sasaran",
        "Target Sasaran Fisik",
        "Realisasi Fisik",
        "Capaian %",
        "Nilai Kinerja",
        "Status Mutu",
        "PIC Penanggung Jawab",
        "Status Sinkronisasi Provinsi",
        "Batch ID Transmisi",
        "Waktu Sinkronisasi"
      ];

      const rows = indicators.map(ind => {
        const rec = pkpStore.getMonthlyRecord(ind.id, selectedMonth);
        const tgt = pkpStore.getAnnualTargets()[ind.id] || {
          targetPct: ind.targetNumeric * 100,
          totalSasaran: ind.totalSasaranDefault,
          targetSasaran: ind.targetSasaranDefault
        };
        const pic = pkpStore.getPicForIndicator(ind.id);
        const officialCode = `${ind.sectionCode}.${ind.no.replace('.', '')}`;
        const statusMutu = rec.nilaiKinerja >= 91 ? 'Baik' : rec.nilaiKinerja >= 81 ? 'Cukup' : 'Kurang';

        return [
          `"${officialCode}"`,
          `"Klaster ${ind.klasterId}"`,
          `"${ind.section.replace(/"/g, '""')}"`,
          `"${ind.kegiatan.replace(/"/g, '""')}"`,
          `"${ind.indikator.replace(/"/g, '""')}"`,
          `"${ind.polarity}"`,
          `"${ind.satuan}"`,
          tgt.targetPct,
          tgt.totalSasaran,
          tgt.targetSasaran.toFixed(1),
          rec.pencapaianRiil,
          rec.capaianRiilPct,
          rec.nilaiKinerja,
          `"${statusMutu}"`,
          `"${pic.name} (${pic.role})"`,
          `"${rec.syncStatus || 'PENDING_SYNC'}"`,
          `"${rec.syncBatchId || '-'}"`,
          `"${rec.syncedAt || '-'}"`
        ].join(';');
      });

      const csvContent = "\uFEFF" + [headers.join(';'), ...rows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const element = document.createElement("a");
      element.href = URL.createObjectURL(blob);
      element.download = `LAPORAN_PKP_${puskesmasName.replace(/\s+/g, '_')}_${reportPeriod}_${currentYear}.csv`;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      setTimeout(() => setDownloaded(false), 3000);
    }, 800);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div 
        className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">
                Ekspor Laporan Penilaian Kinerja Puskesmas (PKP)
              </h3>
              <p className="text-[11px] text-slate-500">
                Format resmi kompatibel 7-Sheet Excel (Klaster 1 s/d 5, Rekomendasi, Nilai Kinerja) & PDF Berita Acara.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 text-xs">
          {/* Options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                Pilih Periode Laporan:
              </label>
              <select
                value={reportPeriod}
                onChange={(e) => setReportPeriod(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 font-bold text-slate-800"
              >
                <option value="TW1">Triwulan I (Januari - Maret)</option>
                <option value="TW2">Triwulan II (April - Juni)</option>
                <option value="TW3">Triwulan III (Juli - September)</option>
                <option value="TW4">Triwulan IV (Oktober - Desember)</option>
                <option value="TAHUNAN">Laporan Tahunan Lengkap (12 Bulan)</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                Fasilitas Pelayanan Kesehatan:
              </label>
              <div className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-bold text-slate-700">
                {puskesmasName} (TA {currentYear})
              </div>
            </div>
          </div>

          {/* Report Preview Document Card */}
          <div className="border border-slate-300 rounded-xl p-5 bg-white space-y-4 shadow-xs">
            <div className="text-center space-y-1 pb-3 border-b border-slate-200">
              <h4 className="font-extrabold text-sm text-slate-900 tracking-wide uppercase">
                PEMERINTAH KABUPATEN / KOTA
              </h4>
              <p className="font-bold text-xs text-slate-700">
                DINAS KESEHATAN • {puskesmasName.toUpperCase()}
              </p>
              <p className="text-[11px] text-slate-500">
                REKAPITULASI HASIL PENILAIAN KINERJA PUSKESMAS {reportPeriod} TAHUN {currentYear}
              </p>
            </div>

            {/* Table Summary of 5 Klasters */}
            <table className="w-full text-left border border-slate-200">
              <thead className="bg-slate-100 text-slate-700 font-bold">
                <tr>
                  <th className="py-2 px-3 border-b border-slate-200 w-16">No</th>
                  <th className="py-2 px-3 border-b border-slate-200">Klaster Pelayanan Integrasi Primer</th>
                  <th className="py-2 px-3 border-b border-slate-200 text-right w-36">Nilai Klaster</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                <tr>
                  <td className="py-1.5 px-3">1.0</td>
                  <td className="py-1.5 px-3 font-sans">Klaster Pelayanan Manajemen Puskesmas</td>
                  <td className="py-1.5 px-3 text-right font-bold">{klasterAverages[1].toFixed(2)}%</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3">2.0</td>
                  <td className="py-1.5 px-3 font-sans">Klaster Pelayanan Kesehatan Ibu dan Anak</td>
                  <td className="py-1.5 px-3 text-right font-bold">{klasterAverages[2].toFixed(2)}%</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3">3.0</td>
                  <td className="py-1.5 px-3 font-sans">Klaster Pelayanan Usia Dewasa dan Lanjut Usia</td>
                  <td className="py-1.5 px-3 text-right font-bold">{klasterAverages[3].toFixed(2)}%</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3">4.0</td>
                  <td className="py-1.5 px-3 font-sans">Klaster Penanggulangan Penyakit Menular & Kesling</td>
                  <td className="py-1.5 px-3 text-right font-bold">{klasterAverages[4].toFixed(2)}%</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3">5.0</td>
                  <td className="py-1.5 px-3 font-sans">Klaster Dukungan Pelayanan Lintas Klaster</td>
                  <td className="py-1.5 px-3 text-right font-bold">{klasterAverages[5].toFixed(2)}%</td>
                </tr>
                <tr className="bg-emerald-50/70 font-bold text-slate-900 border-t-2 border-slate-300">
                  <td className="py-2 px-3 text-center" colSpan={2}>
                    NILAI TOTAL KINERJA PUSKESMAS ({kategoriPKP.toUpperCase()})
                  </td>
                  <td className="py-2 px-3 text-right text-emerald-800 text-sm">
                    {totalPKP}%
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Signature Block */}
            <div className="grid grid-cols-2 pt-6 text-center text-[11px] text-slate-700">
              <div className="space-y-12">
                <p>Mengetahui,<br />Kepala {puskesmasName}</p>
                <p className="font-bold underline">dr. H. Rahmat Hidayat, M.Kes<br /><span className="font-normal font-mono text-[10px] no-underline">NIP. 19780512 200501 1 008</span></p>
              </div>
              <div className="space-y-12">
                <p>Tim Pembina & Penilai Mutu,<br />Dinas Kesehatan Kabupaten/Kota</p>
                <p className="font-bold underline">drg. Sulistyaningsih, M.M.R<br /><span className="font-normal font-mono text-[10px] no-underline">NIP. 19720315 199903 2 004</span></p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-slate-500">
              Menghasilkan berkas Excel terverifikasi 282 indikator.
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak / Cetak PDF</span>
              </button>

              <button
                onClick={handleExportExcel}
                disabled={downloading}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-2 shadow-sm transition-colors"
              >
                {downloading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Mempersiapkan XLSX...</span>
                  </>
                ) : downloaded ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                    <span>Berhasil Diunduh!</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Unduh Excel (7 Sheet)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
