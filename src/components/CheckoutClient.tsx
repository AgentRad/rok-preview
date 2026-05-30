"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import ProductImage from "./ProductImage";
import { primaryImageUrl } from "@/lib/product-images";
import { getCart, clearCart, type CartLine } from "@/lib/cart";
import { formatCents, FEE_RATE_LABEL } from "@/lib/money";
import { computeOrderTotals } from "@/lib/order-totals";
import { formatAddressBlock } from "@/lib/address";
import { SURCHARGE_CENTS } from "@/lib/freight";

type SavedAddress = {
  id: string;
  label: string;
  recipient: string;
  company: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
};

type LookupProduct = {
  sku: string;
  name: string;
  icon: string;
  imageUrl?: string | null;
  manufacturer: string;
  unit: string;
  priceCents: number;
  etaDays: number;
  stock: number;
  supplierId: string;
  supplierName: string;
};

type Props = {
  user: {
    name: string;
    email: string;
    companyName?: string | null;
    companyLogoUrl?: string | null;
  } | null;
  paypalClientId: string;
  paymentsConfigured: boolean;
};

export default function CheckoutClient({ user, paypalClientId, paymentsConfigured }: Props) {
  const router = useRouter();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [products, setProducts] = useState<Record<string, LookupProduct>>({});
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [shipTo, setShipTo] = useState("");
  // PLH-3v: optional enterprise PO number. 64-char cap matches server.
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  // PLH-3y-2: shared org addresses any member can pick as ship-to. Prefixed
  // with "org:" in the dropdown value so pickAddress can tell them apart from
  // the user's personal saved addresses.
  const [orgAddresses, setOrgAddresses] = useState<SavedAddress[]>([]);
  const [orgName, setOrgName] = useState("");
  // PLH-3y-2: HYBRID billing. When the active org allows it, the member can
  // opt to charge the org card instead of their own.
  const [canChargeOrgCard, setCanChargeOrgCard] = useState(false);
  const [chargeOrgCard, setChargeOrgCard] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");

  const [step, setStep] = useState<"form" | "pay">("form");
  const [orderId, setOrderId] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // P9: per-supplier freight selection + surcharges. Populated by the
  // /api/freight/quote endpoint when the buyer's ZIP can be extracted
  // from shipTo and the cart has at least one item with weight + dims.
  type Shipment = {
    supplierId: string;
    supplierName: string;
    originZip: string;
    originCity: string;
    originState: string;
    rates: {
      carrier: string;
      service: string;
      cents: number;
      etaDays: number | null;
      rateId: string | null;
    }[];
    fallbackReason?: string;
    fallbackCents: number;
    selectedIdx: number;
  };
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [freightLoading, setFreightLoading] = useState(false);
  const [surcharges, setSurcharges] = useState({
    liftgate: false,
    residential: false,
    insideDelivery: false,
  });
  // P9.5 MED 27: import SURCHARGE_CENTS from lib/freight instead of
  // hardcoding. Pre-fix three call sites carried their own copy of the
  // constants; a price change would have required three updates.
  const surchargeTotalCents =
    (surcharges.liftgate ? SURCHARGE_CENTS.liftgate : 0) +
    (surcharges.residential ? SURCHARGE_CENTS.residential : 0) +
    (surcharges.insideDelivery ? SURCHARGE_CENTS.insideDelivery : 0);
  // Per-shipment freight: the selected live rate when one exists, else the
  // server-provided per-supplier flat-ground fallback (calculateFreight, the
  // same number the order route uses for that slot). Summing these gives the
  // real per-supplier freight total the server will adopt as the order
  // freight, even for a mixed cart where some suppliers have live rates and
  // others fall back to flat ground.
  function shipmentCents(s: Shipment): number {
    const rate = s.rates[s.selectedIdx];
    return rate ? rate.cents : s.fallbackCents;
  }
  const ratesFetched = shipments.length > 0;
  const freightFromShipments = ratesFetched
    ? shipments.reduce((sum, s) => sum + shipmentCents(s), 0)
    : 0;

  // Pull the 5-digit ZIP out of the buyer-typed shipTo block.
  function extractZip(s: string): string | null {
    const m = s.match(/\b(\d{5})(-\d{4})?\b/);
    return m ? m[1] : null;
  }
  const destZip = extractZip(shipTo);

  async function refreshFreightQuote() {
    if (!destZip || valid.length === 0) {
      setShipments([]);
      return;
    }
    setFreightLoading(true);
    try {
      const res = await fetch("/api/freight/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: valid.map((l) => ({ sku: l.sku, qty: l.qty })),
          destZip,
          surcharges,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setShipments([]);
        return;
      }
      const next: Shipment[] = (data.shipments || []).map(
        (s: {
          supplierId: string;
          supplierName: string;
          originZip: string;
          originCity: string;
          originState: string;
          rates: Shipment["rates"];
          fallbackReason?: string;
          fallbackCents?: number;
        }) => ({
          supplierId: s.supplierId,
          supplierName: s.supplierName,
          originZip: s.originZip,
          originCity: s.originCity,
          originState: s.originState,
          rates: s.rates || [],
          fallbackReason: s.fallbackReason,
          fallbackCents: s.fallbackCents ?? 0,
          selectedIdx: 0,
        })
      );
      setShipments(next);
    } finally {
      setFreightLoading(false);
    }
  }

  useEffect(() => {
    const cart = getCart();
    setLines(cart);
    if (cart.length === 0) {
      setLoading(false);
      return;
    }
    fetch("/api/products/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus: cart.map((l) => l.sku) }),
    })
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, LookupProduct> = {};
        for (const p of data.products as LookupProduct[]) map[p.sku] = p;
        setProducts(map);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch("/api/addresses")
      .then((r) => r.json())
      .then((data) => {
        const list = (data.addresses || []) as SavedAddress[];
        setSavedAddresses(list);
        const def = list.find((a) => a.isDefault);
        if (def && !shipTo) {
          setSelectedAddressId(def.id);
          setShipTo(formatAddressBlock(def));
          if (!name) setName(def.recipient);
        }
      })
      .catch(() => {});
    // PLH-3y-2: pull the active org's shared addresses too (if any).
    fetch("/api/buyer-org/addresses")
      .then((r) => r.json())
      .then((data) => {
        setOrgAddresses((data.addresses || []) as SavedAddress[]);
        if (data.orgName) setOrgName(data.orgName as string);
        setCanChargeOrgCard(!!data.canChargeOrgCard);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function pickAddress(id: string) {
    if (id === "") {
      setSelectedAddressId("");
      setShipTo("");
      return;
    }
    if (id.startsWith("org:")) {
      const a = orgAddresses.find((x) => `org:${x.id}` === id);
      if (!a) return;
      setSelectedAddressId(id);
      setShipTo(formatAddressBlock(a));
      if (!name) setName(a.recipient);
      return;
    }
    const a = savedAddresses.find((x) => x.id === id);
    if (!a) return;
    setSelectedAddressId(id);
    setShipTo(formatAddressBlock(a));
    if (!name) setName(a.recipient);
  }

  const valid = lines.filter((l) => products[l.sku]);
  const supplierCount = new Set(valid.map((l) => products[l.sku].supplierId))
    .size;
  const multiSupplier = supplierCount > 1;
  const lineInputs = valid.map((l) => ({
    unitPriceCents: products[l.sku].priceCents,
    qty: l.qty,
    quoteOnly: (products[l.sku] as { quoteOnly?: boolean }).quoteOnly,
  }));
  // Base freight before surcharges: once the per-supplier quote has been
  // fetched, it is the SUM of each shipment's real freight (selected live
  // rate, or that supplier's flat-ground fallback), which is exactly what the
  // server adopts as the order freight. Before rates are fetched we use the
  // deterministic combined-cart estimate (correct for a single supplier; a
  // multi-supplier cart must fetch rates before payment, enforced in
  // createOrder). Surcharges are always added on top, so the displayed total,
  // the posted claim, and the server compute all agree in every case.
  const naturalFreight = computeOrderTotals(lineInputs).freight;
  const baseFreightCents = ratesFetched
    ? freightFromShipments
    : naturalFreight.freightCents;
  const freightLabel = !ratesFetched
    ? naturalFreight.label
    : shipments.length === 1
      ? `${shipments[0].rates[shipments[0].selectedIdx]?.carrier ?? "Ground"} ${
          shipments[0].rates[shipments[0].selectedIdx]?.service ?? ""
        }`.trim() || "Ground shipping"
      : `${shipments.length} shipments`;
  const totals = computeOrderTotals(lineInputs, {
    freightOverrideCents: baseFreightCents + surchargeTotalCents,
    freightOverrideLabel: freightLabel,
  });
  const subtotal = totals.subtotalCents;
  const freight = totals.freightCents;
  const freightInfo = totals.freight;
  const fee = totals.feeCents;
  const tax = totals.taxCents;
  const total = totals.totalCents;
  const maxEta = valid.reduce(
    (m, l) => Math.max(m, products[l.sku].etaDays),
    0
  );

  async function createOrder() {
    // A multi-supplier cart ships from several origins, so the real freight is
    // the per-supplier sum, not the cheaper combined-cart estimate. Require the
    // buyer to fetch live rates first so the displayed total matches what they
    // are charged. Single-supplier carts compute deterministically without it.
    if (multiSupplier && !ratesFetched) {
      setError(
        "Get freight rates for your delivery ZIP before continuing, so your shipping total is accurate."
      );
      return;
    }
    setBusy(true);
    setError("");
    // Post the breakdown for every shipment once rates are fetched. Live-rate
    // shipments carry their rateId so the server re-verifies them against
    // Shippo; flat-ground shipments carry rateId null so the server flat-rates
    // that slot. Either way the server-verified per-supplier sum is authoritative.
    const freightBreakdown = ratesFetched
      ? shipments.map((s) => {
          const rate = s.rates[s.selectedIdx];
          return {
            supplierId: s.supplierId,
            supplierName: s.supplierName,
            originZip: s.originZip,
            carrier: rate?.carrier || "Ground",
            service: rate?.service || "Flat ground",
            cents: rate ? rate.cents : s.fallbackCents,
            etaDays: rate?.etaDays ?? null,
            rateId: rate?.rateId ?? null,
          };
        })
      : undefined;
    const topCarrier =
      shipments.length === 1
        ? shipments[0].rates[shipments[0].selectedIdx]?.carrier ?? "Ground"
        : ratesFetched
          ? "Multiple carriers"
          : null;
    const topService =
      shipments.length === 1
        ? shipments[0].rates[shipments[0].selectedIdx]?.service ?? null
        : null;

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: valid.map((l) => ({ sku: l.sku, qty: l.qty })),
        buyerName: name,
        buyerEmail: email,
        shipTo,
        freightBreakdown,
        freightCarrier: topCarrier,
        freightService: topService,
        freightSurcharges: surcharges,
        // The freight the buyer sees and agrees to. The server rejects with a
        // refresh-and-retry 400 only if its verified per-supplier total is
        // HIGHER than this (stale/tampered), and never charges more than this.
        claimedFreightCents: freight,
        purchaseOrderNumber: purchaseOrderNumber.trim() || undefined,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not create your order.");
      return;
    }
    setOrderId(data.orderId);
    setReference(data.reference);
    setStep("pay");
  }

  function onFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !shipTo.trim()) {
      setError("Please fill in your name, email and delivery address.");
      return;
    }
    createOrder();
  }

  const finishOrder = useCallback(() => {
    clearCart();
    router.push(`/orders/${orderId}`);
  }, [orderId, router]);

  async function payDemo() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/orders/${orderId}/pay`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Payment failed.");
      setBusy(false);
      return;
    }
    finishOrder();
  }

  async function payHosted() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/payments/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, chargeOrgCard }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setError(data.error || "Could not start checkout.");
        setBusy(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Could not start checkout.");
      setBusy(false);
    }
  }

  if (loading) return <p className="muted-text">Loading checkout…</p>;

  if (valid.length === 0) {
    return (
      <div className="empty-block">
        <h3>Nothing to check out</h3>
        <p>Your cart is empty.</p>
        <div style={{ marginTop: 16 }}>
          <Link className="btn btn-primary" href="/catalog">
            Browse catalog
          </Link>
        </div>
      </div>
    );
  }

  const summary = (
    <div className="card">
      <div className="card-body">
        {user?.companyName || user?.companyLogoUrl ? (
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              marginBottom: 12,
              paddingBottom: 12,
              borderBottom: "1px solid var(--line)",
            }}
          >
            {user.companyLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.companyLogoUrl}
                alt={`${user.companyName ?? "Company"} logo`}
                style={{
                  width: 44,
                  height: 44,
                  objectFit: "contain",
                  border: "1px solid var(--line)",
                  borderRadius: 4,
                  padding: 4,
                  background: "var(--surface)",
                }}
              />
            )}
            <div>
              <div style={{ fontSize: 11, color: "var(--steel)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>
                Billed to
              </div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                {user.companyName ?? user.name}
              </div>
            </div>
          </div>
        ) : null}
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
          Order summary
        </h2>
        {valid.map((l) => {
          const p = products[l.sku];
          return (
            <div className="summary-item" key={l.sku}>
              <div className="si-thumb">
                <ProductImage imageUrl={primaryImageUrl(p)} icon={p.icon} name={p.name} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
                <div className="muted-text" style={{ fontSize: 12 }}>
                  Qty {l.qty} × {formatCents(p.priceCents)}
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                {formatCents(p.priceCents * l.qty)}
              </div>
            </div>
          );
        })}
        <div className="summary-line">
          <span>Subtotal</span>
          <span>{formatCents(subtotal)}</span>
        </div>
        <div className="summary-line">
          <span>
            Freight
            <span className="muted-text" style={{ fontSize: 11, marginLeft: 6 }}>
              {freightInfo.label}
            </span>
          </span>
          <span>{freight > 0 ? formatCents(freight) : freightInfo.basis === "FREIGHT_QUOTED" ? "TBD" : formatCents(0)}</span>
        </div>
        <div className="summary-line">
          <span>Platform fee ({FEE_RATE_LABEL})</span>
          <span style={{ color: "var(--amber-deep)" }}>{formatCents(fee)}</span>
        </div>
        <div className="summary-line">
          <span>Sales tax</span>
          <span>{formatCents(tax)}</span>
        </div>
        <div className="summary-line total">
          <span>Total</span>
          <span>{formatCents(total)}</span>
        </div>
        <p className="muted-text" style={{ fontSize: 12.5, marginTop: 8 }}>
          Estimated delivery in {maxEta} business day{maxEta > 1 ? "s" : ""}.
          Freight and sales tax are calculated at fulfillment based on the
          shipping address and exemption status.
        </p>
      </div>
    </div>
  );

  return (
    <div className="checkout-grid">
      <div>
        {error && <div className="alert alert-error">{error}</div>}

        {step === "form" && (
          <div className="card">
            <div className="card-head">
              <h2>Delivery details</h2>
            </div>
            <div className="card-body">
              <form onSubmit={onFormSubmit}>
                <div className="form-row two">
                  <div>
                    <label htmlFor="cname">Full name</label>
                    <input
                      id="cname"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="cemail">Email</label>
                    <input
                      id="cemail"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                {(savedAddresses.length > 0 || orgAddresses.length > 0) && (
                  <div className="form-row">
                    <label htmlFor="csaved">Saved addresses</label>
                    <select
                      id="csaved"
                      value={selectedAddressId}
                      onChange={(e) => pickAddress(e.target.value)}
                    >
                      <option value="">Enter a new address</option>
                      {savedAddresses.length > 0 && (
                        <optgroup label="Your addresses">
                          {savedAddresses.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label || a.recipient}
                              {a.label ? ` (${a.recipient})` : ""}, {a.city},{" "}
                              {a.region}
                              {a.isDefault ? " (default)" : ""}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {orgAddresses.length > 0 && (
                        <optgroup label={orgName ? `${orgName} (shared)` : "Organization (shared)"}>
                          {orgAddresses.map((a) => (
                            <option key={a.id} value={`org:${a.id}`}>
                              {a.label || a.recipient}
                              {a.label ? ` (${a.recipient})` : ""}, {a.city},{" "}
                              {a.region}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                )}
                <div className="form-row">
                  <label htmlFor="cship">Delivery address</label>
                  <textarea
                    id="cship"
                    value={shipTo}
                    onChange={(e) => {
                      setShipTo(e.target.value);
                      setSelectedAddressId("");
                    }}
                    placeholder="Company, street, city, state, ZIP"
                    required
                  />
                </div>

                {destZip && (
                  <div className="form-row">
                    <label>Freight</label>
                    {shipments.length === 0 && !freightLoading && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={refreshFreightQuote}
                      >
                        Get freight rates for ZIP {destZip}
                      </button>
                    )}
                    {freightLoading && (
                      <div className="muted-text" style={{ fontSize: 13 }}>
                        Loading carrier rates…
                      </div>
                    )}
                    {shipments.length > 0 && (
                      <div>
                        {shipments.map((s, sIdx) => (
                          <div key={s.supplierId} style={{ marginBottom: 12 }}>
                            <div
                              className="muted-text"
                              style={{ fontSize: 12.5, marginBottom: 4 }}
                            >
                              <strong style={{ color: "var(--ink)" }}>
                                {s.supplierName}
                              </strong>
                              {s.originCity && s.originState
                                ? ` ships from ${s.originCity}, ${s.originState} ${s.originZip}`
                                : ""}
                            </div>
                            {s.rates.length === 0 ? (
                              <div className="muted-text" style={{ fontSize: 12.5 }}>
                                {s.fallbackReason ||
                                  "No live rates available; flat-rate ground applies."}
                              </div>
                            ) : (
                              <div className="freight-options">
                                {s.rates.slice(0, 3).map((r, rIdx) => (
                                  <label
                                    key={r.rateId || rIdx}
                                    className={
                                      "freight-option" +
                                      (s.selectedIdx === rIdx ? " is-selected" : "")
                                    }
                                  >
                                    <input
                                      type="radio"
                                      name={`rate-${s.supplierId}`}
                                      checked={s.selectedIdx === rIdx}
                                      onChange={() => {
                                        setShipments((prev) => {
                                          const next = [...prev];
                                          next[sIdx] = { ...next[sIdx], selectedIdx: rIdx };
                                          return next;
                                        });
                                      }}
                                    />
                                    <div className="freight-option-label">
                                      <div className="freight-option-name">
                                        {r.carrier} {r.service}
                                      </div>
                                      <div className="freight-option-meta">
                                        {r.etaDays != null
                                          ? `${r.etaDays} business day${r.etaDays === 1 ? "" : "s"}`
                                          : "ETA: by carrier"}
                                      </div>
                                    </div>
                                    <div className="freight-option-price">
                                      {formatCents(r.cents)}
                                    </div>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          className="link-btn"
                          onClick={refreshFreightQuote}
                          disabled={freightLoading}
                          style={{ fontSize: 12 }}
                        >
                          Refresh rates
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="form-row">
                  <label htmlFor="cpo">Purchase order number (optional)</label>
                  <input
                    id="cpo"
                    type="text"
                    value={purchaseOrderNumber}
                    onChange={(e) => setPurchaseOrderNumber(e.target.value.slice(0, 64))}
                    maxLength={64}
                    placeholder="e.g. PO-2026-04821"
                  />
                  <div className="muted-text" style={{ fontSize: 12, marginTop: 4 }}>
                    Enter your company's PO number for invoice reference.
                  </div>
                </div>

                <div className="form-row">
                  <label>Freight surcharges</label>
                  <div className="surcharge-list">
                    <label className="surcharge-row">
                      <input
                        type="checkbox"
                        checked={surcharges.liftgate}
                        onChange={(e) =>
                          setSurcharges((s) => ({ ...s, liftgate: e.target.checked }))
                        }
                      />
                      <span className="surcharge-row-name">
                        Liftgate at delivery
                        <span
                          className="muted-text"
                          style={{ fontSize: 12, marginLeft: 6 }}
                        >
                          for docks without forklift access
                        </span>
                      </span>
                      <span className="surcharge-row-price">+$150</span>
                    </label>
                    <label className="surcharge-row">
                      <input
                        type="checkbox"
                        checked={surcharges.residential}
                        onChange={(e) =>
                          setSurcharges((s) => ({
                            ...s,
                            residential: e.target.checked,
                          }))
                        }
                      />
                      <span className="surcharge-row-name">
                        Residential delivery
                        <span
                          className="muted-text"
                          style={{ fontSize: 12, marginLeft: 6 }}
                        >
                          home or non-commercial address
                        </span>
                      </span>
                      <span className="surcharge-row-price">+$75</span>
                    </label>
                    <label className="surcharge-row">
                      <input
                        type="checkbox"
                        checked={surcharges.insideDelivery}
                        onChange={(e) =>
                          setSurcharges((s) => ({
                            ...s,
                            insideDelivery: e.target.checked,
                          }))
                        }
                      />
                      <span className="surcharge-row-name">
                        Inside delivery
                        <span
                          className="muted-text"
                          style={{ fontSize: 12, marginLeft: 6 }}
                        >
                          carrier brings the freight indoors
                        </span>
                      </span>
                      <span className="surcharge-row-price">+$200</span>
                    </label>
                  </div>
                </div>

                <button className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? "Creating order…" : "Continue to payment"}
                </button>
              </form>
            </div>
          </div>
        )}

        {step === "pay" && (
          <div className="card">
            <div className="card-head">
              <h2>Payment · Order {reference}</h2>
            </div>
            <div className="card-body">
              <div className="pay-note">
                PartsPort collects payment, then releases funds to the supplier
                on dispatch. The marketplace fee is included in the total below.
              </div>
              {canChargeOrgCard && (
                <label
                  className="surcharge-row"
                  style={{ marginBottom: 12 }}
                >
                  <input
                    type="checkbox"
                    checked={chargeOrgCard}
                    onChange={(e) => setChargeOrgCard(e.target.checked)}
                  />
                  <span className="surcharge-row-name">
                    Charge to {orgName || "my organization"} account
                    <span className="muted-text" style={{ fontSize: 12, marginLeft: 6 }}>
                      bills the org card instead of your own
                    </span>
                  </span>
                </label>
              )}
              {paymentsConfigured ? (
                <>
                  <button
                    className="btn btn-primary btn-block"
                    onClick={payHosted}
                    disabled={busy}
                  >
                    {busy ? "Starting checkout…" : `Pay by bank transfer or card · ${formatCents(total)}`}
                  </button>
                  <p className="muted-text" style={{ fontSize: 12.5, marginTop: 8 }}>
                    Continues to a secure hosted checkout. ACH bank transfer is
                    the default; card is available as a fallback.
                  </p>
                </>
              ) : paypalClientId ? (
                <PayPalScriptProvider
                  options={{ clientId: paypalClientId, currency: "USD" }}
                >
                  <PayPalButtons
                    style={{ layout: "vertical", color: "gold", shape: "rect" }}
                    createOrder={async () => {
                      const res = await fetch("/api/paypal/create-order", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ orderId }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      return data.paypalOrderId as string;
                    }}
                    onApprove={async () => {
                      const res = await fetch("/api/paypal/capture", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ orderId }),
                      });
                      if (!res.ok) {
                        setError("Payment could not be captured.");
                        return;
                      }
                      finishOrder();
                    }}
                    onError={() => setError("PayPal checkout failed. Try again.")}
                  />
                </PayPalScriptProvider>
              ) : (
                <>
                  <div className="alert alert-info">
                    Instant order settlement is enabled for this environment.
                    Connect a PayPal account to accept live card and PayPal
                    payments.
                  </div>
                  <button
                    className="btn btn-primary btn-block"
                    onClick={payDemo}
                    disabled={busy}
                  >
                    {busy ? "Processing…" : `Place order · ${formatCents(total)}`}
                  </button>
                </>
              )}
              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 9 }}
                onClick={() => setStep("form")}
                disabled={busy}
              >
                ← Back to details
              </button>
            </div>
          </div>
        )}
      </div>

      {summary}
    </div>
  );
}
