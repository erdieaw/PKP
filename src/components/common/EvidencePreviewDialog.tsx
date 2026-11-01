import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '../../services/apiClient';
import type { DownloadedFile } from '../../services/apiClient';
import { pkpStore } from '../../services/apiStore';

interface Props {
  readonly evidenceId?: string | null;
  readonly file?: File;
  readonly onClose: () => void;
}

export function EvidencePreviewDialog({ evidenceId, file, onClose }: Props) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const scope = `${pkpStore.getSessionUser()?.id}:${pkpStore.getSelectedHealthCenterId()}:${pkpStore.getCurrentYear()}`;
  const initialScope = useRef(scope);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<{ file: DownloadedFile; url: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    if (scope !== initialScope.current) onClose();
  }, [scope, onClose]);

  useEffect(() => {
    let ignore = false;
    let url: string | null = null;
    setPreview(null);
    setError(null);
    setRenderFailed(false);
    if (scope !== initialScope.current) return;
    void (async () => {
      try {
        const downloaded = file ? { blob: file, filename: file.name } : evidenceId
          ? await pkpStore.getEvidenceDownload(evidenceId) : null;
        if (ignore) return;
        if (!downloaded) throw new Error('Bukti dukung tidak tersedia.');
        // Only render supported MIME types, never HTML or an external document viewer.
        if (['application/pdf', 'image/png', 'image/jpeg'].includes(downloaded.blob.type)) {
          url = URL.createObjectURL(downloaded.blob);
        }
        setPreview({ file: downloaded, url });
      } catch (failure) {
        if (!ignore) setError(failure instanceof Error ? failure.message : 'Pratinjau gagal dimuat.');
      }
    })();
    return () => {
      ignore = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [evidenceId, file, attempt, scope]);

  if (scope !== initialScope.current) return null;
  const filename = preview?.file.filename || file?.name || 'Bukti dukung';
  return (
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      className="w-[calc(100%_-_2rem)] max-w-5xl max-h-[90svh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-0 text-slate-800 shadow-xl backdrop:bg-slate-900/50">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-bold">Pratinjau bukti dukung</h2>
          <p className="mt-1 break-words text-sm text-slate-600">{filename}</p>
          {file && <p className="mt-1 text-xs text-slate-500">File lokal. Pratinjau tidak mengunggah atau menyimpan capaian.</p>}
        </div>
        <button type="button" autoFocus onClick={onClose}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-emerald-600">Tutup pratinjau</button>
      </div>
      <div className="p-4">
        {!preview && !error && <p role="status" className="py-8 text-sm">Memuat pratinjau bukti dukung...</p>}
        {error && <div className="space-y-3 py-8 text-sm">
          <p role="alert" className="text-rose-700">{error}</p>
          <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded-lg border border-slate-300 px-3 py-2">Coba lagi</button>
        </div>}
        {preview && <div className="space-y-4">
          {preview.url && !renderFailed ? preview.file.blob.type === 'application/pdf'
            ? <object data={preview.url} type="application/pdf" title="Pratinjau PDF bukti dukung"
              onError={() => setRenderFailed(true)} className="h-[60svh] w-full rounded-lg border border-slate-200 bg-slate-50">
              <p className="p-4 text-sm">Browser ini tidak menampilkan PDF. Gunakan Unduh bukti dukung untuk membukanya.</p>
            </object>
            : <div className="flex min-h-40 justify-center rounded-lg bg-slate-50 p-2">
              <img src={preview.url} alt={`Bukti dukung: ${filename}`} onError={() => setRenderFailed(true)}
                className="max-h-[60svh] max-w-full object-contain" />
            </div>
            : <p role="status" className="py-8 text-sm text-slate-600">{renderFailed
              ? 'File tidak dapat ditampilkan. Unduh bukti untuk membukanya di perangkat Anda.'
              : 'Pratinjau format ini belum tersedia. Untuk XLSX, unduh dan buka dengan aplikasi spreadsheet.'}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 text-xs text-slate-500">
            <p>Jika pratinjau tidak tampil di browser ini, gunakan Unduh bukti dukung.</p>
            <button type="button" onClick={() => api.saveDownload(preview.file, file?.name || `bukti-${evidenceId}`)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-emerald-600">Unduh bukti dukung</button>
          </div>
        </div>}
      </div>
    </dialog>
  );
}
