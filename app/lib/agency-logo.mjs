/** Lead law-enforcement seal for an operation card.
 *  Chosen from the stored agencies list. Not a database column.
 *  Official seals only. An unmapped list stays blank.
 *  A per-operation override may name a seal; otherwise the list lookup is unchanged.
 */

const AGENCY_LOGOS = Object.freeze({
  nysp: seal(
    "nysp.png",
    "Seal of the New York State Police. Public domain, via Wikimedia Commons.",
  ),
  hsi: seal(
    "hsi.jpg",
    "Badge of Homeland Security Investigations. U.S. government work, via Wikimedia Commons.",
  ),
  ice: seal(
    "ice.png",
    "Seal of U.S. Immigration and Customs Enforcement. U.S. government work, via Wikimedia Commons.",
  ),
  cbp: seal(
    "cbp.png",
    "Seal of U.S. Customs and Border Protection. U.S. government work, via Wikimedia Commons.",
  ),
  fbi: seal(
    "fbi.png",
    "Seal of the Federal Bureau of Investigation. U.S. government work, via Wikimedia Commons.",
  ),
  dea: seal(
    "dea.png",
    "Seal of the Drug Enforcement Administration. U.S. government work, via Wikimedia Commons.",
  ),
  usms: seal(
    "usms.png",
    "Seal of the United States Marshals Service. U.S. government work, via Wikimedia Commons.",
  ),
  "hhs-oig": seal(
    "hhs-oig.jpg",
    "Logo of the U.S. Department of Health and Human Services, Office of Inspector General. U.S. government work, via Wikimedia Commons.",
  ),
  doj: seal(
    "doj.jpg",
    "Seal of the United States Department of Justice. U.S. government work, via Wikimedia Commons.",
  ),
  dhs: seal(
    "dhs.png",
    "Seal of the United States Department of Homeland Security. U.S. government work, via Wikimedia Commons.",
  ),
  // Reachable only through OPERATION_LEAD_OVERRIDES. Not name-matched below.
  "usda-oig": seal(
    "usda-oig.png",
    "Seal of the Office of Inspector General, U.S. Department of Agriculture. U.S. government work, via Wikimedia Commons.",
  ),
  "dol-oig": seal(
    "dol-oig.png",
    "Seal of the Office of Inspector General, U.S. Department of Labor. CC0, via Wikimedia Commons.",
  ),
  "hud-oig": seal(
    "hud-oig.png",
    "Logo of the Office of Inspector General, U.S. Department of Housing and Urban Development. U.S. government work, via Wikimedia Commons.",
  ),
  usao: seal(
    "usao.png",
    "Official logo of the Executive Office for United States Attorneys. U.S. government work, via Wikimedia Commons.",
  ),
  dol: seal(
    "dol.png",
    "Seal of the United States Department of Labor. U.S. government work, via Wikimedia Commons.",
  ),
  atf: seal(
    "atf.png",
    "Seal of the Bureau of Alcohol, Tobacco, Firearms and Explosives. U.S. government work, via Wikimedia Commons.",
  ),
});

// ---- Per-Operation lead-agency overrides ------------------------------
// Keyed by operation id (slug) -> seal key in AGENCY_LOGOS.
// Intentionally EMPTY in this change. Filled in after the cite audit,
// after merge and deploy. Each entry must cite the source naming the lead.
export const OPERATION_LEAD_OVERRIDES = Object.freeze({
});
// ---- end overrides -----------------------------------------------------

/** Commons pages for seals reachable only through OPERATION_LEAD_OVERRIDES.
 *  usda-oig, dol-oig, hud-oig, usao, dol, atf.
 *  Credit strings on AGENCY_LOGOS stay free of URLs.
 */
export const SEAL_SOURCES = Object.freeze({
  "usda-oig": Object.freeze({
    source: "https://commons.wikimedia.org/wiki/File:USDA-OfficeOfInspectorGeneral.svg",
    license: "Public domain (U.S. government work, USDA)",
  }),
  "dol-oig": Object.freeze({
    source: "https://commons.wikimedia.org/wiki/File:Seal_of_the_United_States_Department_of_Labor_Office_of_Inspector_General.svg",
    license: "CC0 1.0 (vector redraw of the official DOL OIG seal)",
  }),
  "hud-oig": Object.freeze({
    source: "https://commons.wikimedia.org/wiki/File:Office_of_Inspector_General_logo_for_HUD.png",
    license: "Public domain (U.S. government work, HUD OIG)",
  }),
  usao: Object.freeze({
    source: "https://commons.wikimedia.org/wiki/File:Official_Logo_for_the_Executive_Office_for_United_States_Attorneys.png",
    license: "Public domain (U.S. government work, EOUSA)",
  }),
  dol: Object.freeze({
    source: "https://commons.wikimedia.org/wiki/File:Seal_of_the_United_States_Department_of_Labor.svg",
    license: "Public domain (U.S. government work)",
  }),
  atf: Object.freeze({
    source: "https://commons.wikimedia.org/wiki/File:Seal_of_the_Bureau_of_Alcohol,_Tobacco,_Firearms_and_Explosives.svg",
    license: "Public domain (U.S. government work)",
  }),
});

