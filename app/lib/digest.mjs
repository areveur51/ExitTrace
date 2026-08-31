/** Host-side public RSS digest. Parks name leads. Digest items are not cites. */

import { IMPORT_CATEGORY_IDS, mapImportCategory } from "./categories.mjs";
import { importSourcePostsText } from "./import-posts.mjs";
import {
  OFFICIAL_NEWS_HANDLES,
  handleKey,
  hostOf,
  isGovHost,
  isOfficialCiteUrl,
  isOfficialNewsHandle,
  isOfficialNewsHost,
  isOfficialPublisherUrl,
  isQDropUrl,
  isWikipediaUrl,
  officialNewsHostsFor,
  parseHttpUrl,
} from "./official.mjs";
import { normalizeSubject, parseEventDate, personSlug } from "./promote.mjs";
import { canonicalPublicUrl } from "./urls.mjs";
import { queueAddRequest } from "./add-request.mjs";

export const DIGEST_SINCE = "2017-01-01";
export const DIGEST_USER_AGENT =
  "ExitTraceDigest/1.0 (+https://github.com/areveur51/ExitTrace)";

const GOOGLE_NEWS_HOSTS = new Set(["news.google.com", "news.google.co.uk"]);

const EXIT_QUERY =
  '(fired OR resigns OR resigned OR arrested OR "stepped down" OR dies OR died OR sacked)';

