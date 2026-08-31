import { render, screen } from '@testing-library/react';
import DashboardPage from './page';
import type { RestaurantScopeState } from '../../hooks/useRestaurantScope';

const replace = jest.fn();
const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
}));

let mockSession: unknown = { access_token: 'a' };
jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ initialising: false, session: mockSession, signOut: jest.fn() }),
}));

let mockState: RestaurantScopeState = { status: 'loading' };
jest.mock('../../hooks/useRestaurantScope', () => ({
  useRestaurantScope: () => ({ state: mockState, reload: jest.fn(), selectRestaurant: jest.fn() }),
}));

let capturedRestaurantId: string | null | undefined;
jest.mock('../../components/OrderBoard', () => ({
  OrderBoard: ({ restaurantId }: { restaurantId: string | null }) => {
    capturedRestaurantId = restaurantId;
    return <div data-testid="order-board-stub" />;
  },
}));

const RESTAURANT_A = {
  restaurantId: 'rest-a',
  restaurantName: 'ร้าน A',
  restaurantStatus: 'ACTIVE',
  memberRole: 'OWNER' as const,
};

describe('DashboardPage — M-2.6 Order Board wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = { access_token: 'a' };
    capturedRestaurantId = undefined;
  });

  it('renders OrderBoard with the resolved, membership-verified restaurantId once scope is ready', () => {
    mockState = { status: 'ready', memberships: [RESTAURANT_A], currentRestaurantId: 'rest-a' };
    render(<DashboardPage />);

    expect(screen.getByTestId('order-board-stub')).toBeInTheDocument();
    expect(capturedRestaurantId).toBe('rest-a');
  });

  it('never renders OrderBoard before scope resolves', () => {
    mockState = { status: 'loading' };
    render(<DashboardPage />);

    expect(screen.queryByTestId('order-board-stub')).not.toBeInTheDocument();
  });
});
