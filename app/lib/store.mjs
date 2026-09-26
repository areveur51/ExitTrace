import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { databaseUrl } from "./env.mjs";
import {
  PromoteError,
  assertNewPersonInsertLock,
  attachPersonEvent,
  buildPersonRow,
  citeRecords,
  incomingPersonEvent,
  collapseDuplicatePeople,
  findGoldMatch,
  mergeCites,
  mergePersonAnnotate,
  personEvents,
  personHasKind,
  projectPerson,
  resolveEventKind,
  validateIdentifiedPersonInput,
  validatePromoteInput,
} from "./promote.mjs";
import { isPeopleMediaHref, resolvePortrait } from "./portrait.mjs";
import { normalizeScreenshotCredit, normalizeScreenshotHref } from "./screenshot.mjs";
import { hasRecordedNetWorth, resolveNetWorth } from "./net-worth.mjs";
import { canonicalPublicUrl } from "./urls.mjs";
import { ageFilterActive, matchesAgeFilter, stampEventAge } from "./age.mjs";
import {
  kindsImplyingTags,
  matchesTags,
  normalizeTags,
  personTags,
} from "./tags.mjs";
import { mergeCareer, personCareer } from "./career.mjs";
import { DEATH_KEEP_IDS, asPostedAt, isIndictmentKeepKind } from "./categories.mjs";
import { eventHeadcount, personHeadcount } from "./event-attrs.mjs";
import { isLogicalSubscriber } from "./logical-heal.mjs";
import {
  CENTRAL_CASTING_SCREENSHOT_KIND,
  CentralCastingClassifyError,
  assertCentralCastingClassification,
  centralCastingStoredQuote,
  commsKind,
  mediaSpec,
  normalizeCentralCasting,
  KIND_COMMS,
  KIND_COMM_IDS,
} from "./kind-comms.mjs";
import {
  buildOperationRow,
  findOperationMatch,
  mergeOperationAnnotate,
  normalizeOperation,
  operationHasTag,
  validateIdentifiedOperationInput,
} from "./operation.mjs";

let pool = null;
let memory = null;

export function backendName() {
  return databaseUrl() ? "postgres" : "file";
}

export async function getPool() {
  const url = databaseUrl();
  if (!url) return null;
  if (pool) return pool;
  let pg;
  try {
    pg = await import("pg");
  } catch {
    throw new Error(
      "DATABASE_URL is set but the 'pg' package is missing. Run: npm install pg",
    );
  }
  pool = new pg.default.Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 4),
    idleTimeoutMillis: 10_000,
  });
  return pool;
}

export async function ensureSchema(p, bootstrapSql) {
  await p.query(bootstrapSql);
}

function asDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function normalizePerson(row) {
  const birth_date = asDate(row.birth_date);
  const events = personEvents(row).map((ev) => stampEventAge(ev, birth_date));
  return projectPerson({
    id: row.id,
    category: row.category,
    name: row.name,
    role: row.role || "",
    event_date: asDate(row.event_date),
    death_date: asDate(row.death_date),
    birth_date,
    country_of_origin: String(row.country_of_origin || "").trim(),
    photo: row.photo || "",
    photo_credit: row.photo_credit || "",
    screenshot: normalizeScreenshotHref(row.screenshot, "people"),
    screenshot_credit: normalizeScreenshotCredit(row.screenshot_credit),
    net_worth_usd:
      row.net_worth_usd === null || row.net_worth_usd === undefined
        ? null
        : Number(row.net_worth_usd),
    net_worth_note: row.net_worth_note || "",
    net_worth_source: row.net_worth_source || "",
    sources: Array.isArray(row.sources) ? row.sources : row.sources || [],
    summary: row.summary || "",
    events,
    career: personCareer(row),
    tags: personTags({ ...row, events }),
    central_casting: normalizeCentralCasting(row.central_casting),
  });
}

/** Accept supporting[].screenshot + screenshot_credit. Invalid shot hrefs fail closed. */
function normalizeKindSnapshot(raw, kind) {
  if (!raw || typeof raw !== "object") return {};
  const snap = { ...raw };
  if (!Array.isArray(raw.supporting)) return snap;
  const spec = mediaSpec(kind);
  snap.supporting = raw.supporting.map((item) => {
    if (!item || typeof item !== "object") return item;
    return {
      ...item,
      screenshot: normalizeScreenshotHref(item.screenshot, spec.screenshotKind),
      screenshot_credit: normalizeScreenshotCredit(item.screenshot_credit),
    };
  });
  return snap;
}

function normalizeKindComm(row, kind = "dog") {
  const spec = commsKind(kind);
  const out = {
    id: row.id,
    posted_at: asPostedAt(row.posted_at),
    handle: row.handle,
    account_name: row.account_name || "",
    text: row.text,
    still: row.still || "",
    still_credit: row.still_credit || "",
    screenshot: normalizeScreenshotHref(row.screenshot, spec.screenshotKind),
    screenshot_credit: normalizeScreenshotCredit(row.screenshot_credit),
    source_url: row.source_url,
    snapshot: normalizeKindSnapshot(row.snapshot, spec.id),
  };
  return out;
}

function kindCommMemory(raw = {}) {
  const out = {};
  for (const id of KIND_COMM_IDS) {
    const spec = KIND_COMMS[id];
    out[spec.memoryKey] = (raw[spec.memoryKey] || []).map((row) => normalizeKindComm(row, id));
  }
  return out;
}

function mergeKindMemory(seed = {}, prior = {}) {
  const out = {};
  for (const id of KIND_COMM_IDS) {
    const spec = KIND_COMMS[id];
    out[spec.memoryKey] = mergeGoldKindComms(seed[spec.memoryKey], prior[spec.memoryKey], id);
  }
  return out;
}

/** Dog seed always replaces. Other kind catalogs keep live rows when the seed list is empty. */
function importKindMemory(seed = {}) {
  const out = {};
  for (const id of KIND_COMM_IDS) {
    const spec = KIND_COMMS[id];
    if (id === "dog") {
      out[spec.memoryKey] = seed.dog_comms;
    } else {
      const incoming = seed[spec.memoryKey];
      out[spec.memoryKey] = incoming?.length ? incoming : getMemory()[spec.memoryKey];
    }
  }
  return out;
}

function normalizeDog(row) {
  return normalizeKindComm(row, "dog");
}

function normalizeSourcePost(row) {
  const sourceUrl = row.source_url || "";
  return {
    id: row.id,
    category: row.category,
    source_url: sourceUrl,
    canonical_url: row.canonical_url || canonicalPublicUrl(sourceUrl),
    quoted_url: row.quoted_url || "",
    card_url: row.card_url || "",
    text: row.text || "",
    poster_handle: row.poster_handle || "",
    poster_name: row.poster_name || "",
    posted_at: asPostedAt(row.posted_at),
    media_urls: Array.isArray(row.media_urls) ? row.media_urls : [],
    gold_person_id: row.gold_person_id || null,
  };
}

function addRequestKind(raw) {
  const kind = String(raw || "").trim();
  if (
    kind === "dog" ||
    kind === "operation" ||
    kind === "red_folder" ||
    kind === "central_casting"
  ) {
    return kind;
  }
  return "person";
}

function normalizeAddRequest(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const created =
    row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at || "";
  const processed =
    row.processed_at instanceof Date
      ? row.processed_at.toISOString()
      : row.processed_at || "";
  return {
    id: row.id,
    kind: addRequestKind(row.kind),
    status: row.status || "pending",
    source: String(row.source || payload.source || "").trim(),
    subject_status_id: String(row.subject_status_id || payload.subject_status_id || "").trim(),
    mention_status_id: String(row.mention_status_id || payload.mention_status_id || "").trim(),
    subject: row.subject || "",
    category: row.category || "",
    event_date: asDate(row.event_date) || "",
    hint_url: row.hint_url || "",
    handle: row.handle || "",
    source_url: row.source_url || "",
    posted_at: asDate(row.posted_at) || "",
    cite_urls: Array.isArray(row.cite_urls) ? row.cite_urls : [],
    extra_urls: Array.isArray(row.extra_urls)
      ? row.extra_urls
      : Array.isArray(payload.extra_urls)
        ? payload.extra_urls
        : [],
    account_name: row.account_name || payload.account_name || "",
    text: row.text || payload.text || "",
    still: row.still || payload.still || "",
    still_credit: row.still_credit || payload.still_credit || "",
    summary: row.summary || payload.summary || "",
    role: row.role || payload.role || "",
    photo: row.photo || payload.photo || "",
    photo_credit: row.photo_credit || payload.photo_credit || "",
    net_worth_usd:
      row.net_worth_usd !== undefined && row.net_worth_usd !== null && row.net_worth_usd !== ""
        ? row.net_worth_usd
        : payload.net_worth_usd !== undefined
          ? payload.net_worth_usd
          : "",
    net_worth_source: row.net_worth_source || payload.net_worth_source || "",
    net_worth_note: row.net_worth_note || payload.net_worth_note || "",
    birth_date: asDate(row.birth_date || payload.birth_date) || "",
    country_of_origin: String(
      row.country_of_origin || payload.country_of_origin || "",
    ).trim(),
    position: String(row.position || payload.position || "").trim(),
    organization: String(row.organization || payload.organization || "").trim(),
    country: String(row.country || payload.country || "").trim(),
    branch: String(row.branch || payload.branch || "").trim(),
    comments: String(row.comments || payload.comments || "").trim(),
    reason: String(row.reason || payload.reason || "").trim(),
    military: row.military ?? payload.military ?? false,
    last_day: String(row.last_day || payload.last_day || "").trim(),
    announced: String(row.announced || payload.announced || "").trim(),
    announced_date: asDate(row.announced_date || payload.announced_date) || "",
    agencies: Array.isArray(row.agencies)
      ? row.agencies
      : Array.isArray(payload.agencies)
        ? payload.agencies
        : String(row.agencies || payload.agencies || "").trim(),
    victim_count:
      row.victim_count !== undefined && row.victim_count !== null && row.victim_count !== ""
        ? row.victim_count
        : payload.victim_count !== undefined
          ? payload.victim_count
          : "",
    arrest_count:
      row.arrest_count !== undefined && row.arrest_count !== null && row.arrest_count !== ""
        ? row.arrest_count
        : payload.arrest_count !== undefined
          ? payload.arrest_count
          : "",
    op_tags: Array.isArray(row.op_tags)
      ? row.op_tags
      : Array.isArray(row.tags)
        ? row.tags
        : Array.isArray(payload.op_tags)
          ? payload.op_tags
          : Array.isArray(payload.tags)
            ? payload.tags
            : [],
    error: row.error || "",
    result: row.result && typeof row.result === "object" ? row.result : null,
    created_at: created,
    processed_at: processed,
  };
}

export function loadSeedFile(seedPath) {
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  return {
    people: (raw.people || []).map(normalizePerson),
    ...kindCommMemory(raw),
    central_casting_comms: centralCastingClipsFrom(raw),
    source_posts: (raw.source_posts || []).map(normalizeSourcePost),
    add_requests: (raw.add_requests || []).map(normalizeAddRequest),
    operations: (raw.operations || []).map(normalizeOperation),
    meta: raw.meta || {},
  };
}

export function loadFileStore(dataDir) {
  const out = path.join(dataDir, "store.json");
  if (!fs.existsSync(out)) return emptyMemory();
  const raw = JSON.parse(fs.readFileSync(out, "utf8"));
  return {
    people: (raw.people || []).map(normalizePerson),
    ...kindCommMemory(raw),
    central_casting_comms: centralCastingClipsFrom(raw),
    source_posts: (raw.source_posts || []).map(normalizeSourcePost),
    add_requests: (raw.add_requests || []).map(normalizeAddRequest),
    operations: (raw.operations || []).map(normalizeOperation),
    meta: raw.meta || {},
  };
}

function normalizeCentralCastingClip(row = {}) {
  const role = String(row.role || "").trim();
  if (role === "glossary") {
    throw new CentralCastingClassifyError("glossary is not stored", "glossary_removed");
  }
  const personRaw = row.person_id == null ? "" : String(row.person_id).trim();
  if (!personRaw) {
    throw new CentralCastingClassifyError("evidence person_id is required", "evidence_person");
  }
  const id = String(row.id || "").trim();
  const source_url = String(row.source_url || "").trim();
  if (!id) throw new CentralCastingClassifyError("clip id is required", "missing_id");
  if (!source_url) throw new CentralCastingClassifyError("cite required", "missing_cite");
  return {
    id,
    person_id: personRaw,
    posted_at: asPostedAt(row.posted_at),
    handle: row.handle || "",
    account_name: row.account_name || "",
    text: centralCastingStoredQuote(row),
    still: row.still || "",
    still_credit: row.still_credit || "",
    screenshot: normalizeScreenshotHref(row.screenshot, CENTRAL_CASTING_SCREENSHOT_KIND),
    screenshot_credit: normalizeScreenshotCredit(row.screenshot_credit),
    source_url,
    snapshot: normalizeKindSnapshot(row.snapshot, "central_casting"),
  };
}