function googleNewsSite(site, extra = "") {
  const q = extra ? `site:${site} ${extra}` : `site:${site}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

function feed(row) {
  return {
    slice: "current",
    gov: false,
    ...row,
    handle: row.gov ? "gov" : handleKey(row.handle),
  };
}

/** Our public RSS list. Official news-org / .gov only. No hosted third-party digest. */
export const OFFICIAL_RSS_FEEDS = [
  feed({
    handle: "bbcnews",
    name: "BBC News",
    url: "https://feeds.bbci.co.uk/news/rss.xml",
  }),
  feed({
    handle: "bbcworld",
    name: "BBC World",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
  }),
  feed({
    handle: "apnews",
    name: "AP News",
    url: googleNewsSite("apnews.com", "when:1d"),
  }),
  feed({
    handle: "reuters",
    name: "Reuters",
    url: googleNewsSite("reuters.com", "when:1d"),
  }),
  feed({
    handle: "nytimes",
    name: "New York Times",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
  }),
  feed({
    handle: "washingtonpost",
    name: "Washington Post",
    url: "https://feeds.washingtonpost.com/rss/national",
  }),
  feed({
    handle: "wsj",
    name: "Wall Street Journal",
    url: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews",
  }),
  feed({
    handle: "guardian",
    name: "The Guardian",
    url: "https://www.theguardian.com/world/rss",
  }),
  feed({
    handle: "npr",
    name: "NPR",
    url: "https://feeds.npr.org/1001/rss.xml",
  }),
  feed({
    handle: "pbs",
    name: "PBS NewsHour",
    url: "https://www.pbs.org/newshour/feeds/rss/headlines",
  }),
  feed({
    handle: "politico",
    name: "Politico",
    url: "https://rss.politico.com/politics-news.xml",
  }),
  feed({
    handle: "thehill",
    name: "The Hill",
    url: "https://thehill.com/news/feed/",
  }),
  feed({
    handle: "axios",
    name: "Axios",
    url: "https://api.axios.com/feed/",
  }),
  feed({
    handle: "cnn",
    name: "CNN",
    url: "http://rss.cnn.com/rss/cnn_allpolitics.rss",
  }),
  feed({
    handle: "abc",
    name: "ABC News",
    url: "https://abcnews.go.com/abcnews/topstories",
  }),
  feed({
    handle: "cbsnews",
    name: "CBS News",
    url: "https://www.cbsnews.com/latest/rss/main",
  }),
  feed({
    handle: "nbcnews",
    name: "NBC News",
    url: "https://feeds.nbcnews.com/nbcnews/public/news",
  }),
  feed({
    handle: "latimes",
    name: "Los Angeles Times",
    url: "https://www.latimes.com/world-nation/rss2.0.xml",
  }),
  feed({
    handle: "usatoday",
    name: "USA Today",
    url: "https://rssfeeds.usatoday.com/usatoday-NewsTopStories",
  }),
  feed({
    handle: "dwnews",
    name: "DW News",
    url: "https://rss.dw.com/rdf/rss-en-all",
  }),
  feed({
    handle: "france24",
    name: "France 24",
    url: "https://www.france24.com/en/rss",
  }),
  feed({
    handle: "bloomberg",
    name: "Bloomberg Politics",
    url: "https://feeds.bloomberg.com/politics/news.rss",
  }),
  feed({
    handle: "ft",
    name: "Financial Times",
    url: "https://www.ft.com/rss/home",
  }),
  feed({
    gov: true,
    name: "White House",
    url: "https://www.whitehouse.gov/news/feed/",
  }),
  feed({
    gov: true,
    name: "Department of Justice",
    url: "https://www.justice.gov/news/rss",
  }),
  feed({
    gov: true,
    name: "Department of Defense",
    url: "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=20",
  }),
  feed({
    gov: true,
    name: "Department of State",
    url: "https://www.state.gov/rss-feed/press-releases/feed/",
  }),
  feed({
    handle: "apnews",
    name: "AP exits since 2017",
    slice: "historical",
    url: googleNewsSite("apnews.com", `${EXIT_QUERY} after:${DIGEST_SINCE}`),
  }),
  feed({
    handle: "reuters",
    name: "Reuters exits since 2017",
    slice: "historical",
    url: googleNewsSite("reuters.com", `${EXIT_QUERY} after:${DIGEST_SINCE}`),
  }),
  feed({
    handle: "bbcnews",
    name: "BBC exits since 2017",
    slice: "historical",
    url: googleNewsSite("bbc.com", `${EXIT_QUERY} after:${DIGEST_SINCE}`),
  }),
];

export function isGoogleNewsHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^www\./, "");
  return GOOGLE_NEWS_HOSTS.has(h);
}

export function hostedDigestVendorRefsIn(text) {
  const vendor = ["world", "monitor"].join("");
  return new RegExp(`${vendor}|${["world", "monitor"].join("[-_]")}|${["WORLD", "MONITOR"].join("_")}`, "i").test(
    String(text || ""),
  );
}

export function selectDigestFeeds(slice = "all") {
  const key = String(slice || "all").trim().toLowerCase();
  if (key === "current") return OFFICIAL_RSS_FEEDS.filter((f) => f.slice === "current");
  if (key === "historical") {
    return OFFICIAL_RSS_FEEDS.filter((f) => f.slice === "historical");
  }
  return OFFICIAL_RSS_FEEDS.slice();
}

export function assertOfficialFeedList(feeds = OFFICIAL_RSS_FEEDS) {
  for (const row of feeds) {
    if (hostedDigestVendorRefsIn(JSON.stringify(row))) {
      throw new Error("digest feed list must not reference a hosted third-party digest");
    }
    const parsed = parseHttpUrl(row.url);
    if (!parsed) throw new Error(`digest feed is not an http(s) URL: ${row.url}`);
    const host = hostOf(parsed);
    if (row.gov) {
      if (!isGovHost(host) && !isGoogleNewsHost(host)) {
        throw new Error(`gov digest feed host is not official: ${host}`);
      }
      continue;
    }
    if (!OFFICIAL_NEWS_HANDLES.has(row.handle)) {
      throw new Error(`digest feed handle is not on the cite allowlist: ${row.handle}`);
    }
    if (!isGoogleNewsHost(host) && !isOfficialNewsHost(host) && !isGovHost(host)) {
      throw new Error(`digest feed host is not an official publisher: ${host}`);
    }
    const allowed = officialNewsHostsFor(row.handle);
    if (!isGoogleNewsHost(host) && allowed.length && !isOfficialNewsHost(host)) {
      throw new Error(`digest feed host does not match handle ${row.handle}: ${host}`);
    }
  }
  return true;
}

function decodeXml(raw) {
  return String(raw || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function innerTag(block, names) {
  for (const name of names) {
    const m = String(block || "").match(
      new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
    );
    if (m) return decodeXml(m[1]);
  }
  return "";
}

function attr(block, tagName, attrName) {
  const m = String(block || "").match(
    new RegExp(`<${tagName}[^>]*\\s${attrName}\\s*=\\s*"([^"]+)"`, "i"),
  );
  return m ? m[1].trim() : "";
}

