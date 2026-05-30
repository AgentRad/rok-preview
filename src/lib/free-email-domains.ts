// PLH-3y-3: free / public email providers. An org may not claim one of these
// as a verified domain, since nobody owns the public namespace and auto-join
// on a public provider would let anyone walk into the org. Used by the domain
// claim route to reject the claim, and by the auto-join path as a belt so a
// public-domain match never triggers a join even if a row somehow exists.
//
// Lowercased, no leading "@". Kept conservative: the common consumer mailbox
// providers plus a handful of disposable-domain roots.
const FREE_EMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "zoho.com",
  "yandex.com",
  "mail.com",
  "fastmail.com",
  "tutanota.com",
  // Disposable / throwaway roots.
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "trashmail.com",
]);

export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

// PLH-3y-3: extract the lowercased domain part of an email address. Returns
// null when the input has no single "@" or an empty domain part.
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || domain.includes("@")) return null;
  return domain;
}

// PLH-3y-3: normalize a user-entered domain claim. Strips a leading "@",
// scheme, path, and whitespace, lowercases, and validates a basic shape
// (label.label, each label alphanumeric or hyphen). Returns null when the
// input is not a plausible domain.
export function normalizeDomainClaim(input: string): string | null {
  let d = String(input || "").trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^@/, "");
  d = d.split("/")[0];
  d = d.split("@").pop() || d;
  if (d.length > 253) return null;
  // At least one dot, valid labels, valid TLD.
  if (!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) {
    return null;
  }
  return d;
}
