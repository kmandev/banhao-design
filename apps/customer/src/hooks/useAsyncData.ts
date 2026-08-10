import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T };

/**
 * Fetches from a repository and exposes loading/error/success explicitly, so
 * every screen has to handle the states the design specifies (brief §17)
 * rather than rendering an empty view while data is in flight.
 */
export function useAsyncData<T>(
  load: () => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    load()
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'เกิดข้อผิดพลาด',
        });
      });

    return () => {
      cancelled = true;
    };
    // NOTE: `load` is intentionally NOT a dependency. Callers pass inline
    // closures, so including it would re-run the effect on every render.
    // `deps` is the caller's explicit contract for when to refetch.
  }, [...deps, nonce]);

  return { ...state, reload };
}