function centralCastingClipsFrom(raw) {
  const out = [];
  for (const row of raw?.central_casting_comms || []) {
    try {
      out.push(normalizeCentralCastingClip(row));
    } catch {
      // Fail closed on load: an unlocked row is omitted, never rewritten.
    }
  }
  return out;
}

function emptyMemory() {
  return {
    people: [],
    ...kindCommMemory({}),
    central_casting_comms: [],
    source_posts: [],
    add_requests: [],
    operations: [],
    meta: {},
  };
}

export function setMemory(seed) {
  memory = {
    people: (seed.people || []).map(normalizePerson),
    ...kindCommMemory(seed),
    central_casting_comms: centralCastingClipsFrom(seed),
    source_posts: (seed.source_posts || []).map(normalizeSourcePost),
    add_requests: (seed.add_requests || []).map(normalizeAddRequest),
    operations: (seed.operations || []).map(normalizeOperation),
    meta: seed.meta || {},
  };
  return memory;
}

export function getMemory() {
  if (!memory) memory = emptyMemory();
  return memory;
}

export function writeFileStore(dataDir, seed) {
  fs.mkdirSync(dataDir, { recursive: true });
  const out = path.join(dataDir, "store.json");
  fs.writeFileSync(out, JSON.stringify(seed, null, 2) + "\n");
  return out;
}

/** Seed wins name/photo/net-worth and existing event fields; extra kinds and cites stay. */
export function mergeGoldPeople(seedPeople, priorPeople) {
  const priorById = new Map((priorPeople || []).map((row) => [row.id, normalizePerson(row)]));
  const out = [];
  const seen = new Set();
  for (const gold of seedPeople || []) {
    const goldRow = normalizePerson(gold);
    seen.add(goldRow.id);
    const prior = priorById.get(goldRow.id);
    if (!prior) {
      out.push(goldRow);
      continue;
    }
    out.push(mergePersonAnnotate(goldRow, prior));
  }
  for (const prior of priorPeople || []) {
    const row = normalizePerson(prior);
    if (!seen.has(row.id)) out.push(row);
  }
  return collapseDuplicatePeople(out);
}

/** Seed operations win identity; extra store ops are kept. Gold counts/cites are not overwritten. */
export function mergeGoldOperations(seedOps, priorOps) {
  const goldIds = new Set((seedOps || []).map((row) => row.id));
  const goldNames = new Set(
    (seedOps || []).map((row) => String(row.name || "").trim().toLowerCase()).filter(Boolean),
  );
  const extras = (priorOps || []).filter((row) => {
    if (goldIds.has(row.id)) return false;
    const name = String(row.name || "").trim().toLowerCase();
    if (name && goldNames.has(name)) return false;
    return true;
  });
  const merged = (seedOps || []).map((gold) => {
    const prior = (priorOps || []).find(
      (row) =>
        row.id === gold.id ||
        String(row.name || "").trim().toLowerCase() === String(gold.name || "").trim().toLowerCase(),
    );
    return prior ? mergeOperationAnnotate(gold, prior) : normalizeOperation(gold);
  });
  return [...merged, ...extras.map(normalizeOperation)];
}


/** Fill-empty merge for kind-comm snapshot. Preserves prior supporting + stills. */
export function mergeKindSnapshotFillEmpty(nextSnap = {}, priorSnap = {}) {
  const next = nextSnap && typeof nextSnap === "object" ? { ...nextSnap } : {};
  const prior = priorSnap && typeof priorSnap === "object" ? priorSnap : {};
  const nextStills = Array.isArray(next.stills) ? next.stills : [];
  const priorStills = Array.isArray(prior.stills) ? prior.stills : [];
  if (!nextStills.length && priorStills.length) next.stills = [...priorStills];
  const nextSupp = Array.isArray(next.supporting) ? next.supporting : [];
  const priorSupp = Array.isArray(prior.supporting) ? prior.supporting : [];
  if (!nextSupp.length && priorSupp.length) next.supporting = priorSupp.map((e) => ({ ...e }));
  return next;
}

/** Seed comms win; extra store rows are kept. Gold rows are not overwritten. */
export function mergeGoldKindComms(seedRows, priorRows, kind = "dog") {
  const goldIds = new Set((seedRows || []).map((row) => row.id));
  const goldUrls = new Set(
    (seedRows || []).map((row) => canonicalPublicUrl(row.source_url)).filter(Boolean),
  );
  const extras = (priorRows || []).filter((row) => {
    if (goldIds.has(row.id)) return false;
    const url = canonicalPublicUrl(row.source_url);
    if (url && goldUrls.has(url)) return false;
    return true;
  });
  const priorById = new Map(
    (priorRows || []).map((row) => [row.id, normalizeKindComm(row, kind)]),
  );
  const gold = (seedRows || []).map((row) => {
    const next = normalizeKindComm(row, kind);
    const prior = priorById.get(next.id);
    if (!prior) return next;
    return {
      ...next,
      screenshot: next.screenshot || prior.screenshot || "",
      screenshot_credit: next.screenshot_credit || prior.screenshot_credit || "",
      // Fill-empty snapshot merge: never wipe gold supporting / stills on seed hydrate.
      snapshot: mergeKindSnapshotFillEmpty(next.snapshot, prior.snapshot),
    };
  });
  return [...gold, ...extras.map((row) => normalizeKindComm(row, kind))];
}

/** Seed dogs win; extra store dogs are kept. Gold rows are not overwritten. */
export function mergeGoldDogs(seedDogs, priorDogs) {
  return mergeGoldKindComms(seedDogs, priorDogs, "dog");
}

function backfillCentralCastingQuotes() {
  for (const row of getMemory().central_casting_comms || []) {
    const text = centralCastingStoredQuote(row, { archivedText: archivedPostText(row.source_url) });
    if (text && row.text !== text) row.text = text;
  }
}

export function hydrateFileMemory(dataDir, seed) {
  const prior = loadFileStore(dataDir);
  const seedClips = seed.central_casting_comms || [];
  const mem = setMemory({
    people: mergeGoldPeople(seed.people, prior.people),
    ...mergeKindMemory(seed, prior),
    central_casting_comms: seedClips.length ? seedClips : prior.central_casting_comms || [],
    operations: mergeGoldOperations(seed.operations, prior.operations),
    source_posts: prior.source_posts,
    add_requests: prior.add_requests || [],
    meta: seed.meta,
  });
  backfillCentralCastingQuotes();
  return mem;
}

