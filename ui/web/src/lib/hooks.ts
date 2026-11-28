import { useCallback, useEffect, useRef, useState } from "react";

/** Loads data for a view. `reload` runs the loader again; stale answers are dropped. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const generation = useRef(0);
  const run = useCallback(() => {
    const mine = ++generation.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    loader().then(
      (data) => { if (mine === generation.current) setState({ data, loading: false }); },
      (error: Error) => { if (mine === generation.current) setState({ error: error.message, loading: false }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function useInterval(callback: () => void, ms: number | null) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
