import { useEffect, useRef, useState } from 'react';
import { ProcessingIndicator } from '../common/ProcessingIndicator';
import { pkpStore } from '../../services/apiStore';
import { ApiError } from '../../services/apiClient';
import { provinceBridge, provinceError, provinceWarning } from '../../services/provinceBridge';
import { compareLocalEpRank, mappingDisplayRows, provinceCandidateCode, suggestProvinceMappings } from '../../services/provinceMapping';
import { compareIndicators, compareNumericCodes, indicatorOrdinal } from '../../services/indicatorOrder';
import { lastSyncText, mappingStatus } from '../../services/integrationStatus';
import type { ProvinceCatalog, ProvinceConfig, ProvinceConnection, ProvinceLogs, ProvinceMapping, ProvinceOperation, ProvincePreview, ProvinceValue } from '../../types/province';

const inputClass = 'mt-1 min-h-11 w-full min-w-0 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 disabled:bg-slate-50';
const buttonClass = 'min-h-11 px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
const primaryClass = `${buttonClass} bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700`;
const valueText = (value: ProvinceValue | undefined) => value === null || value === undefined ? 'Tidak tersedia (bukan nol)' : value === '' ? 'Teks kosong' : String(value);
const logActions = new Map([
  ['PROVINCE_CONFIG_SAVE', 'Simpan kredensial'], ['PROVINCE_TEST', 'Uji koneksi'],
  ['PROVINCE_CATALOG', 'Baca katalog'], ['PROVINCE_MAPPING_SAVE', 'Simpan pemetaan'], ['PROVINCE_PREVIEW', 'Baca pratinjau'],
]);
const logErrors = new Map([
  ['INVALID_REQUEST', 'Permintaan tidak valid'], ['FORBIDDEN', 'Akses ditolak'], ['CONFLICT', 'Konflik periode atau konfigurasi'],
  ['REMOTE_UNAVAILABLE', 'Layanan integrasi tidak tersedia'], ['INTERNAL_ERROR', 'Gangguan internal layanan'],
]);
const fieldLabels: Record<string, string> = {
  targetPct: 'Target (%)', totalSasaran: 'Total sasaran', targetSasaran: 'Target sasaran', pencapaianRiil: 'Pencapaian riil',
  capaianRiilPct: 'Capaian riil (%)', nilaiKinerja: 'Nilai kinerja', scoringVersion: 'Versi penilaian',
  kd_ind: 'Kode provinsi', indikator: 'Indikator', satuan: 'Satuan', total_sasaran: 'Total sasaran portal',
  bulan: 'Bulan', kdindikator: 'Kode provinsi', target: 'Target portal', sasaran: 'Satuan teks (bukan penyebut)',
  jml_sasaran: 'Jumlah sasaran portal', target_sasaran: 'Target sasaran portal', capaian: 'Capaian portal', hasil_riil: 'Hasil riil portal', hasil_kinerja: 'Hasil kinerja portal',
};
function Values({ data, missing }: { data: object | null; missing: string }) {
  if (data === null) return <p className="text-slate-500">{missing}</p>;
  return <dl className="space-y-1">{Object.entries(data).map(([key, value]) => <div key={key}><dt className="inline text-slate-500">{fieldLabels[key] ?? key}: </dt><dd className="inline break-words font-medium">{valueText(value)}</dd></div>)}</dl>;
}

