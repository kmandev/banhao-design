'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupervisorIdentityResponse } from '@banhao/validation';
import { ApiClientError } from '../lib/apiClient';
import { supervisorCaseRepository } from '../repositories/supervisorCases';
import { useAuth } from './useAuth';

/**
 * The staff grant this session actually holds, resolved by the server.
 *
 * This is **presentation state, not the access boundary**. The console asks the
 * API who it is so it can render the role and show a refusal instead of an
 * empty screen; the boundary is `@Roles('OPERATOR','ADMIN')` on every route,
 * re-resolved from `platform_staff` per request. A revoked grant therefore
 * produces a `FORBIDDEN` on the next call regardless of what this hook last
 * returned — which is exactly the Admin design package's acceptance criterion
 * 02, and why nothing here is cached beyond the component's lifetime.
 */
export type StaffStatus = 'loading' | 'granted' | 'forbidden' | 'error' | 'signed-out';

export interface StaffState {
  status: StaffStatus;
  identity: SupervisorIdentityResponse | null;
  reload: () => void;
}

export function useStaff(): StaffState {
  const { initialising, session } = useAuth();
  const [status, setStatus] = useState<StaffStatus>('loading');
  const [identity, setIdentity] = useState<SupervisorIdentityResponse | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (initialising) {
      setStatus('loading');
      return;
    }

    if (!session) {
      setIdentity(null);
      setStatus('signed-out');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    supervisorCaseRepository
      .identity()
      .then((resolved) => {
        if (cancelled) return;
        setIdentity(resolved);
        setStatus('granted');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setIdentity(null);
        // A signed-in account with no staff grant is refused by the server, and
        // that refusal is the answer — not an error to retry around.
        const forbidden = cause instanceof ApiClientError && cause.status === 403;
        setStatus(forbidden ? 'forbidden' : 'error');
      });

    return () => {
      cancelled = true;
    };
  }, [initialising, session, nonce]);

  return { status, identity, reload };
}
