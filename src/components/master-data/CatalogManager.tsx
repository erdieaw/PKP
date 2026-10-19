import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { pkpStore, type MasterIndicator, type SubKlasterMaster } from '../../services/apiStore';
import { ApiError } from '../../services/apiClient';

const input = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const button = 'px-3 py-2 border rounded-lg text-xs font-semibold disabled:opacity-50';
const fresh = { id: '', klasterId: 1, sectionCode: '', no: '', kegiatan: '', indikator: '', satuan: '', targetDisplay: '', targetNumeric: 0, totalSasaranDefault: 0, targetSasaranDefault: 0, polarity: 'HIGHER_IS_BETTER', formulaRaw: '', notes: '' };
type Draft = typeof fresh;

export function CatalogManager({ kind }: { kind: 'indicators' | 'subklasters' }) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [editing, setEditing] = useState<MasterIndicator | SubKlasterMaster | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ ...fresh });
  const [section, setSection] = useState({ code: '', name: '', klasterId: 1, order: 0 });
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [klaster, setKlaster] = useState(0);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    setLoading(true); setOpen(false); setError('');
    pkpStore.fetchMasterCatalog().catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [kind]);
  if (pkpStore.getCurrentUser().role === 'PIC') return null;
  const isIndicator = kind === 'indicators';
  const sections = pkpStore.getMasterSections();
  const rows = isIndicator ? pkpStore.getMasterIndicators() : sections;
  const disabled = pending || loading || pkpStore.isMutating() || pkpStore.getLoadState().loading;
  const run = async (action: () => Promise<unknown>) => {
    if (disabled) return;
    if (!window.confirm('Berlaku untuk seluruh Puskesmas. Lanjutkan perubahan katalog global ini?')) return;
    setPending(true); setError(''); setMessage('');
    try { await action(); setOpen(false); setMessage('Katalog global berhasil diperbarui.'); }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? `Konflik data (409). Perubahan scoring/hierarki yang sudah digunakan atau arsip bagian dengan anak aktif ditolak. Muat ulang katalog sebelum mencoba kembali. ${e.message}` : e instanceof Error ? e.message : 'Perubahan gagal.'); }
    finally { setPending(false); }
  };
  const edit = (row: MasterIndicator | SubKlasterMaster | null) => {
    setEditing(row); setError(''); setOpen(true);
    if (row && 'indikator' in row) setDraft({ ...fresh, ...row, formulaRaw: row.formulaRaw ?? row.formulaKinerjaRaw ?? '', notes: row.notes ?? '' });
    else setDraft({ ...fresh });
    if (row && 'code' in row) setSection({ code: row.code, name: row.name, klasterId: row.klasterId, order: row.order ?? 0 });
    else setSection({ code: '', name: '', klasterId: 1, order: 0 });
  };
  const parentCode = section.code.includes('.') && section.code.split('.').length > 2 ? section.code.slice(0, section.code.lastIndexOf('.')) : null;
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (isIndicator) {
      const selected = sections.find(s => s.code === draft.sectionCode && s.klasterId === draft.klasterId && s.isActive !== false);
      const unchangedSection = editing && 'sectionCode' in editing && editing.sectionCode === draft.sectionCode && editing.klasterId === draft.klasterId;
      if (!selected && !unchangedSection) { setError('Pilih bagian aktif yang sesuai dengan klaster.'); return; }
      const data = { ...draft, formulaRaw: draft.formulaRaw || null, notes: draft.notes || null };
      if (editing && 'indikator' in editing) {
        const previous = { ...editing, formulaRaw: editing.formulaRaw ?? editing.formulaKinerjaRaw ?? null, notes: editing.notes ?? null };
        const patch = Object.fromEntries(Object.entries(data).filter(([key, value]) => key !== 'id' && value !== previous[key as keyof typeof previous]));
        void run(() => pkpStore.updateIndicator(editing.id, { ...patch, expectedUpdatedAt: editing.updatedAt }));
      } else void run(() => pkpStore.addIndicator(data));
    } else {
      if (!editing && (Number(section.code.split('.')[0]) !== section.klasterId || (parentCode && !sections.some(s => s.code === parentCode && s.isActive !== false)))) {
        setError('Kode harus sesuai klaster dan induk langsung harus aktif.'); return;
      }
      void run(() => editing ? pkpStore.updateSubKlaster(section.code, { name: section.name, order: section.order }) : pkpStore.addSubKlaster({ ...section, parentCode }));
    }
  };
  return <section className="space-y-4">
    <p className="p-3 bg-amber-50 text-amber-900 text-sm rounded-lg">Berlaku untuk seluruh Puskesmas. Arsip menyembunyikan data dari katalog aktif, bukan menghapus riwayat.</p>
    {error && <p role="alert" className="text-rose-700 p-3 bg-rose-50">{error}</p>}
    {message && <p role="status" className="text-emerald-700">{message}</p>}
    {loading && <p role="status">Memuat katalog manajemen...</p>}
    <div className="flex flex-wrap gap-3 items-center">
      <label>Cari katalog<input className={input} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label>Filter klaster<select className={input} value={klaster} onChange={e => setKlaster(Number(e.target.value))}><option value={0}>Semua</option>{[1, 2, 3, 4, 5].map(k => <option key={k} value={k}>Klaster {k}</option>)}</select></label>
      <label className="text-sm"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Tampilkan arsip</label>
      <button className={button} disabled={disabled} onClick={() => edit(null)}>Tambah {isIndicator ? 'Indikator' : 'Bagian'}</button>
      <button className={button} disabled={disabled} onClick={() => { setLoading(true); pkpStore.fetchMasterCatalog().catch(e => setError(e.message)).finally(() => setLoading(false)); }}>Muat Ulang</button>
    </div>
    {open && <form onSubmit={save} className="bg-white border rounded-xl p-4 space-y-4">
      <h3 className="font-bold">{editing ? 'Ubah' : 'Tambah'} {isIndicator ? 'Indikator' : 'Bagian'}</h3>
      <fieldset disabled={disabled} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {isIndicator ? <>
          <label>ID indikator<input className={input} required pattern={'[A-Za-z0-9_.\\-]+'} maxLength={100} disabled={!!editing} value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} /></label>
          <label>Klaster<select className={input} disabled={!!editing && 'hasRecords' in editing && editing.hasRecords} value={draft.klasterId} onChange={e => setDraft({ ...draft, klasterId: Number(e.target.value), sectionCode: '' })}>{[1, 2, 3, 4, 5].map(k => <option key={k} value={k}>Klaster {k}</option>)}</select></label>
          <label>Bagian aktif<select required className={input} disabled={!!editing && 'hasRecords' in editing && editing.hasRecords} value={draft.sectionCode} onChange={e => setDraft({ ...draft, sectionCode: e.target.value })}><option value="">Pilih bagian</option>{sections.filter(s => s.klasterId === draft.klasterId && (s.isActive !== false || s.code === draft.sectionCode)).map(s => <option key={s.code} value={s.code}>{s.code} - {s.name}{s.isActive === false ? ' (Arsip)' : ''}</option>)}</select></label>
          {(['no', 'kegiatan', 'indikator', 'satuan', 'targetDisplay', 'formulaRaw', 'notes'] as const).map(key => <label key={key}>{({ no: 'Nomor', kegiatan: 'Kegiatan', indikator: 'Indikator', satuan: 'Satuan', targetDisplay: 'Tampilan target', formulaRaw: 'Formula (metadata saja)', notes: 'Catatan' })[key]}<input className={input} required={!['formulaRaw', 'notes'].includes(key)} maxLength={key === 'no' ? 100 : ['satuan', 'targetDisplay'].includes(key) ? 200 : 4000} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
          {(['targetNumeric', 'totalSasaranDefault', 'targetSasaranDefault'] as const).map(key => <label key={key}>{({ targetNumeric: 'Target numerik', totalSasaranDefault: 'Total sasaran default', targetSasaranDefault: 'Target sasaran default' })[key]}<input type="number" required min={0} max={key === 'targetNumeric' ? 99999999.999999 : 9999999999.9999} step={key === 'targetNumeric' ? '0.000001' : '0.0001'} className={input} disabled={!!editing && 'hasRecords' in editing && editing.hasRecords} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>)}
          <label>Polaritas<select className={input} disabled={draft.polarity === 'TIERED_BRACKETS' || !!(editing && 'hasRecords' in editing && editing.hasRecords)} value={draft.polarity} onChange={e => setDraft({ ...draft, polarity: e.target.value })}>{['HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'BINARY', ...(draft.polarity === 'TIERED_BRACKETS' ? ['TIERED_BRACKETS'] : [])].map(p => <option key={p}>{p}</option>)}</select></label>
          {editing && 'indikator' in editing && <p className="text-xs text-slate-600 sm:col-span-2">Versi scoring: {editing.scoringVersion ?? '-'}. Setelah dipakai dalam record, perubahan scoring/hierarki ditolak server (409). Metadata tetap dapat diubah. TIERED lama dipertahankan.</p>}
        </> : <>
          <label>Kode bagian<input className={input} required pattern="[1-5](\.[1-9][0-9]*)+" maxLength={100} disabled={!!editing} value={section.code} onChange={e => setSection({ ...section, code: e.target.value })} /></label>
          <label>Klaster<select className={input} disabled={!!editing} value={section.klasterId} onChange={e => setSection({ ...section, klasterId: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(k => <option key={k} value={k}>{k}</option>)}</select></label>
          <label>Nama bagian<input className={input} required maxLength={1000} value={section.name} onChange={e => setSection({ ...section, name: e.target.value })} /></label>
          <label>Urutan<input type="number" className={input} required min={0} max={2147483647} step={1} value={section.order} onChange={e => setSection({ ...section, order: Number(e.target.value) })} /></label>
          <label>Induk langsung (otomatis dari kode)<select className={input} disabled value={parentCode ?? ''}><option value="">Tanpa induk (NULL), bagian tingkat atas</option>{sections.filter(s => s.klasterId === section.klasterId && s.isActive !== false).map(s => <option key={s.code} value={s.code}>{s.code} - {s.name}</option>)}</select><span className="text-xs">Kode dan hierarki tidak dapat diubah setelah dibuat.</span></label>
        </>}
        <div className="flex gap-3 sm:col-span-2"><button type="submit" className={button}>Simpan Global</button><button type="button" className={button} onClick={() => setOpen(false)}>Batal</button></div>
      </fieldset>
    </form>}
    <div className="overflow-x-auto bg-white border rounded-xl"><table className="w-full text-left text-sm"><thead><tr>{['Kode / ID', 'Nama', 'Klaster', 'Status', 'Aksi'].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{rows.filter(r => (archived || r.isActive !== false) && (!klaster || r.klasterId === klaster) && JSON.stringify(r).toLowerCase().includes(query.toLowerCase())).map(row => <tr key={row.id} className="border-t"><td className="p-3">{'indikator' in row ? row.id : row.code}</td><td className="p-3 min-w-48">{'indikator' in row ? row.indikator : row.name}</td><td className="p-3">{row.klasterId}</td><td className="p-3">{row.isActive === false ? 'Arsip' : 'Aktif'}</td><td className="p-3"><div className="flex gap-2"><button className={button} disabled={disabled} onClick={() => edit(row)}>Ubah</button><button className={button} disabled={disabled} onClick={() => void run(() => 'indikator' in row ? row.isActive === false ? pkpStore.updateIndicator(row.id, { isActive: true, expectedUpdatedAt: row.updatedAt }) : pkpStore.deleteIndicator(row.id) : row.isActive === false ? pkpStore.updateSubKlaster(row.code, { isActive: true }) : pkpStore.deleteSubKlaster(row.code))}>{row.isActive === false ? 'Pulihkan' : 'Arsipkan'}</button></div></td></tr>)}</tbody></table></div>
  </section>;
}