export async function importSeed(p, seed) {
  if (!p) {
    const existing = getMemory().source_posts || [];
    const incoming = seed.source_posts || [];
    const existingClips = getMemory().central_casting_comms || [];
    const incomingClips = seed.central_casting_comms || [];
    setMemory({
      people: seed.people,
      ...importKindMemory(seed),
      central_casting_comms: incomingClips.length ? incomingClips : existingClips,
      operations: seed.operations,
      source_posts: incoming.length ? incoming : existing,
      meta: seed.meta,
    });
    backfillCentralCastingQuotes();
    const mem = getMemory();
    const imported = {
      people: seed.people.length,
      operations: (seed.operations || []).length,
      source_posts: mem.source_posts.length,
    };
    for (const id of KIND_COMM_IDS) {
      const spec = KIND_COMMS[id];
      imported[spec.memoryKey] = (mem[spec.memoryKey] || []).length;
    }
    return imported;
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    for (const raw of seed.people) {
      const existing = await client.query("SELECT * FROM people WHERE id = $1", [raw.id]);
      const row = existing.rows[0]
        ? mergePersonAnnotate(normalizePerson(raw), normalizePerson(existing.rows[0]))
        : normalizePerson(raw);
      await client.query(
        `INSERT INTO people (
           id, category, name, role, event_date, death_date, birth_date, country_of_origin,
           photo, photo_credit, screenshot, screenshot_credit, net_worth_usd, net_worth_note,
           net_worth_source, sources, summary, events, tags, career
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19::jsonb,$20::jsonb
         )
         ON CONFLICT (id) DO UPDATE SET
           category = EXCLUDED.category,
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           event_date = EXCLUDED.event_date,
           death_date = EXCLUDED.death_date,
           birth_date = EXCLUDED.birth_date,
           country_of_origin = COALESCE(NULLIF(people.country_of_origin, ''), EXCLUDED.country_of_origin),
           photo = EXCLUDED.photo,
           photo_credit = EXCLUDED.photo_credit,
           screenshot = COALESCE(NULLIF(people.screenshot, ''), EXCLUDED.screenshot),
           screenshot_credit = COALESCE(NULLIF(people.screenshot_credit, ''), EXCLUDED.screenshot_credit),
           net_worth_usd = EXCLUDED.net_worth_usd,
           net_worth_note = EXCLUDED.net_worth_note,
           net_worth_source = EXCLUDED.net_worth_source,
           sources = EXCLUDED.sources,
           summary = EXCLUDED.summary,
           events = EXCLUDED.events,
           tags = EXCLUDED.tags,
           career = EXCLUDED.career`,
        personValues(row),
      );
      await syncPersonEvents(client, row);
    }
    for (const raw of seed.dog_comms) {
      const row = normalizeDog(raw);
      await client.query(
        `INSERT INTO dog_comms (
           id, posted_at, handle, account_name, text, still, still_credit,
           screenshot, screenshot_credit, source_url, snapshot
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb
         )
         ON CONFLICT (id) DO UPDATE SET
           posted_at = EXCLUDED.posted_at,
           handle = EXCLUDED.handle,
           account_name = EXCLUDED.account_name,
           text = EXCLUDED.text,
           still = EXCLUDED.still,
           still_credit = EXCLUDED.still_credit,
           screenshot = COALESCE(NULLIF(dog_comms.screenshot, ''), EXCLUDED.screenshot),
           screenshot_credit = COALESCE(NULLIF(dog_comms.screenshot_credit, ''), EXCLUDED.screenshot_credit),
           source_url = EXCLUDED.source_url,
           snapshot = EXCLUDED.snapshot`,
        [
          row.id,
          row.posted_at,
          row.handle,
          row.account_name,
          row.text,
          row.still,
          row.still_credit,
          row.screenshot,
          row.screenshot_credit,
          row.source_url,
          JSON.stringify(row.snapshot || {}),
        ],
      );
    }
    for (const raw of seed.operations || []) {
      const existing = await client.query("SELECT * FROM operations WHERE id = $1", [raw.id]);
      const row = existing.rows[0]
        ? mergeOperationAnnotate(normalizeOperation(raw), normalizeOperation(existing.rows[0]))
        : normalizeOperation(raw);
      await client.query(
        `INSERT INTO operations (
           id, name, event_date, announced_date, agencies, summary,
           victim_count, arrest_count, tags, sources, screenshot
         ) VALUES (
           $1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11
         )
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           event_date = EXCLUDED.event_date,
           announced_date = COALESCE(operations.announced_date, EXCLUDED.announced_date),
           agencies = EXCLUDED.agencies,
           summary = EXCLUDED.summary,
           victim_count = COALESCE(operations.victim_count, EXCLUDED.victim_count),
           arrest_count = COALESCE(operations.arrest_count, EXCLUDED.arrest_count),
           tags = EXCLUDED.tags,
           sources = EXCLUDED.sources,
           screenshot = COALESCE(NULLIF(operations.screenshot, ''), EXCLUDED.screenshot)`,
        operationValues(row),
      );
    }
    await client.query(
      `INSERT INTO et_meta (k, v) VALUES ('seed', $1::jsonb)
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
      [JSON.stringify({ imported_at: new Date().toISOString(), ...(seed.meta || {}) })],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return {
    people: seed.people.length,
    dog_comms: seed.dog_comms.length,
    operations: (seed.operations || []).length,
  };
}

/** Read et_meta rows by key. Missing table/keys → {}. Never throws. */
export async function getEtMeta(keys) {
  const p = await getPool();
  if (!p) return {};
  const list = (Array.isArray(keys) ? keys : [keys]).map(String).filter(Boolean);
  if (!list.length) return {};
  try {
    const res = await p.query("SELECT k, v FROM et_meta WHERE k = ANY($1::text[])", [list]);
    const out = {};
    for (const row of res.rows) out[row.k] = row.v;
    return out;
  } catch {
    return {};
  }
}

/** Same upsert as seed import: INSERT … ON CONFLICT (k) DO UPDATE SET v. */
export async function upsertEtMeta(k, v) {
  const p = await getPool();
  if (!p) {
    throw new Error("et_meta upserts need Postgres (DATABASE_URL)");
  }
  await p.query(
    `INSERT INTO et_meta (k, v) VALUES ($1, $2::jsonb)
     ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
    [String(k), JSON.stringify(v)],
  );
}

/**
 * Ops heal for lab→Render logical apply crash-loop. Subscriber-only:
 * no pg_subscription (publisher / lab) is a no-op. Never auto-SKIP an LSN
 * (Worf #100: SKIP needs Admiral SIGN; not planned or auto-run).
 * - Promote dog_comms.posted_at DATE→TEXT (idempotent; matches bootstrap-db.sql).
 * - Idempotent upsert of data/ops/logical-gap-heal-20260918.json.gz snapshot.
 * - Advance pg_replication_origin to lab tip, then ENABLE subscription.
 * Returns a public-safe summary (no DSNs, hosts, or passwords).
 */
export async function healLogicalApply() {
  const p = await getPool();
  if (!p) return { ok: false, reason: "no_pool" };
  let present = false;
  try {
    const sub = await p.query(`SELECT EXISTS (SELECT 1 FROM pg_subscription) AS present`);
    present = Boolean(sub.rows[0]?.present);
  } catch {
    present = false;
  }
  if (!isLogicalSubscriber(present)) {
    return {
      ok: true,
      reason: "no_subscription",
      posted_at_type_before: null,
      posted_at_type_after: null,
      altered: false,
      apply_error_count_before: null,
      bounced: false,
      gap_upserted: false,
      origin_advanced: false,
      lab_tip_lsn: null,
      people: null,
      dog_comms: null,
      operations: null,
      warren: null,
    };
  }
  const out = {
    ok: true,
    posted_at_type_before: null,
    posted_at_type_after: null,
    altered: false,
    apply_error_count_before: null,
    bounced: false,
    gap_upserted: false,
    origin_advanced: false,
    lab_tip_lsn: null,
    people: null,
    dog_comms: null,
    operations: null,
    warren: null,
  };
  try {
    const typeRes = await p.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dog_comms' AND column_name='posted_at'`,
    );
    out.posted_at_type_before = typeRes.rows[0]?.data_type || null;
    if (out.posted_at_type_before === "date") {
      await p.query(
        `ALTER TABLE dog_comms
           ALTER COLUMN posted_at TYPE TEXT
           USING to_char(posted_at, 'YYYY-MM-DD')`,
      );
      out.altered = true;
    }
    const typeAfter = await p.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dog_comms' AND column_name='posted_at'`,
    );
    out.posted_at_type_after = typeAfter.rows[0]?.data_type || null;

    let errCount = null;
    try {
      const er = await p.query(
        `SELECT apply_error_count FROM pg_stat_subscription_stats
          WHERE subname = 'exittrace_lab_sub'`,
      );
      errCount = er.rows[0] ? Number(er.rows[0].apply_error_count) : null;
    } catch {
      errCount = null;
    }
    out.apply_error_count_before = errCount;

    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, "../..");
    const gapPathGz = path.join(root, "data/ops/logical-gap-heal-20260918.json.gz");
    const gapPath = path.join(root, "data/ops/logical-gap-heal-20260918.json");
    let gap = null;
    try {
      if (fs.existsSync(gapPathGz)) {
        const { gunzipSync } = await import("node:zlib");
        gap = JSON.parse(gunzipSync(fs.readFileSync(gapPathGz)).toString("utf8"));
      } else if (fs.existsSync(gapPath)) {
        gap = JSON.parse(fs.readFileSync(gapPath, "utf8"));
      }
    } catch (e) {
      out.gap_load_error = String(e?.message || e).slice(0, 120);
    }

    const needsCatchup =
      out.altered || (Number.isFinite(errCount) && errCount > 0) || gap != null;

    if (needsCatchup && gap) {
      try {
        await p.query(`ALTER SUBSCRIPTION exittrace_lab_sub DISABLE`);
      } catch {
        /* already disabled */
      }

      const people = Array.isArray(gap.people) ? gap.people : [];
      const dogs = Array.isArray(gap.dog_comms) ? gap.dog_comms : [];
      const ops = Array.isArray(gap.operations) ? gap.operations : [];
      const events = Array.isArray(gap.person_events) ? gap.person_events : [];
      out.lab_tip_lsn = gap.lab_tip_lsn || null;

      const client = await p.connect();
      try {
        await client.query("BEGIN");
        for (const raw of people) {
          const row = normalizePerson(raw);
          await client.query(
            `INSERT INTO people (
               id, category, name, role, event_date, death_date, birth_date, country_of_origin,
               photo, photo_credit, screenshot, screenshot_credit, net_worth_usd, net_worth_note,
               net_worth_source, sources, summary, events, tags, career
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19::jsonb,$20::jsonb
             )
             ON CONFLICT (id) DO UPDATE SET
               category = EXCLUDED.category,
               name = EXCLUDED.name,
               role = EXCLUDED.role,
               event_date = EXCLUDED.event_date,
               death_date = EXCLUDED.death_date,
               birth_date = EXCLUDED.birth_date,
               country_of_origin = EXCLUDED.country_of_origin,
               photo = EXCLUDED.photo,
               photo_credit = EXCLUDED.photo_credit,
               screenshot = EXCLUDED.screenshot,
               screenshot_credit = EXCLUDED.screenshot_credit,
               net_worth_usd = EXCLUDED.net_worth_usd,
               net_worth_note = EXCLUDED.net_worth_note,
               net_worth_source = EXCLUDED.net_worth_source,
               sources = EXCLUDED.sources,
               summary = EXCLUDED.summary,
               events = EXCLUDED.events,
               tags = EXCLUDED.tags,
               career = EXCLUDED.career`,
            personValues(row),
          );
        }
        for (const raw of dogs) {
          const row = normalizeDog(raw);
          await client.query(
            `INSERT INTO dog_comms (
               id, posted_at, handle, account_name, text, still, still_credit,
               screenshot, screenshot_credit, source_url, snapshot
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb
             )
             ON CONFLICT (id) DO UPDATE SET
               posted_at = EXCLUDED.posted_at,
               handle = EXCLUDED.handle,
               account_name = EXCLUDED.account_name,
               text = EXCLUDED.text,
               still = EXCLUDED.still,
               still_credit = EXCLUDED.still_credit,
               screenshot = EXCLUDED.screenshot,
               screenshot_credit = EXCLUDED.screenshot_credit,
               source_url = EXCLUDED.source_url,
               snapshot = EXCLUDED.snapshot`,
            [
              row.id,
              row.posted_at,
              row.handle,
              row.account_name,
              row.text,
              row.still,
              row.still_credit,
              row.screenshot,
              row.screenshot_credit,
              row.source_url,
              JSON.stringify(row.snapshot || {}),
            ],
          );
        }
        for (const raw of ops) {
          const row = normalizeOperation(raw);
          await client.query(
            `INSERT INTO operations (
               id, name, event_date, announced_date, agencies, summary,
               victim_count, arrest_count, tags, sources, screenshot
             ) VALUES (
               $1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11
             )
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               event_date = EXCLUDED.event_date,
               announced_date = EXCLUDED.announced_date,
               agencies = EXCLUDED.agencies,
               summary = EXCLUDED.summary,
               victim_count = EXCLUDED.victim_count,
               arrest_count = EXCLUDED.arrest_count,
               tags = EXCLUDED.tags,
               sources = EXCLUDED.sources,
               screenshot = EXCLUDED.screenshot`,
            operationValues(row),
          );
        }
        for (const raw of events) {
          await client.query(
            `INSERT INTO person_events (
               person_id, kind, event_date, sources, announced_date, position,
               organization, country, branch, comments, age_at_event, alleged_reason,
               unsealed
             ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (person_id, kind) DO UPDATE SET
               event_date = EXCLUDED.event_date,
               sources = EXCLUDED.sources,
               announced_date = EXCLUDED.announced_date,
               position = EXCLUDED.position,
               organization = EXCLUDED.organization,
               country = EXCLUDED.country,
               branch = EXCLUDED.branch,
               comments = EXCLUDED.comments,
               age_at_event = EXCLUDED.age_at_event,
               alleged_reason = EXCLUDED.alleged_reason,
               unsealed = CASE
                 WHEN person_events.unsealed IS TRUE THEN TRUE
                 ELSE EXCLUDED.unsealed
               END`,
            [
              raw.person_id,
              raw.kind,
              raw.event_date,
              JSON.stringify(raw.sources || []),
              raw.announced_date || null,
              raw.position || null,
              raw.organization || null,
              raw.country || null,
              raw.branch || null,
              raw.comments || null,
              raw.age_at_event ?? null,
              raw.alleged_reason || null,
              raw.unsealed === true ? true : null,
            ],
          );
        }
        await client.query("COMMIT");
        out.gap_upserted = true;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      // Fast-forward origin to tip. Never auto-SKIP an LSN here.
      if (out.lab_tip_lsn) {
        try {
          const origins = await p.query(
            `SELECT roname FROM pg_replication_origin WHERE roname LIKE 'pg_%' ORDER BY roname`,
          );
          for (const o of origins.rows) {
            await p.query(`SELECT pg_replication_origin_advance($1, $2::pg_lsn)`, [
              o.roname,
              out.lab_tip_lsn,
            ]);
            out.origin_advanced = true;
          }
        } catch (e) {
          out.origin_error = String(e?.message || e).slice(0, 160);
        }
      }

      await p.query(`ALTER SUBSCRIPTION exittrace_lab_sub ENABLE`);
      out.bounced = true;
    } else if (needsCatchup) {
      await p.query(`ALTER SUBSCRIPTION exittrace_lab_sub DISABLE`);
      await p.query(`ALTER SUBSCRIPTION exittrace_lab_sub ENABLE`);
      out.bounced = true;
    }

    const counts = await p.query(
      `SELECT
         (SELECT count(*)::int FROM people) AS people,
         (SELECT count(*)::int FROM dog_comms) AS dog_comms,
         (SELECT count(*)::int FROM operations) AS operations,
         (SELECT count(*)::int FROM people WHERE id='warren-buffett') AS warren`,
    );
    const row = counts.rows[0] || {};
    out.people = row.people ?? null;
    out.dog_comms = row.dog_comms ?? null;
    out.operations = row.operations ?? null;
    out.warren = row.warren ?? null;

    try {
      await upsertEtMeta("keep_up.logical.last_heal", {
        at: new Date().toISOString(),
        altered: out.altered,
        bounced: out.bounced,
        gap_upserted: out.gap_upserted,
        origin_advanced: out.origin_advanced,
        lab_tip_lsn: out.lab_tip_lsn,
        posted_at_type: out.posted_at_type_after,
        apply_error_count_before: out.apply_error_count_before,
        people: out.people,
        dog_comms: out.dog_comms,
      });
    } catch {
      /* ignore */
    }
  } catch (err) {
    out.ok = false;
    out.reason = String(err?.message || err).slice(0, 240);
  }
  return out;
}

export async function readLogicalApplyDiag() {
  const p = await getPool();
  if (!p) return null;
  const diag = {
    posted_at_type: null,
    apply_error_count: null,
    received_lsn_present: null,
    sub_enabled: null,
  };
  try {
    const t = await p.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dog_comms' AND column_name='posted_at'`,
    );
    diag.posted_at_type = t.rows[0]?.data_type || null;
  } catch { /* ignore */ }
  try {
    const e = await p.query(
      `SELECT apply_error_count FROM pg_stat_subscription_stats WHERE subname='exittrace_lab_sub'`,
    );
    diag.apply_error_count = e.rows[0] ? Number(e.rows[0].apply_error_count) : null;
  } catch { /* ignore */ }
  try {
    const s = await p.query(
      `SELECT subenabled FROM pg_subscription WHERE subname='exittrace_lab_sub'`,
    );
    diag.sub_enabled = s.rows[0] ? !!s.rows[0].subenabled : null;
  } catch { /* ignore */ }
  try {
    const r = await p.query(
      `SELECT received_lsn IS NOT NULL AS present FROM pg_stat_subscription WHERE subname='exittrace_lab_sub'`,
    );
    diag.received_lsn_present = r.rows[0] ? !!r.rows[0].present : null;
  } catch { /* ignore */ }
  return diag;
}

/**
 * Live subscriber apply lag on this database, when a logical sub exists.
 * Public health only gets the number — no sub name, host, or slot.
 */
export async function readLogicalLagSeconds() {
  const snap = await readLogicalApplySnapshot();
  if (!snap) return null;
  const n = snap.last_msg_receipt_age_seconds;
  if (n === null || n === undefined) return null;
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.trunc(num));
}

/**
 * Live apply snapshot for health/heal. Numbers and flags only — no sub name,
 * host, slot, conninfo, or query text.
 */
