import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MenuOptionGroup, MenuSection } from '../domain/menu';
import type { MerchantMenuRepository } from '../repositories';
import { MenuOverview } from './MenuOverview';

/**
 * M-11 — the overview, the drawer, the category dialog and the removal dialog,
 * driven through the real component with a stubbed repository.
 *
 * The repository is the mocking boundary, matching `OrderBoard`'s own tests:
 * no Supabase and no HTTP, but every hook, every form and every dialog runs
 * for real. That is what makes assertions about focus, `aria-disabled` and the
 * optimistic switch meaningful.
 */

function item(overrides: Partial<MenuSection['items'][number]> = {}) {
  return {
    id: 'item-1',
    categoryId: 'cat-1',
    name: 'ข้าวผัดกุ้ง',
    description: 'ไข่ ต้นหอม',
    basePriceSatang: 6500,
    imageUrl: null,
    isAvailable: true,
    sortOrder: 0,
    archivedAt: null,
    updatedAt: '2026-09-01T02:14:00.000Z',
    optionGroupCount: 0,
    ...overrides,
  };
}

function sections(): MenuSection[] {
  return [
    {
      category: { id: 'cat-1', name: 'แนะนำ', sortOrder: 0, archivedAt: null },
      items: [item(), item({ id: 'item-2', name: 'ยำวุ้นเส้น', isAvailable: false, description: null })],
    },
    {
      category: { id: 'cat-2', name: 'เครื่องดื่ม', sortOrder: 1, archivedAt: null },
      items: [],
    },
  ];
}

function makeRepository(overrides: Partial<MerchantMenuRepository> = {}): MerchantMenuRepository {
  return {
    listMenu: jest.fn().mockResolvedValue(sections()),
    listOptionGroups: jest.fn().mockResolvedValue([] as MenuOptionGroup[]),
    createCategory: jest.fn().mockResolvedValue({}),
    renameCategory: jest.fn().mockResolvedValue({}),
    archiveCategory: jest.fn().mockResolvedValue({}),
    reorderCategories: jest.fn().mockResolvedValue({ reordered: 2 }),
    createItem: jest.fn().mockResolvedValue({}),
    updateItem: jest.fn().mockResolvedValue({}),
    setItemAvailability: jest.fn().mockResolvedValue({}),
    archiveItem: jest.fn().mockResolvedValue({}),
    reorderItems: jest.fn().mockResolvedValue({ reordered: 2 }),
    replaceOptionGroups: jest.fn().mockResolvedValue({ menuItemId: 'item-1', groupCount: 0 }),
    ...overrides,
  };
}

async function renderOverview(repository = makeRepository()) {
  render(<MenuOverview restaurantId="rest-1" repository={repository} />);
  await screen.findByTestId('menu-overview');
  return repository;
}

