import { useCallback, useEffect, useState } from 'react';

export function useAsync<T>(loader: () => Promise<T>) {
  const [result, setResult] = useState<{
    loader: typeof loader;
    revision: number;
    data: T | null;
    error: string | null;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    loader()
      .then((data) => {
        if (active) setResult({ loader, revision, data, error: null });
      })
      .catch((reason) => {
        if (active)
          setResult({
            loader,
            revision,
            data: null,
            error: reason instanceof Error ? reason.message : 'Tente novamente em instantes.',
          });
      });
    return () => {
      active = false;
    };
  }, [loader, revision]);
  useEffect(() => {
    window.addEventListener('policy:data-changed', reload);
    return () => window.removeEventListener('policy:data-changed', reload);
  }, [reload]);
  const current = result?.loader === loader && result.revision === revision;
  return {
    data: result?.loader === loader ? result.data : null,
    loading: !current,
    error: current ? result.error : null,
    reload,
  };
}