export async function readLogicalApplySnapshot() {
  const p = await getPool();
  if (!p) return null;
  try {
    const res = await p.query(
      `SELECT
         EXISTS (SELECT 1 FROM pg_subscription) AS present,
         COALESCE((SELECT bool_or(subenabled) FROM pg_subscription), false) AS enabled,
         EXISTS (SELECT 1 FROM pg_stat_subscription WHERE pid IS NOT NULL) AS worker_present,
         (SELECT received_lsn::text FROM pg_stat_subscription
           WHERE received_lsn IS NOT NULL ORDER BY latest_end_time DESC NULLS LAST LIMIT 1) AS received_lsn,
         (SELECT latest_end_lsn::text FROM pg_stat_subscription
           WHERE latest_end_lsn IS NOT NULL ORDER BY latest_end_time DESC NULLS LAST LIMIT 1) AS latest_end_lsn,
         (SELECT EXTRACT(EPOCH FROM (now() - COALESCE(last_msg_receipt_time, latest_end_time)))::bigint
            FROM pg_stat_subscription
           WHERE COALESCE(last_msg_receipt_time, latest_end_time) IS NOT NULL
           ORDER BY COALESCE(last_msg_receipt_time, latest_end_time) DESC
           LIMIT 1) AS last_msg_receipt_age_seconds,
         (SELECT EXTRACT(EPOCH FROM (now() - last_msg_send_time))::bigint
            FROM pg_stat_subscription
           WHERE last_msg_send_time IS NOT NULL
           ORDER BY last_msg_send_time DESC
           LIMIT 1) AS last_msg_send_age_seconds,
         (SELECT COALESCE(SUM(apply_error_count), 0)::bigint FROM pg_stat_subscription_stats) AS apply_error_count,
         (SELECT COALESCE(SUM(sync_error_count), 0)::bigint FROM pg_stat_subscription_stats) AS sync_error_count,
         (SELECT count(*)::int FROM pg_subscription_rel) AS rel_count,
         (SELECT count(*)::int FROM pg_subscription_rel WHERE srsubstate IN ('r', 's')) AS rel_ready_count`,
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      present: Boolean(row.present),
      enabled: Boolean(row.enabled),
      worker_present: Boolean(row.worker_present),
      received_lsn: row.received_lsn || null,
      latest_end_lsn: row.latest_end_lsn || null,
      last_msg_receipt_age_seconds:
        row.last_msg_receipt_age_seconds === null || row.last_msg_receipt_age_seconds === undefined
          ? null
          : Math.max(0, Math.trunc(Number(row.last_msg_receipt_age_seconds))),
      last_msg_send_age_seconds:
        row.last_msg_send_age_seconds === null || row.last_msg_send_age_seconds === undefined
          ? null
          : Math.max(0, Math.trunc(Number(row.last_msg_send_age_seconds))),
      apply_error_count:
        row.apply_error_count === null || row.apply_error_count === undefined
          ? null
          : Math.max(0, Math.trunc(Number(row.apply_error_count))),
      sync_error_count:
        row.sync_error_count === null || row.sync_error_count === undefined
          ? null
          : Math.max(0, Math.trunc(Number(row.sync_error_count))),
      rel_count:
        row.rel_count === null || row.rel_count === undefined
          ? null
          : Math.max(0, Math.trunc(Number(row.rel_count))),
      rel_ready_count:
        row.rel_ready_count === null || row.rel_ready_count === undefined
          ? null
          : Math.max(0, Math.trunc(Number(row.rel_ready_count))),
    };
  } catch {
    try {
      const lag = await p.query(
        `SELECT EXTRACT(EPOCH FROM (now() - COALESCE(last_msg_receipt_time, latest_end_time)))::bigint AS lag_seconds
           FROM pg_stat_subscription
          WHERE COALESCE(last_msg_receipt_time, latest_end_time) IS NOT NULL
          ORDER BY COALESCE(last_msg_receipt_time, latest_end_time) DESC
          LIMIT 1`,
      );
      const n = lag.rows[0]?.lag_seconds;
      if (n === null || n === undefined) return null;
      const num = Number(n);
      if (!Number.isFinite(num)) return null;
      return {
        present: true,
        enabled: true,
        worker_present: true,
        received_lsn: null,
        latest_end_lsn: null,
        last_msg_receipt_age_seconds: Math.max(0, Math.trunc(num)),
        last_msg_send_age_seconds: null,
        apply_error_count: null,
        sync_error_count: null,
        rel_count: null,
        rel_ready_count: null,
      };
    } catch {
      return null;
    }
  }
}

function asCategories(category) {
  if (!category) return [];
  return (Array.isArray(category) ? category : [category])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
}

function parseListArgs(categoryOrOpts, maybeOpts) {
  if (Array.isArray(categoryOrOpts)) {
    return {
      category: categoryOrOpts,
      limit: maybeOpts?.limit,
      offset: maybeOpts?.offset ?? 0,
      minAge: maybeOpts?.minAge,
      maxAge: maybeOpts?.maxAge,
      tags: maybeOpts?.tags,
      unsealed: maybeOpts?.unsealed === true,
    };
  }
  if (categoryOrOpts && typeof categoryOrOpts === "object") {
    return {
      category: categoryOrOpts.category || undefined,
      limit: categoryOrOpts.limit,
      offset: categoryOrOpts.offset ?? 0,
      minAge: categoryOrOpts.minAge,
      maxAge: categoryOrOpts.maxAge,
      tags: categoryOrOpts.tags,
      unsealed: categoryOrOpts.unsealed === true,
    };
  }
  return {
    category: categoryOrOpts || undefined,
    limit: maybeOpts?.limit,
    offset: maybeOpts?.offset ?? 0,
    minAge: maybeOpts?.minAge,
    maxAge: maybeOpts?.maxAge,
    tags: maybeOpts?.tags,
    unsealed: maybeOpts?.unsealed === true,
  };
}

function finiteInt(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function comparePeople(a, b) {
  const d = String(b.event_date || "").localeCompare(String(a.event_date || ""));
  if (d !== 0) return d;
  return String(a.name).localeCompare(String(b.name));
}

function compareDogs(a, b) {
  const d = String(b.posted_at).localeCompare(String(a.posted_at));
  if (d !== 0) return d;
  return String(a.handle).localeCompare(String(b.handle));
}

function compareOperations(a, b) {
  const d = String(b.event_date || "").localeCompare(String(a.event_date || ""));
  if (d !== 0) return d;
  return String(a.name).localeCompare(String(b.name));
}

function operationValues(row) {
  const op = normalizeOperation(row);
  return [
    op.id,
    op.name,
    op.event_date,
    op.announced_date || null,
    JSON.stringify(op.agencies || []),
    op.summary || "",
    op.victim_count,
    op.arrest_count,
    JSON.stringify(op.tags || []),
    JSON.stringify(op.sources || []),
    op.screenshot || "",
  ];
}

function compareSources(a, b) {
  const d = String(b.posted_at || "").localeCompare(String(a.posted_at || ""));
  if (d !== 0) return d;
  return String(a.poster_handle || a.source_url || "").localeCompare(
    String(b.poster_handle || b.source_url || ""),
  );
}

function applyWindow(rows, limit, offset) {
  if (limit != null) return rows.slice(offset, offset + limit);
  return offset ? rows.slice(offset) : rows;
}

function peopleKindWhere(categories, params) {
  if (!categories.length) return "";
  params.push(categories);
  const n = params.length;
  return ` WHERE (
    EXISTS (
      SELECT 1 FROM person_events e
       WHERE e.person_id = people.id AND e.kind = ANY($${n}::text[])
    )
    OR (
      NOT EXISTS (SELECT 1 FROM person_events e WHERE e.person_id = people.id)
      AND (
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(people.events, '[]'::jsonb)) ev
           WHERE ev->>'kind' = ANY($${n}::text[])
        )
        OR people.category = ANY($${n}::text[])
      )
    )
  )`;
}

function confirmedDeathKindSql() {
  return DEATH_KEEP_IDS.map((id) => `'${id}'`).join(", ");
}

/** Confirmed DEATH_KEEP_IDS only. death_unconfirmed must not become a death_date. */
function deathDateSql() {
  const kinds = confirmedDeathKindSql();
  return `COALESCE(
    (SELECT MAX(e.event_date) FROM person_events e
      WHERE e.person_id = people.id AND e.kind IN (${kinds})),
    CASE WHEN people.category IN (${kinds}) THEN COALESCE(people.death_date, people.event_date) END,
    (SELECT MAX((ev->>'event_date')::date)
       FROM jsonb_array_elements(COALESCE(people.events, '[]'::jsonb)) ev
      WHERE ev->>'kind' IN (${kinds}))
  )`;
}

function listedEventDateSql(categories) {
  if (categories.length) {
    return `COALESCE((
      SELECT MAX(e.event_date) FROM person_events e
       WHERE e.person_id = people.id AND e.kind = ANY($KIND::text[])
    ), (
      SELECT MAX((ev->>'event_date')::date)
        FROM jsonb_array_elements(COALESCE(people.events, '[]'::jsonb)) ev
       WHERE ev->>'kind' = ANY($KIND::text[])
    ), people.event_date)`;
  }
  return `COALESCE(${deathDateSql()}, people.event_date)`;
}

function listedStoredAgeSql(categories) {
  if (categories.length) {
    return `COALESCE((
      SELECT e.age_at_event FROM person_events e
       WHERE e.person_id = people.id AND e.kind = ANY($KIND::text[])
         AND e.age_at_event IS NOT NULL
       ORDER BY e.event_date DESC
       LIMIT 1
    ), (
      SELECT NULLIF(ev->>'age_at_event', '')::int
        FROM jsonb_array_elements(COALESCE(people.events, '[]'::jsonb)) ev
       WHERE ev->>'kind' = ANY($KIND::text[])
         AND ev->>'age_at_event' IS NOT NULL
         AND ev->>'age_at_event' <> ''
       ORDER BY (ev->>'event_date') DESC
       LIMIT 1
    ))`;
  }
  return `COALESCE((
    SELECT e.age_at_event FROM person_events e
     WHERE e.person_id = people.id AND e.age_at_event IS NOT NULL
     ORDER BY e.event_date DESC
     LIMIT 1
  ), (
    SELECT NULLIF(ev->>'age_at_event', '')::int
      FROM jsonb_array_elements(COALESCE(people.events, '[]'::jsonb)) ev
     WHERE ev->>'age_at_event' IS NOT NULL
       AND ev->>'age_at_event' <> ''
     ORDER BY (ev->>'event_date') DESC
     LIMIT 1
  ))`;
}

function peopleAgeWhere(params, { minAge, maxAge } = {}, categories = []) {
  if (!ageFilterActive({ minAge, maxAge })) return "";
  let atDate = listedEventDateSql(categories);
  let storedAge = listedStoredAgeSql(categories);
  if (categories.length) {
    params.push(categories);
    const n = params.length;
    atDate = atDate.replaceAll("$KIND", `$${n}`);
    storedAge = storedAge.replaceAll("$KIND", `$${n}`);
  }
  const ageExpr = `COALESCE(${storedAge}, EXTRACT(YEAR FROM age(${atDate}, people.birth_date))::int)`;
  const clauses = [`${ageExpr} IS NOT NULL`];
  if (minAge != null) {
    params.push(minAge);
    clauses.push(`${ageExpr} >= $${params.length}`);
  }
  if (maxAge != null) {
    params.push(maxAge);
    clauses.push(`${ageExpr} <= $${params.length}`);
  }
  return ` AND ${clauses.join(" AND ")}`;
}

function peopleTagWhere(params, tags) {
  const selected = normalizeTags(tags);
  if (!selected.length) return "";
  params.push(selected);
  const tagN = params.length;
  const implied = kindsImplyingTags(selected);
  let sql = ` AND (
    EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(people.tags, '[]'::jsonb)) t
       WHERE t = ANY($${tagN}::text[])
    )`;
  if (implied.length) {
    params.push(implied);
    const kN = params.length;
    sql += `
    OR people.category = ANY($${kN}::text[])
    OR EXISTS (
      SELECT 1 FROM person_events e
       WHERE e.person_id = people.id AND e.kind = ANY($${kN}::text[])
    )`;
  }
  sql += `
  )`;
  return sql;
}

function personIndictmentUnsealed(row, categories) {
  const allow = new Set((categories || []).filter((id) => isIndictmentKeepKind(id)));
  if (!allow.size) return false;
  return personEvents(row).some((ev) => allow.has(ev.kind) && ev.unsealed === true);
}

export function peopleUnsealedWhere(params, unsealed, categories) {
  if (unsealed !== true) return "";
  const kinds = (categories || []).filter((id) => isIndictmentKeepKind(id));
  // No indictment kinds: match the memory filter, which excludes every row.
  if (!kinds.length) return " AND FALSE";
  params.push(kinds);
  const n = params.length;
  return ` AND (
    EXISTS (
      SELECT 1 FROM person_events e
       WHERE e.person_id = people.id
         AND e.kind = ANY($${n}::text[])
         AND e.unsealed IS TRUE
    )
    OR (
      NOT EXISTS (SELECT 1 FROM person_events e WHERE e.person_id = people.id)
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(people.events, '[]'::jsonb)) ev
         WHERE ev->>'kind' = ANY($${n}::text[])
           AND ev->>'unsealed' = 'true'
      )
    )
  )`;
}

function peopleWhere(categories, params, ageFilter, tags, unsealed) {
  const kindSql = peopleKindWhere(categories, params);
  const tagSql = peopleTagWhere(params, tags);
  const ageSql = peopleAgeWhere(params, ageFilter, categories);
  const unsealedSql = peopleUnsealedWhere(params, unsealed, categories);
  const extra = `${tagSql}${ageSql}${unsealedSql}`;
  if (!kindSql && !extra) return "";
  if (kindSql) return `${kindSql}${extra}`;
  return ` WHERE ${extra.replace(/^ AND /, "")}`;
}

function peopleKindOrder(categories, params) {
  if (!categories.length) {
    return ` ORDER BY COALESCE((
      SELECT MAX(e.event_date) FROM person_events e WHERE e.person_id = people.id
    ), (
      SELECT MAX((ev->>'event_date')::date) FROM jsonb_array_elements(COALESCE(people.events, '[]'::jsonb)) ev
    ), event_date) DESC NULLS LAST, name ASC`;
  }
  params.push(categories);
  const n = params.length;
  return ` ORDER BY COALESCE((
    SELECT MAX(e.event_date) FROM person_events e
     WHERE e.person_id = people.id AND e.kind = ANY($${n}::text[])
  ), (
    SELECT MAX((ev->>'event_date')::date) FROM jsonb_array_elements(COALESCE(people.events, '[]'::jsonb)) ev
     WHERE ev->>'kind' = ANY($${n}::text[])
  ), event_date) DESC NULLS LAST, name ASC`;
}

function projectListed(rows, categories) {
  return rows.map((row) =>
    categories.length ? projectPerson(row, categories) : projectPerson(row),
  );
}

export async function listPeople(categoryOrOpts, maybeOpts) {
  const args = parseListArgs(categoryOrOpts, maybeOpts);
  const limit = finiteInt(args.limit, null);
  const offset = finiteInt(args.offset, 0);
  const categories = asCategories(args.category);
  const ageFilter = { minAge: args.minAge, maxAge: args.maxAge };
  const tags = normalizeTags(args.tags);
  const unsealed = args.unsealed === true;
  const p = await getPool();
  if (!p) {
    let rows = getMemory().people.map((r) =>
      categories.length ? projectPerson(r, categories) : projectPerson(r),
    );
    if (categories.length) {
      rows = rows.filter((r) => personHasKind(r, categories));
    }
    if (tags.length) {
      rows = rows.filter((r) => matchesTags(r, tags));
    }
    if (unsealed) {
      rows = rows.filter((r) => personIndictmentUnsealed(r, categories));
    }
    if (ageFilterActive(ageFilter)) {
      rows = rows.filter((r) => matchesAgeFilter(r, ageFilter));
    }
    return applyWindow(rows.slice().sort(comparePeople), limit, offset);
  }
  const params = [];
  let sql = `SELECT * FROM people${peopleWhere(categories, params, ageFilter, tags, unsealed)}`;
  sql += peopleKindOrder(categories, params);
  if (limit != null) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  } else if (offset) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }
  const q = await p.query(sql, params);
  return projectListed(q.rows.map(normalizePerson), categories);
}

