import { createHash } from "node:crypto";
import { mapImportCategory } from "./categories.mjs";
import { listDogComms, listPeople, upsertSourcePosts } from "./store.mjs";
import { canonicalPublicUrl } from "./urls.mjs";

function sourcePostId(canonicalUrl) {
  const hex = createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16);
  return `sp-${hex}`;
}

export function goldUrlIndex(people, dogs) {
  const peopleMap = new Map();
  for (const row of people || []) {
    const cites = [];
    for (const source of row.sources || []) cites.push(source);
    for (const ev of row.events || []) {
      for (const source of ev.sources || []) cites.push(source);
    }
    for (const source of cites) {
      const url = canonicalPublicUrl(source.url);
      if (url) peopleMap.set(url, row.id);
    }
  }
  const dogsSet = new Set();
  for (const row of dogs || []) {
    const url = canonicalPublicUrl(row.source_url);
    if (url) dogsSet.add(url);
  }
  return { people: peopleMap, dogs: dogsSet };
}

function asMediaUrls(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

export function normalizeImportRow(raw) {
  const category = mapImportCategory(raw?.category);
  if (!category) return { skip: "category" };
  const sourceUrl = String(raw?.source_url || "").trim();
  const canonical = canonicalPublicUrl(sourceUrl);
  if (!canonical) return { skip: "url" };
  const posted = String(raw?.posted_at || "").trim();
  return {
    id: sourcePostId(canonical),
    category,
    source_url: sourceUrl,
    canonical_url: canonical,
    quoted_url: String(raw?.quoted_url || "").trim(),
    card_url: String(raw?.card_url || "").trim(),
    text: String(raw?.text || ""),
    poster_handle: String(raw?.poster_handle || "").trim(),
    poster_name: String(raw?.poster_name || "").trim(),
    posted_at: posted ? posted.slice(0, 10) : null,
    media_urls: asMediaUrls(raw?.media_urls),
    gold_person_id: null,
  };
}

export function parseJsonl(text) {
  const rows = [];
  const skipped = [];
  const seen = new Map();
  for (const [index, line] of String(text || "").split(/\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      skipped.push({ line: index + 1, skip: "json" });
      continue;
    }
    const row = normalizeImportRow(raw);
    if (row.skip) {
      skipped.push({ line: index + 1, skip: row.skip, category: raw.category });
      continue;
    }
    seen.set(row.canonical_url, row);
  }
  for (const row of seen.values()) rows.push(row);
  return { rows, skipped };
}

function matchGold(row, gold) {
  const urls = [
    row.canonical_url,
    canonicalPublicUrl(row.quoted_url),
    canonicalPublicUrl(row.card_url),
  ].filter(Boolean);
  for (const url of urls) {
    if (gold.dogs.has(url)) return { kind: "dog" };
    const personId = gold.people.get(url);
    if (personId) return { kind: "person", id: personId };
  }
  return null;
}

/**
 * Park public source rows. Does not classify subjects or invent cites.
 * A later pass can require two published-news or official-account cites
 * per identified person; this step only stores the URLs it is given.
 */
export async function importSourcePostsText(text, { people, dog_comms } = {}) {
  const goldPeople = people || (await listPeople());
  const goldDogs = dog_comms || (await listDogComms());
  const gold = goldUrlIndex(goldPeople, goldDogs);
  const parsed = parseJsonl(text);
  const accepted = [];
  let annotated = 0;
  let skippedDog = 0;
  for (const row of parsed.rows) {
    const hit = matchGold(row, gold);
    if (hit?.kind === "dog") {
      skippedDog += 1;
      continue;
    }
    if (hit?.kind === "person") {
      row.gold_person_id = hit.id;
      annotated += 1;
    }
    accepted.push(row);
  }
  const upserted = await upsertSourcePosts(accepted);
  return {
    parsed: parsed.rows.length,
    skipped: parsed.skipped.length + skippedDog,
    skipped_category: parsed.skipped.filter((s) => s.skip === "category").length,
    skipped_dog: skippedDog,
    annotated,
    ...upserted,
  };
}
