import { renderHook, waitFor, act } from '@testing-library/react';
import { useRestaurantScope } from './useRestaurantScope';
import { setStoredRestaurantId, getStoredRestaurantId } from '../lib/restaurantScope';
import type { RestaurantMembership } from '../domain/restaurantMembership';

const listOwnMemberships = jest.fn<Promise<RestaurantMembership[]>, []>();

jest.mock('../repositories', () => ({
  repositories: {
    merchantRestaurant: {
      listOwnMemberships: () => listOwnMemberships(),
    },
  },
}));

const RESTAURANT_A: RestaurantMembership = {
  restaurantId: 'rest-a',
  restaurantName: 'ร้าน A',
  restaurantStatus: 'ACTIVE',
  memberRole: 'OWNER',
};
const RESTAURANT_B: RestaurantMembership = {
  restaurantId: 'rest-b',
  restaurantName: 'ร้าน B',
  restaurantStatus: 'ACTIVE',
  memberRole: 'STAFF',
};

describe('useRestaurantScope', () => {
  beforeEach(() => {
    window.localStorage.clear();
    listOwnMemberships.mockReset();
  });

  it('does nothing while disabled', () => {
    const { result } = renderHook(() => useRestaurantScope(false));
    expect(result.current.state.status).toBe('loading');
    expect(listOwnMemberships).not.toHaveBeenCalled();
  });

  it('zero memberships: ready with an empty list and no current restaurant', async () => {
    listOwnMemberships.mockResolvedValue([]);
    const { result } = renderHook(() => useRestaurantScope(true));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.state).toMatchObject({
      status: 'ready',
      memberships: [],
      currentRestaurantId: null,
    });
  });

  it('one membership: ready, but does not auto-select on its own (caller decides that)', async () => {
    listOwnMemberships.mockResolvedValue([RESTAURANT_A]);
    const { result } = renderHook(() => useRestaurantScope(true));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.state).toMatchObject({
      status: 'ready',
      memberships: [RESTAURANT_A],
      currentRestaurantId: null,
    });
  });

  it('multiple memberships with no stored scope: currentRestaurantId is null', async () => {
    listOwnMemberships.mockResolvedValue([RESTAURANT_A, RESTAURANT_B]);
    const { result } = renderHook(() => useRestaurantScope(true));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.state).toMatchObject({ currentRestaurantId: null });
  });

  it('multiple memberships with a valid stored scope: currentRestaurantId is trusted', async () => {
    setStoredRestaurantId('rest-b');
    listOwnMemberships.mockResolvedValue([RESTAURANT_A, RESTAURANT_B]);
    const { result } = renderHook(() => useRestaurantScope(true));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.state).toMatchObject({ currentRestaurantId: 'rest-b' });
  });

  it('a stored scope for a restaurant no longer in the membership list is rejected and cleared', async () => {
    setStoredRestaurantId('rest-revoked');
    listOwnMemberships.mockResolvedValue([RESTAURANT_A]);
    const { result } = renderHook(() => useRestaurantScope(true));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.state).toMatchObject({ currentRestaurantId: null });
    expect(getStoredRestaurantId()).toBeNull();
  });

  it('selectRestaurant persists and updates state for a real membership', async () => {
    listOwnMemberships.mockResolvedValue([RESTAURANT_A, RESTAURANT_B]);
    const { result } = renderHook(() => useRestaurantScope(true));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    act(() => result.current.selectRestaurant('rest-b'));

    expect(result.current.state).toMatchObject({ currentRestaurantId: 'rest-b' });
    expect(getStoredRestaurantId()).toBe('rest-b');
  });

  it('selectRestaurant refuses a restaurant id outside the membership list', async () => {
    listOwnMemberships.mockResolvedValue([RESTAURANT_A]);
    const { result } = renderHook(() => useRestaurantScope(true));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    act(() => result.current.selectRestaurant('someone-elses-restaurant'));

    expect(result.current.state).toMatchObject({ currentRestaurantId: null });
    expect(getStoredRestaurantId()).toBeNull();
  });

  it('surfaces a repository failure as an error state, not a silent empty list', async () => {
    listOwnMemberships.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useRestaurantScope(true));

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({ message: 'network error' });
  });

  it('reload() re-fetches from the repository', async () => {
    listOwnMemberships.mockResolvedValue([RESTAURANT_A]);
    const { result } = renderHook(() => useRestaurantScope(true));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    act(() => result.current.reload());

    await waitFor(() => expect(listOwnMemberships).toHaveBeenCalledTimes(2));
  });
});