function firstHttpUrl(raw) {
  const text = String(raw || "");
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[).,;]+$/, "") : "";
}

export function looksLikeRss(text) {
  const body = String(text || "");
  if (!body.trim()) return false;
  if (/<html[\s>]/i.test(body) && !/<rss[\s>]/i.test(body) && !/<feed[\s>]/i.test(body)) {
    return false;
  }
  return /<(rss|rdf:RDF|feed)[\s>]/i.test(body) || /<(item|entry)[\s>]/i.test(body);
}

export function parseRssItems(xml) {
  const blocks = [];
  const src = String(xml || "");
  const itemRe = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = itemRe.exec(src))) blocks.push(match[2]);
  const items = [];
  const seen = new Set();
  for (const block of blocks) {
    const title = innerTag(block, ["title"]);
    const linkAttr = attr(block, "link", "href");
    const linkText = innerTag(block, ["link", "id", "guid"]);
    const sourceUrl = attr(block, "source", "url");
    const description = innerTag(block, [
      "description",
      "summary",
      "content",
      "content:encoded",
    ]);
    const pub = innerTag(block, [
      "pubDate",
      "published",
      "updated",
      "dc:date",
      "date",
    ]);
    const sourceName = innerTag(block, ["source"]);
    let url =
      canonicalPublicUrl(linkAttr) ||
      canonicalPublicUrl(linkText) ||
      canonicalPublicUrl(firstHttpUrl(description)) ||
      "";
    const publisherUrl = canonicalPublicUrl(sourceUrl) || "";
    if (url && isGoogleNewsHost(hostOf(url))) {
      const fromDesc = firstHttpUrl(description);
      if (fromDesc && !isGoogleNewsHost(hostOf(fromDesc))) {
        url = canonicalPublicUrl(fromDesc) || url;
      } else if (publisherUrl) {
        url = publisherUrl;
      }
    }
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({
      title,
      url,
      publisher_url: publisherUrl,
      publisher_name: sourceName,
      summary: description,
      published: pub,
    });
  }
  return items;
}

export function postedAtFromRss(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const iso = parseEventDate(text.slice(0, 10));
  if (iso) return iso;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

export function extractCalendarDate(text) {
  const m = String(text || "").match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (!m) return "";
  return parseEventDate(`${m[1]}-${m[2]}-${m[3]}`) || "";
}

const INDICTMENT_RE =
  /\b(indicted|indictment|indictments|charged by a grand jury)\b/i;

const CATEGORY_RULES = [
  { category: "arrests", re: /\b(arrested|arrests|taken into custody)\b/i },
  {
    category: "firings",
    re: /\b(fired|dismissed|sacked|terminated as|ousted as)\b/i,
  },
  {
    category: "resignations",
    re: /\b(resigns|resigned|resignation|steps down|stepped down)\b/i,
  },
  {
    category: "government_stepdowns",
    re: /\b(leaves office|left office|voted out|removed from office)\b/i,
  },
  {
    category: "death_unspecified",
    re: /\b(dies|died|dead at|obituary|passes away|passed away)\b/i,
  },
];

export function classifyDigestText(text) {
  const body = String(text || "");
  if (INDICTMENT_RE.test(body)) {
    return { import_category: null, indictment: true, keep: "promote" };
  }
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(body)) {
      const mapped = mapImportCategory(rule.category);
      return {
        import_category: mapped,
        indictment: false,
        keep: mapped ? "import" : null,
      };
    }
  }
  return { import_category: null, indictment: false, keep: null };
}

const NAME_STOP = new Set(
  [
    "white house",
    "justice department",
    "associated press",
    "reuters",
    "bbc news",
    "new york times",
    "washington post",
    "united states",
    "prime minister",
    "attorney general",
    "chief executive",
    "public official",
  ].map((s) => s.toLowerCase()),
);

export function extractLeadName(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const lead = t.match(
    /^((?:[A-Z][a-z]+|[A-Z]\.)(?:\s+(?:[A-Z][a-z]+|[A-Z]\.|de|van|von|bin|al)){1,4})\s+(?:has\s+)?(?:been\s+)?(fired|dismissed|sacked|resigns|resigned|arrested|dies|died|indicted|steps|stepped)\b/,
  );
  if (lead) return cleanLeadName(lead[1]);
  const mid = t.match(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(?:is|was|has been)\s+(fired|dismissed|arrested|indicted|sacked)\b/,
  );
  if (mid) return cleanLeadName(mid[1]);
  return "";
}

