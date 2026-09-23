/**
 * Lab request_attributions. Written only after an x_mention KEEP succeeds.
 * First subject wins. mention_url is meta and is not a cite.
 * Display reads this table. mention_queue is not the display source.
 */

import { getMemory, getPool } from "./store.mjs";
import { isSnowflake } from "./x-mentions.mjs";

export const ATTRIBUTION_CHANNEL = "x_mention";

export const ATTRIBUTION_TARGET_KINDS = Object.freeze([
  "person",
  "operation",
  "dog_comm",
  "red_folder_comm",
  "central_casting_comm",
]);

const TARGET_KIND = new Set(ATTRIBUTION_TARGET_KINDS);

export function attributionKindForComms(kindId) {
  if (kindId === "dog") return "dog_comm";
  if (kindId === "red_folder") return "red_folder_comm";
  if (kindId === "central_casting") return "central_casting_comm";
  return "";
}

function bucket() {
  const mem = getMemory();
  if (!Array.isArray(mem.request_attributions)) mem.request_attributions = [];
  return mem.request_attributions;
}

function cleanText(raw, max) {
  return String(raw || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

function isoTimestamp(value) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

export function attributionTargetFromKeep(result) {
  if (!result || typeof result !== "object") return null;
  if (result.person?.id) return { target_kind: "person", target_id: String(result.person.id) };
  if (result.operation?.id) {
    return { target_kind: "operation", target_id: String(result.operation.id) };
  }
  const central = result.central_casting?.id || result.centralCasting?.id;
  if (central) return { target_kind: "central_casting_comm", target_id: String(central) };
  const folder = result.red_folder?.id || result.redFolder?.id;
  if (folder) return { target_kind: "red_folder_comm", target_id: String(folder) };
  if (result.dog?.id) return { target_kind: "dog_comm", target_id: String(result.dog.id) };
  if (result.person_id) return { target_kind: "person", target_id: String(result.person_id) };
  if (result.operation_id) return { target_kind: "operation", target_id: String(result.operation_id) };
  if (result.central_casting_id) {
    return { target_kind: "central_casting_comm", target_id: String(result.central_casting_id) };
  }
  if (result.red_folder_id) {
    return { target_kind: "red_folder_comm", target_id: String(result.red_folder_id) };
  }
  if (result.dog_id) return { target_kind: "dog_comm", target_id: String(result.dog_id) };
  return null;
}

function normalizeAttribution(input = {}) {
  const target_kind = String(input.target_kind || "").trim();
  const target_id = cleanText(input.target_id, 200);
  const channel = String(input.channel || "").trim();
  const subject_status_id = String(input.subject_status_id || "").trim();
  const mention_status_id = String(input.mention_status_id || "").trim();
  const submitted_at = isoTimestamp(input.submitted_at);
  if (!TARGET_KIND.has(target_kind) || !target_id) return null;
  if (channel !== ATTRIBUTION_CHANNEL) return null;
  if (!isSnowflake(subject_status_id) || !isSnowflake(mention_status_id)) return null;
  if (!submitted_at) return null;
  return {
    target_kind,
    target_id,
    channel,
    submitter_display_name: cleanText(input.submitter_display_name, 80),
    submitter_handle: cleanText(input.submitter_handle, 15).replace(/^@/, ""),
    submitter_author_id: cleanText(input.submitter_author_id, 32),
    submitted_at,
    subject_status_id,
    mention_status_id,
    mention_url: cleanText(input.mention_url, 500),
  };
}

function mapRow(row) {
  if (!row) return null;
  return {
    target_kind: row.target_kind,
    target_id: row.target_id,
    channel: row.channel,
    submitter_display_name: row.submitter_display_name || "",
    submitter_handle: row.submitter_handle || "",
    submitter_author_id: row.submitter_author_id || "",
    submitted_at: isoTimestamp(row.submitted_at),
    subject_status_id: row.subject_status_id,
    mention_status_id: row.mention_status_id,
    mention_url: row.mention_url || "",
  };
}

export function sortAttributionsOldestFirst(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const at = String(a?.submitted_at || "");
    const bt = String(b?.submitted_at || "");
    if (at < bt) return -1;
    if (at > bt) return 1;
    return String(a?.subject_status_id || "").localeCompare(String(b?.subject_status_id || ""));
  });
}

/**
 * Insert one attribution. Same channel + subject_status_id keeps the first row.
 */
export async function recordRequestAttribution(input = {}) {
  const row = normalizeAttribution(input);
  if (!row) return { ok: false, created: false, row: null };
  const p = await getPool();
  if (!p) {
    const list = bucket();
    const existing = list.find(
      (item) => item.channel === row.channel && item.subject_status_id === row.subject_status_id,
    );
    if (existing) return { ok: true, created: false, row: mapRow(existing) };
    list.push(row);
    return { ok: true, created: true, row: mapRow(row) };
  }
  const inserted = await p.query(
    `INSERT INTO request_attributions (
       target_kind, target_id, channel,
       submitter_display_name, submitter_handle, submitter_author_id,
       submitted_at, subject_status_id, mention_status_id, mention_url
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (channel, subject_status_id) DO NOTHING
     RETURNING *`,
    [
      row.target_kind,
      row.target_id,
      row.channel,
      row.submitter_display_name,
      row.submitter_handle,
      row.submitter_author_id,
      row.submitted_at,
      row.subject_status_id,
      row.mention_status_id,
      row.mention_url,
    ],
  );
  if (!inserted.rows[0]) {
    const existing = await p.query(
      `SELECT * FROM request_attributions
        WHERE channel = $1 AND subject_status_id = $2`,
      [row.channel, row.subject_status_id],
    );
    return { ok: true, created: false, row: mapRow(existing.rows[0]) };
  }
  return { ok: true, created: true, row: mapRow(inserted.rows[0]) };
}

/** Copy submitter fields off the queue row after lab KEEP success. */
export async function recordXMentionKeepAttribution(queueRow = {}, keepResult) {
  const target = attributionTargetFromKeep(keepResult);
  if (!target) return { ok: false, created: false, row: null };
  return recordRequestAttribution({
    ...target,
    channel: ATTRIBUTION_CHANNEL,
    submitter_display_name: queueRow.author_display_name || "",
    submitter_handle: queueRow.author_handle || "",
    submitter_author_id: queueRow.author_id || "",
    submitted_at: queueRow.created_at || queueRow.submitted_at || new Date().toISOString(),
    subject_status_id: queueRow.subject_status_id,
    mention_status_id: queueRow.mention_status_id,
    mention_url: queueRow.mention_url || "",
  });
}

export async function listRequestAttributions({ target_kind, target_id } = {}) {
  const kind = String(target_kind || "").trim();
  const id = String(target_id || "").trim();
  if (!TARGET_KIND.has(kind) || !id) return [];
  const p = await getPool();
  if (!p) {
    return sortAttributionsOldestFirst(
      bucket()
        .filter((row) => row.target_kind === kind && row.target_id === id)
        .map(mapRow),
    );
  }
  const q = await p.query(
    `SELECT * FROM request_attributions
      WHERE target_kind = $1 AND target_id = $2
      ORDER BY submitted_at ASC, subject_status_id ASC`,
    [kind, id],
  );
  return q.rows.map(mapRow);
}
