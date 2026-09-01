import {
  createMenuCategorySchema,
  createMenuItemSchema,
  menuOptionGroupSchema,
  reorderMenuCategoriesSchema,
  reorderMenuItemsSchema,
  replaceMenuOptionGroupsSchema,
  setMenuItemAvailabilitySchema,
  updateMenuCategorySchema,
  updateMenuItemSchema,
} from './menu';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';

describe('createMenuCategorySchema', () => {
  it('accepts a name', () => {
    expect(createMenuCategorySchema.safeParse({ name: 'อาหารจานเดียว' }).success).toBe(true);
  });

  it('trims, and rejects a name that is only whitespace', () => {
    expect(createMenuCategorySchema.parse({ name: '  แนะนำ  ' })).toEqual({ name: 'แนะนำ' });
    expect(createMenuCategorySchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('imposes no length limit, because the schema declares none (M11-D11)', () => {
    expect(createMenuCategorySchema.safeParse({ name: 'ก'.repeat(500) }).success).toBe(true);
  });

  it('rejects a restaurantId in the body — the route path is the only source', () => {
    expect(
      createMenuCategorySchema.safeParse({ name: 'แนะนำ', restaurantId: CATEGORY_ID }).success,
    ).toBe(false);
  });

  it('rejects a client-chosen sortOrder — a new category appends (M11-D08)', () => {
    expect(createMenuCategorySchema.safeParse({ name: 'แนะนำ', sortOrder: 3 }).success).toBe(false);
  });
});

describe('updateMenuCategorySchema', () => {
  it('accepts a rename', () => {
    expect(updateMenuCategorySchema.safeParse({ name: 'ของหวาน' }).success).toBe(true);
  });

  it('rejects archivedAt — archiving has its own endpoint', () => {
    expect(
      updateMenuCategorySchema.safeParse({ name: 'ของหวาน', archivedAt: null }).success,
    ).toBe(false);
  });
});

describe('createMenuItemSchema', () => {
  const valid = { categoryId: CATEGORY_ID, name: 'ข้าวผัดกุ้ง', basePriceSatang: 6500 };

  it('accepts the fields the schema stores', () => {
    expect(createMenuItemSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an optional description and availability', () => {
    expect(
      createMenuItemSchema.safeParse({ ...valid, description: 'ไข่ ต้นหอม', isAvailable: false })
        .success,
    ).toBe(true);
  });

  it('requires a category — category_id is not null', () => {
    const { categoryId: _omitted, ...withoutCategory } = valid;
    expect(createMenuItemSchema.safeParse(withoutCategory).success).toBe(false);
  });

  it('rejects a negative price', () => {
    expect(createMenuItemSchema.safeParse({ ...valid, basePriceSatang: -1 }).success).toBe(false);
  });

  it('rejects a non-integer price — satang is the smallest unit (CON-003)', () => {
    expect(createMenuItemSchema.safeParse({ ...valid, basePriceSatang: 65.5 }).success).toBe(false);
  });

  it('permits a price of zero, which is what the CHECK permits (M11-Q-05)', () => {
    expect(createMenuItemSchema.safeParse({ ...valid, basePriceSatang: 0 }).success).toBe(true);
  });

  it('rejects an imageUrl — image upload is edit-only and keyed by item id (M11-D09)', () => {
    expect(createMenuItemSchema.safeParse({ ...valid, imageUrl: 'x.jpg' }).success).toBe(false);
  });
});

describe('updateMenuItemSchema', () => {
  it('accepts a single changed field', () => {
    expect(updateMenuItemSchema.safeParse({ name: 'ข้าวผัดหมู' }).success).toBe(true);
  });

  it('accepts moving a dish to another category (M11-Q-02)', () => {
    expect(updateMenuItemSchema.safeParse({ categoryId: CATEGORY_ID }).success).toBe(true);
  });

  it('accepts null to clear a description', () => {
    expect(updateMenuItemSchema.safeParse({ description: null }).success).toBe(true);
  });

  it('rejects an empty patch, which would be a write with nothing to write', () => {
    expect(updateMenuItemSchema.safeParse({}).success).toBe(false);
  });

  it('rejects archivedAt, restaurantId and sortOrder', () => {
    for (const smuggled of [{ archivedAt: null }, { restaurantId: CATEGORY_ID }, { sortOrder: 2 }]) {
      expect(updateMenuItemSchema.safeParse({ name: 'x', ...smuggled }).success).toBe(false);
    }
  });
});

describe('setMenuItemAvailabilitySchema', () => {
  it('accepts only the one boolean', () => {
    expect(setMenuItemAvailabilitySchema.safeParse({ isAvailable: false }).success).toBe(true);
    expect(setMenuItemAvailabilitySchema.safeParse({ isAvailable: 'false' }).success).toBe(false);
    expect(
      setMenuItemAvailabilitySchema.safeParse({ isAvailable: true, name: 'x' }).success,
    ).toBe(false);
  });
});

describe('reorder schemas', () => {
  it('take the complete new order as a list of ids', () => {
    expect(reorderMenuCategoriesSchema.safeParse({ categoryIds: [CATEGORY_ID] }).success).toBe(true);
    expect(
      reorderMenuItemsSchema.safeParse({ categoryId: CATEGORY_ID, menuItemIds: [ITEM_ID] }).success,
    ).toBe(true);
  });

  it('accept an empty list — a category with no dishes still reorders to nothing', () => {
    expect(reorderMenuCategoriesSchema.safeParse({ categoryIds: [] }).success).toBe(true);
  });

  it('reject a non-uuid id', () => {
    expect(reorderMenuCategoriesSchema.safeParse({ categoryIds: ['first'] }).success).toBe(false);
  });
});

describe('menuOptionGroupSchema', () => {
  const option = { label: 'ไข่ดาว', priceDeltaSatang: 1000, isAvailable: true };

  it('accepts the required single-select preset — min 1 / max 1', () => {
    expect(
      menuOptionGroupSchema.safeParse({
        title: 'ระดับความเผ็ด',
        minSelect: 1,
        maxSelect: 1,
        options: [option],
      }).success,
    ).toBe(true);
  });

  it('accepts the optional multi-select preset — min 0 / max N', () => {
    expect(
      menuOptionGroupSchema.safeParse({
        title: 'เพิ่มเติม',
        minSelect: 0,
        maxSelect: 3,
        options: [option],
      }).success,
    ).toBe(true);
  });

  it('rejects maxSelect below minSelect, mirroring the table CHECK', () => {
    expect(
      menuOptionGroupSchema.safeParse({ title: 'x', minSelect: 3, maxSelect: 1, options: [option] })
        .success,
    ).toBe(false);
  });

  it('requires at least one option — M-11 §05', () => {
    expect(
      menuOptionGroupSchema.safeParse({ title: 'x', minSelect: 0, maxSelect: 1, options: [] })
        .success,
    ).toBe(false);
  });

  it('permits a negative price delta, because no CHECK forbids one', () => {
    expect(
      menuOptionGroupSchema.safeParse({
        title: 'ลด',
        minSelect: 0,
        maxSelect: 1,
        options: [{ label: 'ไม่เอาข้าว', priceDeltaSatang: -500, isAvailable: true }],
      }).success,
    ).toBe(true);
  });

  it('rejects a non-integer price delta', () => {
    expect(
      menuOptionGroupSchema.safeParse({
        title: 'x',
        minSelect: 0,
        maxSelect: 1,
        options: [{ ...option, priceDeltaSatang: 10.5 }],
      }).success,
    ).toBe(false);
  });

  it('rejects a client-supplied id — every group is recreated on replace', () => {
    expect(
      menuOptionGroupSchema.safeParse({
        id: CATEGORY_ID,
        title: 'x',
        minSelect: 0,
        maxSelect: 1,
        options: [option],
      }).success,
    ).toBe(false);
  });
});

describe('replaceMenuOptionGroupsSchema', () => {
  it('accepts an empty array — removing every group is a legitimate edit', () => {
    expect(replaceMenuOptionGroupsSchema.safeParse({ groups: [] }).success).toBe(true);
  });
});
