import { parsePhoneNumberFromString } from "libphonenumber-js";

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

// PLH-2 Phase 4d (D3): per-field length caps. Prevents arbitrary-size
// payloads from inflating storage or breaking downstream label/PDF
// renderers. Caller checks each field; first overflow short-circuits.
export const ADDRESS_FIELD_CAPS = {
  recipient: 120,
  line1: 200,
  line2: 200,
  city: 100,
  region: 100,
  postalCode: 20,
  country: 100,
  phone: 40,
  label: 60,
  company: 200,
} as const;

// PLH-2 Phase 4d (D4): country is normalized to ISO-3166 alpha-2 (two
// uppercase letters). Anything else is rejected at the API boundary.
const ISO_ALPHA2 = /^[A-Z]{2}$/;

// PLH-2 Phase 4d (D4): per-country postal-code regexes. Other countries
// fall back to a generic alphanumeric + length check.
const POSTAL_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/,
  // GB postcodes have several shapes; loose pattern catches valid ones
  // without rejecting edge cases like GIR 0AA.
  GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/,
};

const GENERIC_POSTAL = /^[A-Z0-9 \-]{2,20}$/i;

export type AddressFieldError = { field: keyof AddressInput; error: string };

/**
 * Validates required fields, per-field caps (D3), country format (D4
 * alpha-2 ISO), and postal-code format (D4 per-country). Returns null on
 * success or `{ field, error }` on the first failure.
 */
export function validateAddress(
  a: Partial<AddressInput>
): AddressFieldError | string | null {
  if (!a.recipient?.trim()) return { field: "recipient", error: "Recipient name is required." };
  if (!a.line1?.trim()) return { field: "line1", error: "Street address is required." };
  if (!a.city?.trim()) return { field: "city", error: "City is required." };
  if (!a.region?.trim()) return { field: "region", error: "State or region is required." };
  if (!a.postalCode?.trim()) return { field: "postalCode", error: "Postal code is required." };

  for (const [field, cap] of Object.entries(ADDRESS_FIELD_CAPS) as [
    keyof typeof ADDRESS_FIELD_CAPS,
    number
  ][]) {
    const v = (a as Partial<Record<keyof typeof ADDRESS_FIELD_CAPS, string>>)[field];
    if (typeof v === "string" && v.length > cap) {
      return {
        field: field as keyof AddressInput,
        error: `${field} is too long (max ${cap} characters).`,
      };
    }
  }

  const country = (a.country ?? "US").trim().toUpperCase();
  if (!ISO_ALPHA2.test(country)) {
    return {
      field: "country",
      error: "Country must be a 2-letter ISO code (e.g. US, CA, GB).",
    };
  }

  const postal = a.postalCode!.trim().toUpperCase();
  const specific = POSTAL_PATTERNS[country];
  if (specific) {
    if (!specific.test(postal)) {
      return {
        field: "postalCode",
        error: `Postal code does not match the ${country} format.`,
      };
    }
  } else if (!GENERIC_POSTAL.test(postal)) {
    return {
      field: "postalCode",
      error: "Postal code must be 2-20 alphanumeric characters.",
    };
  }

  // PLH-3j P3: phone format validation via libphonenumber-js. Phone is
  // optional, so blank / missing passes. When provided, the number must
  // parse and validate against its country (defaults to the address
  // country). Obvious typos (too short, non-digits, wrong-length for
  // the country) reject with structured { field, error }.
  const phoneRaw = a.phone?.trim();
  if (phoneRaw) {
    const parsed = parsePhoneNumberFromString(phoneRaw, country as never);
    if (!parsed || !parsed.isValid()) {
      return {
        field: "phone",
        error: "Phone number does not look valid for the selected country.",
      };
    }
  }
  return null;
}