describe('MenuOverview — reading the menu', () => {
  it('renders every category as a section, in order, not as tabs (M11-D01)', async () => {
    await renderOverview();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent);
    expect(headings).toEqual(['แนะนำ', 'เครื่องดื่ม']);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('keeps an empty category visible with its own add action (M11-D10)', async () => {
    await renderOverview();

    const emptySection = screen.getByTestId('empty-category-เครื่องดื่ม');
    expect(within(emptySection).getByText('ยังไม่มีรายการในหมวดหมู่นี้')).toBeInTheDocument();
    expect(within(emptySection).getByText('+ เพิ่มรายการในหมวดนี้')).toBeInTheDocument();
  });

  it('summarises the menu, naming how many dishes are off sale today', async () => {
    await renderOverview();

    expect(screen.getByTestId('menu-summary')).toHaveTextContent('เมนู · 2 รายการ · ปิดขายวันนี้ 1 รายการ');
  });

  it('renders price in baht with two decimals, never satang', async () => {
    await renderOverview();

    expect(screen.getAllByText('฿65.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('6500')).toBeNull();
  });

  it('shows the empty state when the restaurant has no categories at all', async () => {
    await renderOverview(makeRepository({ listMenu: jest.fn().mockResolvedValue([]) }));

    expect(screen.getByTestId('menu-empty')).toBeInTheDocument();
    // The empty state leads with the category, because category_id is not
    // null — a first dish is impossible without one.
    expect(screen.getByTestId('create-first-category')).toHaveTextContent('+ สร้างหมวดหมู่แรก');
  });

  it('offers a retry on a load failure', async () => {
    const listMenu = jest.fn().mockRejectedValue(new Error('network'));
    render(<MenuOverview restaurantId="rest-1" repository={makeRepository({ listMenu })} />);

    expect(await screen.findByText('โหลดเมนูไม่สำเร็จ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ลองอีกครั้ง' })).toBeInTheDocument();
  });
});

describe('MenuOverview — availability (M-11 §03)', () => {
  it('exposes a real switch with its state, never colour alone', async () => {
    await renderOverview();

    const toggle = screen.getByRole('switch', { name: 'สถานะการขาย: ข้าวผัดกุ้ง' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    // The text label is always present alongside the switch.
    expect(screen.getAllByText('พร้อมขาย').length).toBeGreaterThan(0);
  });

  it('writes with one call to the single-field endpoint, not a full item update', async () => {
    const repository = await renderOverview();

    fireEvent.click(screen.getByRole('switch', { name: 'สถานะการขาย: ข้าวผัดกุ้ง' }));

    await waitFor(() => expect(repository.setItemAvailability).toHaveBeenCalledWith('item-1', false));
    expect(repository.updateItem).not.toHaveBeenCalled();
  });

  it('moves the switch before the request resolves (M11-D03)', async () => {
    let release: () => void = () => {};
    const setItemAvailability = jest.fn(
      () => new Promise<never>((resolve) => (release = () => resolve(undefined as never))),
    );
    await renderOverview(makeRepository({ setItemAvailability }));

    const toggle = screen.getByRole('switch', { name: 'สถานะการขาย: ข้าวผัดกุ้ง' });
    fireEvent.click(toggle);

    // Optimistic: already off, with the request still in flight.
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(toggle).toHaveAttribute('aria-busy', 'true');

    release();
  });

  it('reverts the switch and reports when the write fails', async () => {
    const setItemAvailability = jest.fn().mockRejectedValue(new Error('offline'));
    await renderOverview(makeRepository({ setItemAvailability }));

    const toggle = screen.getByRole('switch', { name: 'สถานะการขาย: ข้าวผัดกุ้ง' });
    fireEvent.click(toggle);

    await waitFor(() => expect(screen.getByTestId('availability-error')).toBeInTheDocument());
    // Back where it started — the optimistic write is never left ambiguous.
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('availability-error')).toHaveTextContent('เปลี่ยนสถานะไม่สำเร็จ');
  });

  it('raises no dialog — availability must cost nothing', async () => {
    await renderOverview();

    fireEvent.click(screen.getByRole('switch', { name: 'สถานะการขาย: ข้าวผัดกุ้ง' }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('MenuOverview — the item drawer (M-11 §04)', () => {
  it('opens prefilled from a dish row', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('edit-item-ข้าวผัดกุ้ง'));

    const drawer = await screen.findByTestId('item-drawer');
    expect(within(drawer).getByLabelText(/ชื่อรายการ/)).toHaveValue('ข้าวผัดกุ้ง');
    // Baht, not satang — the merchant is never shown the storage unit.
    expect(within(drawer).getByLabelText(/ราคา/)).toHaveValue('65.00');
  });

  it('opens empty for create, with พร้อมขาย preset on', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('add-item'));

    const drawer = await screen.findByTestId('item-drawer');
    expect(within(drawer).getByLabelText(/ชื่อรายการ/)).toHaveValue('');
    expect(within(drawer).getByRole('checkbox')).toBeChecked();
  });

  it('keeps save inert until the form is both valid and dirty', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('edit-item-ข้าวผัดกุ้ง'));
    const save = await screen.findByTestId('item-drawer-save');

    // Opened to look at it, changed nothing: valid but not dirty.
    expect(save).toHaveAttribute('aria-disabled', 'true');

    fireEvent.change(screen.getByLabelText(/ชื่อรายการ/), { target: { value: 'ข้าวผัดหมู' } });
    expect(save).toHaveAttribute('aria-disabled', 'false');
  });

  it('keeps the disabled save focusable so a screen reader can hear why', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('edit-item-ข้าวผัดกุ้ง'));
    const save = await screen.findByTestId('item-drawer-save');

    // aria-disabled, never the disabled attribute (M-11 §11).
    expect(save).not.toBeDisabled();
    expect(save).toHaveAttribute('aria-disabled', 'true');
  });

  it('sends only the fields that changed', async () => {
    const repository = await renderOverview();

    fireEvent.click(screen.getByTestId('edit-item-ข้าวผัดกุ้ง'));
    fireEvent.change(await screen.findByLabelText(/ราคา/), { target: { value: '70.00' } });
    fireEvent.click(screen.getByTestId('item-drawer-save'));

    await waitFor(() =>
      expect(repository.updateItem).toHaveBeenCalledWith('item-1', { basePriceSatang: 7000 }),
    );
  });

  it('converts baht to satang once, at the boundary (M11-D05)', async () => {
    const repository = await renderOverview();

    fireEvent.click(screen.getByTestId('add-item'));
    fireEvent.change(await screen.findByLabelText(/ชื่อรายการ/), { target: { value: 'ชาเย็น' } });
    fireEvent.change(screen.getByLabelText(/ราคา/), { target: { value: '25.50' } });
    fireEvent.click(screen.getByTestId('item-drawer-save'));

    await waitFor(() =>
      expect(repository.createItem).toHaveBeenCalledWith('rest-1', {
        categoryId: 'cat-1',
        name: 'ชาเย็น',
        basePriceSatang: 2550,
        isAvailable: true,
      }),
    );
  });

  it.each([
    ['', 'กรอกราคา'],
    ['-5', 'ราคาต้องไม่ติดลบ'],
    ['65.555', 'ราคาละเอียดได้ถึงสตางค์เท่านั้น'],
  ])('rejects the price %p with its own message', async (value, message) => {
    const repository = await renderOverview();

    fireEvent.click(screen.getByTestId('add-item'));
    fireEvent.change(await screen.findByLabelText(/ชื่อรายการ/), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/ราคา/), { target: { value } });
    fireEvent.click(screen.getByTestId('item-drawer-save'));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(repository.createItem).not.toHaveBeenCalled();
  });

  it('associates a field error with its input for a screen reader', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('add-item'));
    fireEvent.change(await screen.findByLabelText(/ราคา/), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('item-drawer-save'));

    const name = await screen.findByLabelText(/ชื่อรายการ/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby');
  });

  it('raises the discard guard when a dirty form is closed', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('edit-item-ข้าวผัดกุ้ง'));
    fireEvent.change(await screen.findByLabelText(/ชื่อรายการ/), { target: { value: 'อื่น' } });
    fireEvent.click(screen.getByTestId('item-drawer-close'));

    expect(await screen.findByTestId('discard-dialog')).toBeInTheDocument();
    // Still open behind the guard — nothing was thrown away.
    expect(screen.getByTestId('item-drawer')).toBeInTheDocument();
  });

  it('closes a clean form silently', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('edit-item-ข้าวผัดกุ้ง'));
    await screen.findByTestId('item-drawer');
    fireEvent.click(screen.getByTestId('item-drawer-close'));

    expect(screen.queryByTestId('discard-dialog')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('item-drawer')).toBeNull());
  });

  it('states why the image field is unavailable on create rather than inventing an upload', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('add-item'));

    expect(await screen.findByTestId('image-create-hint')).toHaveTextContent(
      'บันทึกรายการก่อน แล้วจึงเพิ่มรูปภาพ',
    );
  });

  it('renders the 403 copy with no retry', async () => {
    const updateItem = jest.fn().mockRejectedValue(
      Object.assign(new Error('forbidden'), { name: 'ApiClientError', code: 'NOT_RESTAURANT_MEMBER' }),
    );
    await renderOverview(makeRepository({ updateItem }));

    fireEvent.click(screen.getByTestId('edit-item-ข้าวผัดกุ้ง'));
    fireEvent.change(await screen.findByLabelText(/ชื่อรายการ/), { target: { value: 'อื่น' } });
    fireEvent.click(screen.getByTestId('item-drawer-save'));

    expect(await screen.findByTestId('item-drawer-error')).toBeInTheDocument();
  });
});

