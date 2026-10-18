import React, { useState } from 'react';
import { pkpStore } from '../../services/mockState';
import { DinkesRecommendation } from '../../types/pkp';
import { 
  MessageSquareCheck, 
  Send, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Edit3,
  Building,
  Check
} from 'lucide-react';

export const RecommendationView: React.FC = () => {
  const [recommendations, setRecommendations] = useState<DinkesRecommendation[]>(
    pkpStore.getRecommendations()
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rtlInput, setRtlInput] = useState<string>('');
  const [statusInput, setStatusInput] = useState<'PENDING' | 'IN_PROGRESS' | 'RESOLVED'>('PENDING');
  const [notification, setNotification] = useState<string | null>(null);

  const handleStartEdit = (rec: DinkesRecommendation) => {
    setEditingId(rec.id);
    setRtlInput(rec.puskesmasRtl);
    setStatusInput(rec.status);
  };

  const handleSaveRtl = (recId: string) => {
    pkpStore.updateRecommendationRtl(recId, rtlInput, statusInput);
    setRecommendations([...pkpStore.getRecommendations()]);
    setEditingId(null);
    setNotification('Rencana Tindak Lanjut (RTL) berhasil diperbarui!');
    setTimeout(() => setNotification(null), 3000);
  };

  return (
    <div className="space-y-6">
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
                  {!isEditing && (
                    <button
                      onClick={() => handleStartEdit(rec)}
                      className="px-2.5 py-1 rounded bg-white hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-300 text-xs font-semibold transition-colors flex items-center gap-1"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Respons RTL</span>
                    </button>
                  )}
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
                    <div className="space-y-3">
                      <textarea
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
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-lg bg-emerald-50/50 border border-emerald-100 text-slate-800 text-xs leading-relaxed font-medium">
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
