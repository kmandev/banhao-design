import { act, renderHook, waitFor } from '@testing-library/react';
import { useAvailability } from './useAvailability';
import type { MerchantAvailabilityRepository } from '../repositories/merchantAvailability';
import { ApiClientError } from '../lib/apiClient';

/**
 * M-13's board-header state layer, tested the same way `useRestaurantProfile`
 * is exercised through its own form (load → ready, save → re-read, failure
 * leaves state untouched) — here directly, since the hook takes its
 * repository as an explicit argument.
 *
 * The repository is built ONCE per test, before `renderHook`, and referenced
 * by closure — never constructed inside the render callback. A fresh object
 * literal there would get a new identity on every render, and since
 * `repository` sits in the load effect's dependency array, that would refire
 * the effect on every state change and spin forever.
 */

function repo(overrides: Partial<MerchantAvailabilityRepository> = {}): MerchantAvailabilityRepository {
  return {
    getAvailability: jest.fn().mockResolvedValue({
      id: 'rest-1',
      availability_mode: 'NORMAL',
      busy_prep_minutes: null,
      updated_at: '2026-09-04T00:00:00.000Z',
    }),
    setAvailability: jest.fn(),
    ...overrides,
  };
}

describe('useAvailability — load', () => {
  it('loads the current mode on mount', async () => {
    const repository = repo();
    const { result } = renderHook(() => useAvailability('rest-1', repository));

    expect(result.current.state).toEqual({ status: 'loading' });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'ready', mode: 'NORMAL', busyPrepMinutes: null }),
    );
  });

  it('does nothing while restaurantId is null', () => {
    const getAvailability = jest.fn();
    const repository = repo({ getAvailability });
    renderHook(() => useAvailability(null, repository));

    expect(getAvailability).not.toHaveBeenCalled();
  });

  it('reports forbidden distinctly from a generic error', async () => {
    const repository = repo({
      getAvailability: jest.fn().mockRejectedValue(new ApiClientError(403, { code: 'NOT_RESTAURANT_MEMBER' })),
    });
    const { result } = renderHook(() => useAvailability('rest-1', repository));

    await waitFor(() => expect(result.current.state).toEqual({ status: 'error', forbidden: true }));
  });
});

describe('useAvailability — setBusy / setPaused / setNormal', () => {
  it('setBusy sends the mode and minutes, and re-reads the response into state', async () => {
    const setAvailability = jest.fn().mockResolvedValue({
      restaurantId: 'rest-1',
      availabilityMode: 'BUSY',
      busyPrepMinutes: 30,
      updatedAt: '2026-09-04T01:00:00.000Z',
    });
    const repository = repo({ setAvailability });
    const { result } = renderHook(() => useAvailability('rest-1', repository));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.setBusy(30);
    });

    expect(setAvailability).toHaveBeenCalledWith('rest-1', { mode: 'BUSY', busyPrepMinutes: 30 });
    expect(succeeded).toBe(true);
    expect(result.current.state).toEqual({ status: 'ready', mode: 'BUSY', busyPrepMinutes: 30 });
    expect(result.current.saveState).toEqual({ status: 'idle' });
  });

  it('setPaused sends PAUSED with no busyPrepMinutes field', async () => {
    const setAvailability = jest.fn().mockResolvedValue({
      restaurantId: 'rest-1',
      availabilityMode: 'PAUSED',
      busyPrepMinutes: null,
      updatedAt: '2026-09-04T01:00:00.000Z',
    });
    const repository = repo({ setAvailability });
    const { result } = renderHook(() => useAvailability('rest-1', repository));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    await act(async () => {
      await result.current.setPaused();
    });

    expect(setAvailability).toHaveBeenCalledWith('rest-1', { mode: 'PAUSED' });
  });

  it('setNormal sends NORMAL with no busyPrepMinutes field', async () => {
    const setAvailability = jest.fn().mockResolvedValue({
      restaurantId: 'rest-1',
      availabilityMode: 'NORMAL',
      busyPrepMinutes: null,
      updatedAt: '2026-09-04T01:00:00.000Z',
    });
    const repository = repo({ setAvailability });
    const { result } = renderHook(() => useAvailability('rest-1', repository));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    await act(async () => {
      await result.current.setNormal();
    });

    expect(setAvailability).toHaveBeenCalledWith('rest-1', { mode: 'NORMAL' });
  });

  it('AC-02: a failed change leaves state untouched, resolves false, and records saveState.failed', async () => {
    const setAvailability = jest.fn().mockRejectedValue(new ApiClientError(409, { code: 'INVALID_TRANSITION' }));
    const repository = repo({ setAvailability });
    const { result } = renderHook(() => useAvailability('rest-1', repository));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    const before = result.current.state;

    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.setBusy(20);
    });

    expect(succeeded).toBe(false);
    expect(result.current.state).toEqual(before);
    expect(result.current.saveState.status).toBe('failed');
  });

  it('reload() re-fetches from the repository', async () => {
    const getAvailability = jest.fn().mockResolvedValue({
      id: 'rest-1',
      availability_mode: 'NORMAL',
      busy_prep_minutes: null,
      updated_at: '2026-09-04T00:00:00.000Z',
    });
    const repository = repo({ getAvailability });
    const { result } = renderHook(() => useAvailability('rest-1', repository));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(getAvailability).toHaveBeenCalledTimes(1);

    act(() => result.current.reload());

    await waitFor(() => expect(getAvailability).toHaveBeenCalledTimes(2));
  });
});