function cleanLeadName(raw) {
  const name = String(raw || "").replace(/\s+/g, " ").trim();
  if (!name || NAME_STOP.has(name.toLowerCase())) return "";
  if (personSlug(name).split("-").length < 2) return "";
  return name;
}

export function livePersonHit(people, { name, event_date, category, slug } = {}) {
  const subject = normalizeSubject(name);
  const id = slug || personSlug(name);
  if (!id && !subject) return null;
  for (const row of people || []) {
    if (id && row.id === id) return row;
    if (
      subject &&
      normalizeSubject(row.name) === subject &&
      event_date &&
      row.event_date === event_date &&
      category &&
      row.category === category
    ) {
      return row;
    }
  }
  return null;
}

/** Digest items are name leads. They never count as cites. */
export function digestItemCiteUrls(_item) {
  return [];
}

export function isDigestItemCite(_item) {
  return false;
}

export function asAddNameLead(item) {
  const subject = String(item?.lead_name || item?.subject || "").trim();
  return {
    kind: "person",
    subject,
    category: String(item?.add_category || "").trim(),
    event_date: parseEventDate(item?.event_date) || "",
    hint_url: String(item?.source_url || item?.hint_url || "").trim(),
    cite_urls: digestItemCiteUrls(item),
  };
}

export function formatJsonlRows(rows) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

function goldUrlSet(people) {
  const urls = new Set();
  for (const row of people || []) {
    for (const source of row.sources || []) {
      const url = canonicalPublicUrl(source.url);
      if (url) urls.add(url);
    }
  }
  return urls;
}

function itemPublisherOk(item, feed) {
  const url = item.url || "";
  if (!url) return false;
  if (isWikipediaUrl(url)) return false;
  if (isQDropUrl(url)) return false;
  if (isOfficialPublisherUrl(url)) return true;
  if (feed?.gov && isGovHost(hostOf(url))) return true;
  if (feed?.handle && isOfficialNewsHandle(feed.handle)) {
    const hosts = officialNewsHostsFor(feed.handle);
    const host = hostOf(url);
    if (hosts.some((root) => host === root || host.endsWith(`.${root}`))) return true;
  }
  return false;
}

export function digestItemsToLeads(items, { people = [], feed = null } = {}) {
  const goldUrls = goldUrlSet(people);
  const leads = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of items || []) {
    const source_url = canonicalPublicUrl(raw.url || raw.source_url);
    if (!source_url) {
      skipped.push({ skip: "url", title: raw.title || "" });
      continue;
    }
    if (seen.has(source_url)) {
      skipped.push({ skip: "url_dedup", source_url });
      continue;
    }
    seen.add(source_url);
    if (!itemPublisherOk({ ...raw, url: source_url }, feed)) {
      skipped.push({ skip: "publisher", source_url });
      continue;
    }
    const text = [raw.title, raw.summary].filter(Boolean).join(" — ");
    const classified = classifyDigestText(text);
    const lead_name = extractLeadName(raw.title || "");
    const posted_at = postedAtFromRss(raw.published);
    const event_date = extractCalendarDate(text);
    if (event_date && posted_at && event_date === posted_at) {
      // calendar date may match pub day; still never copy posted_at as event_date later
    }
    const goldHit = goldUrls.has(source_url);
    const live = lead_name
      ? livePersonHit(people, {
          name: lead_name,
          event_date,
          category: classified.import_category,
        })
      : null;
    if (live && !goldHit) {
      skipped.push({ skip: "live_person", source_url, name: lead_name, id: live.id });
      continue;
    }
    if (!classified.import_category && !classified.indictment && !lead_name) {
      skipped.push({ skip: "unclassified", source_url });
      continue;
    }
    if (!classified.import_category && !classified.indictment) {
      skipped.push({ skip: "closed_catalog", source_url });
      continue;
    }
    leads.push({
      source_url,
      quoted_url: "",
      card_url: "",
      text,
      poster_handle: feed?.handle && feed.handle !== "gov" ? `@${feed.handle}` : "",
      poster_name: feed?.name || raw.publisher_name || "",
      posted_at: posted_at || null,
      event_date,
      media_urls: [],
      category: classified.import_category,
      indictment: classified.indictment,
      lead_name,
      add_category: classified.import_category || "",
      gold_url: goldHit,
    });
  }
  return { leads, skipped };
}

