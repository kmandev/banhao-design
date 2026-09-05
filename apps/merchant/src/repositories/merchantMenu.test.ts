import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';
import { createMerchantMenuRepository } from './merchantMenu';

/**
 * The M-11 repository's write half: that each command hits the endpoint the
 * contract declares, with the verb it declares, and sends no body where the
 * controller takes none.
 *
 * The read half goes through `menuQueries.ts`, which has its own tests.
 */

function fakeApi(): { api: ApiClient; calls: { path: string; init: RequestInit }[] } {
  const calls: { path: string; init: RequestInit }[] = [];
  const api = {
    request: (path: string, init: RequestInit = {}) => {
      calls.push({ path, init });
      return Promise.resolve({});
    },
  } as unknown as ApiClient;
  return { api, calls };
}

const supabase = {} as SupabaseClient;

describe('merchantMenu — write commands', () => {
  it.each([
    [
      'createCategory',
      (r: ReturnType<typeof createMerchantMenuRepository>) =>
        r.createCategory('rest-1', { name: 'ของหวาน' }),
      'POST',
      '/api/v1/merchant/restaurants/rest-1/menu-categories',
      { name: 'ของหวาน' },
    ],
    [
      'renameCategory',
      (r: ReturnType<typeof createMerchantMenuRepository>) => r.renameCategory('cat-1', 'ของหวาน'),
      'PATCH',
      '/api/v1/merchant/menu-categories/cat-1',
      { name: 'ของหวาน' },
    ],
    [
      'reorderCategories',
      (r: ReturnType<typeof createMerchantMenuRepository>) =>
        r.reorderCategories('rest-1', ['a', 'b']),
      'POST',
      '/api/v1/merchant/restaurants/rest-1/menu-categories/reorder',
      { categoryIds: ['a', 'b'] },
    ],
    [
      'createItem',
      (r: ReturnType<typeof createMerchantMenuRepository>) =>
        r.createItem('rest-1', { categoryId: 'cat-1', name: 'x', basePriceSatang: 100 }),
      'POST',
      '/api/v1/merchant/restaurants/rest-1/menu-items',
      { categoryId: 'cat-1', name: 'x', basePriceSatang: 100 },
    ],
    [
      'updateItem',
      (r: ReturnType<typeof createMerchantMenuRepository>) =>
        r.updateItem('item-1', { name: 'x' }),
      'PATCH',
      '/api/v1/merchant/menu-items/item-1',
      { name: 'x' },
    ],
    [
      'setItemAvailability',
      (r: ReturnType<typeof createMerchantMenuRepository>) =>
        r.setItemAvailability('item-1', false),
      'PATCH',
      '/api/v1/merchant/menu-items/item-1/availability',
      { isAvailable: false },
    ],
    [
      'reorderItems',
      (r: ReturnType<typeof createMerchantMenuRepository>) =>
        r.reorderItems('rest-1', 'cat-1', ['a']),
      'POST',
      '/api/v1/merchant/restaurants/rest-1/menu-items/reorder',
      { categoryId: 'cat-1', menuItemIds: ['a'] },
    ],
    [
      'replaceOptionGroups',
      (r: ReturnType<typeof createMerchantMenuRepository>) => r.replaceOptionGroups('item-1', []),
      'PUT',
      '/api/v1/merchant/menu-items/item-1/option-groups',
      { groups: [] },
    ],
  ])('%s issues %s %s', async (_name, call, method, path, body) => {
    const { api, calls } = fakeApi();

    await call(createMerchantMenuRepository(supabase, api));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(path);
    expect(calls[0]?.init.method).toBe(method);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(body);
  });

  it.each([
    ['archiveCategory', '/api/v1/merchant/menu-categories/cat-1/archive'],
    ['archiveItem', '/api/v1/merchant/menu-items/item-1/archive'],
  ])('%s sends no body at all, not an empty object', async (name, path) => {
    const { api, calls } = fakeApi();
    const repository = createMerchantMenuRepository(supabase, api);

    await (name === 'archiveCategory'
      ? repository.archiveCategory('cat-1')
      : repository.archiveItem('item-1'));

    expect(calls[0]?.path).toBe(path);
    expect(calls[0]?.init.method).toBe('POST');
    // `body: '{}'` would invent a request shape the controller does not
    // declare — the rule `merchantOrders.ts` already follows.
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it('never issues a DELETE — removal is an archive (M11-D06)', async () => {
    const { api, calls } = fakeApi();
    const repository = createMerchantMenuRepository(supabase, api);

    await repository.archiveItem('item-1');
    await repository.archiveCategory('cat-1');

    expect(calls.every((call) => call.init.method !== 'DELETE')).toBe(true);
  });

  it('lets the original error through rather than collapsing it', async () => {
    const failure = Object.assign(new Error('nope'), { code: 'NOT_RESTAURANT_MEMBER' });
    const api = { request: () => Promise.reject(failure) } as unknown as ApiClient;

    await expect(
      createMerchantMenuRepository(supabase, api).archiveItem('item-1'),
    ).rejects.toBe(failure);
  });
});

describe('merchantMenu — item image (M-MENU-IMG, existing endpoints reused)', () => {
  it('requestItemImageUpload POSTs to the existing upload-url route', async () => {
    const { api, calls } = fakeApi();

    await createMerchantMenuRepository(supabase, api).requestItemImageUpload(
      'item-1',
      'image/webp',
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/api/v1/merchant/menu-items/item-1/image/upload-url');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ contentType: 'image/webp' });
  });

  it('the upload-url response is returned unchanged', async () => {
    const api = {
      request: () =>
        Promise.resolve({ uploadUrl: 'https://r2.example/put', objectKey: 'menu-items/item-1/x.webp' }),
    } as unknown as ApiClient;

    const result = await createMerchantMenuRepository(supabase, api).requestItemImageUpload(
      'item-1',
      'image/webp',
    );

    expect(result).toEqual({ uploadUrl: 'https://r2.example/put', objectKey: 'menu-items/item-1/x.webp' });
  });

  it('completeItemImageUpload POSTs to the existing complete route', async () => {
    const { api, calls } = fakeApi();

    await createMerchantMenuRepository(supabase, api).completeItemImageUpload(
      'item-1',
      'menu-items/item-1/x.webp',
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/api/v1/merchant/menu-items/item-1/image/complete');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      objectKey: 'menu-items/item-1/x.webp',
    });
  });

  it('the complete response is returned unchanged', async () => {
    const api = {
      request: () => Promise.resolve({ imageUrl: 'https://cdn.example/menu-items/item-1/x.webp' }),
    } as unknown as ApiClient;

    const result = await createMerchantMenuRepository(supabase, api).completeItemImageUpload(
      'item-1',
      'menu-items/item-1/x.webp',
    );

    expect(result).toEqual({ imageUrl: 'https://cdn.example/menu-items/item-1/x.webp' });
  });

  it('introduces no second upload mechanism — no other route is ever called', async () => {
    const paths: string[] = [];
    const api = {
      request: (path: string) => {
        paths.push(path);
        return Promise.resolve({ uploadUrl: 'x', objectKey: 'x', imageUrl: 'x' });
      },
    } as unknown as ApiClient;

    const repo = createMerchantMenuRepository(supabase, api);
    await repo.requestItemImageUpload('item-1', 'image/jpeg');
    await repo.completeItemImageUpload('item-1', 'menu-items/item-1/x.jpg');

    for (const path of paths) {
      expect(path).toMatch(/\/menu-items\/item-1\/image\/(upload-url|complete)$/);
    }
  });

  it('lets an image-upload error through rather than collapsing it', async () => {
    const failure = Object.assign(new Error('nope'), { code: 'VALIDATION_FAILED' });
    const api = { request: () => Promise.reject(failure) } as unknown as ApiClient;

    await expect(
      createMerchantMenuRepository(supabase, api).requestItemImageUpload('item-1', 'image/gif'),
    ).rejects.toBe(failure);
  });
});
