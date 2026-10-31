import { useEffect, useRef, useState } from 'react';
import { pkpStore } from '../../services/apiStore';
import { api } from '../../services/apiClient';

export function useReportExport(scopeKey: string, enabled = true) {
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  useEffect(() => {
    generation.current++;
    active.current = false;
    setPending(false); setError(null); setFile(null);
    return () => {
      generation.current++;
      if (timer.current) clearTimeout(timer.current);
      wake.current?.();
      wake.current = null;
    };
  }, [scopeKey, enabled]);

  const create = async (format: 'excel' | 'pdf', quarter: 1 | 2 | 3 | 4 | 'ANNUAL') => {
    if (active.current || !enabled) return;
    active.current = true;
    const epoch = ++generation.current;
    setPending(true); setError(null); setFile(null);
    try {
      const created = await pkpStore.createExport(format, quarter);
      if (!created.jobId) throw new Error('Server tidak mengembalikan ID pekerjaan ekspor.');
      while (epoch === generation.current) {
        const job = await pkpStore.pollExport(created.jobId);
        if (epoch !== generation.current) return;
        if (job.status === 'FAILED') throw new Error(job.error || 'Ekspor gagal.');
        if (job.status === 'COMPLETED') {
          if (!job.downloadPath || !job.filename) throw new Error('Berkas unduhan belum tersedia.');
          setFile({ path: job.downloadPath, name: job.filename });
          return;
        }
        await new Promise<void>(resolve => {
          wake.current = resolve;
          timer.current = setTimeout(() => { timer.current = null; wake.current = null; resolve(); }, 1500);
        });
      }
    } catch (e) {
      if (epoch === generation.current) setError(e instanceof Error ? e.message : 'Ekspor gagal.');
    } finally {
      if (epoch === generation.current) { active.current = false; setPending(false); }
    }
  };
  const download = async () => {
    if (active.current || !enabled || !file) return;
    active.current = true;
    const epoch = ++generation.current;
    setPending(true); setError(null);
    try {
      const result = await pkpStore.downloadFile(file.path);
      if (epoch === generation.current) api.saveDownload(result, file.name);
    } catch (e) {
      if (epoch === generation.current) setError(e instanceof Error ? e.message : 'Unduhan gagal.');
    } finally {
      if (epoch === generation.current) { active.current = false; setPending(false); }
    }
  };
  return { create, download, pending, error, file };
}
