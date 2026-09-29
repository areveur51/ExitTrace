#!/usr/bin/env node
/**
 * Boot AMEND migration: clip rows → unique-person membership + boot_comms person_events.
 * Preserves cite URLs + clip text as snippet. No invent. Soft-ack OFF. leftover/:5434 untouched.
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
} from "../app/lib/store.mjs";
import { personSlug } from "../app/lib/promote.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(ROOT, ".env"));
const { mediaDir } = resolveRoot(ROOT);
if (!process.env.MEDIA_DIR) process.env.MEDIA_DIR = mediaDir;
const bootstrapSql = fs.readFileSync(path.join(ROOT, "scripts", "bootstrap-db.sql"), "utf8");

/** Structural fields only (not cites). Public roles; no invented injury facts. */
const PERSON_META = {
  "Joe Biden": {
    country_of_origin: "United States",
    position: "President of the United States",
    organization: "Executive Office of the President",
  },
  "Nicole Kidman": {
    country_of_origin: "Australia",
    position: "Actor",
    organization: "Entertainment",
  },
  "Britney Spears": {
    country_of_origin: "United States",
    position: "Singer",
    organization: "Entertainment",
  },
  "Simone Biles": {
    country_of_origin: "United States",
    position: "Gymnast",
    organization: "USA Gymnastics",
  },
};

async function main() {
  const pool = await getPool();
  if (!pool) throw new Error("DATABASE_URL required (lab writer :5433)");
  await ensureSchema(pool, bootstrapSql);

  const clips = (
    await pool.query(
      `SELECT id, posted_at, account_name, text, source_url, snapshot
         FROM boot_comms
        ORDER BY posted_at`,
    )
  ).rows;
  console.log(`clips=${clips.length}`);

  const results = [];
  for (const clip of clips) {
    const subject = String(clip.account_name || "").trim();
    if (!subject) {
      console.warn(`SKIP ${clip.id}: no account_name`);
      continue;
    }
    const event_date = String(clip.posted_at || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
      console.warn(`SKIP ${clip.id}: bad date ${clip.posted_at}`);
      continue;
    }
    const snapCites = Array.isArray(clip.snapshot?.cites) ? clip.snapshot.cites : [];
    const cite_urls = [...new Set([clip.source_url, ...snapCites].filter(Boolean))];
    if (cite_urls.length < 2) {
      console.warn(`SKIP ${clip.id}: need 2 cites, got ${cite_urls.length}`);
      continue;
    }
    const meta = PERSON_META[subject] || {
      country_of_origin: "United States",
      position: "Public figure",
      organization: "Public record",
    };
    const snippet = String(clip.text || clip.snapshot?.text || "").trim();
    const result = await applyIdentifiedPerson({
      subject,
      category: "boot_comms",
      event_date,
      cite_urls,
      comments: snippet || "Medical walking boot after documented lower-leg, ankle, or foot injury",
      reason: snippet || "Medical walking boot after documented lower-leg, ankle, or foot injury",
      ...meta,
    });
    // Preserve clip text as snippet on first cite (no invent).
    if (snippet && result.person?.id) {
      const person = await getPerson(result.person.id);
      if (person) {
        const events = (person.events || []).map((ev) => {
          if (ev.kind !== "boot_comms") return ev;
          const sources = (ev.sources || []).map((src, i) => ({
            ...src,
            snippet: String(src.snippet || "").trim() || (i === 0 ? snippet : ""),
          }));
          return { ...ev, sources, comments: ev.comments || snippet };
        });
        await savePerson({ ...person, events });
      }
    }
    const row = {
      clip_id: clip.id,
      person_id: result.person?.id || personSlug(subject),
      action: result.action,
      cites: cite_urls.length,
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }

  const count = await pool.query(
    `SELECT COUNT(DISTINCT person_id)::int AS n FROM person_events WHERE kind = 'boot_comms'`,
  );
  console.log(`PROOF boot_comms unique_persons=${count.rows[0].n}`);
  console.log(JSON.stringify({ migrated: results.length, persons: count.rows[0].n, results }, null, 2));
  await closeStore();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
