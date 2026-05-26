"use client";

export type CartLine = {
  sku: string;
  qty: number;
  /** PLH-1 commit 5: supplier metadata on each cart line so the
   *  single-supplier-cart constraint can be enforced client-side without an
   *  extra round-trip. Older carts in localStorage may still have lines
   *  without these fields; addToCart treats those as "unknown supplier" and
   *  skips the comparison, falling back to the server-side check in
   *  /api/orders POST. */
  supplierId?: string;
  supplierName?: string;
};

const KEY = "partsport_cart_v1";
const EVENT = "pp-cart-change";

/**
 * PLH-1 commit 5: thrown by addToCart when the cart already contains items
 * from a different supplier. UI surfaces should catch this and show the
 * "start a new cart?" prompt.
 *
 * PartsPort routes shipments and payments per supplier, so each order can
 * only contain items from one supplier at launch. The full multi-supplier
 * Shipment refactor is queued post-launch (see docs/ORCHESTRATOR.md).
 */
export class DifferentSupplierError extends Error {
  existingSupplierName: string;
  existingSupplierId: string;
  newSupplierName: string;
  newSupplierId: string;
  constructor(args: {
    existingSupplierId: string;
    existingSupplierName: string;
    newSupplierId: string;
    newSupplierName: string;
  }) {
    super(
      `Cart contains items from ${args.existingSupplierName}; cannot add item from ${args.newSupplierName}.`
    );
    this.name = "DifferentSupplierError";
    this.existingSupplierId = args.existingSupplierId;
    this.existingSupplierName = args.existingSupplierName;
    this.newSupplierId = args.newSupplierId;
    this.newSupplierName = args.newSupplierName;
  }
}

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
  if (supplier && cart.length > 0) {
    // Find any existing line with a known supplierId that differs from the
    // incoming supplier. Lines without supplierId (pre-PLH-1 carts) are
    // skipped here; the server-side check in /api/orders POST is the
    // belt-and-suspenders guarantee.
    const conflict = cart.find(
      (l) => l.supplierId && l.supplierId !== supplier.id
    );
    if (conflict) {
      throw new DifferentSupplierError({
        existingSupplierId: conflict.supplierId!,
        existingSupplierName: conflict.supplierName || "another supplier",
        newSupplierId: supplier.id,
        newSupplierName: supplier.name,
      });
    }
  }
  const line = cart.find((l) => l.sku === sku);
  if (line) {
    line.qty += qty;
    // Backfill supplier metadata onto the existing line if the caller
    // knows it now and the line was added by a legacy code path.
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