export function ProvinceIntegrationPanel({ selectedMonth }: { selectedMonth: number }) {
  const user = pkpStore.getCurrentUser();
  const tenant = pkpStore.getSelectedHealthCenterId();
  const [config, setConfig] = useState<ProvinceConfig | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [catalog, setCatalog] = useState<ProvinceCatalog | null>(null);
  const [savedMappings, setSavedMappings] = useState<ProvinceMapping[]>([]);
  const [mappingRevision, setMappingRevision] = useState<number | null>(null);
  const [mappings, setMappings] = useState<ProvinceMapping[]>([]);
  const [mappingSummary, setMappingSummary] = useState<ReturnType<typeof suggestProvinceMappings>['counts'] | null>(null);
  const mappingsRef = useRef(mappings);
  const [connection, setConnection] = useState<ProvinceConnection | null>(null);
  const [rawPreview, setPreview] = useState<ProvincePreview | null>(null);
  const [operation, setOperation] = useState<ProvinceOperation>('TARGETS');
  const [pending, setPending] = useState<string | null>('Memuat konfigurasi');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [logs, setLogs] = useState<ProvinceLogs | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const logsController = useRef<AbortController | null>(null);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const indicators = pkpStore.getIndicators().map(indicator => ({ ...indicator, name: indicator.indikator })).sort(compareIndicators);
  const ranks = new Map(indicators.map((indicator, index) => [indicator.id, index]));
  const displayMappings = mappingDisplayRows(mappings, ranks);
  const catalogTargets = [...(catalog?.targets ?? [])].sort((a, b) => compareNumericCodes(a.kd_ind, b.kd_ind));
  const preview = rawPreview && {
    ...rawPreview,
    items: [...rawPreview.items].sort((a, b) => compareLocalEpRank(a.indicatorId, b.indicatorId, ranks)),
    unmappedRemote: [...rawPreview.unmappedRemote].sort((a, b) => compareNumericCodes('kd_ind' in a ? a.kd_ind : a.kdindikator, 'kd_ind' in b ? b.kd_ind : b.kdindikator)),
  };
  const validEps = indicators.filter(indicator => provinceCandidateCode(indicator) !== null);
  const dirtyConfig = !!config && (username !== (config.username ?? '') || code !== (config.provinceHealthCenterCode ?? '') || password !== '');
  const dirtyMappings = JSON.stringify(mappings) !== JSON.stringify(savedMappings);
  const disabled = !!pending || pkpStore.isMutating() || pkpStore.getLoadState().loading;
  const remoteDisabled = disabled || !config?.configured || config.activeYear == null || !config.provinceEnabled || dirtyConfig || reloadRequired;
  const remoteBlockReason = pending ? `${pending}. Tunggu hingga selesai.`
    : disabled ? 'Pemuatan atau penyimpanan data sedang berlangsung. Tunggu hingga selesai.'
    : reloadRequired ? 'Konfigurasi perlu dimuat ulang. Pilih "Muat ulang konfigurasi / coba lagi" sebelum mengakses portal.'
    : !config?.configured ? 'Lengkapi dan simpan kredensial pada langkah 1 sebelum mengakses portal.'
    : config.activeYear == null ? 'Tahun aktif belum ditetapkan. Minta Dinkes menetapkan tahun aktif dan mengaktifkan akses baca provinsi, lalu muat ulang konfigurasi.'
    : !config.provinceEnabled ? 'Akses baca provinsi dinonaktifkan. Minta Dinkes mengaktifkannya untuk tahun aktif, lalu muat ulang konfigurasi.'
    : dirtyConfig ? 'Simpan atau muat ulang perubahan kredensial sebelum mengakses portal.'
    : null;
  const validScope = () => !controller.current?.signal.aborted && pkpStore.getSessionUser() === user && pkpStore.getSelectedHealthCenterId() === tenant;
  const applyConfig = (next: ProvinceConfig) => {
    setConfig(next); setUsername(next.username ?? ''); setCode(next.provinceHealthCenterCode ?? ''); setPassword('');
    setConnection(null); setCatalog(null); setPreview(null); setReloadRequired(false); setMappingSummary(null);
  };
  const load = async (signal: AbortSignal) => {
    const next = await provinceBridge.config(signal);
    const mapping = await provinceBridge.mappings(signal);
    if (mapping.revision !== next.revision || mapping.periodRevision !== next.periodRevision) throw new ApiError(409, 'Revision changed during load');
    if (!signal.aborted && validScope()) { applyConfig(next); setMappingRevision(mapping.revision); setSavedMappings(mapping.items); mappingsRef.current = mapping.items; setMappings(mapping.items); }
  };
  const loadLogs = async (page: number) => {
    if (!validScope() || user.role !== 'ADMIN_PUSKESMAS' || !tenant || tenant !== user.healthCenterId) return;
    logsController.current?.abort();
    const current = new AbortController();
    logsController.current = current;
    setLogsLoading(true); setLogsError(null);
    const isCurrent = () => !current.signal.aborted && logsController.current === current && validScope();
    try {
      const result = await provinceBridge.logs(page, current.signal);
      if (isCurrent()) setLogs(result);
    } catch {
      if (isCurrent()) setLogsError('Riwayat integrasi gagal dimuat. Periksa koneksi dan segarkan riwayat untuk mencoba lagi.');
    } finally {
      if (isCurrent()) setLogsLoading(false);
    }
  };
  useEffect(() => {
    if (user.role !== 'ADMIN_PUSKESMAS' || !tenant || tenant !== user.healthCenterId) return;
    const current = new AbortController();
    controller.current = current; busy.current = true;
    void loadLogs(1);
    void load(current.signal).catch(cause => {
      if (!current.signal.aborted && validScope()) { setError(provinceError(cause)); setReloadRequired(true); }
    }).finally(() => { if (!current.signal.aborted && validScope()) { busy.current = false; setPending(null); } });
    return () => { current.abort(); logsController.current?.abort(); };
    // The parent keys this panel by user, own tenant, active-period revision and month.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (label: string, action: (signal: AbortSignal) => Promise<void>) => {
    if (busy.current || disabled || !validScope() || !controller.current) return;
    busy.current = true; setPending(label); setError(null); setSuccess(null); setPreview(null); setConnection(null);
    const signal = controller.current.signal;
    try { await action(signal); }
    catch (cause) {
      if (!signal.aborted && validScope()) {
        setError(provinceError(cause));
        if (cause instanceof ApiError && cause.status === 409) { setReloadRequired(true); setCatalog(null); }
      }
    } finally {
      if (!signal.aborted && validScope()) {
        setPassword(''); busy.current = false; setPending(null);
        // Audit reads must never replace the operation's original success or error.
        void loadLogs(1);
      }
    }
  };
  const editConfig = () => { setPreview(null); setConnection(null); setSuccess(null); setCatalog(null); setMappingSummary(null); };
  const editMappings = (next: ProvinceMapping[]) => { mappingsRef.current = next; setMappings(next); setPreview(null); setSuccess(null); setMappingSummary(null); };
  const completeMappings = (nextCatalog: ProvinceCatalog) => {
    const result = suggestProvinceMappings(pkpStore.getIndicators(), nextCatalog.targets, mappingsRef.current);
    editMappings(result.mappings);
    setMappingSummary(result.counts);
  };
  const reload = () => {
    if ((dirtyConfig || dirtyMappings) && !window.confirm('Muat ulang dan buang perubahan formulir yang belum disimpan?')) return;
    void run('Memuat konfigurasi', load);
  };
  const saveConfig = () => {
    if (!config || !username.trim() || !code.trim() || (!config.hasPassword && !password)) return;
    if (config.configured && (username !== config.username || code !== config.provinceHealthCenterCode) && !window.confirm('Perubahan username atau kode Puskesmas akan menghapus seluruh pemetaan tersimpan. Lanjutkan?')) return;
    void run('Menyimpan konfigurasi', async signal => {
      await provinceBridge.saveConfig({ revision: config.revision, username, provinceHealthCenterCode: code, ...(password ? { password } : {}) });
      if (!signal.aborted && validScope()) { setReloadRequired(true); await load(signal); if (validScope()) setSuccess('Konfigurasi tersimpan. Koneksi belum diuji.'); }
    });
  };
  const saveMappings = () => {
    if (mappingRevision === null || !catalog || catalog.revision !== mappingRevision) {
      setError('Revisi katalog berbeda dari pemetaan yang dimuat. Muat ulang konfigurasi dan pemetaan sebelum menyimpan.');
      setReloadRequired(true); setCatalog(null); setPreview(null); setConnection(null); return;
    }
    const validCodes = catalog?.targets.filter(t => catalog.targets.filter(other => other.kd_ind === t.kd_ind).length === 1).map(t => t.kd_ind) ?? [];
    if (mappings.some(m => !indicators.some(i => i.id === m.indicatorId) || !validCodes.includes(m.provinceCode)) || new Set(mappings.map(m => m.indicatorId)).size !== mappings.length || new Set(mappings.map(m => m.provinceCode)).size !== mappings.length) {
      setError('Pilih indikator lokal aktif dan kode katalog yang cocok persis. Setiap indikator dan kode hanya boleh dipakai sekali.'); return;
    }
    const removed = savedMappings.filter(old => !mappings.some(m => m.indicatorId === old.indicatorId && m.provinceCode === old.provinceCode)).length;
    if (removed && !window.confirm(`Ganti seluruh pemetaan? ${removed} pasangan tersimpan akan dihapus. Data penilaian tidak diubah.`)) return;
    void run('Menyimpan pemetaan', async signal => {
      await provinceBridge.saveMappings({ revision: mappingRevision, items: mappings });
      if (!signal.aborted && validScope()) { setReloadRequired(true); await load(signal); if (validScope()) setSuccess('Seluruh pemetaan tersimpan dan revisi konfigurasi dimuat ulang.'); }
    });
  };
  if (user.role !== 'ADMIN_PUSKESMAS' || !tenant || tenant !== user.healthCenterId) return null;
  return <div className="min-w-0 space-y-6 text-sm leading-relaxed text-slate-700" aria-busy={!!pending}>
    <section className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-800">Integrasi Provinsi</h3>
        <span className="rounded-md bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800">Hanya baca</span>
      </div>
      <p className="font-semibold break-words">{pkpStore.getSelectedHealthCenter()?.name}</p>
      <p>Siapkan kredensial, petakan indikator, lalu bandingkan data. Pratinjau tidak mengubah data lokal maupun provinsi. Sinkronisasi tidak tersedia.</p>
      {config && <p>Tahun aktif Dinkes: <strong>{config.activeYear ?? 'Belum ditetapkan'}</strong>. Akses baca portal: <strong>{config.provinceEnabled && config.activeYear != null ? 'Diaktifkan' : 'Dinonaktifkan'}</strong>.</p>}
      {pending ? <ProcessingIndicator label={`${pending}...`} description="Tunggu hingga proses selesai sebelum melanjutkan integrasi." /> : <p role="status">{connection && !dirtyConfig && connection.revision === config?.revision ? `Koneksi teruji pada ${new Date(connection.testedAt).toLocaleString('id-ID')} untuk kode ${connection.provinceHealthCenterCode}.` : config?.configured ? 'Konfigurasi tersimpan. Koneksi belum terverifikasi pada formulir ini.' : 'Konfigurasi belum tersedia atau belum dimuat.'}</p>}
      <p id="province-remote-reason" role="status" className={remoteBlockReason ? 'rounded-lg bg-amber-50 p-3 text-amber-900' : 'text-slate-600'}>{remoteBlockReason ?? 'Akses baca siap. Uji koneksi atau lanjutkan ke pemetaan indikator.'}</p>
      {error && <p role="alert" className="p-3 bg-rose-50 text-rose-700 rounded-lg">{error}</p>}
      {success && <p role="status" className="p-3 bg-emerald-50 text-emerald-700 rounded-lg">{success}</p>}
      <button type="button" disabled={disabled} onClick={reload} className={buttonClass}>Muat ulang konfigurasi / coba lagi</button>
    </section>

    {config && <>
      <form aria-labelledby="province-credentials-title" onSubmit={event => { event.preventDefault(); saveConfig(); }} className="bg-white p-5 rounded-xl border border-slate-200 space-y-4">
        <h3 id="province-credentials-title" className="text-base font-bold text-slate-800">1. Kredensial portal provinsi</h3>
        <p>{config.hasPassword ? 'Password sudah tersimpan di server. Kosongkan untuk mempertahankannya.' : 'Password wajib untuk konfigurasi pertama.'} Penyimpanan kredensial hanya lokal.</p>
        <details className="text-slate-600"><summary className="cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-emerald-600">Detail konfigurasi</summary><p>Revisi {config.revision}. Revisi periode {config.periodRevision}. Password pada formulir dikosongkan setelah operasi selesai.</p></details>
        <fieldset disabled={disabled || reloadRequired} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="font-semibold">Username<input required autoComplete="off" value={username} onChange={e => { editConfig(); setUsername(e.target.value); }} className={inputClass} /></label>
          <label className="font-semibold">{config.hasPassword ? 'Password pengganti (opsional)' : 'Password'}<input type="password" required={!config.hasPassword} autoComplete="new-password" value={password} onChange={e => { editConfig(); setPassword(e.target.value); }} className={inputClass} /></label>
          <label className="font-semibold">Kode Puskesmas provinsi<input required autoComplete="off" value={code} onChange={e => { editConfig(); setCode(e.target.value); }} className={inputClass} /><span className="font-normal text-slate-500">Harus cocok persis dengan identitas portal.</span></label>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button disabled={disabled || reloadRequired || !dirtyConfig} className={primaryClass}>Simpan kredensial</button>
          <button type="button" aria-describedby="province-remote-reason" disabled={remoteDisabled} onClick={() => void run('Menguji koneksi', async signal => { const result = await provinceBridge.test(signal); if (validScope()) { if (result.revision !== config.revision || result.periodRevision !== config.periodRevision) throw new ApiError(409, 'Revision changed'); setConnection(result); } })} className={buttonClass}>Uji koneksi tersimpan</button>
        </div>
      </form>

      <section aria-labelledby="province-mapping-title" className="min-w-0 bg-white p-5 rounded-xl border border-slate-200 space-y-4">
        <h3 id="province-mapping-title" className="text-base font-bold text-slate-800">2. Pemetaan indikator</h3>
        <p>Setelah katalog dimuat, pasangan kode persis yang unik di kedua sisi otomatis ditambahkan ke draf, tanpa mencocokkan nama. Pasangan yang sudah ada tidak ditimpa. Tidak disimpan otomatis; penyimpanan mengganti seluruh daftar pemetaan.</p>
        <p>Kandidat adalah konversi struktural bagian dan nomor lokal: 1.1 / 1. menjadi 1.01.01.01.01. Bagian dilengkapi hingga empat tingkat dengan 1, lalu nomor ditambahkan. Keberadaan kode persis di portal mengonfirmasi kecocokan format, bukan jaminan kesetaraan makna indikator. Periksa sebelum menyimpan atau gunakan pasangan manual.</p>
        <button aria-describedby="province-remote-reason" disabled={remoteDisabled} className={buttonClass} onClick={() => void run('Memuat katalog', async signal => { const result = await provinceBridge.catalog(signal); if (validScope()) { if (result.revision !== config.revision || result.revision !== mappingRevision || result.periodRevision !== config.periodRevision) throw new ApiError(409, 'Revision changed'); setCatalog(result); completeMappings(result); } })}>Ambil katalog provinsi</button>
        {catalog && <p>{catalog.targets.length} baris katalog. Tahun provinsi tidak diketahui. Kode duplikat tidak dapat dipilih.</p>}
        {mappingSummary && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-900">Usulan kandidat valid: {mappingSummary.proposed}. Ditambahkan ke draf: {mappingSummary.added}. Tidak ditemukan: {mappingSummary.unmatched}. Ambigu: {mappingSummary.ambiguous}. Sudah terpakai: {mappingSummary.occupied}. Tidak valid / dilewati: {mappingSummary.invalid}. Belum disimpan.</p>}
        <button type="button" disabled={!catalog || remoteDisabled} onClick={() => catalog && completeMappings(catalog)} className={buttonClass}>Lengkapi pemetaan kode persis</button>
        <fieldset disabled={remoteDisabled} className="space-y-3 min-w-0">
          <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200 focus-visible:ring-2 focus-visible:ring-emerald-600" tabIndex={0} role="region" aria-label="Tabel pemetaan indikator">
             <table className="w-full min-w-[640px] text-left"><thead className="bg-slate-100"><tr><th className="p-3">Kandidat kode / indikator lokal</th><th className="p-3">Kode provinsi persis</th><th className="p-3">Aksi</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{displayMappings.map(({ mapping, index }) => <tr key={index}>
                <td className="p-3"><label className="font-semibold">Kandidat kode lokal<input readOnly aria-label={`Kandidat kode lokal baris ${index + 1}`} value={provinceCandidateCode(indicators.find(i => i.id === mapping.indicatorId) ?? { id: mapping.indicatorId }) ?? 'Tidak tersedia'} className={inputClass} /></label><p className="text-xs text-slate-500">Hanya baca; bukan kode portal terverifikasi. ID lokal: {mapping.indicatorId || 'Belum dipilih'}</p><select aria-label={`Indikator lokal baris ${index + 1}`} className={inputClass} value={mapping.indicatorId} onChange={e => editMappings(mappings.map((m, i) => i === index ? { ...m, indicatorId: e.target.value } : m))}><option value="">Pilih indikator lokal</option>{!indicators.some(i => i.id === mapping.indicatorId) && mapping.indicatorId && <option value={mapping.indicatorId}>{mapping.indicatorId} (tidak aktif/tidak tersedia)</option>}{indicators.map(i => <option key={i.id} value={i.id}>{provinceCandidateCode(i) ?? 'Tanpa kandidat'} - {i.name} (ID: {i.id})</option>)}</select></td>
                <td className="p-3"><select disabled={!catalog || remoteDisabled} aria-label={`Kode provinsi baris ${index + 1}`} className={inputClass} value={mapping.provinceCode} onChange={e => editMappings(mappings.map((m, i) => i === index ? { ...m, provinceCode: e.target.value } : m))}><option value="">Pilih kode katalog</option>{mapping.provinceCode && !catalogTargets.some(t => t.kd_ind === mapping.provinceCode) && <option value={mapping.provinceCode}>{mapping.provinceCode} (belum diverifikasi)</option>}{catalogTargets.filter(t => catalogTargets.filter(other => other.kd_ind === t.kd_ind).length === 1).map(t => <option key={t.kd_ind} value={t.kd_ind}>{t.kd_ind} - {t.indikator}</option>)}</select><p className="mt-2">{mappingStatus(mapping.indicatorId, mappings, savedMappings)}</p><p className="text-slate-500">{lastSyncText}</p></td>
                <td className="p-3"><button type="button" aria-label={`Hapus pasangan baris ${index + 1}`} className={buttonClass} onClick={() => editMappings(mappings.filter((_, i) => i !== index))}>Hapus</button></td>
              </tr>)}</tbody></table>
          </div>
          {!mappings.length && <p>Belum ada pasangan pada formulir. Ambil katalog provinsi, lalu pilih "Tambah pasangan" untuk mulai memetakan. {savedMappings.length > 0 && 'Menyimpan daftar kosong akan menghapus semua pemetaan tersimpan.'}</p>}
          <div className="flex flex-wrap gap-2"><button type="button" disabled={!catalog || remoteDisabled} onClick={() => editMappings([...mappings, { indicatorId: '', provinceCode: '' }])} className={buttonClass}>Tambah pasangan</button><button type="button" disabled={!catalog || remoteDisabled || !dirtyMappings} onClick={saveMappings} className={primaryClass}>Simpan seluruh pemetaan</button></div>
        </fieldset>
        <details>
          <summary className="min-h-11 cursor-pointer rounded py-2 font-semibold focus-visible:ring-2 focus-visible:ring-emerald-600">Status integrasi seluruh EP lokal ({validEps.length})</summary>
          <p className="mb-3">Status pemetaan bukan bukti sinkronisasi. Akses provinsi hanya baca; waktu uji koneksi dan pratinjau bukan waktu sinkronisasi.</p>
          <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200" tabIndex={0} role="region" aria-label="Status integrasi seluruh EP lokal">
            <table className="w-full min-w-[640px] text-left"><thead className="sticky top-0 bg-slate-100"><tr>{['Kode / nama EP', 'Status pemetaan', 'Sinkron terakhir'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">{validEps.map(indicator => <tr key={indicator.id}><td className="p-3 break-words">{indicator.sectionCode}.{indicatorOrdinal(indicator.no)} - {indicator.name}</td><td className="p-3">{mappingStatus(indicator.id, mappings, savedMappings)}</td><td className="p-3">{lastSyncText}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      </section>

      <section aria-labelledby="province-preview-title" className="min-w-0 bg-white p-5 rounded-xl border border-slate-200 space-y-4">
        <h3 id="province-preview-title" className="text-base font-bold text-slate-800">3. Pratinjau hanya baca</h3>
        <p>Data lokal tersimpan: tahun {config.activeYear ?? 'belum ditetapkan'}, bulan {selectedMonth} untuk capaian bulanan. Tahun mengikuti periode aktif Dinkes, bukan pilihan tahun historis di header.</p>
        <p className="text-amber-900">Tahun data provinsi tidak diketahui. Kesetaraan rumus belum diverifikasi; angka lokal dan provinsi belum tentu setara.</p>
        <fieldset disabled={remoteDisabled || dirtyMappings} className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 max-w-full font-semibold">Jenis pratinjau<select className={inputClass} value={operation} onChange={e => { setOperation(e.target.value as ProvinceOperation); setPreview(null); }}><option value="TARGETS">Target tahunan lokal / target provinsi</option><option value="MONTHLY">Capaian bulanan</option></select></label>
          <button type="button" aria-describedby="province-remote-reason province-preview-reason" className={buttonClass} onClick={() => void run('Memuat pratinjau', async signal => { const result = await provinceBridge.preview(operation === 'MONTHLY' ? { operation, month: selectedMonth } : { operation }, signal); if (validScope()) { if (result.revision !== config.revision || result.periodRevision !== config.periodRevision) throw new ApiError(409, 'Revision changed'); setPreview(result); } })}>Lihat perbandingan</button>
        </fieldset>
        <p id="province-preview-reason" className="text-amber-900">{dirtyMappings && 'Simpan atau muat ulang pemetaan sebelum membuat pratinjau.'}</p>
        {preview && <>
          <p>Periode lokal: {preview.localYear}{preview.month ? `, bulan ${preview.month}` : ''}. Angka 0 adalah nilai tercatat; data tidak tersedia bukan berarti nol. Data lokal berasal dari rekaman tersimpan, bukan nilai bawaan formulir.</p>
          <ul aria-label="Status integrasi EP pratinjau" className="space-y-2">{preview.items.map(item => <li key={item.indicatorId} className="break-words">{indicators.find(i => i.id === item.indicatorId)?.name ?? item.indicatorId}: {mappingStatus(item.indicatorId, mappings, savedMappings)}. {lastSyncText}</li>)}</ul>
          <ul className="list-disc pl-5 text-amber-800 space-y-1">{preview.warnings.map(w => <li key={w}>{provinceWarning(w)}</li>)}</ul>
          <div className="max-h-[36rem] overflow-auto border border-slate-200 rounded-lg focus-visible:ring-2 focus-visible:ring-emerald-600" tabIndex={0} role="region" aria-label="Tabel perbandingan lokal dan provinsi"><table className="w-full min-w-[800px] text-left align-top"><thead className="sticky top-0 bg-slate-100"><tr>{['Indikator / kode', 'Lokal tersimpan', 'Provinsi (tahun tidak diketahui)', 'Peringatan khusus indikator'].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{preview.items.map(item => <tr key={item.indicatorId} className="align-top"><td className="p-3 break-words"><p className="font-semibold">{indicators.find(i => i.id === item.indicatorId)?.name ?? item.indicatorId}</p><p>ID lokal: {item.indicatorId}</p><p>Kode provinsi: {item.provinceCode}</p></td><td className="p-3"><Values data={item.local} missing="Belum ada rekaman lokal tersimpan (null)." /></td><td className="p-3"><Values data={item.remote} missing="Rekaman provinsi tidak tersedia atau ambigu (null)." /></td><td className="p-3">{item.warnings.some(w => !preview.warnings.includes(w)) ? <ul className="list-disc pl-4 space-y-1">{item.warnings.filter(w => !preview.warnings.includes(w)).map(w => <li key={w}>{provinceWarning(w)}</li>)}</ul> : <span className="text-slate-500">Tidak ada peringatan tambahan.</span>}</td></tr>)}</tbody></table></div>
          {!preview.items.length && <p>Tidak ada pemetaan tersimpan untuk dibandingkan.</p>}
          <details><summary className="min-h-11 cursor-pointer rounded py-2 font-semibold focus-visible:ring-2 focus-visible:ring-emerald-600">Data provinsi belum dipetakan ({preview.unmappedRemote.length})</summary>
            <p className="mb-3">Baris ini belum memiliki pasangan indikator lokal. Gunakan kode provinsi untuk melengkapi langkah 2.</p>
            {!!preview.unmappedRemote.length && <div className="max-h-[32rem] overflow-auto border border-slate-200 rounded-lg" tabIndex={0} role="region" aria-label="Data provinsi belum dipetakan"><table className="w-full min-w-[500px] text-left"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-3">Baris</th><th className="p-3">Nilai portal (tahun tidak diketahui)</th></tr></thead><tbody>{preview.unmappedRemote.map((row, i) => <tr key={i} className="border-t align-top"><td className="p-3">{i + 1}</td><td className="p-3"><Values data={row} missing="Tidak tersedia" /></td></tr>)}</tbody></table></div>}
          </details>
        </>}
      </section>
    </>}
    <section aria-labelledby="province-logs-title" aria-busy={logsLoading} className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="province-logs-title" className="text-base font-bold text-slate-800">Riwayat integrasi</h3>
        <button type="button" disabled={logsLoading} onClick={() => void loadLogs(1)} className={buttonClass}>Segarkan riwayat</button>
      </div>
      <p>Aktivitas Puskesmas sendiri, terbaru lebih dahulu. Hanya baca; tetap tersedia saat akses provinsi dinonaktifkan. Aktivitas baru dapat menggeser isi halaman.</p>
      {logsLoading && <p role="status">Memuat riwayat integrasi...</p>}
      {logsError && <p role="alert" className="p-3 bg-rose-50 text-rose-700 rounded-lg">{logsError}{logs && ' Riwayat di bawah adalah hasil pemuatan sebelumnya.'}</p>}
      {logs && <>
        {!logs.items.length && <p role="status">{logs.page === 1 ? 'Belum ada aktivitas integrasi tercatat.' : 'Tidak ada aktivitas pada halaman ini. Kembali ke halaman sebelumnya atau segarkan riwayat.'}</p>}
        <ol aria-label="Aktivitas integrasi" className="divide-y divide-slate-100">
          {logs.items.map(item => <li key={item.id} className="py-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{logActions.get(item.action) ?? 'Aktivitas integrasi'}</span>
              <span className={`px-2 py-1 rounded-md font-semibold ${item.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{item.status === 'SUCCESS' ? 'Berhasil' : item.status === 'FAILURE' ? 'Gagal' : 'Status tidak tersedia'}</span>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-slate-600">
              <div><dt className="inline">Waktu: </dt><dd className="inline">{Number.isNaN(Date.parse(item.timestamp)) ? 'Tidak tersedia' : new Date(item.timestamp).toLocaleString('id-ID')}</dd></div>
              <div><dt className="inline">Durasi: </dt><dd className="inline">{Number.isInteger(item.durationMs) && item.durationMs !== null && item.durationMs >= 0 ? `${item.durationMs.toLocaleString('id-ID')} ms` : 'Tidak tersedia'}</dd></div>
            </dl>
            {item.status === 'FAILURE' && <p className="text-rose-700">{logErrors.get(item.errorCode ?? '') ?? 'Penyebab tidak tersedia'}</p>}
            <details className="min-w-0 text-slate-600"><summary className="min-h-11 cursor-pointer rounded py-2 focus-visible:ring-2 focus-visible:ring-emerald-600">Detail pelaku</summary><p className="break-all">ID pelaku: {item.actorId ?? 'Tidak tersedia'}</p></details>
          </li>)}
        </ol>
        <nav aria-label="Halaman riwayat integrasi" className="flex flex-wrap items-center justify-between gap-2">
          <span>Halaman {logs.page}</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={logsLoading || logs.page <= 1} onClick={() => void loadLogs(logs.page - 1)} className={buttonClass}>Sebelumnya</button>
            <button type="button" disabled={logsLoading || !logs.hasMore || logs.page >= 1000000} onClick={() => void loadLogs(logs.page + 1)} className={buttonClass}>Berikutnya</button>
          </div>
        </nav>
      </>}
    </section>
  </div>;
}
