import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import RootGate from './page';
import type { RestaurantScopeState } from '../hooks/useRestaurantScope';

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

let mockInitialising = true;
let mockSession: unknown = null;
jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ initialising: mockInitialising, session: mockSession }),
}));

const selectRestaurant = jest.fn();
const reload = jest.fn();
let mockState: RestaurantScopeState = { status: 'loading' };
jest.mock('../hooks/useRestaurantScope', () => ({
  useRestaurantScope: () => ({ state: mockState, reload, selectRestaurant }),
}));

const RESTAURANT_A = {
  restaurantId: 'rest-a',
  restaurantName: 'ร้าน A',
  restaurantStatus: 'ACTIVE',
  memberRole: 'OWNER' as const,
};
const RESTAURANT_B = {
  restaurantId: 'rest-b',
  restaurantName: 'ร้าน B',
  restaurantStatus: 'ACTIVE',
  memberRole: 'STAFF' as const,
};

describe('RootGate — the authorization decision', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitialising = false;
    mockSession = { access_token: 'a' };
    mockState = { status: 'loading' };
  });

  it('unauthenticated → /login (the 401 case: no valid session at all)', async () => {
    mockSession = null;
    render(<RootGate />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('zero active memberships → /unauthorized (the 403 case)', async () => {
    mockState = { status: 'ready', memberships: [], currentRestaurantId: null };
    render(<RootGate />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/unauthorized'));
  });

  it('exactly one membership → auto-selects it and goes to /dashboard', async () => {
    mockState = { status: 'ready', memberships: [RESTAURANT_A], currentRestaurantId: null };
    render(<RootGate />);

    await waitFor(() => expect(selectRestaurant).toHaveBeenCalledWith('rest-a'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('multiple memberships with a valid stored scope → /dashboard directly', async () => {
    mockState = {
      status: 'ready',
      memberships: [RESTAURANT_A, RESTAURANT_B],
      currentRestaurantId: 'rest-b',
    };
    render(<RootGate />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('multiple memberships with no valid stored scope → /select-restaurant', async () => {
    mockState = {
      status: 'ready',
      memberships: [RESTAURANT_A, RESTAURANT_B],
      currentRestaurantId: null,
    };
    render(<RootGate />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/select-restaurant'));
  });

  it('a repository/network failure shows a retryable error, not a silent redirect', async () => {
    mockState = { status: 'error', message: 'network error' };
    render(<RootGate />);

    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('ลองอีกครั้ง'));
    expect(reload).toHaveBeenCalled();
  });

  it('while initialising, does not redirect yet', () => {
    mockInitialising = true;
    render(<RootGate />);
    expect(replace).not.toHaveBeenCalled();
  });
});
