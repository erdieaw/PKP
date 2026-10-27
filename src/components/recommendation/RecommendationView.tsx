import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { pkpStore } from '../../services/apiStore';
import { api } from '../../services/apiClient';
import { DinkesRecommendation } from '../../types/pkp';
import { 
  MessageSquareCheck, 
  Send, 
  Edit3,
  Building,
  Check
} from 'lucide-react';

export const RecommendationView: React.FC = () => {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const recommendations = pkpStore.getRecommendations();
  const role = pkpStore.getCurrentUser().role;
  const year = pkpStore.getCurrentYear();
  const centerId = pkpStore.getSelectedHealthCenterId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState('');
  const [feedback, setFeedback] = useState({ sectionCode: '', quarter: '1', recommendationText: '' });
  const sections = pkpStore.getSubKlasters();
  const disabled = pending || pkpStore.getLoadState().loading || !pkpStore.isActiveYear();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rtlInput, setRtlInput] = useState<string>('');
  const [statusInput, setStatusInput] = useState<'PENDING' | 'IN_PROGRESS' | 'RESOLVED'>('PENDING');
  const [notification, setNotification] = useState<string | null>(null);
  useEffect(() => {
    setEditingId(null); setRtlInput(''); setAnalysis(''); setError(null); setNotification(null);
    setFeedback({ sectionCode: '', quarter: '1', recommendationText: '' });
  }, [centerId, year]);

  const handleStartEdit = (rec: DinkesRecommendation) => {
    setEditingId(rec.id);
    setRtlInput(rec.puskesmasRtl);
    setStatusInput(rec.status);
    setAnalysis((rec as DinkesRecommendation & { analisisPenyebab?: string }).analisisPenyebab ?? '');
    setError(null);
  };

  const handleSaveRtl = async (recId: string) => {
    if (disabled || role !== 'ADMIN_PUSKESMAS' || !centerId) return;
    setPending(true); setError(null); setNotification(null);
    try {
      // The store's RTL helper omits the backend-supported cause analysis field.
      await api.request(`/recommendations/${encodeURIComponent(recId)}/action-plan`, { method: 'PATCH', body: { healthCenterId: centerId, analisisPenyebab: analysis, actionPlanText: rtlInput, statusFollowUp: statusInput } });
      await pkpStore.refreshScope();
      setEditingId(null);
      setNotification('Analisis penyebab dan RTL berhasil diperbarui.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Penyimpanan RTL gagal. Coba lagi.'); }
    finally { setPending(false); }
  };
  const saveFeedback = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || role !== 'DINKES_ADMIN') return;
    if (!sections.some(s => s.code === feedback.sectionCode) || !feedback.recommendationText.trim()) { setError('Pilih bagian dan isi rekomendasi Dinkes.'); return; }
    setPending(true); setError(null); setNotification(null);
    try {
      await pkpStore.addFeedback(feedback.sectionCode, Number(feedback.quarter), feedback.recommendationText.trim());
      setFeedback({ sectionCode: '', quarter: '1', recommendationText: '' });
      setNotification('Rekomendasi Dinkes berhasil disimpan.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Penyimpanan rekomendasi gagal. Coba lagi.'); }
    finally { setPending(false); }
  };

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm">{error}</p>}
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-wider mb-1">
            <MessageSquareCheck className="w-4 h-4" />
            <span>Lembar Evaluasi & Pembinaan Terpadu (Sheet 6)</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800">
            Rekomendasi Dinas Kesehatan & Rencana Tindak Lanjut (RTL)
          </h2>
          <p className="text-xs text-slate-500">
            Umpan balik tertulis resmi dari Tim Pembina Dinkes per kelompok indikator serta rencana tindak lanjut perbaikan mutu oleh Puskesmas.
          </p>
        </div>

        {notification && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
            <Check className="w-4 h-4" />
            <span>{notification}</span>
          </div>
        )}
      </div>

      {role === 'DINKES_ADMIN' && <form onSubmit={saveFeedback} className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
        <fieldset disabled={disabled} className="space-y-3">
          <h3 className="font-bold text-sm text-slate-800">Tambah / Perbarui Rekomendasi Dinkes</h3>
          <p className="text-xs text-slate-500">{pkpStore.getSelectedHealthCenter()?.name} / {year}. Bagian dan triwulan yang sama memperbarui rekomendasi yang sudah ada.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs font-semibold text-slate-600">Tahun<input readOnly value={year} className="block w-full border rounded-lg p-2 bg-slate-50" /></label>
            <label className="text-xs font-semibold text-slate-600">Triwulan<select value={feedback.quarter} onChange={e => setFeedback({ ...feedback, quarter: e.target.value })} className="block w-full border rounded-lg p-2">{[1, 2, 3, 4].map(q => <option key={q}>{q}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600">Bagian<select required value={feedback.sectionCode} onChange={e => setFeedback({ ...feedback, sectionCode: e.target.value })} className="block w-full border rounded-lg p-2"><option value="" disabled>Pilih bagian</option>{sections.map(s => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}</select></label>
          </div>
          <label className="block text-xs font-semibold text-slate-600">Rekomendasi<textarea required maxLength={10000} value={feedback.recommendationText} onChange={e => setFeedback({ ...feedback, recommendationText: e.target.value })} className="block w-full h-24 p-3 border border-slate-300 rounded-lg" /></label>
          <button type="submit" className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold">{pending ? 'Menyimpan...' : 'Simpan Rekomendasi'}</button>
        </fieldset>
      </form>}
      {!recommendations.length && <p className="p-5 text-sm text-slate-500">Belum ada rekomendasi untuk Puskesmas dan tahun terpilih.</p>}

      {/* Recommendation Cards List */}
      <div className="grid grid-cols-1 gap-4">
        {recommendations.map((rec) => {
          const isEditing = editingId === rec.id;

          let badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
          let statusText = 'Sedang Diproses';
          if (rec.status === 'RESOLVED') {
            badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
            statusText = 'Tuntas / Selesai';
          } else if (rec.status === 'PENDING') {
            badgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
            statusText = 'Belum Ditindaklanjuti';
          }

          return (
            <div key={rec.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-800">
                    Kode {rec.sectionCode}
                  </span>
                  <h4 className="font-bold text-slate-800 text-xs sm:text-sm">
                    {rec.sectionName}
                  </h4>
                  <span className="text-[11px] text-slate-400 font-mono">
                    (Klaster {rec.klasterId} • Triwulan {rec.quarter})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${badgeColor}`}>
                    {statusText}
                  </span>
                  {!isEditing && role === 'ADMIN_PUSKESMAS' && (
                    <button
                      disabled={disabled}
                      onClick={() => handleStartEdit(rec)}
                      className="px-2.5 py-1 rounded bg-white hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-300 text-xs font-semibold transition-colors flex items-center gap-1"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Respons RTL</span>
                    </button>
                   )}
                  {role === 'DINKES_ADMIN' && <button disabled={disabled} onClick={() => { setFeedback({ sectionCode: rec.sectionCode, quarter: String(rec.quarter), recommendationText: rec.recommendationText }); setError(null); }} className="px-2.5 py-1 rounded bg-white border border-slate-300 text-xs font-semibold">Edit Rekomendasi</button>}
                </div>
              </div>

              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Dinkes Recommendation */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-indigo-700 text-xs font-bold uppercase tracking-wider">
                    <Building className="w-4 h-4 text-indigo-600" />
                    <span>Catatan & Rekomendasi Dinkes:</span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-indigo-50/60 border border-indigo-100 text-slate-800 text-xs leading-relaxed whitespace-pre-line font-medium">
                    {rec.recommendationText}
                  </div>
                </div>

                {/* Puskesmas RTL */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-emerald-700 text-xs font-bold uppercase tracking-wider">
                    <Send className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Rencana Tindak Lanjut (RTL) Puskesmas:</span>
                  </div>

                  {isEditing ? (
                    <fieldset disabled={disabled} className="space-y-3">
                      <label className="block text-xs font-semibold text-slate-600">Analisis Penyebab<textarea maxLength={10000} value={analysis} onChange={e => setAnalysis(e.target.value)} className="block w-full h-24 p-3 border border-slate-300 rounded-lg" /></label>
                      <textarea
                        maxLength={10000}
                        value={rtlInput}
                        onChange={(e) => setRtlInput(e.target.value)}
                        placeholder="Tuliskan rencana perbaikan mutu, jadwal kegiatan, dan penanggung jawab..."
                        className="w-full h-24 p-3 text-xs border border-emerald-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-sans"
                      />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-slate-600 font-semibold">Status RTL:</label>
                          <select
                            value={statusInput}
                            onChange={(e) => setStatusInput(e.target.value as any)}
                            className="text-xs font-semibold bg-white border border-slate-300 rounded px-2 py-1"
                          >
                            <option value="PENDING">Belum Ditindaklanjuti</option>
                            <option value="IN_PROGRESS">Sedang Berjalan</option>
                            <option value="RESOLVED">Selesai / Tuntas</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleSaveRtl(rec.id)}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700"
                          >
                            Simpan RTL
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-xs hover:bg-slate-300"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    </fieldset>
                  ) : (
                    <div className="p-3.5 rounded-lg bg-emerald-50/50 border border-emerald-100 text-slate-800 text-xs leading-relaxed font-medium">
                      <p className="mb-2 whitespace-pre-line"><strong>Analisis penyebab: </strong>{(rec as DinkesRecommendation & { analisisPenyebab?: string }).analisisPenyebab || 'Belum diisi.'}</p>
                      {rec.puskesmasRtl || (
                        <span className="text-slate-400 italic">Belum ada RTL yang diinputkan.</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
