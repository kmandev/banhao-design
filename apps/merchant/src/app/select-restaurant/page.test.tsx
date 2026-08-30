import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SelectRestaurantPage from './page';
import type { RestaurantScopeState } from '../../hooks/useRestaurantScope';

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

let mockSession: unknown = { access_token: 'a' };
jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ initialising: false, session: mockSession }),
}));

const selectRestaurant = jest.fn();
const reload = jest.fn();
let mockState: RestaurantScopeState = { status: 'loading' };

jest.mock('../../hooks/useRestaurantScope', () => ({
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

describe('SelectRestaurantPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = { access_token: 'a' };
    mockState = { status: 'loading' };
  });

  it('renders every active membership when there are several', () => {
    mockState = { status: 'ready', memberships: [RESTAURANT_A, RESTAURANT_B], currentRestaurantId: null };
    render(<SelectRestaurantPage />);

    expect(screen.getByTestId('restaurant-option-rest-a')).toBeInTheDocument();
    expect(screen.getByTestId('restaurant-option-rest-b')).toBeInTheDocument();
  });

  it('selecting a restaurant persists the scope and navigates to the dashboard', () => {
    mockState = { status: 'ready', memberships: [RESTAURANT_A, RESTAURANT_B], currentRestaurantId: null };
    render(<SelectRestaurantPage />);

    fireEvent.click(screen.getByTestId('restaurant-option-rest-b'));

    expect(selectRestaurant).toHaveBeenCalledWith('rest-b');
    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('redirects to / when landed on directly with zero or one membership', async () => {
    mockState = { status: 'ready', memberships: [RESTAURANT_A], currentRestaurantId: 'rest-a' };
    render(<SelectRestaurantPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('shows a retryable error state on a repository failure', () => {
    mockState = { status: 'error', message: 'network error' };
    render(<SelectRestaurantPage />);

    fireEvent.click(screen.getByText('ลองอีกครั้ง'));
    expect(reload).toHaveBeenCalled();
  });

  it('redirects to /login when there is no session', async () => {
    mockSession = null;
    mockState = { status: 'loading' };
    render(<SelectRestaurantPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });
});
