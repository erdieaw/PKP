import React, { useState, useSyncExternalStore } from 'react';
import { pkpStore } from '../../services/apiStore';
import { Download, FileSpreadsheet, Printer, X } from 'lucide-react';
import { useReportExport } from './useReportExport';

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedMonth: number;
  puskesmasName: string;
}

export const ExportReportModal: React.FC<ExportReportModalProps> = ({ isOpen, onClose, selectedMonth, puskesmasName }) => {
  const [reportPeriod, setReportPeriod] = useState<1 | 2 | 3 | 4 | 'ANNUAL'>(() => Math.ceil(selectedMonth / 3) as 1 | 2 | 3 | 4);
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const year = pkpStore.getCurrentYear();
  const scope = `${pkpStore.getSelectedHealthCenterId()}:${year}:${reportPeriod}`;
  const { create, pending, error, file } = useReportExport(scope, isOpen);
  if (!isOpen) return null;
  let summary;
  try { summary = pkpStore.getOfficialSheet7Data(reportPeriod); } catch { /* Scope is loading. */ }
  const canExport = pkpStore.getCurrentUser().role !== 'PIC';
  const score = (value: number | null | undefined) => value == null ? '-' : `${value.toFixed(2)}%`;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Ekspor laporan PKP" className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in">
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <div><h3 className="font-bold text-slate-800 text-sm">Ekspor Laporan Penilaian Kinerja Puskesmas (PKP)</h3>
              <p className="text-[11px] text-slate-500">Excel Sheet 7 dan PDF resmi dihasilkan oleh server.</p></div>
          </div>
          <button aria-label="Tutup ekspor laporan" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-6 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <label className="font-semibold text-slate-600">Pilih Periode Laporan:
              <select aria-label="Periode laporan ekspor" value={reportPeriod} disabled={pending} onChange={e => setReportPeriod(e.target.value === 'ANNUAL' ? 'ANNUAL' : Number(e.target.value) as 1 | 2 | 3 | 4)} className="mt-1 w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 font-bold text-slate-800">
                {[1, 2, 3, 4].map(q => <option key={q} value={q}>Triwulan {q} (YTD Januari - bulan {q * 3})</option>)}
                <option value="ANNUAL">Laporan Tahunan Lengkap (12 Bulan)</option>
              </select>
            </label>
            <div><p className="font-semibold text-slate-600 mb-1">Fasilitas Pelayanan Kesehatan:</p><div className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-bold text-slate-700">{puskesmasName} (TA {year})</div></div>
          </div>
          {summary ? <div className="border border-slate-300 rounded-xl p-5 bg-white space-y-4 shadow-xs">
            <div className="text-center space-y-1 pb-3 border-b border-slate-200"><h4 className="font-extrabold text-sm text-slate-900 uppercase">Rekapitulasi Hasil Penilaian Kinerja</h4><p className="font-bold text-slate-700">{summary.puskesmasName}</p><p>{summary.periodLabel} {year}</p></div>
            <table className="w-full text-left border border-slate-200"><thead className="bg-slate-100 text-slate-700 font-bold"><tr><th className="py-2 px-3">Klaster Pelayanan</th><th className="py-2 px-3 text-right">Nilai Klaster</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{[1, 2, 3, 4, 5].map(id => <tr key={id}><td className="py-2 px-3">Klaster {id}</td><td className="py-2 px-3 text-right font-mono font-bold">{score(summary.klasterScores[id])}</td></tr>)}
                <tr className="bg-emerald-50 font-bold"><td className="py-2 px-3">NILAI KINERJA ({summary.kategoriPKP ?? '-'})</td><td className="py-2 px-3 text-right">{score(summary.nilaiKinerjaPuskesmas)}</td></tr></tbody>
            </table>
          </div> : <p role="status">Ringkasan server belum tersedia.</p>}
          {error && <p role="alert" className="p-3 rounded-lg bg-rose-50 text-rose-800">{error}</p>}
          {pending && <p role="status">Server sedang memproses ekspor. Menutup dialog menghentikan pemantauan pekerjaan ini.</p>}
          {file && <a href={file.url} download={file.name} target="_blank" rel="noreferrer" className="block p-3 bg-emerald-50 text-emerald-800 rounded-lg underline">Unduh {file.name}</a>}
          {!canExport && <p>Ekspor resmi hanya tersedia bagi Admin Puskesmas dan Dinkes.</p>}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <button disabled={pending || !canExport || !summary} onClick={() => void create('pdf', reportPeriod)} className="px-3.5 py-2 bg-slate-100 text-slate-700 rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50"><Printer className="w-4 h-4" />Unduh PDF Resmi</button>
            <button disabled={pending || !canExport || !summary} onClick={() => void create('excel', reportPeriod)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold flex items-center gap-2 shadow-sm disabled:opacity-50"><Download className="w-4 h-4" />Unduh Excel (Sheet 7)</button>
          </div>
        </div>
      </div>
    </div>
  );
};
