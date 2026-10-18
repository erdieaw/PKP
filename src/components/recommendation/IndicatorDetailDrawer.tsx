import React, { useState } from 'react';
import { OfficialIndicator } from '../../types/pkp';
import { pkpStore } from '../../services/mockState';
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
  if (!indicator) return null;

  const isHead = !!indicator.isHead;
  const officialCode = isHead ? `HEAD ${indicator.sectionCode}` : `${indicator.sectionCode}.${indicator.no.replace('.', '')}`;
  const rec = pkpStore.getMonthlyRecord(indicator.id, selectedMonth);
  const target = pkpStore.getAnnualTargets()[indicator.id] || {
    targetPct: indicator.targetNumeric * 100,
    totalSasaran: indicator.totalSasaranDefault,
    targetSasaran: indicator.targetSasaranDefault
  };
  const pic = pkpStore.getPicForIndicator(indicator.id);
  const headAgg = isHead ? pkpStore.getSubKlasterAggregation(indicator.sectionCode, selectedMonth) : null;

  // Get child elements if isHead
  const childIndicators = isHead 
    ? pkpStore.getIndicators().filter(i => 
        i.sectionCode === indicator.sectionCode && 
        !(i.no === 'No' || i.no === '(1)' || i.no === '(2)' || i.no === '(3)' || i.no === 'Kegiatan')
      )
    : [];

  const [realisasiInput, setRealisasiInput] = useState<string>(rec.pencapaianRiil.toString());
  const [notesInput, setNotesInput] = useState<string>(rec.notes || '');
  const [evidenceUploaded, setEvidenceUploaded] = useState<boolean>(!!rec.notes);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  
  // Sync state
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [showApiPayload, setShowApiPayload] = useState<boolean>(false);

  const handleSave = () => {
    if (isHead) return;
    const val = parseFloat(realisasiInput) || 0;
    pkpStore.updateMonthlyInput(indicator.id, selectedMonth, val, notesInput);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleSyncElement = () => {
    if (isHead) return;
    setIsSyncing(true);
    setTimeout(() => {
      pkpStore.syncElementToProvinsi(indicator.id, selectedMonth);
      setIsSyncing(false);
      setSyncFeedback(`Elemen [${officialCode}] berhasil disinkronkan ke server SIPKP Provinsi!`);
      setTimeout(() => setSyncFeedback(null), 3500);
    }, 450);
  };

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  // Current sync status
  const syncStatus = rec.syncStatus || 'PENDING_SYNC';
  const isSynced = syncStatus === 'SYNCED';

  // Mock API payload for Provincial SIPKP Bridge
  const provincialPayload = {
    provinsi_endpoint: "POST /api/v1/pkp/element-sync",
    puskesmas_id: "35070101",
    puskesmas_name: "Puskesmas Kebonagung",
    dinas_kesehatan: "Dinas Kesehatan Kabupaten Malang",
    official_code: officialCode,
    indicator_title: indicator.indikator,
    period: {
      month: selectedMonth,
      year: 2026,
      subklaster: indicator.sectionCode
    },
    performance: {
      realisasi_fisik: isHead ? headAgg?.averageCapaian : parseFloat(realisasiInput) || 0,
      satuan: indicator.satuan,
      target_persen: target.targetPct,
      nilai_kinerja: isHead ? headAgg?.averageScore : rec.nilaiKinerja,
      capaian_riil_pct: isHead ? headAgg?.averageCapaian : rec.capaianRiilPct
    },
    meta: {
      pic_name: pic.name,
      pic_role: pic.role,
      sync_batch_id: rec.syncBatchId || `PRV-SYNC-2026-M${selectedMonth}-${indicator.id}`,
      timestamp_sync: rec.syncedAt || new Date().toISOString()
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end">
      <div 
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
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
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
                  <p className="font-mono font-bold text-purple-900 text-sm mt-0.5">{headAgg.averageScore}</p>
                </div>
                <div className="bg-white p-2 rounded-lg border border-purple-100">
                  <span className="text-[10px] text-slate-500 font-medium block">Rerata Capaian</span>
                  <p className="font-mono font-bold text-purple-900 text-sm mt-0.5">{headAgg.averageCapaian}%</p>
                </div>
                <div className="bg-white p-2 rounded-lg border border-purple-100">
                  <span className="text-[10px] text-slate-500 font-medium block">Child Elemen</span>
                  <p className="font-mono font-bold text-slate-800 text-sm mt-0.5">{headAgg.childCount} Elemen</p>
                </div>
                <div className="bg-white p-2 rounded-lg border border-purple-100">
                  <span className="text-[10px] text-slate-500 font-medium block">Sinkronisasi</span>
                  <p className="font-mono font-bold text-emerald-700 text-sm mt-0.5">{headAgg.syncedCount}/{headAgg.childCount}</p>
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
              {isHead ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-400/30 text-[10px] font-bold">
                  {headAgg?.syncedCount}/{headAgg?.childCount} Child Sinkron
                </span>
              ) : isSynced ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-bold">
                  <CheckCircle className="w-3 h-3 text-emerald-400" />
                  <span>Tersinkron ke Provinsi</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30 text-[10px] font-bold">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  <span>Draft Lokal (Belum Sinkron)</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-800">
              <div>
                <span className="text-slate-400 text-[10px]">Waktu Sinkronisasi Terakhir:</span>
                <p className="font-mono font-semibold text-slate-200">
                  {rec.syncedAt || (isSynced ? '31 Mar 2026 16:45' : 'Belum pernah')}
                </p>
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">Nomor Batch Transmisi SIPKP:</span>
                <p className="font-mono text-emerald-300 truncate font-semibold" title={rec.syncBatchId || 'Belum dibuat'}>
                  {rec.syncBatchId || (isSynced ? `PRV-2026-TW1-${indicator.id}` : 'Draft Lokal')}
                </p>
              </div>
            </div>

            {!isHead && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowApiPayload(!showApiPayload)}
                  className="text-slate-400 hover:text-slate-200 text-[11px] inline-flex items-center gap-1 transition-colors"
                >
                  <Code className="w-3.5 h-3.5" />
                  <span>{showApiPayload ? 'Sembunyikan Payload API' : 'Lihat Payload REST API SIPKP'}</span>
                  {showApiPayload ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                <button
                  onClick={handleSyncElement}
                  disabled={isSyncing}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${
                    isSynced
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white active:scale-98'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Mengirim Data...' : isSynced ? 'Kirim Ulang ke Provinsi' : 'Sinkronkan Sekarang'}</span>
                </button>
              </div>
            )}

            {syncFeedback && (
              <p className="text-[11px] text-emerald-300 font-bold flex items-center gap-1 pt-1 animate-fade-in">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span>{syncFeedback}</span>
              </p>
            )}

            {/* Accordion JSON Payload */}
            {showApiPayload && (
              <div className="mt-2 p-2.5 bg-slate-950 rounded-lg border border-slate-800 font-mono text-[10px] text-emerald-400 overflow-x-auto max-h-48 overflow-y-auto">
                <pre>{JSON.stringify(provincialPayload, null, 2)}</pre>
              </div>
            )}
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
                  <p className="font-mono font-bold text-slate-800 text-sm mt-0.5">{target.targetPct}%</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400">Total Sasaran</span>
                  <p className="font-mono font-bold text-slate-800 text-sm mt-0.5">{target.totalSasaran}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400">Target Fisik (Thn)</span>
                  <p className="font-mono font-bold text-emerald-600 text-sm mt-0.5">{target.targetSasaran.toFixed(1)}</p>
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
              <div className={`w-9 h-9 rounded-full ${pic.avatarColor} text-white flex items-center justify-center font-bold text-xs`}>
                {pic.name.charAt(0)}
              </div>
              <div>
                <p className="font-bold text-slate-800">{pic.name}</p>
                <p className="text-[11px] text-slate-500">{pic.role}</p>
              </div>
            </div>
            <span className="text-[11px] font-mono text-emerald-600 font-semibold">
              {pic.phone}
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
                        <p className="text-[10px] text-slate-500 truncate mt-0.5">Realisasi: {childRec.pencapaianRiil} {child.satuan}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <ScoreBadge score={childRec.nilaiKinerja} size="sm" />
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          childRec.syncStatus === 'SYNCED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}>
                          {childRec.syncStatus === 'SYNCED' ? 'Sinkron' : 'Draft'}
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
              <ScoreBadge score={isHead ? (headAgg?.averageScore || 0) : rec.nilaiKinerja} size="sm" />
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
                      {(target.targetSasaran / 12).toFixed(1)} {indicator.satuan}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Catatan Lapangan / Kendala:
                  </label>
                  <textarea
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    placeholder="Catatan analisis kendala atau sumber data (misal ASIK / SMILE)..."
                    className="w-full h-16 p-2 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Evidence attachment simulation */}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setEvidenceUploaded(!evidenceUploaded)}
                    className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors ${
                      evidenceUploaded
                        ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                        : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>{evidenceUploaded ? 'Bukti Dukung Terlampir' : 'Lampirkan Bukti (PDF/ASIK)'}</span>
                  </button>

                  <button
                    onClick={handleSave}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors shadow-sm"
                  >
                    Simpan Capaian
                  </button>
                </div>

                {savedSuccess && (
                  <p className="text-[11px] text-emerald-700 font-bold flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Data capaian bulan {selectedMonth} tersimpan lokal! (Klik Sinkronkan untuk mengirim ke Provinsi)</span>
                  </p>
                )}
              </>
            )}
          </div>

          {/* 12-Month Performance Sparkline / Table */}
          {!isHead && (
            <div className="space-y-2">
              <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                Tren Capaian 12 Bulan (Tahun 2026)
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
                      <span className="font-bold">{mRec.pencapaianRiil}</span>
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
