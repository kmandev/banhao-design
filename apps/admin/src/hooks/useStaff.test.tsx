import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { useStaff } from './useStaff';
import { ApiClientError } from '../lib/apiClient';

const identity = jest.fn();

jest.mock('../repositories/supervisorCases', () => ({
  supervisorCaseRepository: {
    identity: () => identity(),
    list: jest.fn(),
    detail: jest.fn(),
    resolve: jest.fn(),
  },
}));

let authState = { initialising: false, session: { access_token: 'token' } as unknown };

jest.mock('./useAuth', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

beforeEach(() => {
  identity.mockReset();
  authState = { initialising: false, session: { access_token: 'token' } };
});

describe('useStaff', () => {
  it('reports the grant the server resolved, never one inferred on the client', async () => {
    identity.mockResolvedValue({ userId: 'u1', staffRole: 'ADMIN' });

    const { result } = renderHook(() => useStaff());

    await waitFor(() => expect(result.current.status).toBe('granted'));
    expect(result.current.identity).toEqual({ userId: 'u1', staffRole: 'ADMIN' });
  });

  it('treats a 403 as a refusal rather than an error to retry', async () => {
    identity.mockRejectedValue(new ApiClientError(403, { code: 'FORBIDDEN' }));

    const { result } = renderHook(() => useStaff());

    await waitFor(() => expect(result.current.status).toBe('forbidden'));
    expect(result.current.identity).toBeNull();
  });

  it('distinguishes a failed capability read from a refusal', async () => {
    identity.mockRejectedValue(new ApiClientError(500, { code: 'INTERNAL_ERROR' }));

    const { result } = renderHook(() => useStaff());

    // Rendering a network failure as "you have no access" would send a real
    // operator away from a queue they are entitled to work.
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('never asks the server who it is when there is no session', async () => {
    authState = { initialising: false, session: null };

    const { result } = renderHook(() => useStaff());

    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(identity).not.toHaveBeenCalled();
  });
});
