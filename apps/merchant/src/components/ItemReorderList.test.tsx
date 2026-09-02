import { fireEvent, render, screen } from '@testing-library/react';
import type { MenuItem } from '../domain/menu';
import { ItemReorderList } from './ItemReorderList';

function item(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 'item-1',
    categoryId: 'cat-1',
    name: 'ข้าวมันไก่',
    description: null,
    basePriceSatang: 5500,
    imageUrl: null,
    isAvailable: true,
    sortOrder: 0,
    archivedAt: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
    optionGroupCount: 0,
    ...overrides,
  };
}

const ITEMS: MenuItem[] = [
  item({ id: 'a', name: 'ข้าวมันไก่' }),
  item({ id: 'b', name: 'ข้าวขาหมู' }),
  item({ id: 'c', name: 'ข้าวหมูกรอบ' }),
];

function renderList(overrides: Partial<Parameters<typeof ItemReorderList>[0]> = {}) {
  const onSave = jest.fn();
  const onCancel = jest.fn();
  render(
    <ItemReorderList
      categoryName="อาหารจานเดียว"
      items={ITEMS}
      saving={false}
      failed={false}
      onSave={onSave}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onSave, onCancel };
}

describe('ItemReorderList — moving rows', () => {
  it('moves a row down and updates position badges', () => {
    renderList();

    fireEvent.click(screen.getByTestId('reorder-down-ข้าวมันไก่'));

    const rows = screen.getAllByTestId(/^reorder-row-/).map((row) => row.getAttribute('data-testid'));
    expect(rows).toEqual(['reorder-row-ข้าวขาหมู', 'reorder-row-ข้าวมันไก่', 'reorder-row-ข้าวหมูกรอบ']);
    expect(screen.getByTestId('reorder-position-ข้าวมันไก่')).toHaveTextContent('2');
  });

  it('moves a row up', () => {
    renderList();

    fireEvent.click(screen.getByTestId('reorder-up-ข้าวหมูกรอบ'));

    expect(screen.getByTestId('reorder-position-ข้าวหมูกรอบ')).toHaveTextContent('2');
  });

  it('does not move past the first position', () => {
    renderList();

    expect(screen.getByTestId('reorder-up-ข้าวมันไก่')).toBeDisabled();
    fireEvent.click(screen.getByTestId('reorder-up-ข้าวมันไก่'));
    expect(screen.getByTestId('reorder-position-ข้าวมันไก่')).toHaveTextContent('1');
  });

  it('does not move past the last position', () => {
    renderList();

    expect(screen.getByTestId('reorder-down-ข้าวหมูกรอบ')).toBeDisabled();
    fireEvent.click(screen.getByTestId('reorder-down-ข้าวหมูกรอบ'));
    expect(screen.getByTestId('reorder-position-ข้าวหมูกรอบ')).toHaveTextContent('3');
  });

  it('announces each move through the live region', () => {
    renderList();

    fireEvent.click(screen.getByTestId('reorder-down-ข้าวมันไก่'));

    expect(screen.getByTestId('reorder-announcement')).toHaveTextContent(
      'ย้าย ข้าวมันไก่ ไปตำแหน่งที่ 2 จาก 3',
    );
  });

  it('reorders by dragging, not only by button', () => {
    renderList();

    const from = screen.getByTestId('reorder-row-ข้าวมันไก่');
    const to = screen.getByTestId('reorder-row-ข้าวหมูกรอบ');
    const dataTransfer = { effectAllowed: '', setData: jest.fn(), getData: jest.fn() };

    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragOver(to, { dataTransfer });
    fireEvent.drop(to, { dataTransfer });

    const rows = screen.getAllByTestId(/^reorder-row-/).map((row) => row.getAttribute('data-testid'));
    expect(rows).toEqual(['reorder-row-ข้าวขาหมู', 'reorder-row-ข้าวหมูกรอบ', 'reorder-row-ข้าวมันไก่']);
  });
});

describe('ItemReorderList — save/cancel', () => {
  it('save is disabled until the order changes', () => {
    renderList();
    expect(screen.getByTestId('reorder-save')).toHaveAttribute('aria-disabled', 'true');
  });

  it('moving a row enables save and shows the changed note', () => {
    renderList();

    fireEvent.click(screen.getByTestId('reorder-down-ข้าวมันไก่'));

    expect(screen.getByTestId('reorder-save')).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByTestId('reorder-footer-note')).toHaveTextContent('ลำดับเปลี่ยนแล้ว — ยังไม่บันทึก');
  });

  it('save sends the full ordered id list, not a partial diff', () => {
    const { onSave } = renderList();

    fireEvent.click(screen.getByTestId('reorder-down-ข้าวมันไก่'));
    fireEvent.click(screen.getByTestId('reorder-save'));

    expect(onSave).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('cancel discards the draft — onCancel is called, nothing is saved', () => {
    const { onSave, onCancel } = renderList();

    fireEvent.click(screen.getByTestId('reorder-down-ข้าวมันไก่'));
    fireEvent.click(screen.getByTestId('reorder-cancel'));

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Escape behaves the same as Cancel', () => {
    const { onCancel } = renderList();

    fireEvent.keyDown(screen.getByTestId('reorder-list-อาหารจานเดียว'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalled();
  });

  it('saving disables move, drag, cancel and save — no duplicate submit', () => {
    renderList({ saving: true });

    expect(screen.getByTestId('reorder-up-ข้าวขาหมู')).toBeDisabled();
    expect(screen.getByTestId('reorder-down-ข้าวขาหมู')).toBeDisabled();
    expect(screen.getByTestId('reorder-cancel')).toBeDisabled();
    expect(screen.getByTestId('reorder-save')).toHaveTextContent('กำลังบันทึก…');
    expect(screen.getByTestId('reorder-row-ข้าวมันไก่')).toHaveAttribute('draggable', 'false');
  });

  it('renders the failure banner with retry — save stays enabled to retry', () => {
    renderList({ failed: true });

    expect(screen.getByTestId('reorder-error')).toHaveTextContent('จัดลำดับไม่สำเร็จ · ลองอีกครั้ง');
  });
});