export async function listKindComms(kind, opts = {}) {
  const spec = commsKind(kind);
  const limit = finiteInt(opts.limit, null);
  const offset = finiteInt(opts.offset, 0);
  const p = await getPool();
  if (!p) {
    const rows = (getMemory()[spec.memoryKey] || []).slice();
    return applyWindow(rows.sort(compareDogs), limit, offset);
  }
  const params = [];
  let sql = `SELECT * FROM ${spec.table}`;
  sql += ` ORDER BY posted_at DESC, handle ASC`;
  if (limit != null) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  } else if (offset) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }
  const q = await p.query(sql, params);
  return q.rows.map((row) => normalizeKindComm(row, spec.id));
}

export async function listDogComms(opts = {}) {
  return listKindComms("dog", opts);
}

export async function listRedFolderComms(opts = {}) {
  return listKindComms("red_folder", opts);
}

export async function countPeople(categoryOrOpts) {
  const args =
    categoryOrOpts &&
    typeof categoryOrOpts === "object" &&
    !Array.isArray(categoryOrOpts)
      ? categoryOrOpts
      : { category: categoryOrOpts };
  const categories = asCategories(args.category);
  const ageFilter = { minAge: args.minAge, maxAge: args.maxAge };
  const tags = normalizeTags(args.tags);
  const unsealed = args.unsealed === true;
  const p = await getPool();
  if (!p) {
    let rows = getMemory().people;
    if (categories.length) {
      rows = rows.filter((r) => personHasKind(r, categories));
    }
    if (tags.length) {
      rows = rows.filter((r) => matchesTags(r, tags));
    }
    if (unsealed) {
      rows = rows.filter((r) => personIndictmentUnsealed(r, categories));
    }
    if (ageFilterActive(ageFilter)) {
      rows = rows
        .map((r) => (categories.length ? projectPerson(r, categories) : projectPerson(r)))
        .filter((r) => matchesAgeFilter(r, ageFilter));
    }
    return rows.length;
  }
  if (!categories.length && !ageFilterActive(ageFilter) && !tags.length && !unsealed) {
    const q = await p.query("SELECT COUNT(*)::int AS n FROM people");
    return q.rows[0].n;
  }
  const params = [];
  const q = await p.query(
    `SELECT COUNT(*)::int AS n FROM people${peopleWhere(categories, params, ageFilter, tags, unsealed)}`,
    params,
  );
  return q.rows[0].n;
}

export async function countKindComms(kind) {
  const spec = commsKind(kind);
  const p = await getPool();
  if (!p) return (getMemory()[spec.memoryKey] || []).length;
  const q = await p.query(`SELECT COUNT(*)::int AS n FROM ${spec.table}`);
  return q.rows[0].n;
}

export async function countDogComms() {
  return countKindComms("dog");
}

export async function countRedFolderComms() {
  return countKindComms("red_folder");
}

export async function listOperations(opts = {}) {
  const limit = finiteInt(opts.limit, null);
  const offset = finiteInt(opts.offset, 0);
  const tags = Array.isArray(opts.tags)
    ? opts.tags
    : opts.tag
      ? [opts.tag]
      : [];
  const p = await getPool();
  if (!p) {
    let rows = (getMemory().operations || []).slice();
    if (tags.length) rows = rows.filter((r) => operationHasTag(r, tags));
    return applyWindow(rows.sort(compareOperations), limit, offset);
  }
  const params = [];
  let sql = "SELECT * FROM operations";
  if (tags.length) {
    params.push(tags);
    sql += ` WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) t
       WHERE t = ANY($${params.length}::text[])
    )`;
  }
  sql += " ORDER BY event_date DESC, name ASC";
  if (limit != null) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  } else if (offset) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }
  const q = await p.query(sql, params);
  return q.rows.map(normalizeOperation);
}

export async function countOperations(opts = {}) {
  const tags = Array.isArray(opts.tags)
    ? opts.tags
    : opts.tag
      ? [opts.tag]
      : [];
  const p = await getPool();
  if (!p) {
    let rows = getMemory().operations || [];
    if (tags.length) rows = rows.filter((r) => operationHasTag(r, tags));
    return rows.length;
  }
  const params = [];
  let sql = "SELECT COUNT(*)::int AS n FROM operations";
  if (tags.length) {
    params.push(tags);
    sql += ` WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) t
       WHERE t = ANY($1::text[])
    )`;
  }
  const q = await p.query(sql, params);
  return q.rows[0].n;
}

export async function getOperation(id) {
  if (!id) return null;
  const p = await getPool();
  if (!p) return (getMemory().operations || []).find((r) => r.id === id) || null;
  const q = await p.query("SELECT * FROM operations WHERE id = $1", [id]);
  return q.rows[0] ? normalizeOperation(q.rows[0]) : null;
}

export async function insertOperation(row) {
  const op = normalizeOperation(row);
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    if (!mem.operations) mem.operations = [];
    if (mem.operations.some((r) => r.id === op.id)) {
      throw new PromoteError(`operation exists: ${op.id}`, "id_collision");
    }
    mem.operations.push(op);
    return op;
  }
  await p.query(
    `INSERT INTO operations (
       id, name, event_date, announced_date, agencies, summary,
       victim_count, arrest_count, tags, sources, screenshot
     ) VALUES (
       $1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11
     )`,
    operationValues(op),
  );
  return op;
}

export async function saveOperation(row) {
  const op = normalizeOperation(row);
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    if (!mem.operations) mem.operations = [];
    const i = mem.operations.findIndex((r) => r.id === op.id);
    if (i < 0) mem.operations.push(op);
    else mem.operations[i] = op;
    return op;
  }
  await p.query(
    `INSERT INTO operations (
       id, name, event_date, announced_date, agencies, summary,
       victim_count, arrest_count, tags, sources, screenshot
     ) VALUES (
       $1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11
     )
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       event_date = EXCLUDED.event_date,
       announced_date = EXCLUDED.announced_date,
       agencies = EXCLUDED.agencies,
       summary = EXCLUDED.summary,
       victim_count = EXCLUDED.victim_count,
       arrest_count = EXCLUDED.arrest_count,
       tags = EXCLUDED.tags,
       sources = EXCLUDED.sources,
       screenshot = COALESCE(NULLIF(operations.screenshot, ''), EXCLUDED.screenshot)`,
    operationValues(op),
  );
  return op;
}

export async function applyIdentifiedOperation(input) {
  const parsed = validateIdentifiedOperationInput(input);
  const existing = findOperationMatch(await listOperations(), parsed);
  if (existing) {
    const incoming = buildOperationRow({ ...parsed, slug: existing.id }, [existing]);
    const merged = mergeOperationAnnotate(existing, incoming);
    const operation = await saveOperation({ ...merged, id: existing.id });
    return {
      action: "annotated",
      operation,
      added_cites: Math.max(0, operation.sources.length - existing.sources.length),
      operations: await countOperations(),
    };
  }
  const row = buildOperationRow(parsed, await listOperations());
  const operation = await insertOperation(row);
  return {
    action: "created",
    operation,
    added_cites: operation.sources.length,
    operations: await countOperations(),
  };
}

function sourcePostWhere(opts = {}) {
  const params = [];
  const clauses = [];
  if (opts.category) {
    params.push(opts.category);
    clauses.push(`category = $${params.length}`);
  }
  if (opts.standalone) {
    clauses.push("gold_person_id IS NULL");
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return { params, where };
}

export async function listSourcePosts(opts = {}) {
  const limit = finiteInt(opts.limit, null);
  const offset = finiteInt(opts.offset, 0);
  const p = await getPool();
  if (!p) {
    let rows = getMemory().source_posts || [];
    if (opts.category) rows = rows.filter((r) => r.category === opts.category);
    if (opts.standalone) rows = rows.filter((r) => !r.gold_person_id);
    return applyWindow(rows.slice().sort(compareSources), limit, offset);
  }
  const { params, where } = sourcePostWhere(opts);
  let sql = `SELECT * FROM source_posts${where} ORDER BY posted_at DESC NULLS LAST, poster_handle ASC`;
  if (limit != null) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  } else if (offset) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }
  const q = await p.query(sql, params);
  return q.rows.map(normalizeSourcePost);
}

export async function countSourcePosts(opts = {}) {
  const p = await getPool();
  if (!p) {
    let rows = getMemory().source_posts || [];
    if (opts.category) rows = rows.filter((r) => r.category === opts.category);
    if (opts.standalone) rows = rows.filter((r) => !r.gold_person_id);
    return rows.length;
  }
  const { params, where } = sourcePostWhere(opts);
  const q = await p.query(`SELECT COUNT(*)::int AS n FROM source_posts${where}`, params);
  return q.rows[0].n;
}

export async function getSourcePost(id) {
  if (!id) return null;
  const p = await getPool();
  if (!p) return (getMemory().source_posts || []).find((r) => r.id === id) || null;
  const q = await p.query("SELECT * FROM source_posts WHERE id = $1", [id]);
  return q.rows[0] ? normalizeSourcePost(q.rows[0]) : null;
}