export function leadsToImportRows(leads) {
  const rows = [];
  for (const lead of leads || []) {
    if (lead.indictment) continue;
    if (!IMPORT_CATEGORY_IDS.includes(lead.category)) continue;
    rows.push({
      source_url: lead.source_url,
      quoted_url: lead.quoted_url || "",
      card_url: lead.card_url || "",
      text: lead.text,
      poster_handle: lead.poster_handle,
      poster_name: lead.poster_name,
      posted_at: lead.posted_at,
      media_urls: lead.media_urls || [],
      category: lead.category,
    });
  }
  return rows;
}

export async function fetchFeedXml(url, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }
  const res = await fetchImpl(url, {
    headers: {
      "User-Agent": DIGEST_USER_AGENT,
      Accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      "Accept-Language": "en-US,en;q=0.8",
    },
  });
  if (!res || !res.ok) {
    return { url, ok: false, xml: "", error: String(res?.status || "fetch") };
  }
  const xml = await res.text();
  if (!looksLikeRss(xml)) {
    return { url, ok: false, xml: "", error: "not_rss" };
  }
  return { url, ok: true, xml, error: "" };
}

export async function seedRssDigest({
  people = [],
  feeds,
  slice = "all",
  fetchImpl,
  xmlByUrl,
  importPosts = true,
  queueLeads = true,
} = {}) {
  assertOfficialFeedList(OFFICIAL_RSS_FEEDS);
  const selected = feeds || selectDigestFeeds(slice);
  assertOfficialFeedList(selected);
  const allLeads = [];
  const skipped = [];
  const fetched = [];
  for (const feed of selected) {
    let xml = xmlByUrl?.[feed.url] || xmlByUrl?.[feed.name] || "";
    if (!xml && fetchImpl) {
      const got = await fetchFeedXml(feed.url, { fetchImpl });
      fetched.push({ name: feed.name, url: feed.url, ok: got.ok, error: got.error });
      if (!got.ok) {
        skipped.push({ skip: "fetch", url: feed.url, error: got.error });
        continue;
      }
      xml = got.xml;
    } else if (!xml) {
      skipped.push({ skip: "no_xml", url: feed.url });
      continue;
    }
    const items = parseRssItems(xml);
    const mapped = digestItemsToLeads(items, { people, feed });
    allLeads.push(...mapped.leads);
    skipped.push(...mapped.skipped);
  }

  const importRows = leadsToImportRows(allLeads);
  let imported = {
    parsed: 0,
    inserted: 0,
    updated: 0,
    annotated: 0,
    skipped: 0,
  };
  if (importPosts && importRows.length) {
    imported = await importSourcePostsText(formatJsonlRows(importRows), { people });
  }

  const queued = [];
  if (queueLeads) {
    for (const lead of allLeads) {
      if (!lead.lead_name) continue;
      if (
        livePersonHit(people, {
          name: lead.lead_name,
          event_date: lead.event_date,
          category: lead.category,
        })
      ) {
        continue;
      }
      const nameLead = asAddNameLead(lead);
      if (!nameLead.subject) continue;
      if (nameLead.cite_urls.length) {
        throw new Error("digest name lead must not carry cites");
      }
      const result = await queueAddRequest(nameLead);
      queued.push({
        id: result.request.id,
        created: result.created,
        subject: nameLead.subject,
        hint_url: nameLead.hint_url,
      });
    }
  }

  return {
    feeds: selected.length,
    leads: allLeads,
    import_rows: importRows,
    skipped,
    fetched,
    imported,
    queued,
    jsonl: formatJsonlRows(importRows),
  };
}

export function digestCiteFloorCheck(item, extraCites = []) {
  const cites = [...digestItemCiteUrls(item), ...extraCites];
  const official = cites.filter((url) => isOfficialCiteUrl(url));
  return official.length;
}
