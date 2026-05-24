export type AddressInput = {
  label?: string;
  recipient: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country?: string;
  phone?: string;
};

export type AddressLike = AddressInput & {
  id?: string;
  isDefault?: boolean;
};

/** Renders an address as a multi-line block suitable for Order.shipTo. */
export function formatAddressBlock(a: AddressLike): string {
  const lines: string[] = [];
  const headline = [a.recipient, a.company].filter(Boolean).join(" / ");
  if (headline) lines.push(headline);
  lines.push(a.line1);
  if (a.line2) lines.push(a.line2);
  lines.push(
    [a.city, a.region, a.postalCode].filter(Boolean).join(", ")
  );
  if (a.country && a.country !== "US") lines.push(a.country);
  if (a.phone) lines.push(a.phone);
  return lines.join("\n");
}

/** Validates required fields. Returns null if ok, or an error message. */
export function validateAddress(a: Partial<AddressInput>): string | null {
  if (!a.recipient?.trim()) return "Recipient name is required.";
  if (!a.line1?.trim()) return "Street address is required.";
  if (!a.city?.trim()) return "City is required.";
  if (!a.region?.trim()) return "State or region is required.";
  if (!a.postalCode?.trim()) return "Postal code is required.";
  return null;
}