export async function findSourcePost({ id, source_url } = {}) {
  const canonical = source_url ? canonicalPublicUrl(source_url) : "";
  if (id) {
    const row = await getSourcePost(id);
    if (!row) {
      throw new PromoteError(`source post not found: ${id}`, "source_not_found");
    }
    if (
      canonical &&
      row.canonical_url !== canonical &&
      canonicalPublicUrl(row.source_url) !== canonical
    ) {
      throw new PromoteError(
        "source id and source_url do not match one post",
        "source_mismatch",
      );
    }
    return row;
  }
  if (!canonical) return null;
  const p = await getPool();
  if (!p) {
    const row = (getMemory().source_posts || []).find(
      (r) => r.canonical_url === canonical || r.source_url === source_url,
    );
    if (!row) {
      throw new PromoteError(
        `source post not found: ${source_url}`,
        "source_not_found",
      );
    }
    return row;
  }
  const q = await p.query(
    "SELECT * FROM source_posts WHERE canonical_url = $1 OR source_url = $2",
    [canonical, source_url],
  );
  if (!q.rows[0]) {
    throw new PromoteError(
      `source post not found: ${source_url}`,
      "source_not_found",
    );
  }
  return normalizeSourcePost(q.rows[0]);
}

export async function lookupSourcePost({ id, source_url } = {}) {
  if (!id && !source_url) return null;
  try {
    return await findSourcePost({ id, source_url });
  } catch (err) {
    if (err instanceof PromoteError && err.code === "source_not_found") return null;
    throw err;
  }
}

function personValues(row) {
  const person = normalizePerson(row);
  return [
    person.id,
    person.category,
    person.name,
    person.role,
    person.event_date,
    person.death_date,
    person.birth_date || null,
    person.country_of_origin || "",
    person.photo,
    person.photo_credit,
    person.screenshot,
    person.screenshot_credit,
    person.net_worth_usd,
    person.net_worth_note,
    person.net_worth_source,
    JSON.stringify(person.sources || []),
    person.summary,
    JSON.stringify(person.events || []),
    JSON.stringify(person.tags || []),
    JSON.stringify(person.career || []),
  ];
}

async function syncPersonEvents(client, row) {
  const person = normalizePerson(row);
  await client.query("DELETE FROM person_events WHERE person_id = $1", [person.id]);
  for (const ev of person.events) {
    await client.query(
      `INSERT INTO person_events (
         person_id, kind, event_date, sources, announced_date,
         position, organization, country, branch, comments,
         notable_group, title_note, status,
         age_at_event, unsealed
       )
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (person_id, kind) DO UPDATE SET
         event_date = person_events.event_date,
         sources = EXCLUDED.sources,
         announced_date = COALESCE(person_events.announced_date, EXCLUDED.announced_date),
         position = COALESCE(NULLIF(person_events.position, ''), EXCLUDED.position),
         organization = COALESCE(NULLIF(person_events.organization, ''), EXCLUDED.organization),
         country = COALESCE(NULLIF(person_events.country, ''), EXCLUDED.country),
         branch = COALESCE(NULLIF(person_events.branch, ''), EXCLUDED.branch),
         comments = COALESCE(NULLIF(person_events.comments, ''), EXCLUDED.comments),
         notable_group = COALESCE(NULLIF(person_events.notable_group, ''), EXCLUDED.notable_group),
         title_note = COALESCE(NULLIF(person_events.title_note, ''), EXCLUDED.title_note),
         status = COALESCE(NULLIF(person_events.status, ''), EXCLUDED.status),
         age_at_event = COALESCE(person_events.age_at_event, EXCLUDED.age_at_event),
         unsealed = CASE
           WHEN person_events.unsealed IS TRUE THEN TRUE
           ELSE EXCLUDED.unsealed
         END`,
      [
        person.id,
        ev.kind,
        ev.event_date,
        JSON.stringify(ev.sources || []),
        ev.announced_date || null,
        ev.position || null,
        ev.organization || null,
        ev.country || null,
        ev.branch || null,
        ev.comments || null,
        ev.notable_group || null,
        ev.title_note || null,
        ev.status || null,
        ev.age_at_event ?? null,
        ev.unsealed === true ? true : null,
      ],
    );
  }
}

export async function insertPerson(row) {
  const person = normalizePerson(row);
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    if (mem.people.some((r) => r.id === person.id)) {
      throw new PromoteError(`person exists: ${person.id}`, "id_collision");
    }
    mem.people.push(person);
    return person;
  }
  await p.query(
    `INSERT INTO people (
       id, category, name, role, event_date, death_date, birth_date, country_of_origin,
       photo, photo_credit, screenshot, screenshot_credit, net_worth_usd, net_worth_note,
       net_worth_source, sources, summary, events, tags, career
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19::jsonb,$20::jsonb
     )`,
    personValues(person),
  );
  const client = await p.connect();
  try {
    await syncPersonEvents(client, person);
  } finally {
    client.release();
  }
  return person;
}

export async function savePerson(row) {
  const person = normalizePerson(row);
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    const i = mem.people.findIndex((r) => r.id === person.id);
    if (i < 0) {
      throw new PromoteError(`person not found: ${person.id}`, "person_not_found");
    }
    mem.people[i] = person;
    return person;
  }
  await p.query(
    `UPDATE people SET
       category = $2, name = $3, role = $4, event_date = $5, death_date = $6,
       birth_date = $7, country_of_origin = $8, photo = $9, photo_credit = $10,
       screenshot = $11, screenshot_credit = $12,
       net_worth_usd = $13, net_worth_note = $14, net_worth_source = $15,
       sources = $16::jsonb, summary = $17, events = $18::jsonb, tags = $19::jsonb,
       career = $20::jsonb
     WHERE id = $1`,
    personValues(person),
  );
  const client = await p.connect();
  try {
    await syncPersonEvents(client, person);
  } finally {
    client.release();
  }
  return getPerson(person.id);
}

export async function deletePerson(id) {
  if (!id) return false;
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    const n = mem.people.length;
    mem.people = mem.people.filter((r) => r.id !== id);
    return mem.people.length !== n;
  }
  const client = await p.connect();
  try {
    await client.query("DELETE FROM person_events WHERE person_id = $1", [id]);
    const q = await client.query("DELETE FROM people WHERE id = $1", [id]);
    return q.rowCount > 0;
  } finally {
    client.release();
  }
}

export async function appendPersonSources(id, incoming, kind) {
  const person = await getPerson(id);
  if (!person) {
    throw new PromoteError(`person not found: ${id}`, "person_not_found");
  }
  const targetKind = kind || person.category;
  const event = person.events.find((ev) => ev.kind === targetKind) || person.events[0];
  if (!event) {
    const merged = mergeCites(person.sources, incoming);
    if (!merged.added.length) return { person, added: [] };
    const next = projectPerson({ ...person, sources: merged.sources });
    await savePerson(next);
    return { person: next, added: merged.added };
  }
  const attached = attachPersonEvent(person, {
    kind: event.kind,
    event_date: event.event_date,
    sources: incoming,
  });
  if (!attached.added.length) {
    return { person, added: [] };
  }
  const saved = await savePerson(attached.person);
  return { person: saved, added: attached.added };
}

export async function setPersonPhoto(id, photo, photo_credit = "") {
  const person = await getPerson(id);
  if (!person) {
    throw new PromoteError(`person not found: ${id}`, "person_not_found");
  }
  if (person.photo) return person;
  const href = String(photo || "").trim();
  if (!href || !isPeopleMediaHref(href)) return person;
  const credit = String(photo_credit || person.photo_credit || "").trim();
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    const i = mem.people.findIndex((r) => r.id === id);
    if (i < 0) return person;
    mem.people[i] = { ...person, photo: href, photo_credit: credit };
    return mem.people[i];
  }
  await p.query(
    `UPDATE people
        SET photo = $1, photo_credit = $2
      WHERE id = $3 AND (photo IS NULL OR photo = '')`,
    [href, credit, id],
  );
  return getPerson(id);
}

export async function attachPersonPortrait(person, input = {}) {
  if (!person || person.photo) return person;
  const resolved = await resolvePortrait({
    mediaDir: input.mediaDir || process.env.MEDIA_DIR,
    personId: person.id,
    supplied: input.photo || input.supplied || "",
    photo_credit: input.photo_credit || "",
  });
  if (!resolved) return person;
  return setPersonPhoto(person.id, resolved.href, resolved.credit);
}

export async function setPersonNetWorth(id, worth) {
  const person = await getPerson(id);
  if (!person) {
    throw new PromoteError(`person not found: ${id}`, "person_not_found");
  }
  if (hasRecordedNetWorth(person)) return person;
  const resolved = resolveNetWorth(worth);
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    const i = mem.people.findIndex((r) => r.id === id);
    if (i < 0) return person;
    mem.people[i] = { ...person, ...resolved };
    return mem.people[i];
  }
  await p.query(
    `UPDATE people
        SET net_worth_usd = $1, net_worth_note = $2, net_worth_source = $3
      WHERE id = $4
        AND net_worth_usd IS NULL
        AND (net_worth_note IS NULL OR net_worth_note = '')
        AND (net_worth_source IS NULL OR net_worth_source = '')`,
    [resolved.net_worth_usd, resolved.net_worth_note, resolved.net_worth_source, id],
  );
  return getPerson(id);
}

export async function attachPersonNetWorth(person, input = {}) {
  if (!person || hasRecordedNetWorth(person)) return person;
  return setPersonNetWorth(person.id, {
    net_worth_usd: input.net_worth_usd,
    net_worth_source: input.net_worth_source,
    net_worth_note: input.net_worth_note,
  });
}

export async function applyIdentifiedPerson(input) {
  const parsed = validateIdentifiedPersonInput(input);
  const people = await listPeople();
  const existing = findGoldMatch(people, parsed);
  const incoming = citeRecords(parsed.cite_urls, parsed.event_date);
  const extras = {
    photo: parsed.photo,
    photo_credit: parsed.photo_credit,
    mediaDir: input.mediaDir,
    net_worth_usd: parsed.net_worth_usd,
    net_worth_source: parsed.net_worth_source,
    net_worth_note: parsed.net_worth_note,
  };
  if (existing) {
    const kind = resolveEventKind(existing, parsed.category);
    const prior = {
      ...existing,
      birth_date: existing.birth_date || parsed.birth_date || null,
      country_of_origin: existing.country_of_origin || parsed.country_of_origin || "",
      career: mergeCareer(existing.career, parsed.career),
    };
    const attached = attachPersonEvent(
      prior,
      incomingPersonEvent({ ...parsed, category: kind }, incoming),
    );
    let person = await savePerson(attached.person);
    person = await attachPersonPortrait(person, extras);
    person = await attachPersonNetWorth(person, extras);
    return {
      action: "annotated",
      person: projectPerson(person, kind),
      added_cites: attached.added.length,
      added_event: !attached.existed,
      people: await countPeople(),
    };
  }
  assertNewPersonInsertLock(parsed);
  const row = buildPersonRow({ ...parsed, photo: "", photo_credit: "" }, people);
  const created = await insertPerson(row);
  let person = await attachPersonPortrait(created, extras);
  if (!person.photo) {
    console.warn(
      `[exittrace] KEEP insert blank portrait id=${person.id} — not recommended; supply an eligible portrait (gov/Commons/news or a supplied photo) on first pass`,
    );
  }
  person = await attachPersonNetWorth(person, extras);
  return {
    action: "created",
    person: projectPerson(person, parsed.category),
    added_cites: incoming.length,
    added_event: true,
    people: await countPeople(),
  };
}

export async function promoteSourcePost(input) {
  const parsed = validatePromoteInput(input);
  const sourcePost = await findSourcePost({
    id: parsed.id,
    source_url: parsed.source_url,
  });
  if (!sourcePost) {
    throw new PromoteError("source post not found", "source_not_found");
  }
  const result = await applyIdentifiedPerson({
    ...parsed,
    mediaDir: input.mediaDir,
  });
  return { ...result, source_post: sourcePost };
}

