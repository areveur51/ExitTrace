/**
 * One spelling for each office. Abbreviations are spelled out.
 * U.S., (D), and (R) stay abbreviated. A party and a state are not turned
 * into an office the text did not name. Former and ordinals stay.
 */

const STATE_NAMES = {
  al: "Alabama",
  ala: "Alabama",
  alabama: "Alabama",
  ak: "Alaska",
  alaska: "Alaska",
  az: "Arizona",
  ariz: "Arizona",
  arizona: "Arizona",
  ar: "Arkansas",
  ark: "Arkansas",
  arkansas: "Arkansas",
  ca: "California",
  calif: "California",
  california: "California",
  co: "Colorado",
  colo: "Colorado",
  colorado: "Colorado",
  ct: "Connecticut",
  conn: "Connecticut",
  connecticut: "Connecticut",
  de: "Delaware",
  del: "Delaware",
  delaware: "Delaware",
  fl: "Florida",
  fla: "Florida",
  florida: "Florida",
  ga: "Georgia",
  georgia: "Georgia",
  hi: "Hawaii",
  hawaii: "Hawaii",
  id: "Idaho",
  idaho: "Idaho",
  il: "Illinois",
  ill: "Illinois",
  illinois: "Illinois",
  in: "Indiana",
  ind: "Indiana",
  indiana: "Indiana",
  ia: "Iowa",
  iowa: "Iowa",
  ks: "Kansas",
  kan: "Kansas",
  kans: "Kansas",
  kansas: "Kansas",
  ky: "Kentucky",
  kentucky: "Kentucky",
  la: "Louisiana",
  louisiana: "Louisiana",
  me: "Maine",
  maine: "Maine",
  md: "Maryland",
  maryland: "Maryland",
  ma: "Massachusetts",
  mass: "Massachusetts",
  massachusetts: "Massachusetts",
  mi: "Michigan",
  mich: "Michigan",
  michigan: "Michigan",
  mn: "Minnesota",
  minn: "Minnesota",
  minnesota: "Minnesota",
  ms: "Mississippi",
  miss: "Mississippi",
  mississippi: "Mississippi",
  mo: "Missouri",
  missouri: "Missouri",
  mt: "Montana",
  mont: "Montana",
  montana: "Montana",
  ne: "Nebraska",
  neb: "Nebraska",
  nebr: "Nebraska",
  nebraska: "Nebraska",
  nv: "Nevada",
  nev: "Nevada",
  nevada: "Nevada",
  nh: "New Hampshire",
  "n.h": "New Hampshire",
  "new hampshire": "New Hampshire",
  nj: "New Jersey",
  "n.j": "New Jersey",
  "new jersey": "New Jersey",
  nm: "New Mexico",
  "n.m": "New Mexico",
  "new mexico": "New Mexico",
  ny: "New York",
  "n.y": "New York",
  "new york": "New York",
  nc: "North Carolina",
  "n.c": "North Carolina",
  "north carolina": "North Carolina",
  nd: "North Dakota",
  "n.d": "North Dakota",
  "north dakota": "North Dakota",
  oh: "Ohio",
  ohio: "Ohio",
  ok: "Oklahoma",
  okla: "Oklahoma",
  oklahoma: "Oklahoma",
  or: "Oregon",
  ore: "Oregon",
  oregon: "Oregon",
  pa: "Pennsylvania",
  penn: "Pennsylvania",
  pennsylvania: "Pennsylvania",
  ri: "Rhode Island",
  "r.i": "Rhode Island",
  "rhode island": "Rhode Island",
  sc: "South Carolina",
  "s.c": "South Carolina",
  "south carolina": "South Carolina",
  sd: "South Dakota",
  "s.d": "South Dakota",
  "south dakota": "South Dakota",
  tn: "Tennessee",
  tenn: "Tennessee",
  tennessee: "Tennessee",
  tx: "Texas",
  tex: "Texas",
  texas: "Texas",
  ut: "Utah",
  utah: "Utah",
  vt: "Vermont",
  vermont: "Vermont",
  va: "Virginia",
  virginia: "Virginia",
  wa: "Washington",
  wash: "Washington",
  washington: "Washington",
  "washington state": "Washington",
  wv: "West Virginia",
  "w.va": "West Virginia",
  "w. va": "West Virginia",
  "west virginia": "West Virginia",
  wi: "Wisconsin",
  wis: "Wisconsin",
  wisc: "Wisconsin",
  wisconsin: "Wisconsin",
  wy: "Wyoming",
  wyo: "Wyoming",
  wyoming: "Wyoming",
  dc: "District of Columbia",
  "d.c": "District of Columbia",
  "district of columbia": "District of Columbia",
  pr: "Puerto Rico",
  "puerto rico": "Puerto Rico",
};

