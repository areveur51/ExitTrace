#!/usr/bin/env node
/**
 * Seed remaining High TSV rows that already have 2 official.mjs-family cites.
 * Medium stay leads. Blank X stay blank. No invent. Soft-ack OFF.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadDotEnv, resolveRoot } from "../app/lib/env.mjs";
import {
  applyIdentifiedPerson,
  closeStore,
  ensureSchema,
  getPerson,
  getPool,
  savePerson,
  countPeople,
} from "../app/lib/store.mjs";
import { isOfficialCiteUrl } from "../app/lib/official.mjs";
import { canonicalPublicUrl } from "../app/lib/urls.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(ROOT, ".env"));
const { mediaDir } = resolveRoot(ROOT);
if (!process.env.MEDIA_DIR) process.env.MEDIA_DIR = mediaDir;
const bootstrapSql = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");

/** Only rows with ≥2 verified cite URLs (researched; not invented). */
const SEEDS = [
  {
    subject: "Kyle Busch",
    event_date: "2015-03-10", // NASCAR.com timeline: walking boots
    cite_urls: [
      "https://www.foxsports.com/stories/nascar/kyle-busch-takes-big-step-in-recovery-process",
      "https://www.nascar.com/news-media/2015/11/25/timeline-of-kyle-busch-injury-recovery/",
    ],
    snippet:
      "Kyle Busch in medical walking boots after a Daytona Xfinity crash (R lower-leg compound + L midfoot).",
    country_of_origin: "United States",
    position: "NASCAR driver",
    organization: "NASCAR",
  },
  {
    subject: "Kelly Ripa",
    event_date: "2015-07-30", // GMA / Live appearance date
    cite_urls: [
      "https://pagesix.com/2015/07/30/kelly-ripa-breaks-foot-during-dance-lesson-gone-awry/",
      "https://www.goodmorningamerica.com/culture/story/kelly-ripa-broke-foot-32788344",
    ],
    snippet:
      "Kelly Ripa in a medical walking boot after breaking four bones in her left foot in a dance class.",
    country_of_origin: "United States",
    position: "Television host",
    organization: "Live with Kelly and Michael",
  },
];

function monthToDay(year, month) {
  const m = String(month || "").trim();
  const map = {
    January: "01", February: "02", March: "03", April: "04", May: "05", June: "06",
    July: "07", August: "08", September: "09", October: "10", November: "11", December: "12",
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", Jun: "06", Jul: "07", Aug: "08",
    Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  // Prefer cite-stated full day from seed entry; this helper is fallback only.
  const mm = map[m] || ( /^\d{1,2}$/.test(m) ? m.padStart(2, "0") : "");
  return mm ? `${year}-${mm}-01` : "";
}

async function main() {
  const pool = await getPool();
  if (!pool) throw new Error("DATABASE_URL required");
  await ensureSchema(pool, bootstrapSql);

  if (!SEEDS.length) {
    const n = await countPeople({ category: "boot_comms" });
    console.log(`NO_ADDITIONAL_HIGHS person_count=${n}`);
    await closeStore();
    return;
  }

  const out = [];
  for (const row of SEEDS) {
    const cites = (row.cite_urls || [])
      .map((u) => canonicalPublicUrl(u) || String(u).trim())
      .filter((u) => u && isOfficialCiteUrl(u));
    if (cites.length < 2) {
      console.warn(`LEAD ${row.subject}: cites=${cites.length}`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.event_date)) {
      console.warn(`LEAD ${row.subject}: need cite-stated YYYY-MM-DD, got ${row.event_date}`);
      continue;
    }
    const result = await applyIdentifiedPerson({
      subject: row.subject,
      category: "boot_comms",
      event_date: row.event_date,
      cite_urls: cites,
      comments: row.snippet || row.comments || "Medical walking boot after documented lower-leg, ankle, or foot injury",
      reason: row.snippet || row.comments || "Medical walking boot after documented lower-leg, ankle, or foot injury",
      country_of_origin: row.country_of_origin || "United States",
      position: row.position || "Public figure",
      organization: row.organization || "Public record",
    });
    if (row.snippet && result.person?.id) {
      const person = await getPerson(result.person.id);
      if (person) {
        const events = (person.events || []).map((ev) => {
          if (ev.kind !== "boot_comms") return ev;
          const sources = (ev.sources || []).map((src, i) => ({
            ...src,
            snippet: String(src.snippet || "").trim() || (i === 0 ? row.snippet : ""),
          }));
          return { ...ev, sources };
        });
        await savePerson({ ...person, events });
      }
    }
    out.push({ subject: row.subject, person_id: result.person?.id, action: result.action });
    console.log(JSON.stringify(out[out.length - 1]));
  }
  const n = await countPeople({ category: "boot_comms" });
  console.log(`PROOF boot_comms unique_persons=${n} seeded_this_pass=${out.length}`);
  await closeStore();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
