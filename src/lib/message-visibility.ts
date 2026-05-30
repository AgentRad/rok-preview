// PLH-3p F3: visibility rules for thread messages.
//
// - PUBLIC: everyone on the thread sees it and is emailed.
// - SUPPLIER_INTERNAL: only the posting supplier's team + admins see; no
//   buyer email.
// - BUYER_INTERNAL: only the buyer + admins see; no supplier email.
// - ADMIN_ONLY: only admins see; no outbound email at all.

export type ViewerRole = "admin" | "buyer" | "supplier" | "none";

export type MessageVisibility =
  | "PUBLIC"
  | "SUPPLIER_INTERNAL"
  | "BUYER_INTERNAL"
  | "ADMIN_ONLY";

const ALL: MessageVisibility[] = [
  "PUBLIC",
  "SUPPLIER_INTERNAL",
  "BUYER_INTERNAL",
  "ADMIN_ONLY",
];

export function isMessageVisibility(v: unknown): v is MessageVisibility {
  return typeof v === "string" && (ALL as string[]).includes(v);
}

/**
 * Resolve the visibility the server should persist, given what the sender
 * requested and which role they are posting under. Falls back to PUBLIC on
 * anything the role is not allowed to use.
 */
export function resolveOutgoingVisibility(
  requested: unknown,
  role: ViewerRole
): MessageVisibility {
  const v = isMessageVisibility(requested) ? requested : "PUBLIC";
  if (role === "admin") return v;
  if (role === "supplier") {
    return v === "SUPPLIER_INTERNAL" ? "SUPPLIER_INTERNAL" : "PUBLIC";
  }
  // Buyer (and anything else): only PUBLIC is permitted.
  return "PUBLIC";
}

/**
 * Allowed visibilities a given viewer role can READ on a thread.
 */
export function visibilitiesVisibleTo(role: ViewerRole): MessageVisibility[] {
  if (role === "admin") return ALL.slice();
  if (role === "supplier") return ["PUBLIC", "SUPPLIER_INTERNAL"];
  if (role === "buyer") return ["PUBLIC", "BUYER_INTERNAL"];
  return ["PUBLIC"];
}

/**
 * Does the visibility allow emailing the buyer party?
 */
export function emailsBuyer(v: MessageVisibility): boolean {
  return v === "PUBLIC" || v === "BUYER_INTERNAL";
}

/**
 * Does the visibility allow emailing the supplier team?
 */
export function emailsSupplierTeam(v: MessageVisibility): boolean {
  return v === "PUBLIC" || v === "SUPPLIER_INTERNAL";
}
