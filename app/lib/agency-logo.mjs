/** Lead law-enforcement seal for an operation card.
 *  Chosen from the stored agencies list. Not a database column.
 *  Official seals only. An unmapped list stays blank.
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
export function operationLeadAgencyId(agencies) {
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

export function operationLeadLogo(agencies) {
  const id = operationLeadAgencyId(agencies);
  const logo = id ? AGENCY_LOGOS[id] : null;
  if (!logo) return { photo: "", photo_credit: "" };
  return {
    photo: `/media/agencies/${logo.file}`,
    photo_credit: logo.credit,
  };
}
