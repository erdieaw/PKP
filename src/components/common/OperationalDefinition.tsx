import { useEffect, useState } from 'react';
import { api, ApiError } from '../../services/apiClient';

export type StoredDefinition = {
  readonly definitionId: string;
  readonly indicatorId: string;
  readonly version: string;
  readonly year: number;
  readonly definition: string;
  readonly calculation: string;
  readonly dataSource: string | null;
  readonly notes: string | null;
  readonly targetDisplay: string;
  readonly sourceRef: string;
  readonly sourceHash: string;
  readonly sourceFile: string;
  readonly implementationStatus: string;
  readonly approvalStatus: string;
  readonly reason: string | null;
  readonly storage: 'DATABASE';
};

type Props = { readonly indicatorId: string; readonly year: number };
type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly value: StoredDefinition };

function DefinitionContent({ state }: { readonly state: LoadState }) {
  switch (state.kind) {
    case 'loading': return <p role="status">Memuat definisi dari database…</p>;
    case 'error': return <p role="alert" className="text-rose-800">{state.message}</p>;
    case 'ready': {
      const row = state.value;
      return <div className="space-y-4">
        <p className="text-slate-500">Tahun {row.year} · Tersimpan di database · {row.definitionId}</p>
        <p className="text-amber-900">Definisi dari workbook sumber. Belum merupakan pengesahan penilaian resmi Dinkes.</p>
        <section aria-label="Definisi operasional sumber"><h4 className="font-semibold text-slate-900">Definisi operasional</h4><p className="mt-1 whitespace-pre-wrap">{row.definition}</p></section>
        <section aria-label="Cara penghitungan sumber"><h4 className="font-semibold text-slate-900">Cara penghitungan</h4><p className="mt-1 whitespace-pre-wrap">{row.calculation}</p></section>
        <dl className="space-y-3">
          <div><dt className="font-semibold text-slate-900">Target pada sumber</dt><dd className="mt-1">{row.targetDisplay}</dd></div>
          <div><dt className="font-semibold text-slate-900">Sumber data</dt><dd className="mt-1 whitespace-pre-wrap">{row.dataSource ?? 'Tidak dicantumkan dalam sumber.'}</dd></div>
          {row.notes && <div><dt className="font-semibold text-slate-900">Catatan sumber</dt><dd className="mt-1 whitespace-pre-wrap">{row.notes}</dd></div>}
        </dl>
        <p className="border-t border-slate-200 pt-3 text-slate-600">{row.implementationStatus === 'IMPLEMENTED' ? 'Profil pengukuran tersedia; skor hanya diberikan pada rentang yang terdefinisi.' : 'Penghitungan otomatis V2 belum tersedia untuk indikator ini.'}</p>
        {row.reason && <p className="text-slate-600">{row.reason}</p>}
        <details className="text-slate-500"><summary className="cursor-pointer focus-visible:outline-emerald-600">Asal dan versi definisi</summary>
          <dl className="mt-2 space-y-2"><div><dt>Berkas</dt><dd>{row.sourceFile}</dd></div><div><dt>Lokasi sel</dt><dd>{row.sourceRef}</dd></div><div><dt>Versi</dt><dd>{row.version}</dd></div><div><dt>SHA-256 sumber</dt><dd className="break-all">{row.sourceHash}</dd></div></dl>
        </details>
      </div>;
    }
    default: return assertNever(state);
  }
}

export function OperationalDefinition({ indicatorId, year }: Props) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    void api.request<StoredDefinition>(`/master/indicators/${encodeURIComponent(indicatorId)}/definition?year=${year}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setState({ kind: 'ready', value }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', message: error instanceof ApiError ? error.message : 'Definisi belum dapat dimuat. Silakan coba lagi.' });
      });
    return () => controller.abort();
  }, [indicatorId, year, open, attempt]);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="border-y border-slate-200 py-3 text-sm text-slate-700">
    <summary className="cursor-pointer font-semibold text-emerald-800 focus-visible:outline-emerald-600">Definisi Operasional · {year}</summary>
    {open && <div className="pt-4 leading-relaxed break-words">
      <DefinitionContent state={state} />
      {state.kind === 'error' && <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 rounded border border-slate-300 px-3 py-2">Coba lagi</button>}
    </div>}
  </details>;
}

function assertNever(value: never): never { throw new TypeError(`Status definisi tidak dikenal: ${String(value)}`); }