describe('MenuOverview — removal (M-11 §08)', () => {
  it('never uses the word ลบ, because the database archives', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('remove-item-ข้าวผัดกุ้ง'));

    const dialog = await screen.findByTestId('remove-item-dialog');
    expect(dialog).toHaveTextContent('นำ “ข้าวผัดกุ้ง” ออกจากเมนู');
    expect(dialog.textContent).not.toContain('ลบ');
  });

  it('states that past orders are unaffected', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('remove-item-ข้าวผัดกุ้ง'));

    expect(await screen.findByTestId('remove-item-dialog')).toHaveTextContent(
      'ออเดอร์ที่สั่งไปแล้วยังคงอยู่ในประวัติตามเดิม',
    );
  });

  it('starts focus on cancel, never on the destructive button', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('remove-item-ข้าวผัดกุ้ง'));
    await screen.findByTestId('remove-item-dialog');

    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('data-confirm-cancel'),
    );
  });

  it('archives rather than deleting on confirm', async () => {
    const repository = await renderOverview();

    fireEvent.click(screen.getByTestId('remove-item-ข้าวผัดกุ้ง'));
    fireEvent.click(await screen.findByTestId('remove-item-dialog-confirm'));

    await waitFor(() => expect(repository.archiveItem).toHaveBeenCalledWith('item-1'));
  });
});