/** First matching law-enforcement agency wins. Order is the stored list, not this table. */
const LAW_ENFORCEMENT = Object.freeze([
  ["nysp", ["new york state police", "nysp"]],
  ["hsi", ["homeland security investigations", "hsi"]],
  ["ice", [
    "ice",
    "u s immigration and customs enforcement",
    "immigration and customs enforcement",
  ]],
  ["cbp", [
    "cbp",
    "u s customs and border protection",
    "customs and border protection",
  ]],
  ["fbi", ["fbi", "federal bureau of investigation"]],
  ["dea", [
    "dea",
    "drug enforcement administration",
    "u s drug enforcement administration",
  ]],
  ["usms", [
    "usms",
    "u s marshals service",
    "united states marshals service",
  ]],
  ["hhs-oig", [
    "hhs oig",
    "hhs office of inspector general",
    "office of inspector general hhs",
  ]],
]);

const DOJ = new Set([
  "doj",
  "u s department of justice",
  "department of justice",
  "united states department of justice",
]);

const DHS = new Set([
  "dhs",
  "u s department of homeland security",
  "department of homeland security",
  "united states department of homeland security",
]);

const LE_BY_NAME = new Map();
for (const [id, names] of LAW_ENFORCEMENT) {
  for (const name of names) LE_BY_NAME.set(name, id);
}

function seal(file, credit) {
  return Object.freeze({ file, credit });
}

/** Prototype names are never an operation id or a seal key. */
const PROTO_SEAL_KEYS = new Set(["__proto__", "constructor", "toString"]);

export function knownSealKeys() {
  return Object.keys(AGENCY_LOGOS);
}

function ownDataValue(obj, key) {
  if (obj === null || typeof obj !== "object") return undefined;
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(obj, key)) return undefined;
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc || !Object.prototype.hasOwnProperty.call(desc, "value")) return undefined;
  return desc.value;
}

/** Own override entry whose value is an own AGENCY_LOGOS key, or "". */
function sealIdFromOverride(operationId, overrides) {
  const id = String(operationId ?? "").trim();
  if (!id || PROTO_SEAL_KEYS.has(id)) return "";
  const key = ownDataValue(overrides, id);
  if (typeof key !== "string" || !key || PROTO_SEAL_KEYS.has(key)) return "";
  if (!Object.prototype.hasOwnProperty.call(AGENCY_LOGOS, key)) return "";
  return key;
}

export function foldAgencyName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lead seal id, or "" when the list has no mapped law-enforcement agency and no department fallback. */
export function operationLeadAgencyId(agencies, operationId = "", overrides = OPERATION_LEAD_OVERRIDES) {
  const overridden = sealIdFromOverride(operationId, overrides);
  if (overridden) return overridden;
  const list = Array.isArray(agencies) ? agencies : [];
  for (const name of list) {
    const id = LE_BY_NAME.get(foldAgencyName(name));
    if (id && AGENCY_LOGOS[id]) return id;
  }
  const folded = list.map(foldAgencyName);
  if (folded.some((name) => DOJ.has(name))) return "doj";
  if (folded.some((name) => DHS.has(name))) return "dhs";
  return "";
}

export function operationLeadLogo(agencies, operationId = "", overrides = OPERATION_LEAD_OVERRIDES) {
  const id = operationLeadAgencyId(agencies, operationId, overrides);
  const logo = id && Object.prototype.hasOwnProperty.call(AGENCY_LOGOS, id)
    ? Object.getOwnPropertyDescriptor(AGENCY_LOGOS, id).value
    : null;
  if (!logo) return { photo: "", photo_credit: "" };
  return {
    photo: `/media/agencies/${logo.file}`,
    photo_credit: logo.credit,
  };
}
