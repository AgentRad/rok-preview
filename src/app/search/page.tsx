import { redirect } from "next/navigation";

type SearchParams = { q?: string };

/**
 * /search → /catalog?q=...
 *
 * Some callers (search-engine deep links, copy-pasted URLs from elsewhere,
 * external integrations) hit /search expecting a search results page. We
 * don't have a dedicated route (catalog is the search results page), so
 * we redirect with the query intact. Avoids a 404 for the most predictable
 * misspelled URL on the site.
 */
export default async function SearchRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = (sp.q || "").trim();
  redirect(q ? `/catalog?q=${encodeURIComponent(q)}` : "/catalog");
}