export async function upsertSourcePosts(rows) {
  const incoming = (rows || []).map(normalizeSourcePost).filter((r) => r.id && r.canonical_url);
  let inserted = 0;
  let updated = 0;
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    if (!mem.source_posts) mem.source_posts = [];
    for (const row of incoming) {
      const i = mem.source_posts.findIndex(
        (r) => r.canonical_url === row.canonical_url || r.id === row.id,
      );
      if (i >= 0) {
        const prev = mem.source_posts[i];
        mem.source_posts[i] = {
          ...prev,
          ...row,
          gold_person_id: row.gold_person_id || prev.gold_person_id || null,
        };
        updated += 1;
      } else {
        mem.source_posts.push(row);
        inserted += 1;
      }
    }
    return { inserted, updated, source_posts: mem.source_posts.length };
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    for (const row of incoming) {
      const existing = await client.query(
        "SELECT id, gold_person_id FROM source_posts WHERE canonical_url = $1 OR id = $2",
        [row.canonical_url, row.id],
      );
      const goldId = row.gold_person_id || existing.rows[0]?.gold_person_id || null;
      await client.query(
        `INSERT INTO source_posts (
           id, category, source_url, canonical_url, quoted_url, card_url, text,
           poster_handle, poster_name, posted_at, media_urls, gold_person_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12
         )
         ON CONFLICT (canonical_url) DO UPDATE SET
           category = EXCLUDED.category,
           source_url = EXCLUDED.source_url,
           quoted_url = EXCLUDED.quoted_url,
           card_url = EXCLUDED.card_url,
           text = EXCLUDED.text,
           poster_handle = EXCLUDED.poster_handle,
           poster_name = EXCLUDED.poster_name,
           posted_at = EXCLUDED.posted_at,
           media_urls = EXCLUDED.media_urls,
           gold_person_id = COALESCE(EXCLUDED.gold_person_id, source_posts.gold_person_id)`,
        [
          row.id,
          row.category,
          row.source_url,
          row.canonical_url,
          row.quoted_url,
          row.card_url,
          row.text,
          row.poster_handle,
          row.poster_name,
          row.posted_at,
          JSON.stringify(row.media_urls || []),
          goldId,
        ],
      );
      if (existing.rows.length) updated += 1;
      else inserted += 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { inserted, updated, source_posts: await countSourcePosts() };
}

export async function listCatalog(categoryOrOpts, maybeOpts) {
  const args = parseListArgs(categoryOrOpts, maybeOpts);
  const people = await listPeople({
    category: args.category,
    limit: args.limit,
    offset: args.offset,
  });
  return people.map((row) => ({ type: "person", date: row.event_date || "", row }));
}

export async function countCatalog(category) {
  return countPeople(category);
}

function centralCastingPersonStats(people) {
  let n = 0;
  for (const row of people) {
    if ((row.central_casting || []).length) n += 1;
  }
  return { central_casting: n };
}

export async function listCentralCastingPeople(opts = {}) {
  const limit = finiteInt(opts.limit, null);
  const offset = finiteInt(opts.offset, 0);
  const p = await getPool();
  if (!p) {
    const rows = getMemory().people.filter((row) => (row.central_casting || []).length);
    return applyWindow(rows.slice().sort(comparePeople), limit, offset);
  }
  const params = [];
  let sql = `SELECT * FROM people
    WHERE jsonb_typeof(central_casting) = 'array'
      AND jsonb_array_length(central_casting) > 0
    ORDER BY event_date DESC NULLS LAST, name ASC`;
  if (limit != null) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  } else if (offset) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }
  const q = await p.query(sql, params);
  return q.rows.map(normalizePerson).filter((row) => (row.central_casting || []).length);
}

export async function countCentralCastingPeople() {
  const rows = await listCentralCastingPeople();
  return rows.length;
}

function archivedPostText(sourceUrl) {
  const want = canonicalPublicUrl(sourceUrl);
  if (!want) return "";
  let best = "";
  for (const post of getMemory().source_posts || []) {
    const urls = [post.canonical_url, post.source_url]
      .map((url) => canonicalPublicUrl(url))
      .filter(Boolean);
    if (!urls.includes(want)) continue;
    const text = centralCastingStoredQuote({ text: post.text });
    if (text.length > best.length) best = text;
  }
  return best;
}

/** Display quote for one evidence row. Writes a real backfill onto the in-memory row. */
function presentCentralCastingClip(row, archivedText = "") {
  const clip = normalizeCentralCastingClip(row);
  const text = centralCastingStoredQuote(row, { archivedText });
  if (text && row.text !== text) row.text = text;
  return { ...clip, text };
}

export async function listCentralCastingEvidence(personId) {
  const id = String(personId || "").trim();
  if (!id) return [];
  const p = await getPool();
  if (!p) {
    return (getMemory().central_casting_comms || [])
      .filter((row) => row.person_id === id)
      .map((row) => presentCentralCastingClip(row, archivedPostText(row.source_url)));
  }
  const q = await p.query(
    `SELECT c.*,
            (
              SELECT sp.text
                FROM source_posts sp
               WHERE sp.canonical_url = c.source_url
                  OR sp.source_url = c.source_url
                  OR replace(sp.canonical_url, '://twitter.com/', '://x.com/')
                     = replace(c.source_url, '://twitter.com/', '://x.com/')
                  OR replace(sp.source_url, '://twitter.com/', '://x.com/')
                     = replace(c.source_url, '://twitter.com/', '://x.com/')
               ORDER BY
                 CASE
                   WHEN sp.canonical_url = c.source_url OR sp.source_url = c.source_url THEN 0
                   ELSE 1
                 END,
                 length(btrim(sp.text)) DESC NULLS LAST
               LIMIT 1
            ) AS archived_text
       FROM central_casting_comms c
      WHERE c.person_id = $1
      ORDER BY c.posted_at DESC`,
    [id],
  );
  return q.rows.map((row) => presentCentralCastingClip(row, row.archived_text));
}

/** Badge an existing person. Does not create a person or a KEEP event. */
export async function annotateCentralCasting(personId, classification) {
  const id = String(personId || "").trim();
  const nextCite = assertCentralCastingClassification(classification);
  const person = await getPerson(id);
  if (!person) {
    throw new CentralCastingClassifyError(`person not found: ${id || "(empty)"}`, "missing_person");
  }
  const central_casting = normalizeCentralCasting([...(person.central_casting || []), nextCite]);
  const p = await getPool();
  if (!p) {
    const row = getMemory().people.find((item) => item.id === id);
    row.central_casting = central_casting;
    return { ...row, central_casting };
  }
  await p.query(`UPDATE people SET central_casting = $2::jsonb WHERE id = $1`, [
    id,
    JSON.stringify(central_casting),
  ]);
  return getPerson(id);
}

/** Harvest/evidence under an existing person. Not a parent-list card. */
export async function insertCentralCastingClip(row) {
  const clip = normalizeCentralCastingClip(row);
  const person = await getPerson(clip.person_id);
  if (!person) {
    throw new CentralCastingClassifyError(`person not found: ${clip.person_id}`, "missing_person");
  }
  const p = await getPool();
  if (!p) {
    const list = getMemory().central_casting_comms || (getMemory().central_casting_comms = []);
    if (list.some((item) => item.id === clip.id)) {
      throw new CentralCastingClassifyError(`clip exists: ${clip.id}`, "id_collision");
    }
    list.push(clip);
    return clip;
  }
  await p.query(
    `INSERT INTO central_casting_comms (
       id, posted_at, handle, account_name, text, still, still_credit,
       screenshot, screenshot_credit, source_url, snapshot, person_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12
     )`,
    [
      clip.id,
      clip.posted_at,
      clip.handle,
      clip.account_name,
      clip.text,
      clip.still,
      clip.still_credit,
      clip.screenshot,
      clip.screenshot_credit,
      clip.source_url,
      JSON.stringify(clip.snapshot || {}),
      clip.person_id,
    ],
  );
  return clip;
}

export async function counts() {
  const p = await getPool();
  if (!p) {
    const people = getMemory().people;
    const byCategory = {};
    let peopleCensus = 0;
    for (const row of people) {
      peopleCensus += personHeadcount(row);
      const events = personEvents(row);
      if (!events.length && row.category) {
        byCategory[row.category] = (byCategory[row.category] || 0) + 1;
        continue;
      }
      for (const ev of events) {
        if (!ev.kind) continue;
        byCategory[ev.kind] = (byCategory[ev.kind] || 0) + eventHeadcount(ev);
      }
    }
    const operations = getMemory().operations || [];
    const kindCounts = {};
    for (const id of KIND_COMM_IDS) {
      const spec = KIND_COMMS[id];
      const rows = getMemory()[spec.memoryKey] || [];
      kindCounts[spec.memoryKey] = rows.length;
      byCategory[spec.categoryId] = rows.length;
    }
    const central = centralCastingPersonStats(people);
    byCategory.central_casting = central.central_casting;
    byCategory.operations = operations.length;
    for (const row of operations) {
      for (const tag of row.tags || []) {
        byCategory[tag] = (byCategory[tag] || 0) + 1;
      }
    }
    return {
      people: peopleCensus,
      ...kindCounts,
      ...central,
      operations: operations.length,
      source_posts: (getMemory().source_posts || []).length,
      byCategory,
    };
  }
  const kindQueries = KIND_COMM_IDS.map((id) =>
    p.query(`SELECT COUNT(*)::int AS n FROM ${KIND_COMMS[id].table}`),
  );
  const [peopleCount, ...kindCountRows] = await Promise.all([
    p.query(`SELECT COALESCE(SUM(
      COALESCE((
        SELECT MAX((ev->>'headcount')::int)
        FROM jsonb_array_elements(COALESCE(events, '[]'::jsonb)) ev
        WHERE (ev->>'headcount') ~ '^[0-9]+$'
          AND (ev->>'headcount')::int BETWEEN 2 AND 100000
      ), 1)
    ), 0)::int AS n FROM people`),
    ...kindQueries,
  ]);
  const [postCount, opCount, grouped, opTags, centralCount] = await Promise.all([
    p.query("SELECT COUNT(*)::int AS n FROM source_posts"),
    p.query("SELECT COUNT(*)::int AS n FROM operations"),
    p.query(
      `SELECT e.kind AS category,
              COALESCE(SUM(
                COALESCE((
                  SELECT MAX((ev->>'headcount')::int)
                  FROM jsonb_array_elements(COALESCE(p.events, '[]'::jsonb)) ev
                  WHERE ev->>'kind' = e.kind
                    AND (ev->>'headcount') ~ '^[0-9]+$'
                    AND (ev->>'headcount')::int BETWEEN 2 AND 100000
                ), 1)
              ), 0)::int AS n
         FROM person_events e
         JOIN people p ON p.id = e.person_id
        GROUP BY e.kind`,
    ),
    p.query(
      `SELECT t AS category, COUNT(*)::int AS n
         FROM operations,
              LATERAL jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) t
        GROUP BY t`,
    ),
    p.query(
      `SELECT COUNT(*)::int AS n FROM people
        WHERE jsonb_typeof(central_casting) = 'array'
          AND jsonb_array_length(central_casting) > 0`,
    ),
  ]);
  const byCategory = {};
  for (const row of grouped.rows) byCategory[row.category] = row.n;
  if (!grouped.rows.length) {
    const fallback = await p.query(
      "SELECT category, COUNT(*)::int AS n FROM people GROUP BY category",
    );
    for (const row of fallback.rows) byCategory[row.category] = row.n;
  }
  const kindCounts = {};
  KIND_COMM_IDS.forEach((id, i) => {
    const spec = KIND_COMMS[id];
    const n = kindCountRows[i].rows[0].n;
    kindCounts[spec.memoryKey] = n;
    byCategory[spec.categoryId] = n;
  });
  const centralCasting = centralCount.rows[0].n;
  byCategory.central_casting = centralCasting;
  byCategory.operations = opCount.rows[0].n;
  for (const row of opTags.rows) byCategory[row.category] = row.n;
  return {
    people: peopleCount.rows[0].n,
    ...kindCounts,
    central_casting: centralCasting,
    operations: opCount.rows[0].n,
    source_posts: postCount.rows[0].n,
    byCategory,
  };
}

export async function getPerson(id) {
  if (!id) return null;
  const p = await getPool();
  if (!p) return getMemory().people.find((r) => r.id === id) || null;
  const q = await p.query("SELECT * FROM people WHERE id = $1", [id]);
  return q.rows[0] ? normalizePerson(q.rows[0]) : null;
}

export async function getKindComm(kind, id) {
  if (!id) return null;
  const spec = commsKind(kind);
  const p = await getPool();
  if (!p) return (getMemory()[spec.memoryKey] || []).find((r) => r.id === id) || null;
  const q = await p.query(`SELECT * FROM ${spec.table} WHERE id = $1`, [id]);
  return q.rows[0] ? normalizeKindComm(q.rows[0], spec.id) : null;
}

export async function getDogComm(id) {
  return getKindComm("dog", id);
}

export async function getRedFolderComm(id) {
  return getKindComm("red_folder", id);
}

