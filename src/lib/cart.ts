"use client";

export type CartLine = {
  sku: string;
  qty: number;
  /** PLH-1 commit 5: supplier metadata on each cart line so the cart UI
   *  can group items by supplier without an extra round-trip. Older carts
   *  in localStorage may still have lines without these fields; CartClient
   *  falls back to the supplierName on the looked-up product when missing.
   *  PLH-3g Phase 2: multi-supplier carts are now allowed; the single-
   *  supplier client guard (DifferentSupplierError) was removed.
   */
  supplierId?: string;
  supplierName?: string;
};

const KEY = "partsport_cart_v1";
const EVENT = "pp-cart-change";

export function getCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function setCart(lines: CartLine[]): void {
  localStorage.setItem(KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event(EVENT));
}

export function addToCart(
  sku: string,
  qty = 1,
  supplier?: { id: string; name: string }
): void {
  const cart = getCart();
  // PLH-3g Phase 2: multi-supplier carts allowed. No supplier conflict check.
  const line = cart.find((l) => l.sku === sku);
  if (line) {
    line.qty += qty;
    if (supplier && !line.supplierId) {
      line.supplierId = supplier.id;
      line.supplierName = supplier.name;
    }
  } else {
    cart.push({
      sku,
      qty,
      supplierId: supplier?.id,
      supplierName: supplier?.name,
    });
  }
  setCart(cart);
}

export function setQty(sku: string, qty: number): void {
  let cart = getCart();
  if (qty <= 0) cart = cart.filter((l) => l.sku !== sku);
  else cart = cart.map((l) => (l.sku === sku ? { ...l, qty } : l));
  setCart(cart);
}

export function clearCart(): void {
  setCart([]);
}

export function cartCount(): number {
  return getCart().reduce((n, l) => n + l.qty, 0);
}

export function onCartChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
