import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Satang } from '@banhao/types';
import type { CartLine } from '../mocks/types';
import { calculateTotals, type OrderTotals } from '../mocks/pricing';

/**
 * Local cart state.
 *
 * Deliberately client-only: no order is created on any backend in this step
 * (brief §7). When order creation lands, this becomes the input to it — the
 * cart itself is never financial truth (DEC-014).
 */

interface CartState {
  lines: CartLine[];
  itemCount: number;
  subtotalSatang: Satang;
  totals: OrderTotals;
  addLine: (line: Omit<CartLine, 'lineId'>) => void;
  increase: (lineId: string) => void;
  decrease: (lineId: string) => void;
  remove: (lineId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartState | undefined>(undefined);

export function lineTotal(line: CartLine): Satang {
  return (line.basePriceSatang + line.optionsDeltaSatang) * line.quantity;
}

/**
 * The design ships with two items already in the cart so the cart, checkout,
 * and payment screens are reachable. Kept as the initial state rather than
 * scattered through screens.
 */
const initialLines: CartLine[] = [
  {
    lineId: 'seed-1',
    menuItemId: 'menu-somtam-thai-kaikem',
    shopId: 'shop-somtam-pathongdee',
    name: 'ส้มตำไทยไข่เค็ม',
    basePriceSatang: 6000,
    optionLabels: ['เผ็ดน้อย', 'ไม่ใส่ถั่ว'],
    optionsDeltaSatang: 0,
    note: '',
    quantity: 1,
  },
  {
    lineId: 'seed-2',
    menuItemId: 'menu-pad-kaprao-moo',
    shopId: 'shop-somtam-pathongdee',
    name: 'ผัดกะเพราหมูสับ',
    basePriceSatang: 5000,
    optionLabels: ['หมู', 'เผ็ดน้อย', 'ไข่ดาว +10'],
    optionsDeltaSatang: 1000,
    note: 'ไม่ใส่ผัก',
    quantity: 1,
  },
];

export function CartProvider({
  children,
  seed = initialLines,
}: {
  children: React.ReactNode;
  /** Overridable so tests can start from an empty or custom cart. */
  seed?: CartLine[];
}) {
  const [lines, setLines] = useState<CartLine[]>(seed);

  const addLine = useCallback((line: Omit<CartLine, 'lineId'>) => {
    setLines((prev) => [...prev, { ...line, lineId: `line-${Date.now()}-${prev.length}` }]);
  }, []);

  const increase = useCallback((lineId: string) => {
    setLines((prev) =>
      prev.map((l) => (l.lineId === lineId ? { ...l, quantity: l.quantity + 1 } : l)),
    );
  }, []);

  const decrease = useCallback((lineId: string) => {
    setLines((prev) =>
      prev.map((l) =>
        // Floor at 1; removing is an explicit action, matching the design.
        l.lineId === lineId ? { ...l, quantity: Math.max(1, l.quantity - 1) } : l,
      ),
    );
  }, []);

  const remove = useCallback((lineId: string) => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartState>(() => {
    const subtotalSatang = lines.reduce((sum, l) => sum + lineTotal(l), 0);
    return {
      lines,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      subtotalSatang,
      totals: calculateTotals(subtotalSatang),
      addLine,
      increase,
      decrease,
      remove,
      clear,
    };
  }, [lines, addLine, increase, decrease, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
