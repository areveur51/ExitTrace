/** Canonical public URL for dedup. Host + path only; tracking query is dropped. */

const TRACKING = /^(utm_|fbclid|gclid|mc_|igshid|s$)/i;
const X_HOSTS = new Set(["twitter.com", "mobile.twitter.com", "m.twitter.com", "x.com"]);

export function canonicalPublicUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (X_HOSTS.has(host)) host = "x.com";
  let path = parsed.pathname.replace(/\/+$/, "") || "";
  const kept = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (TRACKING.test(key)) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));
  const query = kept.length
    ? `?${kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
    : "";
  return `${parsed.protocol}//${host}${path}${query}`;
}

export function publicUrlsOf(row) {
  const urls = [row?.source_url, row?.quoted_url, row?.card_url];
  if (Array.isArray(row?.media_urls)) urls.push(...row.media_urls);
  return [...new Set(urls.map(canonicalPublicUrl).filter(Boolean))];
}
