"use client";

export type CartLine = { sku: string; qty: number };
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

export function addToCart(sku: string, qty = 1): void {
  const cart = getCart();
  const line = cart.find((l) => l.sku === sku);
  if (line) line.qty += qty;
  else cart.push({ sku, qty });
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
