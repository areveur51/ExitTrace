/**
 * Lab request_attributions. Written only after an x_mention KEEP succeeds.
 * First subject wins when subject_status_id is set. mention_url is meta, not a cite.
 * Display reads this table. mention_queue is not the display source.
 */

import { createHash } from "node:crypto";
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
const COMMS_TARGET = new Set(["dog_comm", "red_folder_comm", "central_casting_comm"]);

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

function emptyToNull(raw, max) {
  const text = cleanText(raw, max);
  return text || null;
}

function isoTimestamp(value) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function firstId(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

/**
 * Comms KEEP wins over the person card. Central Casting and Corona person
 * keeps stay on the person when the dig did not keep a comms row.
 */
export function attributionTargetFromKeep(result) {
  if (!result || typeof result !== "object") return null;
  const central = firstId(
    result.central_casting?.id,
    result.centralCasting?.id,
    result.central_casting_comm?.id,
    result.central_casting_id,
  );
  if (central && !Array.isArray(result.central_casting)) {
    return { target_kind: "central_casting_comm", target_id: central };
  }
  const folder = firstId(result.red_folder?.id, result.redFolder?.id, result.red_folder_id);
  if (folder) return { target_kind: "red_folder_comm", target_id: folder };
  const dog = firstId(result.dog?.id, result.dog_id);
  if (dog) return { target_kind: "dog_comm", target_id: dog };
  const person = firstId(result.person?.id, result.person_id);
  if (person) return { target_kind: "person", target_id: person };
  const operation = firstId(result.operation?.id, result.operation_id);
  if (operation) return { target_kind: "operation", target_id: operation };
  return null;
}

export function attributionId(row) {
  const given = cleanText(row?.id, 80);
  if (/^ra-[a-f0-9]{16}$/.test(given)) return given;
  const basis = row.subject_status_id
    ? `${row.channel}\n${row.subject_status_id}`
    : [
        row.channel,
        row.mention_status_id || "",
        row.target_kind,
        row.target_id,
        row.submitted_at,
      ].join("\n");
  return `ra-${createHash("sha256").update(basis).digest("hex").slice(0, 16)}`;
}

function optionalSnowflake(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (!isSnowflake(text)) return false;
  return text;
}

function normalizeAttribution(input = {}) {
  const target_kind = String(input.target_kind || "").trim();
  const target_id = cleanText(input.target_id, 200);
  const channel = String(input.channel || ATTRIBUTION_CHANNEL).trim() || ATTRIBUTION_CHANNEL;
  const subject_status_id = optionalSnowflake(input.subject_status_id);
  const mention_status_id = optionalSnowflake(input.mention_status_id);
  const submitted_at = isoTimestamp(input.submitted_at);
  const submitter_handle = cleanText(input.submitter_handle, 15).replace(/^@/, "");
  if (!TARGET_KIND.has(target_kind) || !target_id) return null;
  if (channel !== ATTRIBUTION_CHANNEL) return null;
  if (subject_status_id === false || mention_status_id === false) return null;
  if (!submitter_handle || !submitted_at) return null;
  const row = {
    target_kind,
    target_id,
    channel,
    submitter_display_name: cleanText(input.submitter_display_name, 80),
    submitter_handle,
    submitter_author_id: emptyToNull(input.submitter_author_id, 32),
    submitted_at,
    subject_status_id,
    mention_status_id,
    mention_url: emptyToNull(input.mention_url, 500),
    created_at: isoTimestamp(input.created_at) || new Date().toISOString(),
  };
  row.id = attributionId({ ...row, id: input.id });
  return row;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    target_kind: row.target_kind,
    target_id: row.target_id,
    channel: row.channel || ATTRIBUTION_CHANNEL,
    submitter_display_name: row.submitter_display_name || "",
    submitter_handle: row.submitter_handle || "",
    submitter_author_id: row.submitter_author_id || null,
    submitted_at: isoTimestamp(row.submitted_at),
    subject_status_id: row.subject_status_id || null,
    mention_status_id: row.mention_status_id || null,
    mention_url: row.mention_url || null,
    created_at: isoTimestamp(row.created_at),
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

function sameSubject(a, b) {
  return Boolean(a?.subject_status_id) && a.channel === b.channel && a.subject_status_id === b.subject_status_id;
}

/**
 * Insert one attribution from the winning queue row.
 * Same channel + subject_status_id keeps the first row when the subject is set.
 */
export async function recordRequestAttribution(input = {}) {
  const row = normalizeAttribution(input);
  if (!row) return { ok: false, created: false, row: null };
  const p = await getPool();
  if (!p) {
    const list = bucket();
    const existing = row.subject_status_id ? list.find((item) => sameSubject(item, row)) : null;
    if (existing) return { ok: true, created: false, row: mapRow(existing) };
    list.push(row);
    return { ok: true, created: true, row: mapRow(row) };
  }
  const inserted = await p.query(
    `INSERT INTO request_attributions (
       id, target_kind, target_id, channel,
       submitter_display_name, submitter_handle, submitter_author_id,
       submitted_at, subject_status_id, mention_status_id, mention_url, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (channel, subject_status_id) WHERE subject_status_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      row.id,
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
      row.created_at,
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

/** Copy the winning mention_queue row after lab KEEP success. */
export async function recordXMentionKeepAttribution(queueRow = {}, keepResult) {
  const target = attributionTargetFromKeep(keepResult);
  if (!target) return { ok: false, created: false, row: null };
  if (target.target_kind === "person" && COMMS_TARGET.has(keepResult?.kept_target_kind)) {
    return { ok: false, created: false, row: null };
  }
  return recordRequestAttribution({
    ...target,
    channel: ATTRIBUTION_CHANNEL,
    submitter_display_name: queueRow.author_display_name || "",
    submitter_handle: queueRow.author_handle || "",
    submitter_author_id: queueRow.author_id || null,
    submitted_at: queueRow.created_at || queueRow.submitted_at || new Date().toISOString(),
    subject_status_id: queueRow.subject_status_id || null,
    mention_status_id: queueRow.mention_status_id || null,
    mention_url: queueRow.mention_url || null,
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
      ORDER BY submitted_at ASC, subject_status_id ASC NULLS LAST`,
    [kind, id],
  );
  return q.rows.map(mapRow);
}
