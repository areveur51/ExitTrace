#!/usr/bin/env node
/**
 * ExitTrace daily apply driver (called by scripts/et-daily-ingest.sh).
 *
 * Reads the grok envelope at $APPLY ({rows:[...], skipped:[...]}) and applies
 * each picked row through the one apply entry:
 *   node scripts/process-add-request.mjs --queue --subject ... --cite-url ...
 * --queue parks (or reuses) a pending person add request and processes it by
 * id, so the fail-closed checks and the live display check stay in one place.
 *
 * Writes a summary to $SUMMARY and appends it to $REPORT.
 * Exit 0 when no row failed; exit 2 when any row failed or apply.json is bad.
 * APPLY_DRY=1 plans the helper calls only (no spawn, no writes).
 */
import { spawnSync } from "child_process";
import fs from "fs";

const KEEP = new Set([
  "death_celebrity", "death_ceo", "death_official", "firings", "resignations",
  "government_stepdowns", "arrests", "indictment_civilian", "indictment_non_civilian",
]);
const MAX_ROWS = 8;
const OPTIONAL_FLAGS = [
  ["role", "--role"],
  ["position", "--position"],
  ["organization", "--organization"],
  ["country_of_origin", "--country-of-origin"],
  ["reason", "--reason"],
  ["hint_url", "--hint-url"],
];

export function loadApply(p) {
  if (!p || !fs.existsSync(p)) return { error: "missing-apply-json" };
  const raw = fs.readFileSync(p, "utf8").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) return { error: "apply-json-not-json" };
  try {
    const data = JSON.parse(raw.slice(start, end + 1));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { error: "apply-json-not-object" };
    }
    return { data };
  } catch {
    return { error: "apply-json-parse" };
  }
}

export function helperArgs(helper, row) {
  const args = [
    helper,
    "--queue",
    "--subject", row.subject,
    "--category", row.category,
    "--event-date", row.event_date,
  ];
  for (const [key, flag] of OPTIONAL_FLAGS) {
    const v = String(row[key] || "").trim();
    if (v) args.push(flag, v);
  }
  for (const u of row.cite_urls.slice(0, 6)) args.push("--cite-url", u);
  return args;
}

export function normalizeRow(row = {}) {
  return {
    ...row,
    subject: String(row.subject || "").trim(),
    category: String(row.category || "").trim(),
    event_date: String(row.event_date || "").trim(),
    cite_urls: (Array.isArray(row.cite_urls) ? row.cite_urls : [])
      .map((u) => String(u).trim())
      .filter(Boolean),
  };
}

export function rowArgsOk(row) {
  return Boolean(
    row.subject &&
      KEEP.has(row.category) &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.event_date) &&
      row.cite_urls.length >= 2,
  );
}

export function runApply({ applyPath, root, node, helper, dry = false }) {
  const loaded = loadApply(applyPath);
  const summary = {
    picked: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
    planned: 0,
    dry_run: Boolean(dry),
    apply_json_error: loaded.error || null,
    helper,
    inserted_rows: [],
    skipped_rows: [],
    failed_rows: [],
    planned_rows: [],
  };
  if (loaded.error) return summary;
  const data = loaded.data;
  const skipped = Array.isArray(data.skipped) ? data.skipped.slice() : [];
  const rows = (Array.isArray(data.rows) ? data.rows : []).slice(0, MAX_ROWS).map(normalizeRow);
  summary.picked = rows.length;
  for (const row of rows) {
    if (!rowArgsOk(row)) {
      skipped.push({ subject: row.subject, reason: "fail-closed-args" });
      continue;
    }
    const args = helperArgs(helper, row);
    if (dry) {
      summary.planned_rows.push({ subject: row.subject, args: args.slice(1) });
      continue;
    }
    const run = spawnSync(node, args, { cwd: root, encoding: "utf8", timeout: 180000 });
    const out = `${run.stdout || ""}${run.stderr || ""}`.trim();
    if (run.status === 0) {
      const action = (out.match(/add-process (\w+)/) || [])[1] || "ok";
      summary.inserted_rows.push({
        subject: row.subject,
        category: row.category,
        event_date: row.event_date,
        action,
        out: out.split("\n").slice(-2).join(" | "),
      });
    } else {
      summary.failed_rows.push({
        subject: row.subject,
        exit: run.status,
        signal: run.signal || null,
        error: run.error ? String(run.error.message || run.error) : null,
        out: out.slice(-800),
      });
    }
  }
  summary.skipped_rows = skipped;
  summary.inserted = summary.inserted_rows.length;
  summary.failed = summary.failed_rows.length;
  summary.skipped = skipped.length;
  summary.planned = summary.planned_rows.length;
  return summary;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const root = process.env.ROOT || process.cwd();
  const summary = runApply({
    applyPath: process.env.APPLY,
    root,
    node: process.env.NODE || process.execPath,
    helper: process.env.HELPER || `${root}/scripts/process-add-request.mjs`,
    dry: process.env.APPLY_DRY === "1",
  });
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (process.env.SUMMARY) fs.writeFileSync(process.env.SUMMARY, text);
  if (process.env.REPORT) fs.appendFileSync(process.env.REPORT, text);
  console.log(
    `applied picked=${summary.picked} inserted=${summary.inserted} skipped=${summary.skipped} failed=${summary.failed}` +
      (summary.dry_run ? ` planned=${summary.planned} dry_run=1` : "") +
      (summary.apply_json_error ? ` apply_json_error=${summary.apply_json_error}` : ""),
  );
  process.exit(summary.apply_json_error || summary.failed > 0 ? 2 : 0);
}