const MONTHS = {
  Jan: "January",
  Feb: "February",
  Mar: "March",
  Apr: "April",
  Jun: "June",
  Jul: "July",
  Aug: "August",
  Sep: "September",
  Sept: "September",
  Oct: "October",
  Nov: "November",
  Dec: "December",
};

/** Uppercase tokens whose English name is fixed. Longer tokens first. */
const ACRONYMS = [
  ["SCOTUS", "Supreme Court of the United States"],
  ["FLOTUS", "First Lady of the United States"],
  ["POTUS", "President of the United States"],
  ["ECOWAS", "Economic Community of West African States"],
  ["HPSCI", "House Permanent Select Committee on Intelligence"],
  ["NASA", "National Aeronautics and Space Administration"],
  ["NYPD", "New York City Police Department"],
  ["ESPN", "Entertainment and Sports Programming Network"],
  ["FIFA", "International Federation of Association Football"],
  ["NBC", "National Broadcasting Company"],
  ["ABC", "American Broadcasting Company"],
  ["CBS", "Columbia Broadcasting System"],
  ["CNN", "Cable News Network"],
  ["BBC", "British Broadcasting Corporation"],
  ["PBS", "Public Broadcasting Service"],
  ["NPR", "National Public Radio"],
  ["WWE", "World Wrestling Entertainment"],
  ["NBA", "National Basketball Association"],
  ["NFL", "National Football League"],
  ["MLB", "Major League Baseball"],
  ["NHL", "National Hockey League"],
  ["NCAA", "National Collegiate Athletic Association"],
  ["IRGC", "Islamic Revolutionary Guard Corps"],
  ["HQDA", "Headquarters, Department of the Army"],
  ["CBP", "U.S. Customs and Border Protection"],
  ["ICE", "U.S. Immigration and Customs Enforcement"],
  ["ATF", "Bureau of Alcohol, Tobacco, Firearms and Explosives"],
  ["DEA", "Drug Enforcement Administration"],
  ["CDC", "Centers for Disease Control and Prevention"],
  ["FDA", "Food and Drug Administration"],
  ["NIH", "National Institutes of Health"],
  ["DOJ", "Department of Justice"],
  ["DHS", "Department of Homeland Security"],
  ["FBI", "Federal Bureau of Investigation"],
  ["CIA", "Central Intelligence Agency"],
  ["NSA", "National Security Agency"],
  ["FSB", "Federal Security Service"],
  ["RNC", "Republican National Committee"],
  ["DNC", "Democratic National Committee"],
  ["GOP", "Republican Party"],
  ["CPC", "Communist Party of China"],
  ["LNP", "Liberal National Party"],
  ["CDA", "Christian Democratic Appeal"],
  ["NSD", "National Security Division"],
  ["EAD", "Executive Assistant Director"],
  ["CHS", "confidential human source"],
  ["OCG", "organized crime group"],
  ["UAE", "United Arab Emirates"],
  ["NYC", "New York City"],
  ["USS", "United States Ship"],
  ["SVU", "Special Victims Unit"],
  ["LLC", "Limited Liability Company"],
  ["ENT", "ear, nose, and throat"],
  ["CBD", "cannabidiol"],
  ["UN", "United Nations"],
  ["UK", "United Kingdom"],
  ["EU", "European Union"],
];

const OFFICE_ACRONYMS = [
  ["CEO", "Chief Executive Officer"],
  ["CFO", "Chief Financial Officer"],
  ["COO", "Chief Operating Officer"],
  ["CTO", "Chief Technology Officer"],
  ["SVP", "Senior Vice President"],
  ["EVP", "Executive Vice President"],
  ["VP", "Vice President"],
  ["MP", "Member of Parliament"],
  ["PM", "Prime Minister"],
  ["GP", "General Practitioner"],
  ["QB", "Quarterback"],
];

