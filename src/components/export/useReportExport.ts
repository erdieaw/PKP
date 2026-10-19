import { useEffect, useRef, useState } from 'react';
import { pkpStore } from '../../services/apiStore';

export function useReportExport(scopeKey: string, enabled = true) {
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
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
          if (!job.downloadUrl) throw new Error('Tautan unduhan belum tersedia.');
          setFile({ url: job.downloadUrl, name: `sheet7-${job.year}-${job.quarter}.${job.format}` });
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
  return { create, pending, error, file };
}
