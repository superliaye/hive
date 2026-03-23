import { useState, useEffect, useCallback } from 'react';

export function useApi<T>(url: string, opts?: { refreshInterval?: number }) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    refetch();
    if (opts?.refreshInterval) {
      const id = setInterval(refetch, opts.refreshInterval);
      return () => clearInterval(id);
    }
  }, [refetch, opts?.refreshInterval]);

  return { data, loading, error, refetch, setData };
}
