import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import { pkpStore } from '../../services/apiStore';
import { getMonthlyInputBlockReason, monthPeriodLabel } from '../../services/inputPeriod';
import type { AnnualStructuredInput, Do2026Profile, RecapLedgerDraft } from '../../types/do2026';
import type { SourceAssessmentDraft, SourceAssessmentInput } from '../../types/sourceAssessment';
import { assertSourceIdentity, createSourceAssessmentDraft, parseSourceAssessmentDraft, sourceAssessmentCounts, sourcePeriodLabels, validateSourceAssessment } from '../../services/sourceAssessment';
import { createRecapLedgerDraft, parseRecapLedgerDraft, recapLedgerCounts, structuredInputKindFor, validateRecapLedger } from '../../services/recapStructuredInput';
import { confirmDiscardChanges, useUnsavedChanges } from '../common/useUnsavedChanges';
import type { PeriodRecapItem } from './recap-types';
import { recapMonths } from './recap-types';
import { RecapLedgerEditor } from './recap-ledger-editor';
import { RecapAnnualEditor } from './recap-annual-editor';
import { SourceAssessmentEditor } from './SourceAssessmentEditor';

export function getRecapInputBlockReason(year: number, endMonth: number, healthCenterId: string, indicatorId?: string, profile?: Do2026Profile): string | null {
  if (!pkpStore.getSessionUser()) return 'Sesi berakhir. Silakan masuk kembali.';
  if (pkpStore.getSelectedHealthCenterId() !== healthCenterId || pkpStore.getCurrentYear() !== year) {
    return 'Lingkup Puskesmas atau tahun berubah. Buka kembali rekap pada periode yang dipilih.';
  }
  const live = pkpStore.getIndicators().find(row => row.id === indicatorId)?.do2026;
  const source = profile?.sourceAssessment ?? live?.sourceAssessment;
  // The recap endpoint checks every storage-period lock, independently of the observation window.
  for (let month = 1; month <= endMonth; month++) {
    const reason = getMonthlyInputBlockReason(year, month, indicatorId);
    if (reason) return reason;
  }
  if (source?.period === 'QUARTER' && endMonth % 3 !== 0) return 'Pilih Maret, Juni, September atau Desember untuk satu triwulan utuh.';
  if (source?.period === 'SCHOOL_YEAR' && year !== 2026) return 'Sumber hanya menetapkan tahun ajaran 2025/2026 untuk penilaian 2026.';
  if (endMonth !== 12 && ((!source && profile?.structuredInputKind) || (indicatorId && structuredInputKindFor(indicatorId)) || profile?.annualRecapOnly ||
    (!source && pkpStore.getIndicators().find(row => row.id === indicatorId)?.do2026?.structuredInputKind) ||
    pkpStore.getIndicators().find(row => row.id === indicatorId)?.do2026?.annualRecapOnly)) {
    return 'Profil ini hanya menerima rekap tahunan Januari sampai Desember yang dikonfirmasi. Rekap parsial tidak dapat diubah. Pilih Desember pada Akhir periode rekap untuk mengisi rekap tahunan.';
  }
  if (pkpStore.isMutating()) return 'Tunggu penyimpanan selesai sebelum mengubah rekap.';
  return null;
}

interface Props {
  readonly item: PeriodRecapItem;
  readonly profile: Do2026Profile;
  readonly year: number;
  readonly endMonth: number;
  readonly healthCenterId: string;
  readonly readOnlyReason: string | null;
  readonly onPendingChange: (pending: boolean) => void;
  readonly onSaved: () => void;
}

