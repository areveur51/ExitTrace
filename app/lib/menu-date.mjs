/** Year a person card uses on one catalog menu. Display only. Does not write people.event_date. */

import { asEventDate, personEvents } from "./promote.mjs";
import { normalizeClearances } from "./clearances.mjs";
import { isTrumpNickname, normalizeNicknames } from "./nicknames.mjs";

function day(raw) {
  return asEventDate(raw) || "";
}

function newest(dates) {
  let best = "";
  for (const raw of dates) {
    const value = day(raw);
    if (value && value > best) best = value;
  }
  return best;
}

function earliest(dates) {
  let best = "";
  for (const raw of dates) {
    const value = day(raw);
    if (value && (!best || value < best)) best = value;
  }
  return best;
}

function eventsOf(row, kinds) {
  const allow = new Set(kinds);
  return personEvents(row).filter((ev) => allow.has(String(ev?.kind || "").trim()));
}

function trumpNicknameDate(row) {
  const cites = [];
  for (const item of normalizeNicknames(row?.nicknames)) {
    if (!isTrumpNickname(item)) continue;
    for (const source of item.sources || []) cites.push(source?.date);
  }
  // One card. The year is the newest stored Trump-nickname cite, not another event.
  return newest(cites) || newest(eventsOf(row, ["nickname"]).map((ev) => ev.event_date));
}

function epsteinFileDate(row) {
  const dates = [];
  for (const ev of personEvents(row)) {
    const sources = Array.isArray(ev?.sources) ? ev.sources : [];
    const hit = sources.some((source) =>
      /justice\.gov\/epstein\//i.test(String(source?.url || "")),
    );
    if (hit) dates.push(ev.event_date);
  }
  return newest(dates);
}

function transparencyDate(row) {
  const dates = [];
  for (const ev of personEvents(row)) {
    const comments = String(ev?.comments || "");
    if (!/epstein files transparency act|h\.r\.\s*4405/i.test(comments)) continue;
    dates.push(ev.event_date);
  }
  return newest(dates);
}

function harassmentRecordsDate(row) {
  const dates = [];
  for (const ev of personEvents(row)) {
    const comments = String(ev?.comments || "");
    if (!/h\.?\s*res\.?\s*1100/i.test(comments)) continue;
    dates.push(ev.event_date);
  }
  return newest(dates);
}

/**
 * Date for the menu that is open.
 * Fact tags use that fact's own day. Category lists use that kind's event day.
 * A missing day stays blank so the card is not filed under a different event.
 * Epstein-client events store the first flight day.
 */
export function personMenuDate(row, menu = {}) {
  const tag = String(menu.tag || "");
  const kinds = Array.isArray(menu.kinds)
    ? menu.kinds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (tag === "endorsements") {
    return newest(eventsOf(row, ["endorsement"]).map((ev) => ev.event_date));
  }
  if (tag === "clearance_revoked") {
    const fromEvent = newest(eventsOf(row, ["clearance"]).map((ev) => ev.event_date));
    if (fromEvent) return fromEvent;
    const fromRows = newest(normalizeClearances(row?.clearances).map((item) => item.date));
    if (fromRows) return fromRows;
    if (String(row?.category || "") === "clearance") return day(row?.event_date);
    return "";
  }
  if (tag === "epstein_clients") {
    const fromEvent = earliest(eventsOf(row, ["epstein_clients"]).map((ev) => ev.event_date));
    if (fromEvent) return fromEvent;
    const flight = day(menu.flightDate);
    if (flight) return flight;
    if (String(row?.category || "") === "epstein_clients") return day(row?.event_date);
    return "";
  }
  if (tag === "trump_nickname") return trumpNicknameDate(row);
  if (tag === "epstein_files") return epsteinFileDate(row);
  if (tag === "epstein_transparency_act") return transparencyDate(row);
  if (tag === "harassment_records") return harassmentRecordsDate(row);
  if (tag === "masks") return "";
  if (menu.centralCasting) {
    return newest(eventsOf(row, ["central_casting"]).map((ev) => ev.event_date));
  }
  if (kinds.length) {
    return newest(eventsOf(row, kinds).map((ev) => ev.event_date));
  }
  return day(row?.event_date);
}

export function orderPeopleByMenuDate(rows, menu = {}) {
  const flightDates = menu.flightDates;
  const dateOf = (row) =>
    personMenuDate(row, {
      ...menu,
      flightDate: flightDates?.get?.(row.id) || menu.flightDate || "",
    });
  const ordered = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const da = dateOf(a);
    const db = dateOf(b);
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return db < da ? -1 : 1;
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  return { ordered, dateOf };
}
