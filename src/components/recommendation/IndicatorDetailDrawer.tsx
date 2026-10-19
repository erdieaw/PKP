import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { OfficialIndicator } from '../../types/pkp';
import { pkpStore } from '../../services/apiStore';
import { 
  X, 
  Target, 
  HelpCircle, 
  Paperclip, 
  CheckCircle,
  Cloud,
  RefreshCw,
  Lock,
  ChevronDown,
  ChevronUp,
  Layers,
  Sparkles,
  AlertTriangle,
  Code
} from 'lucide-react';
import { PolarityBadge } from '../common/PolarityBadge';
import { ScoreBadge } from '../common/ScoreBadge';

interface IndicatorDetailDrawerProps {
  indicator: OfficialIndicator | null;
  selectedMonth: number;
  onClose: () => void;
  onSelectIndicator?: (ind: OfficialIndicator) => void;
}

export const IndicatorDetailDrawer: React.FC<IndicatorDetailDrawerProps> = ({
  indicator,
  selectedMonth,
  onClose,
  onSelectIndicator
}) => {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [realisasiInput, setRealisasiInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [evidenceName, setEvidenceName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const generation = useRef(0);
  const year = pkpStore.getCurrentYear();
  const center = pkpStore.getSelectedHealthCenterId();
  useEffect(() => {
    generation.current++;
    const record = indicator ? pkpStore.getMonthlyRecord(indicator.id, selectedMonth) : null;
    setRealisasiInput(record?.pencapaianRiil?.toString() ?? '');
    setNotesInput(record?.notes ?? ''); setEvidenceId(record?.evidenceId ?? null);
    setEvidenceName(''); setError(null); setSavedSuccess(false); setPending(false); setDownloadUrl(null);
    return () => { generation.current++; };
  }, [indicator?.id, selectedMonth, year, center]);
  if (!indicator) return null;

  const isHead = !!indicator.isHead;
  const officialCode = isHead ? `HEAD ${indicator.sectionCode}` : `${indicator.sectionCode}.${indicator.no.replace('.', '')}`;
  const rec = pkpStore.getMonthlyRecord(indicator.id, selectedMonth);
  const target = pkpStore.getAnnualTargets()[indicator.id];
  const pic = pkpStore.getPicForIndicator(indicator.id);
  const headAgg = isHead ? pkpStore.getSubKlasterAggregation(indicator.sectionCode, selectedMonth) : null;

  // Get child elements if isHead
  const childIndicators = isHead 
    ? pkpStore.getIndicators().filter(i => 
        i.sectionCode === indicator.sectionCode && 
        !(i.no === 'No' || i.no === '(1)' || i.no === '(2)' || i.no === '(3)' || i.no === 'Kegiatan')
      )
    : [];

  const user = pkpStore.getCurrentUser();
  const canEdit = !pkpStore.getLoadState().loading && !isHead && !pkpStore.isPeriodLocked(year, selectedMonth) &&
    (user.role === 'ADMIN_PUSKESMAS' || (user.role === 'PIC' && pkpStore.getAssignments()[indicator.id] === user.id));
  const handleSave = async () => {
    if (!canEdit || pending) return;
    const val = Number(realisasiInput);
    if (!realisasiInput.trim() || !Number.isFinite(val) || val < 0) { setError('Realisasi harus berupa angka valid nonnegatif.'); return; }
    const epoch = generation.current;
    setPending(true); setError(null); setSavedSuccess(false);
    try {
      await pkpStore.saveRecord(indicator.id, selectedMonth, { pencapaianRiil: val, notes: notesInput, evidenceId });
      if (epoch === generation.current) setSavedSuccess(true);
    } catch (e) { if (epoch === generation.current) setError(e instanceof Error ? e.message : 'Penyimpanan gagal.'); }
    finally { if (epoch === generation.current) setPending(false); }
  };
  const handleUpload = async (file?: File) => {
    if (!file || pending || !canEdit) return;
    const epoch = generation.current;
    setPending(true); setError(null); setSavedSuccess(false);
    try {
      const metadata = await pkpStore.uploadEvidence(file, selectedMonth);
      if (epoch === generation.current) { setEvidenceId(metadata.evidenceId); setEvidenceName(file.name); setDownloadUrl(null); }
    } catch (e) { if (epoch === generation.current) setError(e instanceof Error ? e.message : 'Unggah gagal.'); }
    finally { if (epoch === generation.current) setPending(false); }
  };
  const handleDownload = async () => {
    if (!evidenceId || pending) return;
    const epoch = generation.current;
    setPending(true); setError(null);
    try {
      const result = await pkpStore.getEvidenceDownload(evidenceId);
      if (epoch === generation.current) setDownloadUrl(result.downloadUrl);
    } catch (e) { if (epoch === generation.current) setError(e instanceof Error ? e.message : 'Unduhan gagal.'); }
    finally { if (epoch === generation.current) setPending(false); }
  };

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];


  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end">
      <div 
        role="dialog" aria-modal="true" aria-label="Rincian indikator"
        className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            {isHead ? (
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-900 border border-purple-300 flex items-center gap-1">
                <Lock className="w-3 h-3 text-purple-700" />
                <span>{officialCode}</span>
              </span>
            ) : (
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                Kode {officialCode}
              </span>
            )}
            <span className="text-xs font-semibold text-slate-500">Klaster {indicator.klasterId}</span>
            {isHead && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                Head Penilaian
              </span>
            )}
          </div>
          <button 
            aria-label="Tutup rincian indikator"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {error && <p role="alert" className="p-3 bg-rose-50 text-rose-800 rounded-lg">{error}</p>}
          {pending && <p role="status">Memproses permintaan server...</p>}
          {/* Indicator Title & Section */}
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900 leading-snug">
              {indicator.indikator}
            </h3>
            <p className="text-slate-500 font-medium">
              Kegiatan: <strong className="text-slate-700">{indicator.kegiatan}</strong>
            </p>
            <p className="text-[11px] text-slate-400 font-mono">
              Bagian: {indicator.section}
            </p>
          </div>

          {/* ============================================================== */}
          {/* HEAD PENILAIAN CARD (NON-EDITABLE BANNER & AGGREGATION STATS) */}
          {/* ============================================================== */}
          {isHead && headAgg && (
            <div className="bg-purple-50/70 p-4 rounded-xl border border-purple-200 space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="p-2 rounded-lg bg-purple-100 text-purple-800 shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <span className="font-bold text-purple-950 uppercase tracking-wider text-[11px] block">
                    Head Penilaian (Sub-Klaster Induk)
                  </span>
                  <p className="text-purple-800 text-[11px] leading-relaxed">
                    Sesuai juknis evaluasi PKP Provinsi, <strong>elemen kepala penilaian tidak dapat diisi secara manual</strong> karena nilainya dihitung otomatis dari akumulasi rata-rata seluruh elemen turunan (child) di bawahnya.
                  </p>
                </div>
              </div>

              {/* Head Aggregate Metrics */}
              <div className="grid grid-cols-4 gap-2 pt-2 border-t border-purple-200 text-center">
                <div className="bg-white p-2 rounded-lg border border-purple-100">
                  <span className="text-[10px] text-slate-500 font-medium block">Rerata Skor</span>
                  <p className="font-mono font-bold text-purple-900 text-sm mt-0.5">{headAgg.averageScore ?? '-'}</p>
                </div>
                <div className="bg-white p-2 rounded-lg border border-purple-100">
                  <span className="text-[10px] text-slate-500 font-medium block">Rerata Capaian</span>
                  <p className="font-mono font-bold text-purple-900 text-sm mt-0.5">{headAgg.averageCapaian == null ? '-' : `${headAgg.averageCapaian}%`}</p>
                </div>
                <div className="bg-white p-2 rounded-lg border border-purple-100">
                  <span className="text-[10px] text-slate-500 font-medium block">Child Elemen</span>
                  <p className="font-mono font-bold text-slate-800 text-sm mt-0.5">{headAgg.childCount} Elemen</p>
                </div>
                <div className="bg-white p-2 rounded-lg border border-purple-100">
                  <span className="text-[10px] text-slate-500 font-medium block">Sinkronisasi</span>
                  <p className="font-mono font-bold text-slate-500 text-sm mt-0.5">Belum tersedia</p>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* INDIKATOR STATUS SINKRONISASI PROVINSI PER ELEMEN */}
          {/* ============================================================== */}
          <div className="bg-slate-900 text-white p-4 rounded-xl shadow-md border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-xs uppercase tracking-wider text-slate-200">
                  Status Sinkronisasi Provinsi
                </span>
              </div>
              <span className="text-amber-300">Integrasi belum tersedia</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-800">
              <div>
                <span className="text-slate-400 text-[10px]">Waktu Sinkronisasi Terakhir:</span>
                <p className="font-mono font-semibold text-slate-200">
                  {rec.syncedAt ?? '-'}
                </p>
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">Nomor Batch Transmisi SIPKP:</span>
                <p className="font-mono text-emerald-300 truncate font-semibold" title={rec.syncBatchId || 'Belum dibuat'}>
                  {rec.syncBatchId ?? '-'}
                </p>
              </div>
            </div>

            <p className="text-slate-300">Data disimpan di server aplikasi. Pengiriman ke SIPKP Provinsi belum didukung backend.</p>
            <button disabled className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400">Sinkronkan Sekarang</button>
          </div>

          {/* Polarity & Target Card (If not Head) */}
          {!isHead && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                  Konteks & Polaritas Target
                </span>
                <PolarityBadge polarity={indicator.polarity} targetDisplay={indicator.targetDisplay} />
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 text-center">
                <div>
                  <span className="text-[10px] text-slate-400">Target %</span>
                  <p className="font-mono font-bold text-slate-800 text-sm mt-0.5">{target?.targetPct == null ? '-' : `${target.targetPct}%`}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400">Total Sasaran</span>
                  <p className="font-mono font-bold text-slate-800 text-sm mt-0.5">{target?.totalSasaran ?? '-'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400">Target Fisik (Thn)</span>
                  <p className="font-mono font-bold text-emerald-600 text-sm mt-0.5">{target?.targetSasaran?.toFixed(1) ?? '-'}</p>
                </div>
              </div>

              {indicator.polarity === 'LOWER_IS_BETTER' && (
                <div className="p-2.5 rounded bg-orange-50 border border-orange-200 text-orange-800 text-[11px] leading-relaxed">
                  <strong>Catatan Polaritas:</strong> Indikator ini dinilai <em>Semakin Kecil Semakin Bagus</em>. Skor 100 diberikan jika realisasi berada di bawah target maksimal.
                </div>
              )}
              {indicator.polarity === 'TIERED_BRACKETS' && (
                <div className="p-2.5 rounded bg-purple-50 border border-purple-200 text-purple-800 text-[11px] leading-relaxed">
                  <strong>Catatan Polaritas:</strong> Menggunakan rubrik evaluasi bertingkat (step-down scoring) sesuai aturan klinis Kemenkes.
                </div>
              )}
            </div>
          )}

          {/* PIC In Charge Info */}
          <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full ${pic?.avatarColor ?? 'bg-slate-300'} text-white flex items-center justify-center font-bold text-xs`}>
                {pic?.name.charAt(0) ?? '-'}
              </div>
              <div>
                <p className="font-bold text-slate-800">{pic?.name ?? 'Belum ditugaskan'}</p>
                <p className="text-[11px] text-slate-500">{pic?.role ?? '-'}</p>
              </div>
            </div>
            <span className="text-[11px] font-mono text-emerald-600 font-semibold">
              {pic?.phone ?? '-'}
            </span>
          </div>

          {/* ============================================================== */}
          {/* CHILD LIST FOR HEAD PENILAIAN */}
          {/* ============================================================== */}
          {isHead && childIndicators.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-purple-600" />
                  <span>Daftar {childIndicators.length} Child Elemen Penilaian:</span>
                </span>
                <span className="text-[10px] text-slate-500">Klik child untuk input</span>
              </div>

              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {childIndicators.map((child) => {
                  const childRec = pkpStore.getMonthlyRecord(child.id, selectedMonth);
                  const childCode = `${child.sectionCode}.${child.no.replace('.', '')}`;
                  return (
                    <div 
                      key={child.id}
                      role="button" tabIndex={0} aria-label={`Rincian indikator ${childCode}`}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectIndicator?.(child); } }}
                      onClick={() => onSelectIndicator && onSelectIndicator(child)}
                      className="p-2.5 hover:bg-slate-50 flex items-center justify-between gap-3 cursor-pointer transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {childCode}
                          </span>
                          <p className="font-semibold text-slate-800 truncate text-[11px]">{child.indikator}</p>
                        </div>
                        <p className="text-[10px] text-slate-500 truncate mt-0.5">Realisasi: {childRec.pencapaianRiil ?? '-'} {child.satuan}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {childRec.nilaiKinerja == null ? '-' : <ScoreBadge score={childRec.nilaiKinerja} size="sm" />}
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          childRec.syncStatus === 'SYNCED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}>
                          {childRec.isMissing ? 'Belum diisi' : 'Data server'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* MONTHLY REALIZATION INPUT FORM (LOCKED IF HEAD) */}
          {/* ============================================================== */}
          <div className={`p-4 rounded-xl border space-y-3 ${
            isHead 
              ? 'bg-slate-100/70 border-slate-300' 
              : 'bg-emerald-50/50 border-emerald-200'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1">
                {isHead && <Lock className="w-3.5 h-3.5 text-slate-500" />}
                <span>Input Capaian Bulan {selectedMonth}</span>
              </span>
              {(isHead ? headAgg?.averageScore : rec.nilaiKinerja) == null ? '-' : <ScoreBadge score={(isHead ? headAgg?.averageScore : rec.nilaiKinerja)!} size="sm" />}
            </div>

            {isHead ? (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-[11px] flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-700 shrink-0" />
                <span>
                  <strong>Form Terkunci:</strong> Elemen ini adalah Head Penilaian. Pengisian dilakukan pada masing-masing child elemen di atas.
                </span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                      Realisasi Fisik ({indicator.satuan}):
                    </label>
                    <input
                      aria-label="Realisasi fisik"
                      disabled={!canEdit || pending}
                      type="number"
                      value={realisasiInput}
                      onChange={(e) => setRealisasiInput(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs font-mono font-bold bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                      Target Sasaran Bulanan:
                    </label>
                    <div className="px-3 py-1.5 text-xs font-mono font-bold bg-slate-100 border border-slate-200 rounded-lg text-slate-700">
                      {target?.targetSasaran == null ? '-' : (target.targetSasaran / 12).toFixed(1)} {indicator.satuan}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Catatan Lapangan / Kendala:
                  </label>
                  <textarea
                    aria-label="Catatan lapangan"
                    disabled={!canEdit || pending}
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    placeholder="Catatan analisis kendala atau sumber data (misal ASIK / SMILE)..."
                    className="w-full h-16 p-2 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Evidence attachment simulation */}
                <div className="flex items-center justify-between pt-1">
                  <label className="min-w-0 text-slate-600">Lampirkan bukti dukung
                    <input type="file" aria-label="Lampirkan bukti dukung" disabled={!canEdit || pending}
                      onChange={e => { void handleUpload(e.target.files?.[0]); e.target.value = ''; }} className="block w-full text-xs" />
                  </label>

                  <button
                    onClick={handleSave}
                    disabled={!canEdit || pending}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors shadow-sm"
                  >
                    Simpan Capaian
                  </button>
                </div>
                {!canEdit && <p>Hanya Admin atau PIC yang ditugaskan dapat mengubah periode terbuka.</p>}
                {evidenceId && <div className="space-y-2"><p>Bukti: {evidenceName || evidenceId}. Simpan capaian untuk menautkan bukti dan catatan.</p>
                  <button disabled={pending} onClick={handleDownload} className="underline">Siapkan unduhan bukti</button>
                  {downloadUrl && <a href={downloadUrl} target="_blank" rel="noreferrer" className="block underline">Unduh bukti dukung</a>}
                </div>}

                {savedSuccess && (
                  <p className="text-[11px] text-emerald-700 font-bold flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Data capaian bulan {selectedMonth} tersimpan di server.</span>
                  </p>
                )}
              </>
            )}
          </div>

          {/* 12-Month Performance Sparkline / Table */}
          {!isHead && (
            <div className="space-y-2">
              <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                Tren Capaian 12 Bulan (Tahun {year})
              </span>
              <div className="grid grid-cols-6 gap-1 text-center font-mono text-[10px]">
                {months.map((mName, idx) => {
                  const mNum = idx + 1;
                  const mRec = pkpStore.getMonthlyRecord(indicator.id, mNum);
                  const isCurrent = mNum === selectedMonth;

                  return (
                    <div 
                      key={mNum} 
                      className={`p-1.5 rounded border ${
                        isCurrent 
                          ? 'bg-emerald-50 border-emerald-400 text-emerald-800 font-bold' 
                          : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                    >
                      <span className="block text-[9px] text-slate-400 uppercase">{mName}</span>
                      <span className="font-bold">{mRec.pencapaianRiil ?? '-'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Operational Definition / Notes from Column L */}
          {indicator.notes && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 space-y-1">
              <span className="font-bold text-[11px] flex items-center gap-1 text-amber-800">
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Petunjuk Teknis Pengisian (Definisi Operasional):</span>
              </span>
              <p className="text-xs leading-relaxed font-medium">
                {indicator.notes}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