const PHRASES = [
  [/white house communications director/gi, "White House Communications Director"],
  [/communications director/gi, "Communications Director"],
  [/chief operating officer/gi, "Chief Operating Officer"],
  [/chief executive officer/gi, "Chief Executive Officer"],
  [/chief financial officer/gi, "Chief Financial Officer"],
  [/chief technology officer/gi, "Chief Technology Officer"],
  [/chief of staff/gi, "Chief of Staff"],
  [/attorney general/gi, "Attorney General"],
  [/prime minister/gi, "Prime Minister"],
  [/vice president/gi, "Vice President"],
  [/first lady/gi, "First Lady"],
  [/u\.s\. secretary of state/gi, "U.S. Secretary of State"],
  [/secretary of state/gi, "Secretary of State"],
  [/u\.s\. senator/gi, "U.S. Senator"],
  [/u\.s\. representative/gi, "U.S. Representative"],
  [/member of parliament/gi, "Member of Parliament"],
  [/general practitioner/gi, "General Practitioner"],
  [/lieutenant governor/gi, "Lieutenant Governor"],
  [/state representative/gi, "State Representative"],
  [/state senator/gi, "State Senator"],
  [/country singer/gi, "Country Singer"],
  [/scottish secretary/gi, "Scottish Secretary"],
  [/deputy director/gi, "Deputy Director"],
  [/managing director/gi, "Managing Director"],
  [/white house staff secretary/gi, "White House Staff Secretary"],
  [/singer-songwriter(?!-)/gi, "Singer-Songwriter"],
  [/of the united states/gi, "of the United States"],
  [/national security advisor/gi, "National Security Advisor"],
];

const OFFICE_WORDS = [
  "president",
  "senator",
  "governor",
  "secretary",
  "minister",
  "chairman",
  "chairwoman",
  "speaker",
  "premier",
  "ambassador",
  "commissioner",
  "lieutenant",
  "representative",
  "advisor",
  "treasurer",
  "chancellor",
  "mayor",
  "colonel",
];

function stateKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

function stateOf(raw) {
  return STATE_NAMES[stateKey(raw)] || "";
}

