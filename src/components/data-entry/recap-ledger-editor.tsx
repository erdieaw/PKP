import type { RecapLedgerDraft } from '../../types/do2026';
import { normalizeLedgerId } from '../../services/recapStructuredInput';

const inputClass = 'mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100';
const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-slate-50 disabled:opacity-50';

interface Props {
  readonly value: Extract<RecapLedgerDraft, { kind: 'PME_ANNUAL' | 'RTM_ANNUAL' }>;
  readonly disabled: boolean;
  readonly onChange: (value: RecapLedgerDraft) => void;
}

export function RecapLedgerEditor({ value, disabled, onChange }: Props) {
  function field(label: string, current: string, update: (next: string) => void, maxLength = 500, date = false) {
    return <label className="block min-w-0 text-sm font-medium">{label}
      <input type={date ? 'date' : 'text'} required value={current} onChange={event => update(event.target.value)}
        maxLength={date ? undefined : maxLength} min={date ? `${value.year}-01-01` : undefined} max={date ? `${value.year}-12-31` : undefined}
        className={inputClass} />
    </label>;
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <legend className="font-semibold text-slate-900">{value.kind === 'PME_ANNUAL' ? 'Ledger keikutsertaan PME' : 'Ledger rapat dan rekomendasi RTM'} {value.year}</legend>
    <p className="text-sm text-slate-600">Sumber independen Januari sampai Desember, bukan penjumlahan bulanan. Referensi berupa teks adalah attestasi petugas, bukan validasi dokumen eksternal. Jangan isi nama, NIK, nomor rekam medis, atau identitas pasien.</p>
    {value.kind === 'PME_ANNUAL' ? <>
      <p className="text-sm text-slate-600">N = jumlah kegiatan berbeda; D = minimum 2 keikutsertaan setahun. Capaian di atas 100% sah dan tidak dipangkas. Tidak menghasilkan skor kinerja numerik.</p>
      {!value.participations.length && <p role="status" className="text-sm text-amber-900">Daftar PME kosong: N = 0, D = 2. Simpan hanya jika sumber dan konfirmasi menyatakan nihil selama tahun rekap, bukan data belum tersedia.</p>}
      {value.participations.map((row, index) => {
        const update = (patch: Partial<typeof row>) => onChange({ ...value, participations: value.participations.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
        return <fieldset key={index} className="min-w-0 space-y-3 border-t border-slate-200 pt-3">
          <legend className="text-sm font-semibold">Kegiatan PME {index + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('ID kegiatan', row.eventId, eventId => update({ eventId }), 100)}
            {field('Tanggal kegiatan', row.date, date => update({ date }), 500, true)}
            {field('Penyelenggara', row.organizer, organizer => update({ organizer }))}
            {field('Program PME', row.program, program => update({ program }))}
          </div>
          {field('Referensi sertifikat/hasil', row.evidenceReference, evidenceReference => update({ evidenceReference }), 1000)}
          <button type="button" className={buttonClass} onClick={() => onChange({ ...value, participations: value.participations.filter((_, i) => i !== index) })}>Hapus kegiatan {index + 1}</button>
        </fieldset>;
      })}
      <button type="button" className={buttonClass} disabled={value.participations.length >= 1000} onClick={() => onChange({ ...value, participations: [...value.participations, { eventId: '', date: '', organizer: '', program: '', evidenceReference: '' }] })}>Tambah kegiatan PME</button>
    </> : <>
      <p role="status" className="text-sm text-amber-900">{value.meetings.length} rapat dicatat. Prasyarat minimal 2 rapat berbeda dalam tahun rekap diperiksa terpisah oleh server; rasio rekomendasi tidak menggantikannya. N = rekomendasi selesai; D = seluruh rekomendasi, bukan jumlah rapat. Tidak menghasilkan skor kinerja numerik.</p>
      {!value.meetings.length && <p className="text-sm text-amber-900">Daftar rapat kosong adalah pernyataan nihil, bukan data belum tersedia. Nyatakan pada sumber dan konfirmasi sebelum menyimpan.</p>}
      {value.meetings.map((row, index) => {
        const update = (patch: Partial<typeof row>) => onChange({ ...value, meetings: value.meetings.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
        return <fieldset key={index} className="min-w-0 space-y-3 border-t border-slate-200 pt-3">
          <legend className="text-sm font-semibold">Rapat RTM {index + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('ID rapat', row.meetingId, meetingId => update({ meetingId }), 100)}
            {field('Tanggal rapat', row.date, date => update({ date }), 500, true)}
          </div>
          {field('Referensi notulen', row.minutesReference, minutesReference => update({ minutesReference }), 1000)}
          <button type="button" className={buttonClass} onClick={() => onChange({ ...value, meetings: value.meetings.filter((_, i) => i !== index) })}>Hapus rapat {index + 1}</button>
        </fieldset>;
      })}
      <button type="button" className={buttonClass} disabled={value.meetings.length >= 1000} onClick={() => onChange({ ...value, meetings: [...value.meetings, { meetingId: '', date: '', minutesReference: '' }] })}>Tambah rapat RTM</button>
      <h4 className="text-sm font-semibold">Rekomendasi dan tindak lanjut</h4>
      {!value.recommendations.length && <p role="status" className="text-sm text-amber-900">Daftar rekomendasi kosong: N = 0, D = 0. Nyatakan nihil dalam sumber dan konfirmasi; D nol tidak otomatis berarti 100%, N/A, atau skor nol.</p>}
      {value.recommendations.map((row, index) => {
        const update = (patch: Partial<typeof row>) => onChange({ ...value, recommendations: value.recommendations.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
        const selectedMeeting = value.meetings.find(meeting => normalizeLedgerId(meeting.meetingId) === normalizeLedgerId(row.meetingId));
        return <fieldset key={index} className="min-w-0 space-y-3 border-t border-slate-200 pt-3">
          <legend className="text-sm font-semibold">Rekomendasi RTM {index + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('ID rekomendasi', row.recommendationId, recommendationId => update({ recommendationId }), 100)}
            <label className="block min-w-0 text-sm font-medium">Rapat asal
              <select aria-label="Rapat asal" required value={selectedMeeting?.meetingId ?? row.meetingId} onChange={event => update({ meetingId: event.target.value })} className={inputClass}>
                <option value="">Pilih rapat</option>
                {row.meetingId && !selectedMeeting && <option value={row.meetingId} disabled>Rapat tidak ditemukan: {row.meetingId}</option>}
                {value.meetings.filter(meeting => meeting.meetingId.trim()).map((meeting, i) => <option key={i} value={meeting.meetingId}>{meeting.meetingId} ({meeting.date || 'tanggal belum diisi'})</option>)}
              </select>
            </label>
          </div>
          {field('Uraian rekomendasi', row.description, description => update({ description }), 2000)}
          <label className="block text-sm font-medium">Status tindak lanjut
            <select aria-label="Status tindak lanjut" value={row.followUpStatus} onChange={event => {
              const followUpStatus = event.target.value as 'COMPLETED' | 'NOT_COMPLETED';
              const { followUpDate: _date, followUpReference: _reference, ...withoutCompletion } = row;
              onChange({ ...value, recommendations: value.recommendations.map((entry, i) => i === index
                ? { ...withoutCompletion, followUpStatus, ...(followUpStatus === 'COMPLETED' ? { followUpDate: '', followUpReference: '' } : {}) } : entry) });
            }} className={inputClass}>
              <option value="NOT_COMPLETED">Belum selesai</option><option value="COMPLETED">Selesai</option>
            </select>
          </label>
          {row.followUpStatus === 'COMPLETED' && <div className="grid gap-3 sm:grid-cols-2">
            {field('Tanggal tindak lanjut', row.followUpDate ?? '', followUpDate => update({ followUpDate }), 500, true)}
            {field('Referensi tindak lanjut', row.followUpReference ?? '', followUpReference => update({ followUpReference }), 1000)}
          </div>}
          <button type="button" className={buttonClass} onClick={() => onChange({ ...value, recommendations: value.recommendations.filter((_, i) => i !== index) })}>Hapus rekomendasi {index + 1}</button>
        </fieldset>;
      })}
      <button type="button" className={buttonClass} disabled={value.recommendations.length >= 1000} onClick={() => onChange({ ...value, recommendations: [...value.recommendations, { recommendationId: '', meetingId: '', description: '', followUpStatus: 'NOT_COMPLETED' }] })}>Tambah rekomendasi RTM</button>
    </>}
  </fieldset>;
}