describe('MenuOverview — categories (M-11 §07)', () => {
  it('reorders by keyboard, not only by drag', async () => {
    await renderOverview();

    fireEvent.click(screen.getByText('จัดการหมวดหมู่'));
    const dialog = await screen.findByTestId('category-dialog');

    fireEvent.click(within(dialog).getByLabelText('ย้ายลง: แนะนำ'));

    expect(screen.getByTestId('category-announcement')).toHaveTextContent('ย้าย แนะนำ ไปลำดับที่ 2');
  });

  it('saves the whole order in one request, not one per move (M11-D08)', async () => {
    const repository = await renderOverview();

    fireEvent.click(screen.getByText('จัดการหมวดหมู่'));
    const dialog = await screen.findByTestId('category-dialog');
    fireEvent.click(within(dialog).getByLabelText('ย้ายลง: แนะนำ'));
    fireEvent.click(within(dialog).getByTestId('save-category-order'));

    await waitFor(() =>
      expect(repository.reorderCategories).toHaveBeenCalledWith('rest-1', ['cat-2', 'cat-1']),
    );
    expect(repository.reorderCategories).toHaveBeenCalledTimes(1);
  });

  it('keeps บันทึกลำดับ inert until the order actually changed', async () => {
    await renderOverview();

    fireEvent.click(screen.getByText('จัดการหมวดหมู่'));
    const dialog = await screen.findByTestId('category-dialog');

    expect(within(dialog).getByTestId('save-category-order')).toHaveAttribute('aria-disabled', 'true');
  });

  it('blocks removing a category that still holds dishes', async () => {
    await renderOverview();

    fireEvent.click(screen.getByText('จัดการหมวดหมู่'));
    const dialog = await screen.findByTestId('category-dialog');

    // แนะนำ has two dishes; เครื่องดื่ม has none.
    expect(within(dialog).getByTestId('category-archive-แนะนำ')).toBeDisabled();
    expect(within(dialog).getByTestId('category-archive-เครื่องดื่ม')).not.toBeDisabled();
  });

  it('creates a category from the dialog', async () => {
    const repository = await renderOverview();

    fireEvent.click(screen.getByText('จัดการหมวดหมู่'));
    const dialog = await screen.findByTestId('category-dialog');
    fireEvent.change(within(dialog).getByTestId('new-category-name'), { target: { value: 'ของหวาน' } });
    fireEvent.click(within(dialog).getByTestId('create-category'));

    await waitFor(() =>
      expect(repository.createCategory).toHaveBeenCalledWith('rest-1', { name: 'ของหวาน' }),
    );
  });

  it('routes an add-dish press to the category dialog when no category exists', async () => {
    await renderOverview(makeRepository({ listMenu: jest.fn().mockResolvedValue([]) }));

    fireEvent.click(screen.getByTestId('add-item'));

    // A dish cannot exist outside a category — category_id is not null.
    expect(await screen.findByTestId('category-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('item-drawer')).toBeNull();
  });
});

describe('MenuOverview — option groups (M-11 §06)', () => {
  it('writes the three presets as the pairs they stand for (M11-D07)', async () => {
    const repository = await renderOverview();

    fireEvent.click(screen.getByTestId('edit-item-ข้าวผัดกุ้ง'));
    fireEvent.click(await screen.findByTestId('open-option-editor'));

    const editor = await screen.findByTestId('option-editor');
    // The editor seeds its draft once the dish's stored groups arrive, and
    // disables the add button until then — otherwise a group added during the
    // fetch would be wiped by the seed. Wait for that, rather than racing it.
    await waitFor(() => expect(within(editor).getByTestId('add-option-group')).not.toBeDisabled());
    fireEvent.click(within(editor).getByTestId('add-option-group'));

    fireEvent.change(within(editor).getByTestId('group-title-0'), { target: { value: 'ระดับความเผ็ด' } });
    fireEvent.change(within(editor).getByTestId('group-preset-0'), { target: { value: 'REQUIRED_ONE' } });
    fireEvent.change(within(editor).getByTestId('option-label-0-0'), { target: { value: 'เผ็ดมาก' } });
    fireEvent.click(within(editor).getByTestId('option-editor-save'));

    await waitFor(() =>
      expect(repository.replaceOptionGroups).toHaveBeenCalledWith('item-1', [
        {
          title: 'ระดับความเผ็ด',
          minSelect: 1,
          maxSelect: 1,
          options: [{ label: 'เผ็ดมาก', priceDeltaSatang: 0, isAvailable: true }],
        },
      ]),
    );
  });

  it('shows the stored pair in mono, so an operator can read what was written', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('edit-item-ข้าวผัดกุ้ง'));
    fireEvent.click(await screen.findByTestId('open-option-editor'));
    const editor = await screen.findByTestId('option-editor');
    // The editor seeds its draft once the dish's stored groups arrive, and
    // disables the add button until then — otherwise a group added during the
    // fetch would be wiped by the seed. Wait for that, rather than racing it.
    await waitFor(() => expect(within(editor).getByTestId('add-option-group')).not.toBeDisabled());
    fireEvent.click(within(editor).getByTestId('add-option-group'));

    expect(within(editor).getByText('min 0 / max 1')).toBeInTheDocument();
  });

  it('refuses a group with no options', async () => {
    const repository = await renderOverview();

    fireEvent.click(screen.getByTestId('edit-item-ข้าวผัดกุ้ง'));
    fireEvent.click(await screen.findByTestId('open-option-editor'));
    const editor = await screen.findByTestId('option-editor');
    // The editor seeds its draft once the dish's stored groups arrive, and
    // disables the add button until then — otherwise a group added during the
    // fetch would be wiped by the seed. Wait for that, rather than racing it.
    await waitFor(() => expect(within(editor).getByTestId('add-option-group')).not.toBeDisabled());
    fireEvent.click(within(editor).getByTestId('add-option-group'));
    fireEvent.change(within(editor).getByTestId('group-title-0'), { target: { value: 'x' } });
    fireEvent.click(within(editor).getByTestId('remove-group-0'));
    fireEvent.click(within(editor).getByTestId('add-option-group'));
    fireEvent.change(within(editor).getByTestId('group-title-0'), { target: { value: 'x' } });
    fireEvent.click(within(editor).getByTestId('option-editor-save'));

    // The one unlabelled option makes the group invalid.
    await waitFor(() => expect(repository.replaceOptionGroups).not.toHaveBeenCalled());
  });

  it('says a required group changes the customer flow', async () => {
    await renderOverview();

    fireEvent.click(screen.getByTestId('edit-item-ข้าวผัดกุ้ง'));
    fireEvent.click(await screen.findByTestId('open-option-editor'));
    const editor = await screen.findByTestId('option-editor');
    // The editor seeds its draft once the dish's stored groups arrive, and
    // disables the add button until then — otherwise a group added during the
    // fetch would be wiped by the seed. Wait for that, rather than racing it.
    await waitFor(() => expect(within(editor).getByTestId('add-option-group')).not.toBeDisabled());
    fireEvent.click(within(editor).getByTestId('add-option-group'));
    fireEvent.change(within(editor).getByTestId('group-preset-0'), { target: { value: 'REQUIRED_ONE' } });

    expect(within(editor).getByText('ลูกค้าต้องเลือกก่อนสั่ง')).toBeInTheDocument();
  });
});
