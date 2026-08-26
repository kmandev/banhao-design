import { createRiderDeliveryRepository } from './riderDelivery';
import { createRiderDeliveryActionsRepository } from './riderDeliveryActions';
import { ACTIVE_DELIVERY_STATES, currentStep, DELIVERY_STEPS } from '../domain/riderDelivery';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';

/**
 * G-7.2 Phase 1 — the rider's active-delivery read path and the four
 * transition commands.
 *
 * The read assertions are about **which columns leave the database**, not only
 * about the mapped shape: `deliveries_select_rider` is a full-row grant, so
 * unlike the `rider_order_*` views nothing in the database stops this client
 * from pulling `rider_earning_satang` or `proof_photo_path`. Keeping them out
 * is this repository's own responsibility, which is why it is asserted here in
 * the same style `riderAvailability.test.ts` asserts its own column list.
 */

interface Recorded {
  table: string;
  columns?: string;
  in?: { column: string; values: unknown[] };
}

function supabaseStub(rows: unknown[] | null, error: { message: string } | null = null) {
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      const call: Recorded = { table };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        in(column: string, values: unknown[]) {
          call.in = { column, values };
          return builder;
        },
        returns: () => Promise.resolve({ data: rows, error }),
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

const ROW = {
  id: 'delivery-1',
  order_id: 'order-1',
  state: 'EN_ROUTE',
  assigned_at: '2026-08-26T10:00:00Z',
  picked_up_at: '2026-08-26T10:20:00Z',
  delivered_at: null,
};

describe('RiderDeliveryRepository.getActiveDelivery', () => {
  it('reads the deliveries table, not a view — rider_order_view carries no delivery state', async () => {
    const { client, calls } = supabaseStub([ROW]);

    await createRiderDeliveryRepository(client).getActiveDelivery();

    expect(calls.map((call) => call.table)).toEqual(['deliveries']);
  });

  it('never selects a money column or the proof photo path', async () => {
    const { client, calls } = supabaseStub([ROW]);

    await createRiderDeliveryRepository(client).getActiveDelivery();

    const columns = calls[0]?.columns ?? '';
    // The RLS grant is full-row, so this is the only thing keeping them out.
    expect(columns).not.toMatch(/rider_earning_satang|satang/);
    expect(columns).not.toMatch(/proof_photo_path/);
    expect(columns).toBe('id, order_id, state, assigned_at, picked_up_at, delivered_at');
  });

  it('never filters by rider_id — row scope is the RLS policy, not a client filter', async () => {
    const { client, calls } = supabaseStub([ROW]);

    await createRiderDeliveryRepository(client).getActiveDelivery();

    expect(calls[0]?.in?.column).toBe('state');
    // Duplicating is_assigned_rider() on the client would put a security
    // boundary in the one place that cannot enforce it.
    expect(JSON.stringify(calls[0])).not.toMatch(/rider_id/);
  });

  it('narrows to the active states only, excluding every terminal one', async () => {
    const { client, calls } = supabaseStub([ROW]);

    await createRiderDeliveryRepository(client).getActiveDelivery();

    expect(calls[0]?.in?.values).toEqual([...ACTIVE_DELIVERY_STATES]);
    for (const terminal of ['DELIVERED', 'FAILED', 'ABANDONED']) {
      expect(calls[0]?.in?.values).not.toContain(terminal);
    }
  });

  it('maps the row into a money-free domain shape', async () => {
    const { client } = supabaseStub([ROW]);

    const delivery = await createRiderDeliveryRepository(client).getActiveDelivery();

    expect(delivery).toEqual({
      deliveryId: 'delivery-1',
      orderId: 'order-1',
      state: 'EN_ROUTE',
      assignedAt: '2026-08-26T10:00:00Z',
      pickedUpAt: '2026-08-26T10:20:00Z',
      deliveredAt: null,
    });
    for (const key of Object.keys(delivery ?? {})) {
      expect(key).not.toMatch(/satang|earning|fee|proof/i);
    }
  });

  it('returns null when the rider has no active delivery', async () => {
    const { client } = supabaseStub([]);

    await expect(createRiderDeliveryRepository(client).getActiveDelivery()).resolves.toBeNull();
  });

  it('throws on a read failure — never reports it as "no active delivery"', async () => {
    const { client } = supabaseStub(null, { message: 'network request failed' });

    await expect(createRiderDeliveryRepository(client).getActiveDelivery()).rejects.toThrow(
      /network request failed/,
    );
  });
});

const PROOF_KEY =
  'deliveries/11111111-1111-4111-8111-111111111111/proof/22222222-2222-4222-8222-222222222222.jpg';

describe('RiderDeliveryActionsRepository', () => {
  function apiStub() {
    // Typed parameters so `request.mock.calls[0][1]` is inspectable — an
    // untyped `jest.fn()` records calls as an empty tuple.
    const request = jest.fn(async (_path: string, _init?: unknown) => ({}));
    return { client: { request } as unknown as ApiClient, request };
  }

  it.each([
    ['markArrived', 'arrived'],
    ['markPickedUp', 'picked-up'],
    ['markEnRoute', 'en-route'],
    ['markDelivered', 'delivered'],
  ] as const)('%s POSTs to the %s command path', async (method, path) => {
    const { client, request } = apiStub();
    const repo = createRiderDeliveryActionsRepository(client, async () => 'token');

    // `markDelivered` alone carries a body — the mandatory proof key.
    if (method === 'markDelivered') {
      await repo.markDelivered('delivery-1', PROOF_KEY);
      expect(request).toHaveBeenCalledWith(`/api/v1/rider/deliveries/delivery-1/${path}`, {
        method: 'POST',
        body: JSON.stringify({ objectKey: PROOF_KEY }),
      });
      return;
    }

    await repo[method]('delivery-1');

    expect(request).toHaveBeenCalledWith(`/api/v1/rider/deliveries/delivery-1/${path}`, {
      method: 'POST',
    });
  });

  it('sends no request at all when signed out', async () => {
    const { client, request } = apiStub();
    const repo = createRiderDeliveryActionsRepository(client, async () => null);

    await expect(repo.markDelivered('delivery-1', PROOF_KEY)).rejects.toThrow();
    // A signed-out app must not issue a delivery transition and collect a 401.
    expect(request).not.toHaveBeenCalled();
  });

  it('carries the proof key verbatim, never a key it built itself', async () => {
    const { client, request } = apiStub();
    const repo = createRiderDeliveryActionsRepository(client, async () => 'token');

    await repo.markDelivered('delivery-1', PROOF_KEY);

    // The server templated this key and re-parses it on arrival; the client
    // neither constructs nor modifies one.
    expect(request.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      body: JSON.stringify({ objectKey: PROOF_KEY }),
    });
  });

  it('sends no body for the three transitions that need none', async () => {
    const { client, request } = apiStub();
    const repo = createRiderDeliveryActionsRepository(client, async () => 'token');

    await repo.markArrived('delivery-1');

    expect(request.mock.calls[0]?.[1]).toEqual({ method: 'POST' });
  });
});

describe('delivery step mapping', () => {
  it.each([
    ['RIDER_ASSIGNED', 'arrived', 1],
    ['AT_MERCHANT', 'pickedUp', 2],
    ['PICKED_UP', 'enRoute', 3],
    ['EN_ROUTE', 'delivered', 4],
  ] as const)('maps %s to the %s action at step %i', (state, action, index) => {
    const step = currentStep(state);
    expect(step?.action).toBe(action);
    expect(step?.index).toBe(index);
  });

  it.each(['RIDER_REASSIGNING', 'DELIVERED', 'FAILED', 'ABANDONED', 'RIDER_SEARCHING'])(
    'offers no action from %s',
    (state) => {
      expect(currentStep(state)).toBeNull();
    },
  );

  it('covers every step exactly once, in order', () => {
    expect(DELIVERY_STEPS.map((step) => step.index)).toEqual([1, 2, 3, 4]);
    expect(new Set(DELIVERY_STEPS.map((step) => step.from)).size).toBe(DELIVERY_STEPS.length);
  });
});
