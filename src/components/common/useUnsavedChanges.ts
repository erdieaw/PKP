import { useEffect, useRef } from 'react';

const drafts = new Map<symbol, string | undefined>();

export function confirmDiscardChanges(scope?: string) {
  const dirty = scope === undefined ? drafts.size > 0 : [...drafts.values()].includes(scope);
  return !dirty || window.confirm('Ada perubahan capaian yang belum disimpan. Buang perubahan dan lanjutkan?');
}

export function useUnsavedChanges(dirty: boolean, scope?: string) {
  const id = useRef(Symbol('input-draft'));
  useEffect(() => {
    if (!dirty) return;
    const key = id.current;
    drafts.set(key, scope);
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => {
      drafts.delete(key);
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty, scope]);
}
