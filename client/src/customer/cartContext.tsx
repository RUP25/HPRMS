import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CartLine, MenuItem, Variant } from './types';

type CartContextValue = {
  cart: CartLine[];
  addToCart: (it: MenuItem, v: Variant, delta: number) => void;
  qtyInCart: (itemId: string, variantLabel: string) => number;
  clearCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function storageKey(tableId: number) {
  return `hprms.cart.${tableId}`;
}

export function CartProvider({
  tableId,
  children,
}: {
  tableId: number;
  children: ReactNode;
}) {
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey(tableId)) || '[]');
    } catch {
      return [];
    }
  });

  const persist = useCallback(
    (next: CartLine[]) => {
      localStorage.setItem(storageKey(tableId), JSON.stringify(next));
      setCart(next);
    },
    [tableId],
  );

  const addToCart = useCallback(
    (it: MenuItem, v: Variant, delta: number) => {
      setCart((prev) => {
        const next = [...prev];
        const idx = next.findIndex(
          (c) => c.menu_item_id === it.id && c.variant_label === v.label,
        );
        if (idx >= 0) {
          next[idx] = { ...next[idx], qty: next[idx].qty + delta };
          if (next[idx].qty <= 0) next.splice(idx, 1);
        } else if (delta > 0) {
          next.push({
            menu_item_id: it.id,
            variant_label: v.label,
            name: it.name,
            unit_price: v.price,
            qty: delta,
          });
        }
        localStorage.setItem(storageKey(tableId), JSON.stringify(next));
        return next;
      });
    },
    [tableId],
  );

  const qtyInCart = useCallback(
    (itemId: string, variantLabel: string) =>
      cart
        .filter((c) => c.menu_item_id === itemId && c.variant_label === variantLabel)
        .reduce((s, c) => s + c.qty, 0),
    [cart],
  );

  const clearCart = useCallback(() => {
    persist([]);
  }, [persist]);

  const value = useMemo(
    () => ({ cart, addToCart, qtyInCart, clearCart }),
    [cart, addToCart, qtyInCart, clearCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart outside CartProvider');
  return ctx;
}