export function RecapEditor({ item, profile, year, endMonth, healthCenterId, readOnlyReason, onPendingChange, onSaved }: Props) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [contract] = useState(() => {
    const kind = profile.structuredInputKind;
    const expectedKind = structuredInputKindFor(item.indicatorId);
    let ledger: RecapLedgerDraft | null = null;
    let sourceDraft: SourceAssessmentDraft | null = null;
    let issue: string | null = null;
    try {
      if (kind === 'DO_SOURCE_ASSESSMENT') {
        const descriptor = assertSourceIdentity(profile, item.indicatorId);
        if (item.recapRevision > 0 && item.recapStructuredInput == null) throw new Error('Asesmen tersimpan tidak tersedia.');
        if (item.recapStructuredInput != null) {
          validateSourceAssessment(item.recapStructuredInput, descriptor, year, endMonth);
          const counts = sourceAssessmentCounts(item.recapStructuredInput);
          if ((item.numerator !== null && item.numerator !== counts.numerator) || (item.denominator !== null && item.denominator !== counts.denominator)) throw new Error('N/D tersimpan tidak sesuai asesmen.');
          sourceDraft = item.recapStructuredInput;
        } else sourceDraft = createSourceAssessmentDraft(descriptor, year, endMonth);
      } else {
      if (profile.sourceAssessment || kind !== expectedKind) {
        throw new Error('Jenis ledger tidak dikenal.');
      }
      if (expectedKind && (!profile.annualRecapOnly || profile.measurementUnit !== (expectedKind === 'SEMESTER_SURVEY_ANNUAL' ? 'SCORE' : 'PERCENT') ||
        profile.numeratorInput !== (expectedKind === 'SEMESTER_SURVEY_ANNUAL' ? 'DECIMAL' : 'INTEGER') || profile.denominatorInput !== 'INTEGER')) {
        throw new Error('Kontrak tahunan atau unit tidak sesuai identitas.');
      }
      if (kind) {
        if (item.recapRevision > 0 && item.recapStructuredInput == null) throw new Error('Ledger tersimpan tidak tersedia.');
        if (item.recapStructuredInput != null) {
          validateRecapLedger(item.recapStructuredInput, kind, year);
          ledger = item.recapStructuredInput;
        } else ledger = createRecapLedgerDraft(kind, year);
      } else if (item.recapStructuredInput != null) throw new Error('Ledger tidak sesuai profil.');
      }
    } catch {
      issue = 'Format ledger tersimpan atau jenis profil tidak dikenal/tidak sesuai tahun. Muat ulang rekap; penyimpanan ditahan agar data tidak terhapus.';
    }
    return { kind, ledger, sourceDraft, sourceDescriptor: profile.sourceAssessment, profileSignature: JSON.stringify(profile), issue, year, endMonth, healthCenterId, indicatorId: item.indicatorId, revision: item.recapRevision,
      numeratorInput: profile.numeratorInput, denominatorInput: profile.denominatorInput,
      annualOnly: !!profile.annualRecapOnly, definitionId: profile.definitionId, measurementUnit: profile.measurementUnit,
      stored: JSON.stringify(item.recapStructuredInput ?? null) };
  });
  const [ledger, setLedger] = useState(contract.ledger);
  const [sourceDraft, setSourceDraft] = useState(contract.sourceDraft);
  const [numerator, setNumerator] = useState(item.numerator?.toString() ?? '');
  const [denominator, setDenominator] = useState(item.denominator?.toString() ?? '');
  const [notes, setNotes] = useState(item.recapNotes ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [baseline, setBaseline] = useState({ numerator, denominator, notes, confirmed, ledger, sourceDraft });
  const [userId] = useState(() => pkpStore.getSessionUser()?.id);
  const [userRole] = useState(() => pkpStore.getSessionUser()?.role);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);
  const dirty = numerator !== baseline.numerator || denominator !== baseline.denominator || notes !== baseline.notes || confirmed !== baseline.confirmed || JSON.stringify(ledger) !== JSON.stringify(baseline.ledger) || JSON.stringify(sourceDraft) !== JSON.stringify(baseline.sourceDraft);
  useUnsavedChanges(dirty || pending, 'recap');
  function contractBlockReason() {
    if (contract.issue) return contract.issue;
    const live = pkpStore.getIndicators().find(row => row.id === item.indicatorId)?.do2026;
    if (contract.kind === 'DO_SOURCE_ASSESSMENT') {
      try { if (!live) throw new Error('Missing'); assertSourceIdentity(live, item.indicatorId); assertSourceIdentity(profile, item.indicatorId); }
      catch { return 'Identitas descriptor sumber berubah. Draft dipertahankan; muat ulang rekap.'; }
      if (JSON.stringify(live) !== contract.profileSignature || JSON.stringify(profile) !== contract.profileSignature) return 'Metadata sumber berubah. Draft dipertahankan; muat ulang rekap.';
    }
    if (profile.structuredInputKind !== contract.kind || live?.structuredInputKind !== contract.kind ||
      (contract.kind !== 'DO_SOURCE_ASSESSMENT' && (profile.status !== 'IMPLEMENTED' || live?.status !== 'IMPLEMENTED')) ||
      profile.numeratorInput !== contract.numeratorInput || live?.numeratorInput !== contract.numeratorInput ||
      profile.denominatorInput !== contract.denominatorInput || live?.denominatorInput !== contract.denominatorInput ||
      !!profile.annualRecapOnly !== contract.annualOnly || !!live?.annualRecapOnly !== contract.annualOnly ||
      profile.definitionId !== contract.definitionId || live?.definitionId !== contract.definitionId ||
      profile.measurementUnit !== contract.measurementUnit || live?.measurementUnit !== contract.measurementUnit ||
      year !== contract.year || endMonth !== contract.endMonth || healthCenterId !== contract.healthCenterId || item.indicatorId !== contract.indicatorId ||
      item.recapRevision !== contract.revision ||
      JSON.stringify(item.recapStructuredInput ?? null) !== contract.stored) {
      return 'Profil atau ledger sumber berubah. Draft tetap dipertahankan; muat ulang rekap sebelum menyimpan.';
    }
    if (pkpStore.getSessionUser()?.id !== userId) return 'Sesi pengguna berubah. Buka kembali rekap sebelum menyimpan.';
    if (pkpStore.getSessionUser()?.role !== userRole) return 'Peran pengguna berubah. Draft dipertahankan; buka kembali rekap sebelum menyimpan.';
    return null;
  }
  const blockReason = getRecapInputBlockReason(year, endMonth, healthCenterId, item.indicatorId, profile) ?? contractBlockReason() ?? readOnlyReason;
  const blocked = Boolean(blockReason) || pending;
  let parsedLedger: AnnualStructuredInput | null = null;
  let parsedSource: SourceAssessmentInput | null = null;
  let ledgerError: string | null = null;
  if (ledger) {
    try { parsedLedger = parseRecapLedgerDraft(ledger); }
    catch (failure) { ledgerError = failure instanceof Error ? failure.message : 'Periksa ledger sebelum menyimpan.'; }
  }
  if (sourceDraft && contract.sourceDescriptor) {
    try { parsedSource = parseSourceAssessmentDraft(sourceDraft, contract.sourceDescriptor, year, endMonth); }
    catch (failure) { ledgerError = failure instanceof Error ? failure.message : 'Periksa asesmen sumber.'; }
  }
  const counts = parsedSource ? sourceAssessmentCounts(parsedSource) : parsedLedger ? recapLedgerCounts(parsedLedger) : ledger?.kind === 'PME_ANNUAL' || ledger?.kind === 'RTM_ANNUAL' ? recapLedgerCounts(ledger) : null;
  const combinedUnavailable = sourceDraft?.values.kind === 'COMPONENT_OBSERVATIONS' || sourceDraft?.values.kind === 'SOURCE_OBSERVATION';
  const hasPayload = !!ledger || !!sourceDraft;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || controller.current || pkpStore.isMutating()) return;
    const user = pkpStore.getSessionUser();
    const liveReason = getRecapInputBlockReason(year, endMonth, healthCenterId, item.indicatorId, profile) ?? contractBlockReason();
    if (!user || user.id !== userId || liveReason || readOnlyReason) {
      setError(liveReason ?? readOnlyReason ?? 'Sesi pengguna berubah. Buka kembali rekap sebelum menyimpan.');
      return;
    }
    if (!confirmed) return;
    if (hasPayload && ((!parsedLedger && !parsedSource) || ledgerError)) {
      setError(ledgerError ?? 'Periksa ledger sebelum menyimpan.'); return;
    }
    const actualNumerator = counts?.numerator ?? Number(numerator);
    const actualDenominator = counts?.denominator ?? Number(denominator);
    if ((!hasPayload && (!numerator.trim() || !denominator.trim())) || !notes.trim() ||
      !Number.isFinite(actualNumerator) || !Number.isFinite(actualDenominator) || actualNumerator < 0 || actualDenominator < 0) {
      setError('Isi N, D nonnegatif dan catatan sumber. Kosong bukan nol.');
      return;
    }
    if (!sourceDraft && ((profile.numeratorInput === 'INTEGER' && !Number.isInteger(actualNumerator)) ||
      (profile.denominatorInput === 'INTEGER' && !Number.isInteger(actualDenominator)))) {
      setError('Isi bilangan bulat untuk N dan D berupa hitungan sesuai DO. Jangan membulatkan data sumber secara otomatis.');
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setError(null);
    try {
      await pkpStore.savePeriodRecap({
        year, endMonth, indicatorId: item.indicatorId, numerator: actualNumerator,
        denominator: actualDenominator, notes: notes.trim(), confirmed: true, expectedRevision: item.recapRevision,
        ...(parsedSource || parsedLedger ? { structuredInput: parsedSource ?? parsedLedger! } : {}),
      });
      if (!request.signal.aborted) {
        setNotes(notes.trim());
        setBaseline({ numerator, denominator, notes: notes.trim(), confirmed, ledger, sourceDraft });
        onSaved();
      }
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : 'Rekap gagal disimpan. Coba kembali.');
    } finally {
      if (!request.signal.aborted) {
        controller.current = null;
        setPending(false);
      }
    }
  }

  return <details open={open} className="border-t border-slate-200 pt-4">
    <summary onClick={event => {
      event.preventDefault();
      if (open) {
        if (pending || controller.current || pkpStore.isMutating() || !confirmDiscardChanges('recap')) return;
        setNumerator(baseline.numerator);
        setDenominator(baseline.denominator);
        setNotes(baseline.notes);
        setConfirmed(baseline.confirmed);
        setLedger(baseline.ledger);
        setSourceDraft(baseline.sourceDraft);
        setError(null);
      }
      setOpen(!open);
    }} className="cursor-pointer font-semibold text-emerald-800 focus-visible:outline-emerald-600">Isi atau perbarui rekap terpisah</summary>
    <form onSubmit={save} className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">{contract.sourceDescriptor ? `Simpan asesmen terpisah: ${sourcePeriodLabels[contract.sourceDescriptor.period]}; cutoff pada ${monthPeriodLabel(year, endMonth)}.` : `Simpan angka rekap Januari sampai ${monthPeriodLabel(year, endMonth)}. Ini bukan input untuk bulan akhir saja.`} Puskesmas: {pkpStore.getSelectedHealthCenter()?.name ?? healthCenterId}. Data bulanan tidak ditimpa.</p>
      {profile.annualRecapOnly && <p className="text-sm text-slate-600">Hanya rekap tahunan Januari sampai Desember yang dikonfirmasi sesuai DO. Bukan penjumlahan otomatis data bulanan; pengukuran dan ketercapaian tidak berarti skor kinerja tersedia.</p>}
      {profile.annualRecapOnly && profile.assessmentInstruction && <p role="status" className="whitespace-pre-wrap text-sm text-amber-900">{profile.assessmentInstruction}</p>}
      {blockReason && <p role="status" className="text-sm text-amber-900">{blockReason}</p>}
      {sourceDraft && contract.sourceDescriptor && <SourceAssessmentEditor value={sourceDraft} descriptor={contract.sourceDescriptor} disabled={blocked} onChange={setSourceDraft} />}
      {ledger && (ledger.kind === 'PME_ANNUAL' || ledger.kind === 'RTM_ANNUAL'
        ? <RecapLedgerEditor value={ledger} disabled={blocked} onChange={setLedger} />
        : <RecapAnnualEditor value={ledger} disabled={blocked} onChange={setLedger} />)}
      {combinedUnavailable ? <p className="text-sm text-slate-600">N/D gabungan: tidak berlaku untuk observasi komponen/sumber. Tidak dijumlahkan atau dirata-rata. API menyimpan placeholder kompatibilitas 0/0, bukan hasil pengukuran.</p> : <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">{profile.numeratorLabel || 'Pembilang aktual (N)'}
          <input type="number" min="0" step={profile.numeratorInput === 'INTEGER' ? '1' : 'any'} required disabled={blocked} readOnly={hasPayload} value={counts?.numerator ?? (hasPayload ? '' : numerator)} onChange={event => setNumerator(event.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100" />
        </label>
        <label className="block text-sm font-medium">{profile.denominatorLabel || 'Penyebut aktual (D)'}
          <input type="number" min="0" step={profile.denominatorInput === 'INTEGER' ? '1' : 'any'} required disabled={blocked} readOnly={hasPayload} value={counts?.denominator ?? (hasPayload ? '' : denominator)} onChange={event => setDenominator(event.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100" />
        </label>
      </div>}
      {sourceDraft && <p role="status" className="text-sm text-slate-600">N/D API diturunkan dari observasi valid. Angka dapat tersedia dengan hasil ukur null bila konteks belum lengkap. {ledgerError}</p>}
      {ledger && <p className="text-sm text-slate-600">N/D dihitung dari ledger valid dan tidak dapat diedit. Server menghitung ulang serta menolak angka yang tidak cocok. {ledgerError && 'Lengkapi ledger untuk memperoleh N/D; draft tetap dipertahankan.'}</p>}
      {ledger && ledger.kind !== 'PME_ANNUAL' && ledger.kind !== 'RTM_ANNUAL' && ledgerError && <p role="status" className="text-sm text-amber-900">{ledgerError}</p>}
      <label className="block text-sm font-medium">Sumber dan cara menyusun rekap (wajib)
        <textarea required maxLength={2000} rows={3} disabled={blocked} value={notes} onChange={event => setNotes(event.target.value)}
          placeholder="Sebutkan register, periode, kesesuaian sampel/metode, dan cara memastikan data tidak dihitung ganda."
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100" />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" required checked={confirmed} disabled={blocked} onChange={event => setConfirmed(event.target.checked)} className="mt-1 accent-emerald-700" />
        <span>{sourceDraft ? 'Saya mengonfirmasi pencatatan asesmen pada lingkup, status kelengkapan, referensi dan gap yang dinyatakan; ini tidak mengonfirmasi otomatis semua kriteria atau kelayakan sumber.' : `Saya telah merekonsiliasi sumber rekap Januari sampai ${recapMonths[endMonth - 1]} ${year}, memeriksa kesesuaian sampel/metode dan periode, serta memastikan tidak ada penghitungan ganda sesuai DO.`} Konfirmasi ini bukan pengesahan Dinkes.</span>
      </label>
      {(ledger?.kind === 'PME_ANNUAL' || ledger?.kind === 'RTM_ANNUAL') && <p className="text-sm text-slate-600">Dengan konfirmasi ini, daftar kosong dinyatakan nihil sepanjang tahun sesuai catatan sumber, bukan data hilang. Referensi belum divalidasi sebagai bukti eksternal.</p>}
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      <button type="submit" disabled={blocked || !confirmed || (!!ledgerError && ledger?.kind !== 'PME_ANNUAL' && ledger?.kind !== 'RTM_ANNUAL')} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? 'Menyimpan rekap...' : 'Simpan rekap terpisah'}
      </button>
    </form>
  </details>;
}