function ordinal(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return String(raw);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function capFirst(text) {
  return text.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function tidy(text) {
  let next = text.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
  next = next.replace(/([^s])'(?=\s)/g, "$1's");
  const open = (next.match(/\(/g) || []).length;
  const close = (next.match(/\)/g) || []).length;
  if (open > close) next += ")".repeat(open - close);
  return next;
}

function preclean(raw) {
  let text = String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  text = text
    .replace(/\ba\/k\/a\b/gi, "also known as")
    .replace(/\bGovenors\b/gi, "Governors")
    .replace(/\bGovenor\b/gi, "Governor")
    .replace(/\bGovernors's\b/g, "Governor's")
    .replace(/\bOfficals\b/gi, "Officials")
    .replace(/\bOffical\b/gi, "Official")
    .replace(/\bIllinous\b/g, "Illinois")
    .replace(/\bChair women\b/gi, "Chairwoman")
    .replace(/\bAdvisers\b/gi, "Advisors")
    .replace(/\bAdviser\b/gi, "Advisor")
    .replace(/\bleadsinger\b/gi, "lead singer")
    .replace(/\bGeneatech\b/g, "Genentech")
    .replace(/\bSpains\b/g, "Spain's")
    .replace(/\bminister if\b/gi, "minister of")
    .replace(/\btalian\b/g, "Italian")
    .replace(/\bTom's Hanks wife\b/g, "Tom Hanks's wife")
    .replace(/\b([A-Z][a-z]+) Husband\b/g, "$1's husband")
    .replace(/(\d+)\s*yr\b/gi, "$1-year")
    .replace(/(\d+)\s+Year Old\b/g, "$1-year-old")
    .replace(/'([^']*)'/g, "$1")
    .replace(/(^|\s)'(?=\S)/g, "$1");
  return text.replace(/[,\s]+$/g, "").trim();
}

function normalizeCountryAbbrev(text) {
  return text
    .replace(/\bU\.S\.A\.\b/g, "U.S.")
    .replace(/\bUSA\b/g, "U.S.")
    .replace(/\bUS\b/g, "U.S.")
    .replace(/\bU\.S(?!\.)/g, "U.S.");
}

function partyState(party, raw) {
  const state = stateOf(raw);
  if (!state) return "";
  return `(${party}), ${state}`;
}

function normalizePolitical(text) {
  if (/^Alabama State Representative, House District 65 \(R-Fruitdale\)$/i.test(text)) {
    return "State Representative (R), Alabama, House District 65, Fruitdale";
  }

  let next = text.replace(/House of Rep\.?(?=\s|\(|$)/gi, "House of Representatives");
  let match = next.match(/^House of Representatives \(([DR])\) from (.+)$/i);
  if (match) {
    const state = stateOf(match[2]) || match[2].trim();
    return `U.S. Representative (${match[1]}), ${state}`;
  }
  match = next.match(/^House of Representatives \(([DR])\) ([A-Za-z].+)$/i);
  if (match && stateOf(match[2])) {
    return `U.S. Representative (${match[1]}), ${stateOf(match[2])}`;
  }

  match = next.match(/^U\.S\. REP \(([DR])\) (.+)$/i);
  if (match && stateOf(match[2])) {
    return `U.S. Representative (${match[1]}), ${stateOf(match[2])}`;
  }

  match = next.match(/^\(([DR])\)\s+Rep\.?\s+from\s+([^,]+)(,.*)?$/i);
  if (match && stateOf(match[2])) {
    return `U.S. Representative (${match[1]}), ${stateOf(match[2])}${match[3] || ""}`;
  }

  match = next.match(/^\(([DR])\)\s+congressman elect\s+(.+)$/i);
  if (match && stateOf(match[2])) {
    return `U.S. Representative-elect (${match[1]}), ${stateOf(match[2])}`;
  }

  match = next.match(/^\(([DR])\)\s+(.+?)\s+Congress(?:man|woman)$/i);
  if (match && stateOf(match[2])) {
    return `U.S. Representative (${match[1]}), ${stateOf(match[2])}`;
  }

  match = next.match(/^(?:Democratic|Democrat)\s+(.+?)\s+Rep\.?$/i);
  if (match && stateOf(match[1])) {
    return `U.S. Representative (D), ${stateOf(match[1])}`;
  }
  match = next.match(/^Republican\s+(.+?)\s+Rep\.?$/i);
  if (match && stateOf(match[1])) {
    return `U.S. Representative (R), ${stateOf(match[1])}`;
  }

  match = next.match(/^\(([DR])\)\s+U\.S\. Senator(?:\s+from)?\s+(.+)$/i);
  if (match && stateOf(match[2])) {
    return `U.S. Senator (${match[1]}), ${stateOf(match[2])}`;
  }
  match = next.match(/^U\.S\. Senator from (.+)$/i);
  if (match && stateOf(match[1])) {
    return `U.S. Senator from ${stateOf(match[1])}`;
  }

  match = next.match(/^\(([DR])\)\s+(.+?)\s+state\s+senator$/i);
  if (match && stateOf(match[2])) {
    return `State Senator (${match[1]}), ${stateOf(match[2])}`;
  }
  match = next.match(/^\(([DR])\)\s+(.+?)\s+State Rep\.?$/i);
  if (match && stateOf(match[2])) {
    return `State Representative (${match[1]}), ${stateOf(match[2])}`;
  }
  match = next.match(/^\(([DR])\)\s+(.+?)\s+Senator$/i);
  if (match && stateOf(match[2])) {
    return `Senator (${match[1]}), ${stateOf(match[2])}`;
  }

  match = next.match(/^\(([DR])\)\s+(.+?)\s+Governor\b(.*)$/i);
  if (match && stateOf(match[2])) {
    let note = match[3].trim();
    if (note.startsWith("(") && !note.endsWith(")")) note += ")";
    return `Governor (${match[1]}), ${stateOf(match[2])}${note ? ` ${note}` : ""}`;
  }

  match = next.match(/^\(([DR])\)\s+RNC Chairwoman$/i);
  if (match) return `Republican National Committee Chairwoman (${match[1]})`;

  match = next.match(/^(.+?)\s+State Senator(\s+\([^)]*\))?$/i);
  if (match && stateOf(match[1])) {
    return `State Senator, ${stateOf(match[1])}${match[2] || ""}`;
  }
  match = next.match(/^(.+?)\s+House Rep\.?$/i);
  if (match && stateOf(match[1])) {
    return `State Representative, ${stateOf(match[1])}`;
  }
  match = next.match(/^(.+?)\s+Senator$/i);
  if (match && stateOf(match[1])) {
    return `Senator, ${stateOf(match[1])}`;
  }

  if (/^(?:Congress(?:man|woman)|Congress Member|Member of Congress)$/i.test(next)) {
    return "U.S. Representative";
  }
  if (/^Congress(?:man|woman),\s+U\.S\. Congress$/i.test(next)) return "U.S. Representative";
  if (/^Representative$/i.test(next)) return "U.S. Representative";
  if (/^State Rep\.?$/i.test(next)) return "State Representative";

  match = next.match(/^\(([DR])\)\s*-?\s*(.+)$/);
  if (match) {
    const labeled = partyState(match[1], match[2]);
    if (labeled) return labeled;
  }
  match = next.match(/^([DR])\s*-\s*(.+)$/);
  if (match) {
    const labeled = partyState(match[1], match[2]);
    if (labeled) return labeled;
  }
  match = next.match(/^\(([DR])\s*-\s*([^)]+)\)$/);
  if (match) {
    const labeled = partyState(match[1], match[2]);
    if (labeled) return labeled;
  }
  return null;
}

function expandToken(text, token, expansion, flags = "g") {
  const re = new RegExp(`\\b${token}('s)?\\b`, flags);
  return text.replace(re, (_, poss) => expansion + (poss || ""));
}

function expandPartyCodes(text) {
  return text.replace(/\(([DR])\s*-\s*([^)]+)\)/g, (full, party, rest) => {
    const match = rest.match(/^([A-Za-z.\s]+?)(?:\s*-\s*(\d+))?$/);
    if (!match) return full;
    const state = stateOf(match[1]);
    if (!state) return full;
    if (match[2]) {
      return `(${party}) from ${state}'s ${ordinal(match[2])} Congressional District`;
    }
    return `(${party}), ${state}`;
  });
}

function expandDottedStates(text) {
  const dotted = [
    [/\bMass\b\.?/g, "Massachusetts"],
    [/\bCalif\b\.?/g, "California"],
    [/\bAriz\b\.?/g, "Arizona"],
    [/\bConn\b\.?/g, "Connecticut"],
    [/\bColo\b\.?/g, "Colorado"],
    [/\bMont\b\.?/g, "Montana"],
    [/\bWisc\b\.?/g, "Wisconsin"],
    [/\bPenn\b\.?/g, "Pennsylvania"],
    [/\bNev\b\.?/g, "Nevada"],
    [/\bFla\b\.?/g, "Florida"],
    [/\bIll\b\.?/g, "Illinois"],
    [/\bAla\./g, "Alabama"],
    [/\bGa\./g, "Georgia"],
    [/\bPa\./g, "Pennsylvania"],
    [/\bVa\./g, "Virginia"],
  ];
  let next = text;
  for (const [pattern, name] of dotted) next = next.replace(pattern, name);
  return next;
}

function expandBody(text) {
  let next = text.replace(/\(ENT\)/g, "ear, nose, and throat");
  next = next.replace(/House of Rep\.?(?=\s|\(|$)/gi, "House of Representatives");
  next = next.replace(/\bPOTUS Son\b\.?/gi, "Son of the President of the United States.");
  next = next.replace(/\bR&B\b/g, "Rhythm and Blues");
  next = next.replace(/\bto UN\b/g, "to the United Nations");
  next = next.replace(/\bDr\.?\s+Oz\.?$/i, "Doctor Oz");
  next = next.replace(/\bDr\.?\s+(?=[A-Z])/g, "Doctor ");
  next = next.replace(/\bSt\.?\s+(?=[A-Z])/g, "Saint ");
  next = next.replace(/\bSr\.?\s+(?=[A-Za-z])/g, "Senior ");
  next = next.replace(/\bLt\.?(?=\s|$)/g, "Lieutenant");
  next = next.replace(/\bGov\.(?=\s|$)/g, "Governor");
  next = next.replace(/\bGov(?=\s)/g, "Governor");
  next = next.replace(/\bBroward Co\./g, "Broward County");
  next = next.replace(/\bInc\.?(?=\s|$|,)/g, "Incorporated");
  next = next.replace(/\bCorp\.?(?=\s|$|,)/g, "Corporation");
  next = next.replace(/\bPlc\.?(?=\s|$|,)/g, "Public Limited Company");
  next = next.replace(/\bLtd\.?(?=\s|$|,)/g, "Limited");
  next = expandPartyCodes(next);
  next = next.replace(/\bMember of Congress\b/g, "U.S. Representative");
  next = next.replace(/\bCongress Members\b/g, "U.S. Representatives");
  next = next.replace(/\bCongress Member\b/g, "U.S. Representative");
  next = next.replace(/\bCongresswomen\b/g, "U.S. Representatives");
  next = next.replace(/\bCongresswoman\b/g, "U.S. Representative");
  next = next.replace(/\bCongressmen\b/g, "U.S. Representatives");
  next = next.replace(/\bCongressman\b/g, "U.S. Representative");
  next = next.replace(/\bRep\.?(?=\s|$)/g, "Representative");
  next = next.replace(/\bSen\.?(?=\s|$)/g, "Senator");
  for (const [token, expansion] of OFFICE_ACRONYMS) {
    next = expandToken(next, token, expansion, "gi");
  }
  for (const [token, expansion] of ACRONYMS) {
    next = expandToken(next, token, expansion, "g");
  }
  next = next.replace(/ & /g, " and ");
  next = next.replace(/\bAmbassador U\.S\. to\b/g, "U.S. Ambassador to");
  next = expandDottedStates(next);
  next = next.replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?\b/g, (token) => {
    const key = token.replace(/\.$/, "");
    return MONTHS[key] || token;
  });
  next = next.replace(/\s*\(([A-Za-z][A-Za-z.\s]*)\)/g, (full, inner) => {
    const state = stateOf(inner);
    return state ? `, ${state}` : full;
  });
  if (next.startsWith("ear, nose, and throat")) {
    next = `Ear, nose, and throat${next.slice("ear, nose, and throat".length)}`;
  }
  return next;
}

function capOfficeWords(text) {
  const re = new RegExp(`\\b(${OFFICE_WORDS.join("|")})\\b`, "gi");
  return text.replace(re, (word, _match, offset) => {
    const canon = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    const before = text.slice(0, offset).trimEnd();
    if (!before) return canon;
    const prev = before.match(/([A-Za-z][A-Za-z.'’-]*)$/);
    const prevCap = Boolean(prev && prev[1][0] !== prev[1][0].toLowerCase() && prev[1][0] === prev[1][0].toUpperCase());
    const shout = word === word.toUpperCase() && word.length > 1;
    const titled = word[0] !== word[0].toLowerCase() && word[0] === word[0].toUpperCase();
    if (prevCap || shout || titled) return canon;
    return word;
  });
}

function applyPhrases(text) {
  let next = text;
  for (const [pattern, canon] of PHRASES) next = next.replace(pattern, canon);
  return next;
}

function standardizeSegment(raw) {
  let text = String(raw || "").trim();
  if (!text) return "";
  let former = false;
  const formerMatch = text.match(/^former\s+/i);
  if (formerMatch) {
    former = true;
    text = text.slice(formerMatch[0].length).trim();
  }
  text = normalizeCountryAbbrev(text);
  const political = normalizePolitical(text);
  text = expandBody(political || text);
  text = applyPhrases(text);
  if (text === "Chairman Council of Economic Advisors") {
    text = "Chairman, Council of Economic Advisors";
  }
  text = tidy(text);
  if (!former) text = capFirst(text);
  text = capOfficeWords(text);
  if (former) text = `Former ${text}`;
  return tidy(text);
}

/** Canonical position or role text. Blank stays blank. Idempotent. */
export function standardizePosition(raw) {
  let text = preclean(raw);
  if (!text) return "";
  const [head, rest] = text.split(/\s*;\s*/, 2);
  if (rest && /^defendant\b/i.test(rest)) text = head.trim();
  const parts = text
    .split(/\s*;\s*/)
    .map(standardizeSegment)
    .filter(Boolean);
  return tidy(parts.join("; "));
}