export async function findKindCommMatch(kind, { id, source_url, handle, posted_at } = {}) {
  const spec = commsKind(kind);
  const canonical = source_url ? canonicalPublicUrl(source_url) : "";
  const handleKey = String(handle || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  const date = asDate(posted_at);
  const match = (row) => {
    if (id && row.id === id) return true;
    if (canonical && canonicalPublicUrl(row.source_url) === canonical) return true;
    const rowHandle = String(row.handle || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (handleKey && date && rowHandle === handleKey && asDate(row.posted_at) === date) {
      return true;
    }
    return false;
  };
  const p = await getPool();
  if (!p) return (getMemory()[spec.memoryKey] || []).find(match) || null;
  if (id) {
    const byId = await getKindComm(spec.id, id);
    if (byId) return byId;
  }
  if (canonical) {
    const q = await p.query(`SELECT * FROM ${spec.table} WHERE source_url = $1`, [source_url]);
    if (q.rows[0]) return normalizeKindComm(q.rows[0], spec.id);
  }
  if (handleKey && date) {
    const q = await p.query(
      `SELECT * FROM ${spec.table} WHERE lower(regexp_replace(handle, '^@', '')) = $1 AND left(posted_at::text, 10) = $2`,
      [handleKey, date],
    );
    if (q.rows[0]) return normalizeKindComm(q.rows[0], spec.id);
  }
  return null;
}

export async function findDogMatch(query) {
  return findKindCommMatch("dog", query);
}

export async function insertKindComm(kind, row) {
  const spec = commsKind(kind);
  const comm = normalizeKindComm(row, spec.id);
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    const list = mem[spec.memoryKey] || (mem[spec.memoryKey] = []);
    if (list.some((r) => r.id === comm.id)) {
      throw new PromoteError(`${spec.label} exists: ${comm.id}`, "id_collision");
    }
    list.push(comm);
    return comm;
  }
  const params = [
    comm.id,
    comm.posted_at,
    comm.handle,
    comm.account_name,
    comm.text,
    comm.still,
    comm.still_credit,
    comm.screenshot,
    comm.screenshot_credit,
    comm.source_url,
    JSON.stringify(comm.snapshot || {}),
  ];
  const columns = `id, posted_at, handle, account_name, text, still, still_credit,
       screenshot, screenshot_credit, source_url, snapshot`;
  const values = `$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb`;
  await p.query(
    `INSERT INTO ${spec.table} (${columns}) VALUES (${values})`,
    params,
  );
  return comm;
}

export async function insertDogComm(row) {
  return insertKindComm("dog", row);
}

export async function insertRedFolderComm(row) {
  return insertKindComm("red_folder", row);
}

export function persistAddRequests(dataDir) {
  if (databaseUrl()) return null;
  const file = path.join(dataDir, "store.json");
  const prior = fs.existsSync(file) ? loadFileStore(dataDir) : emptyMemory();
  return writeFileStore(dataDir, {
    ...prior,
    operations: getMemory().operations || prior.operations || [],
    add_requests: getMemory().add_requests || [],
  });
}

export async function listAddRequests(opts = {}) {
  const p = await getPool();
  if (!p) {
    let rows = getMemory().add_requests || [];
    if (opts.status) rows = rows.filter((r) => r.status === opts.status);
    return rows.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
  const params = [];
  let sql = "SELECT * FROM add_requests";
  if (opts.status) {
    params.push(opts.status);
    sql += ` WHERE status = $${params.length}`;
  }
  sql += " ORDER BY created_at ASC";
  const q = await p.query(sql, params);
  return q.rows.map(normalizeAddRequest);
}

export async function getAddRequest(id) {
  if (!id) return null;
  const p = await getPool();
  if (!p) return (getMemory().add_requests || []).find((r) => r.id === id) || null;
  const q = await p.query("SELECT * FROM add_requests WHERE id = $1", [id]);
  return q.rows[0] ? normalizeAddRequest(q.rows[0]) : null;
}

export async function nextPendingAddRequest() {
  const p = await getPool();
  if (!p) {
    return (
      (getMemory().add_requests || [])
        .filter((r) => r.status === "pending")
        .slice()
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] || null
    );
  }
  const q = await p.query(
    "SELECT * FROM add_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1",
  );
  return q.rows[0] ? normalizeAddRequest(q.rows[0]) : null;
}

function addRequestValues(row) {
  const req = normalizeAddRequest(row);
  return [
    req.id,
    req.kind,
    req.status,
    req.subject || null,
    req.category || null,
    req.event_date || null,
    req.hint_url || null,
    req.handle || null,
    req.source_url || null,
    req.posted_at || null,
    JSON.stringify(req.cite_urls || []),
    JSON.stringify({
      account_name: req.account_name,
      text: req.text,
      still: req.still,
      still_credit: req.still_credit,
      summary: req.summary,
      role: req.role,
      photo: req.photo,
      photo_credit: req.photo_credit,
      net_worth_usd: req.net_worth_usd,
      net_worth_source: req.net_worth_source,
      net_worth_note: req.net_worth_note,
      extra_urls: req.extra_urls || [],
      birth_date: req.birth_date || "",
      country_of_origin: req.country_of_origin || "",
      position: req.position || "",
      organization: req.organization || "",
      country: req.country || "",
      branch: req.branch || "",
      comments: req.comments || "",
      reason: req.reason || "",
      military: req.military || false,
      last_day: req.last_day || "",
      announced: req.announced || "",
      announced_date: req.announced_date || "",
      agencies: req.agencies || [],
      victim_count: req.victim_count,
      arrest_count: req.arrest_count,
      op_tags: req.op_tags || [],
      source: req.source || "",
      subject_status_id: req.subject_status_id || "",
      mention_status_id: req.mention_status_id || "",
    }),
    req.error || null,
    req.result ? JSON.stringify(req.result) : null,
    req.created_at || new Date().toISOString(),
    req.processed_at || null,
  ];
}

export async function createAddRequest(input) {
  const now = new Date().toISOString();
  const row = normalizeAddRequest({
    ...input,
    status: input.status || "pending",
    created_at: input.created_at || now,
  });
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    if (!mem.add_requests) mem.add_requests = [];
    const dup = mem.add_requests.find(
      (r) => r.status === "pending" && r.id === row.id,
    );
    if (dup) return dup;
    mem.add_requests.push(row);
    return row;
  }
  await p.query(
    `INSERT INTO add_requests (
       id, kind, status, subject, category, event_date, hint_url, handle, source_url,
       posted_at, cite_urls, payload, error, result, created_at, processed_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15,$16
     )`,
    addRequestValues(row),
  );
  return row;
}

export async function updateAddRequest(id, patch) {
  const prior = await getAddRequest(id);
  if (!prior) {
    throw new PromoteError(`add request not found: ${id}`, "request_not_found");
  }
  const row = normalizeAddRequest({ ...prior, ...patch, id });
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    const i = (mem.add_requests || []).findIndex((r) => r.id === id);
    if (i < 0) throw new PromoteError(`add request not found: ${id}`, "request_not_found");
    mem.add_requests[i] = row;
    return row;
  }
  await p.query(
    `UPDATE add_requests SET
       kind = $2, status = $3, subject = $4, category = $5, event_date = $6,
       hint_url = $7, handle = $8, source_url = $9, posted_at = $10,
       cite_urls = $11::jsonb, payload = $12::jsonb, error = $13, result = $14::jsonb,
       created_at = $15, processed_at = $16
     WHERE id = $1`,
    addRequestValues(row),
  );
  return row;
}

function likeNeedle(q) {
  return `%${String(q).replace(/[%_\\]/g, "\\$&")}%`;
}

function matchesPerson(row, needle) {
  return [row.name, row.role, row.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function matchesDog(row, needle) {
  return [row.handle, row.account_name, row.text]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function matchesOperation(row, needle) {
  return [row.name, row.summary, ...(row.agencies || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function matchesSource(row, needle) {
  return [
    row.poster_handle,
    row.poster_name,
    row.text,
    row.source_url,
    row.quoted_url,
    row.card_url,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export async function searchPeople(q) {
  const raw = String(q || "").trim();
  if (!raw) return [];
  const p = await getPool();
  if (!p) {
    const needle = raw.toLowerCase();
    return getMemory()
      .people.filter((r) => matchesPerson(r, needle))
      .slice()
      .sort(comparePeople);
  }
  const res = await p.query(
    `SELECT * FROM people
     WHERE name ILIKE $1 ESCAPE '\\'
        OR role ILIKE $1 ESCAPE '\\'
        OR summary ILIKE $1 ESCAPE '\\'
     ORDER BY event_date DESC, name ASC`,
    [likeNeedle(raw)],
  );
  return res.rows.map(normalizePerson);
}

export async function searchKindComms(kind, q) {
  const spec = commsKind(kind);
  const raw = String(q || "").trim();
  if (!raw) return [];
  const p = await getPool();
  if (!p) {
    const needle = raw.toLowerCase();
    return (getMemory()[spec.memoryKey] || [])
      .filter((r) => matchesDog(r, needle))
      .slice()
      .sort(compareDogs);
  }
  const res = await p.query(
    `SELECT * FROM ${spec.table}
     WHERE handle ILIKE $1 ESCAPE '\\'
        OR account_name ILIKE $1 ESCAPE '\\'
        OR text ILIKE $1 ESCAPE '\\'
     ORDER BY posted_at DESC, handle ASC`,
    [likeNeedle(raw)],
  );
  return res.rows.map((row) => normalizeKindComm(row, spec.id));
}

export async function searchDogComms(q) {
  return searchKindComms("dog", q);
}

export async function searchRedFolderComms(q) {
  return searchKindComms("red_folder", q);
}

export async function searchSourcePosts(q) {
  const raw = String(q || "").trim();
  if (!raw) return [];
  const p = await getPool();
  if (!p) {
    const needle = raw.toLowerCase();
    return (getMemory().source_posts || [])
      .filter((r) => !r.gold_person_id && matchesSource(r, needle))
      .slice()
      .sort(compareSources);
  }
  const res = await p.query(
    `SELECT * FROM source_posts
     WHERE gold_person_id IS NULL
       AND (
         poster_handle ILIKE $1 ESCAPE '\\'
         OR poster_name ILIKE $1 ESCAPE '\\'
         OR text ILIKE $1 ESCAPE '\\'
         OR source_url ILIKE $1 ESCAPE '\\'
       )
     ORDER BY posted_at DESC NULLS LAST, poster_handle ASC`,
    [likeNeedle(raw)],
  );
  return res.rows.map(normalizeSourcePost);
}

export async function searchOperations(q) {
  const raw = String(q || "").trim();
  if (!raw) return [];
  const p = await getPool();
  if (!p) {
    const needle = raw.toLowerCase();
    return (getMemory().operations || [])
      .filter((r) => matchesOperation(r, needle))
      .slice()
      .sort(compareOperations);
  }
  const res = await p.query(
    `SELECT * FROM operations
     WHERE name ILIKE $1 ESCAPE '\\'
        OR summary ILIKE $1 ESCAPE '\\'
        OR agencies::text ILIKE $1 ESCAPE '\\'
     ORDER BY event_date DESC, name ASC`,
    [likeNeedle(raw)],
  );
  return res.rows.map(normalizeOperation);
}

export async function searchCatalog(q) {
  const kindHits = await Promise.all([
    searchPeople(q),
    searchOperations(q),
    ...KIND_COMM_IDS.map((id) => searchKindComms(id, q)),
    searchSourcePosts(q),
  ]);
  const people = kindHits[0];
  const operations = kindHits[1];
  const posts = kindHits[kindHits.length - 1];
  const comms = KIND_COMM_IDS.map((id, i) =>
    kindHits[i + 2].map((row) => ({
      type: KIND_COMMS[id].searchType,
      date: row.posted_at || "",
      row,
    })),
  ).flat();
  return [
    ...people.map((row) => ({ type: "person", date: row.event_date || "", row })),
    ...operations.map((row) => ({ type: "operation", date: row.event_date || "", row })),
    ...comms,
    ...posts.map((row) => ({ type: "source", date: row.posted_at || "", row })),
  ];
}

export async function migrateUniquePeople() {
  const people = await listPeople();
  const collapsed = collapseDuplicatePeople(people);
  const keepIds = new Set(collapsed.map((row) => row.id));
  let merged = 0;
  for (const row of people) {
    if (!keepIds.has(row.id)) {
      await deletePerson(row.id);
      merged += 1;
    }
  }
  for (const row of collapsed) {
    const existing = people.find((p) => p.id === row.id);
    if (!existing) {
      await insertPerson(row);
      continue;
    }
    await savePerson(row);
  }
  return { people: collapsed.length, merged };
}

export async function closeStore() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}


/** Epstein legs for person detail. Empty → section hidden. */
export async function listEpsteinLegsForPerson(personId) {
  const id = String(personId || "").trim();
  if (!id) return [];
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    return (mem.epstein_flight_legs || []).filter((row) => row.person_id === id);
  }
  const q = await p.query(
    `SELECT * FROM epstein_flight_legs
      WHERE person_id = $1
      ORDER BY flight_date ASC NULLS LAST, id ASC`,
    [id],
  );
  return q.rows.map((row) => {
    let flight_date = "";
    if (row.flight_date instanceof Date) {
      flight_date = row.flight_date.toISOString().slice(0, 10);
    } else if (row.flight_date) {
      flight_date = String(row.flight_date).slice(0, 10);
    }
    return { ...row, flight_date };
  });
}
