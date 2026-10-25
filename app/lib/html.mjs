import {
  categoryById,
  categoryByPath,
  formatDate,
  formatPosted,
  formatUsd,
  postedAtValue,
  DEATH_UNCONFIRMED_ID,
  isDeathCategory,
  isDeathFamily,
  isDisplayedEventKind,
  isGroupOpsCategory,
  isIndictmentCategory,
  GROUP_OPS_KEEP_IDS,
  isIndictmentKeepKind,
} from "./categories.mjs";
import { normalizeOperationTags, operationPortraitFrom, operationTagLabel } from "./operation.mjs";
import { storedAgeAtEvent } from "./age.mjs";
import {
  EVENT_ATTR_FIELDS,
  EVENT_ATTR_LABELS,
  EVENT_MEDIA_DISPLAY_MAX,
  displayEventMedia,
  eventHeadcount,
  normalizeEventMedia,
  originText,
} from "./event-attrs.mjs";
import { coronaStatusLabel } from "./corona-status.mjs";
import { careerLine, visibleCareer } from "./career.mjs";
import { standardizePosition } from "./position-format.mjs";
import {
  clearanceMetaLabel,
  clearanceStatusLabel,
  normalizeClearances,
} from "./clearances.mjs";
import { isTrumpNickname, nicknameCatalogDate, normalizeNicknames, trumpNicknameLabel } from "./nicknames.mjs";
import { asEventDate, notableEvents, personEvents } from "./promote.mjs";
import { renderEventGraph } from "./event-graph.mjs";
import { hostOf, isUnofficialOrCommentarySocial } from "./official.mjs";
import { canonicalPublicUrl } from "./urls.mjs";
import {
  PAGE_SIZE,
  PAGE_SIZES,
  PAGE_SIZE_STORAGE_KEY,
  pageHref,
  pageWindow,
} from "./paginate.mjs";
import {
  thumbHrefFor,
  goldMediaHref,
  DETAIL_PORTRAIT_CSS_H,
  DETAIL_PORTRAIT_CSS_W,
  LIST_THUMB_CSS_H,
  LIST_THUMB_CSS_W,
  LIST_THUMB_PX_W,
  LIST_THUMB_2X_W,
  PORTRAIT_CACHE,
  isCommsMediaHref,
} from "./thumb.mjs";
import {
  CENTRAL_CASTING_KEYMAP,
  BOOT_COMMS_PATH,
  BOOT_COMMS_KEYMAP,
  CENTRAL_CASTING_PATH,
  centralCastingStoredQuote,
  commsKind,
  commsKindByPath,
  isCommsKind,
  KIND_COMMS,
  KIND_COMM_IDS,
  linkedPersonIds,
  mediaSpec,} from "./kind-comms.mjs";
import { isPeopleMediaHref } from "./portrait.mjs";
import { normalizeScreenshotHref } from "./screenshot.mjs";
import { findPostMediaBox } from "./post-shot.mjs";
import {
  localMediaFile,
  localMediaFileReady,
  localMediaRecord,
  mediaHrefPath,
} from "./media-file.mjs";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
} from "./themes.mjs";
import {
  MENU_ATTRIBUTE_TAGS,
  attributeTagHref,
  EPSTEIN_CLIENTS_CATEGORY,
  IDENTITY_TAGS,
  attributeTagById,
  catalogMainPath,
  filterPath,
  indictmentUnsealedSelectOptions,
  isTagCiteUrl,
  normalizeTags,
  personTags,
  tagDescription,
} from "./tags.mjs";
import {
  VOTE_FACT_KINDS,
  VOTE_NO_KINDS,
  VOTE_ROLLS,
  normalizeRollCall,
  officialRollPageUrl,
  voteRollTitle,
  voteStageLabel,
} from "./vote-rolls.mjs";
import { AGE_BANDS, parseAgeBand } from "./age.mjs";
import {
  DASH_AGE,
  DASH_DIMENSIONS,
  DASH_MISSING,
  DASH_MISSING_FIELDS,
  DASH_RANGE_PRESETS,
  DASH_RANGE_STORAGE_KEY,
  dashRangeHref,
  parseMissingField,
  resolveDashRange,
  serializeDashRange,
} from "./dashboard.mjs";
import {
  GROKIPEDIA_PATH,
  fillEmptyFromGrokipedia,
  grokipediaCite,
} from "./grokipedia.mjs";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "app", "public");
const PKG_VERSION = JSON.parse(readFileSync(path.join(ROOT_DIR, "package.json"), "utf8")).version;
/** Content hash so immutable Cache-Control busts when CSS/JS bytes change. */
export const ASSET_VERSION = `${PKG_VERSION}-${createHash("sha1")
  .update(readFileSync(path.join(PUBLIC_DIR, "styles.css")))
  .update("\0")
  .update(readFileSync(path.join(PUBLIC_DIR, "app.js")))
  .digest("hex")
  .slice(0, 10)}`;
/** UI-only portrait when a well has no local still. Not written into the catalog. */
export const EMPTY_PORTRAIT_HREF = `/empty-portrait.jpg?v=${createHash("sha1")
  .update(readFileSync(path.join(PUBLIC_DIR, "empty-portrait.jpg")))
  .digest("hex")
  .slice(0, 10)}`;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PIXELS = {
  E: ["11111", "10000", "11110", "10000", "11111"],
  X: ["10001", "01010", "00100", "01010", "10001"],
  I: ["11111", "00100", "00100", "00100", "11111"],
  T: ["11111", "00100", "00100", "00100", "00100"],
  R: ["11110", "10001", "11110", "10100", "10010"],
  A: ["01110", "10001", "11111", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "01111"],
};

export function pixelWordmark(text = "EXITTRACE") {
  const cell = 8;
  const gap = 1;
  const letterGap = 6;
  const rows = 5;
  const cols = 5;
  const letters = String(text).toUpperCase().split("");
  const letterW = cols * cell + (cols - 1) * gap;
  const width = letters.length * letterW + (letters.length - 1) * letterGap;
  const height = rows * cell + (rows - 1) * gap;
  const extra = 4;
  const pad = 3;
  const exitShadow = [];
  const exitInk = [];
  const traceShadow = [];
  const traceInk = [];
  let traceOrigin = null;
  let traceEnd = 0;
  letters.forEach((ch, li) => {
    const glyph = PIXELS[ch];
    if (!glyph) return;
    const ox = li * (letterW + letterGap);
    const part = li < 4 ? "exit" : "trace";
    if (part === "trace") {
      if (traceOrigin == null) traceOrigin = ox;
      traceEnd = ox + letterW;
    }
    glyph.forEach((line, y) => {
      [...line].forEach((bit, x) => {
        if (bit !== "1") return;
        const px = ox + x * (cell + gap);
        const py = y * (cell + gap);
        if (part === "exit") {
          exitShadow.push(
            `<rect class="wm-exit-shadow" x="${px + extra}" y="${py + extra}" width="${cell}" height="${cell}" fill="var(--brick)"/>`,
          );
          exitInk.push(
            `<rect class="wm-exit-ink" x="${px}" y="${py}" width="${cell}" height="${cell}" fill="var(--label)"/>`,
          );
        } else {
          traceShadow.push(
            `<rect class="wm-trace-shadow wm-callsign-shadow" x="${px + extra}" y="${py + extra}" width="${cell}" height="${cell}" fill="var(--label)"/>`,
          );
          traceInk.push(
            `<rect class="wm-trace-ink wm-callsign-ink" x="${px}" y="${py}" width="${cell}" height="${cell}" fill="var(--brick)"/>`,
          );
        }
      });
    });
  });
  const plate =
    traceOrigin == null
      ? ""
      : `<rect class="wm-trace-plate" x="${traceOrigin - pad}" y="${-pad}" width="${
          traceEnd - traceOrigin + pad * 2
        }" height="${height + pad * 2}" fill="var(--label)"/>`;
  const vbX = -pad;
  const vbY = -pad;
  const vbW = width + extra + pad;
  const vbH = height + extra + pad;
  return `<svg class="pixel-wordmark" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}" role="img" aria-label="ExitTrace" xmlns="http://www.w3.org/2000/svg"><g class="wm-exit">${exitShadow.join("")}${exitInk.join("")}</g><g class="wm-trace wm-callsign">${plate}${traceShadow.join("")}${traceInk.join("")}</g></svg>`;
}

function keymapItems(activePath) {
  const keys = [
    { key: "f", href: "/firings" },
    { key: "r", href: "/resignations" },
    { key: "g", href: "/government" },
    { key: "a", href: "/arrests" },
    { key: "i", href: "/indictments" },
    { key: "d", href: "/deaths" },
    { key: "m", href: "/group-operations" },
    { key: "b", href: "/dashboard", label: "Dashboard" },
    { key: "u", href: "/unsorted" },
    { key: "w", href: "/downloads", label: "Downloads" },
  ].map((item) => ({
    ...item,
    label: item.label || categoryByPath(item.href)?.nav || item.href,
  }));
  if (activePath !== "/") keys.push({ key: "h", href: "/", label: "Home" });
  return keys;
}

/**
 * Comms section of the keymap menu (same section pattern as Tags).
 * Order: KIND_COMMS clip catalogs (Dog, Red Folder, Eagle, Ronald, Shot), then
 * Boot (person), Corona, then Central Casting. Shortcut keys are unchanged.
 */
export function keymapCommsItems() {
  return [
    ...KIND_COMM_IDS.map((id) => {
      const spec = KIND_COMMS[id];
      return { key: spec.keymapKey, href: spec.path, label: spec.navLabel };
    }),
    { key: BOOT_COMMS_KEYMAP, href: BOOT_COMMS_PATH, label: "Boot" },
    { key: "o", href: "/corona-comms", label: categoryByPath("/corona-comms")?.nav || "Corona" },
    { key: CENTRAL_CASTING_KEYMAP, href: CENTRAL_CASTING_PATH, label: "Central Casting" },
  ];
}

export function themeSwitcher() {
  return "";
}

function themeBootScript() {
  return `<script>
(function(){try{var key=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(key);if(t!==${JSON.stringify(DEFAULT_THEME)}){localStorage.removeItem(key);localStorage.setItem(key,${JSON.stringify(DEFAULT_THEME)});}document.documentElement.setAttribute("data-theme",${JSON.stringify(DEFAULT_THEME)});}catch(e){try{document.documentElement.setAttribute("data-theme",${JSON.stringify(DEFAULT_THEME)});}catch(e2){}}})();
</script>`;
}

function pageSizeBootScript() {
  return `<script>
(function(){try{var key=${JSON.stringify(PAGE_SIZE_STORAGE_KEY)};var allowed=${JSON.stringify(PAGE_SIZES)};var raw=localStorage.getItem(key);var n=Number(raw);var size=allowed.indexOf(n)!==-1?String(n):null;if(size)document.cookie=key+"="+size+"; Path=/; SameSite=Lax";var rendered=document.documentElement.getAttribute("data-page-size");var guard=key+"-sync";if(rendered&&size&&rendered!==size&&sessionStorage.getItem(guard)!==size){sessionStorage.setItem(guard,size);location.replace(location.pathname+location.search+location.hash);}}catch(e){}})();
</script>`;
}

function dashRangeBootScript() {
  return `<script>
(function(){try{var key=${JSON.stringify(DASH_RANGE_STORAGE_KEY)};var path=location.pathname||"";if(path!=="/dashboard"&&path.indexOf("/dashboard/")!==0)return;var params=new URLSearchParams(location.search);var q=params.get("range");if(q){var token=q==="custom"?("custom:"+(params.get("from")||"")+":"+(params.get("to")||"")):q;localStorage.setItem(key,token);document.cookie=key+"="+encodeURIComponent(token)+"; Path=/; SameSite=Lax";return;}var raw=localStorage.getItem(key);if(!raw)return;document.cookie=key+"="+encodeURIComponent(raw)+"; Path=/; SameSite=Lax";var rendered=document.documentElement.getAttribute("data-dash-range");var guard=key+"-sync";if(rendered&&raw&&rendered!==raw&&sessionStorage.getItem(guard)!==raw){sessionStorage.setItem(guard,raw);location.replace(location.pathname+location.search+location.hash);}}catch(e){}})();
</script>`;
}

/** Result-list display. List is the standing row. Cards restyle the same rows. */
export const RESULTS_VIEW_STORAGE_KEY = "exittrace-results-view";
export const CARD_SIZE_STORAGE_KEY = "exittrace-card-size";
export const RESULTS_VIEWS = ["list", "cards"];
export const CARD_SIZES = ["s", "m", "l"];
export const DEFAULT_RESULTS_VIEW = "list";
export const DEFAULT_CARD_SIZE = "m";

const CARD_SIZE_LABELS = { s: "Small", m: "Medium", l: "Large" };

const UI_ICONS = {
  list: `<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>`,
  cards: `<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>`,
  "card-s": `<rect x="8.5" y="10" width="7" height="10" rx="1"/>`,
  "card-m": `<rect x="6" y="6.5" width="12" height="13.5" rx="1"/>`,
  "card-l": `<rect x="3.5" y="3" width="17" height="17" rx="1.25"/>`,
  prev: `<path d="M14.5 5.5 8 12l6.5 6.5"/>`,
  next: `<path d="M9.5 5.5 16 12l-6.5 6.5"/>`,
  rows: `<path d="M4 7h16M4 12h16M4 17h16"/>`,
};

function uiIcon(name) {
  const body = UI_ICONS[name];
  if (!body) return "";
  const solid = String(name).startsWith("card-") ? " ui-icon-solid" : "";
  return `<svg class="ui-icon${solid}" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${body}</svg>`;
}

function resultsViewBootScript() {
  return `<script>
(function(){try{var viewKey=${JSON.stringify(RESULTS_VIEW_STORAGE_KEY)};var sizeKey=${JSON.stringify(CARD_SIZE_STORAGE_KEY)};var views=${JSON.stringify(RESULTS_VIEWS)};var sizes=${JSON.stringify(CARD_SIZES)};var view=localStorage.getItem(viewKey);var size=localStorage.getItem(sizeKey);if(views.indexOf(view)===-1)view=${JSON.stringify(DEFAULT_RESULTS_VIEW)};if(sizes.indexOf(size)===-1)size=${JSON.stringify(DEFAULT_CARD_SIZE)};document.documentElement.setAttribute("data-results-view",view);document.documentElement.setAttribute("data-card-size",size);}catch(e){try{document.documentElement.setAttribute("data-results-view",${JSON.stringify(DEFAULT_RESULTS_VIEW)});document.documentElement.setAttribute("data-card-size",${JSON.stringify(DEFAULT_CARD_SIZE)});}catch(e2){}}})();
</script>`;
}

/** Shared list ↔ cards control. Card size is in the markup and shown only in card view. */
export function resultsViewControl({ pagerHtml = "" } = {}) {
  const viewBtns = RESULTS_VIEWS.map((id) => {
    const on = id === DEFAULT_RESULTS_VIEW;
    const label = id === "cards" ? "Cards" : "List";
    return `<button type="button" class="results-view-btn keychip" data-results-view-set="${id}" aria-pressed="${
      on ? "true" : "false"
    }">${uiIcon(id === "cards" ? "cards" : "list")}<span>${label}</span></button>`;
  }).join("");
  const sizeBtns = CARD_SIZES.map((id) => {
    const on = id === DEFAULT_CARD_SIZE;
    const label = CARD_SIZE_LABELS[id];
    return `<button type="button" class="card-size-btn keychip" data-card-size-set="${id}" aria-pressed="${
      on ? "true" : "false"
    }" aria-label="${label}">${uiIcon(`card-${id}`)}</button>`;
  }).join("");
  const pagingRow = pagerHtml
    ? `<div class="results-controls-row results-controls-row--page">${pagerHtml}</div>`
    : "";
  return `<div class="results-controls results-view" data-results-toolbar>
    <div class="results-controls-row results-controls-row--view">
      <div class="results-view-mode">
        <span class="results-view-label" id="results-view-label">View</span>
        <div class="results-view-btns" role="group" aria-labelledby="results-view-label">${viewBtns}</div>
      </div>
      <div class="card-size">
        <span class="card-size-label" id="card-size-label">Card size</span>
        <div class="card-size-btns" role="group" aria-labelledby="card-size-label">${sizeBtns}</div>
      </div>
    </div>
    ${pagingRow}
  </div>`;
}

export function pageSizeSelector(activeSize = PAGE_SIZE) {
  const current = PAGE_SIZES.includes(Number(activeSize)) ? Number(activeSize) : PAGE_SIZE;
  const options = PAGE_SIZES.map((n) => {
    const on = n === current;
    return `<option value="${n}"${on ? " selected" : ""}>${n}</option>`;
  }).join("");
  return `<nav class="page-size" aria-label="Rows per page">
    <span class="page-size-label" id="page-size-label">${uiIcon("rows")}<span class="page-size-label-short">Rows</span><span class="page-size-label-full">Rows per page</span><span class="vh">Rows</span></span>
    <label class="page-size-select-wrap">
      <span class="vh">Rows per page</span>
      <select class="page-size-select" data-page-size-select aria-label="${current} rows per page">${options}</select>
    </label>
    <div class="page-size-btns" role="group" aria-labelledby="page-size-label">
      ${PAGE_SIZES.map((n) => {
        const on = n === current;
        return `<button type="button" class="page-size-btn keychip" data-page-size-set="${n}" aria-pressed="${
          on ? "true" : "false"
        }" aria-label="${n} per page">${n}</button>`;
      }).join("")}
    </div>
  </nav>`;
}

export function identityFilterNav(basePath, { tags = [], unsealed = false } = {}) {
  const main = catalogMainPath(basePath);
  const selected = normalizeTags(tags);
  const locked = main === "/government" ? ["official"] : [];
  const allHref = filterPath(main, { tags: locked });
  const options = [{ href: allHref, label: "All" }];
  if (main === "/group-operations") {
    for (const kind of GROUP_OPS_KEEP_IDS) {
      const child = categoryById(kind);
      if (!child) continue;
      options.push({
        href: filterPath(child.path, { tags: [] }),
        label: child.nav,
      });
    }
  }
  if (main !== "/group-operations") {
    for (const tag of IDENTITY_TAGS) {
      if (locked.includes(tag.id)) continue;
      const href = filterPath(main, { tags: [...new Set([...locked, tag.id])] });
      options.push({ href, label: tag.nav });
    }
  }
  if (main === "/indictments") {
    const after = options.findIndex((o) => o.label === "Non-civilians");
    options.splice(after < 0 ? options.length : after + 1, 0, ...indictmentUnsealedSelectOptions());
  }
  if (main === "/deaths") {
    const unconfirmed = categoryById(DEATH_UNCONFIRMED_ID);
    if (unconfirmed) options.push({ href: unconfirmed.path, label: unconfirmed.nav });
  }
  const currentHref = filterPath(basePath, {
    tags: selected,
    unsealed: main === "/indictments" && unsealed === true,
  });
  const current = options.find((o) => o.href === currentHref) || options[0];
  const opts = options
    .map((o) => {
      const on = o.href === current.href;
      return `<option value="${esc(o.href)}"${on ? " selected" : ""}>${esc(o.label)}</option>`;
    })
    .join("");
  return `<nav class="identity-filters" aria-label="Identity filters">
    <label class="identity-filters-label" for="identity-filter">Filters</label>
    <select class="identity-filter-select" id="identity-filter" data-filter-select>${opts}</select>
  </nav>`;
}

/** One keymap menu chip. Keyed chips show [k] and carry data-key for shortcuts. */
function keymapChip(item, activePath, { cls = "keychip", order = null } = {}) {
  const on = item.href === activePath;
  const key = item.key ? ` data-key="${esc(item.key)}"` : "";
  const style = order == null ? "" : ` style="--key-order:${order}"`;
  const cap = item.key ? `<span class="br">[</span>${esc(item.key)}<span class="br">]</span> ` : "";
  const title = item.title ? ` title="${esc(item.title)}"` : "";
  return `<a class="${cls}" href="${esc(item.href)}"${key}${style}${on ? ' aria-current="page"' : ""}${title}>${cap}${esc(item.label)}</a>`;
}

/** Shared keymap section (heading + grouped chips). Used by Comms and Tags; desktop and mobile share it. */
function keymapSection({ id, title, ariaLabel, chipClass, items }, activePath) {
  const chips = items.map((item) => keymapChip(item, activePath, { cls: `keychip ${chipClass}` })).join("");
  return `<nav class="keymap-group keymap-${id}" aria-label="${esc(ariaLabel)}"><p class="keymap-section">${esc(title)}</p>${chips}</nav>`;
}

function keymapCommsSection(activePath) {
  return keymapSection(
    { id: "comms", title: "Comms", ariaLabel: "Comms", chipClass: "keymap-comm", items: keymapCommsItems() },
    activePath,
  );
}

/** Longest Tags-menu label that fits one line in the 13.25rem keymap rail. */
export const TAG_MENU_MAX_LABEL = 18;

/**
 * Display-only short labels for the Tags menu. Tag ids, slugs, `nav`, and the tag
 * pages' own titles are unchanged; the full `nav` name goes in the chip's title.
 */
const TAG_MENU_SHORT_LABELS = Object.freeze({
  big_beautiful_bill_act: "Big Beautiful Bill",
  secure_the_border_act: "Secure the Border",
});

/** One Tags-menu row: the short label when the full name is too long, plus the full name as title. */
export function tagMenuItem(tag) {
  const label = TAG_MENU_SHORT_LABELS[tag.id] || tag.nav;
  return { href: attributeTagHref(tag), label, ...(label === tag.nav ? {} : { title: tag.nav }) };
}

function keymapTagSection(activePath) {
  return keymapSection(
    {
      id: "tags",
      title: "Tags",
      ariaLabel: "Fact tags",
      chipClass: "keymap-tag",
      items: MENU_ATTRIBUTE_TAGS.map(tagMenuItem),
    },
    activePath,
  );
}

/**
 * General description block for a tag page. Text and labels are escaped; a cite URL
 * that is not https on a .gov or official news host is dropped, not linked.
 */
export function tagDescriptionHtml(desc) {
  if (!desc || !String(desc.text || "").trim()) return "";
  const text = [desc.text, desc.votes].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  const links = (desc.cites || [])
    .filter((c) => c && String(c.label || "").trim() && isTagCiteUrl(c.url))
    .map(
      (c) =>
        `<a class="tag-desc-cite" href="${esc(String(c.url).trim())}" target="_blank" rel="noopener noreferrer">${esc(String(c.label).trim())}</a>`,
    );
  const cites = links.length
    ? `<p class="tag-desc-cites"><span class="tag-desc-label">Sources</span> ${links.join(" ")}</p>`
    : "";
  return `<section class="tag-desc" aria-label="About this tag"><p class="tag-desc-text">${esc(text)}</p>${cites}</section>`;
}

/** Description block for a tag id from TAG_DESCRIPTIONS (tags.mjs). Empty when the id has none. */
export function tagDescriptionBlock(id) {
  return tagDescriptionHtml(tagDescription(id));
}

/** Fact-tag index. Same rows as the catalog Tags menu. */
export function tagsIndexBody() {
  const chips = MENU_ATTRIBUTE_TAGS.map(
    (tag) => `<a class="keychip keymap-tag" href="${esc(attributeTagHref(tag))}">${esc(tag.nav)}</a>`,
  ).join("");
  return `<nav class="keymap-group tag-index" aria-label="Fact tags"><p class="keymap-section">Tags</p>${chips}</nav>`;
}

export function keymapFooter(activePath) {
  const chips = keymapItems(activePath)
    .map((k, i) => keymapChip(k, activePath, { order: i }))
    .join("");
  return `<footer class="keymap" aria-label="Catalog">
    <div class="keymap-keys">${chips}</div>
    ${keymapCommsSection(activePath)}
    ${keymapTagSection(activePath)}
    <p class="fineprint">Neutral record. One card per person. Two published news citations on every tagged event. Official news and official government social count; unofficial or commentary social is extra only, not a cite. Wikipedia is not a cite. Grokipedia may appear as an extra encyclopedia cite; it does not replace official news cites. Net-worth figures are published estimates or left blank. Dog-comm, red-folder-comm, and central-casting stills and post text are stored locally. No live X, Wikimedia, or news fetches.</p>
  </footer>`;
}

export function boxFrame(title, inner, { active = false, extraClass = "" } = {}) {
  const t = title ? `<span class="box-title">${title}</span>` : "";
  return `<div class="box-pane${active ? " is-active" : ""}${extraClass ? ` ${extraClass}` : ""}">
    <div class="box-h" aria-hidden="true"><span class="box-c">┌</span>${t}<span class="box-dash"></span><span class="box-c">┐</span></div>
    <div class="box-mid"><span class="box-c box-side" aria-hidden="true">│</span><div class="box-inner">${inner}</div><span class="box-c box-side" aria-hidden="true">│</span></div>
    <div class="box-f" aria-hidden="true"><span class="box-c">└</span><span class="box-dash"></span><span class="box-c">┘</span></div>
  </div>`;
}

export function listHead({ title, total, index = 1, of = 1 }) {
  const n = Math.max(0, Number(total) || 0);
  const ofN = Math.max(n ? 1 : 0, Number(of) || 0);
  const i = ofN ? Math.min(ofN, Math.max(1, Number(index) || 1)) : 0;
  return `<p class="list-head"><span class="dot">•</span> ${esc(title)} <span class="sep">•</span> ${n} available <span class="sep">•</span> <span data-list-pos>${i}/${ofN || 0}</span></p>`;
}

export function tuiCount({ title, total, index = 1, of = 1 }) {
  const n = Math.max(0, Number(total) || 0);
  const ofN = Math.max(n ? 1 : 0, Number(of) || 0);
  const i = ofN ? Math.min(ofN, Math.max(1, Number(index) || 1)) : 0;
  return `• ${esc(title)} • ${n} available • ${i}/${ofN || 0}`;
}

function chromeWidgets() {
  return `
  <div id="tui-toast" class="tui-toast" hidden role="status" aria-live="polite">
    ${boxFrame("INFO", `<p class="toast-msg"></p>`, { extraClass: "toast-box" })}
  </div>
  <div id="tui-modal" class="tui-modal" hidden>
    <div class="tui-modal-scrim" data-close-modal></div>
    <div class="tui-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      ${boxFrame(
        `<span id="modal-title">Preview</span>`,
        `<div id="modal-body"></div>
        <hr class="hr">
        <div class="modal-keys">
          <button type="button" class="keychip" id="modal-ok"><span class="br">[</span>Enter<span class="br">]</span> Open</button>
          <button type="button" class="keychip" id="modal-cancel" data-close-modal><span class="br">[</span>Esc<span class="br">]</span> Back</button>
        </div>`,
        { active: true, extraClass: "modal-box" },
      )}
    </div>
  </div>
  <div id="tui-lightbox" class="tui-lightbox" hidden>
    <div class="tui-lightbox-scrim" data-close-lightbox></div>
    <figure class="tui-lightbox-frame" role="dialog" aria-modal="true" aria-labelledby="lightbox-title">
      <img id="lightbox-img" alt="">
      <video id="lightbox-video" controls playsinline hidden></video>
      <figcaption id="lightbox-title" class="credit"></figcaption>
      <button type="button" class="keychip" data-close-lightbox><span class="br">[</span>Esc<span class="br">]</span> Back</button>
    </figure>
  </div>`;
}

function categoryTrail(cat) {
  if (!cat || cat.id === "notable" || !cat.path) return [];
  if (isDeathFamily(cat.id)) {
    if (cat.id === "death_unspecified") {
      return [{ href: "/deaths", label: "Deaths" }];
    }
    return [
      { href: "/deaths", label: "Deaths" },
      { href: cat.path, label: cat.nav },
    ];
  }
  if (isIndictmentCategory(cat.id)) {
    if (cat.id === "indictment_unspecified") {
      return [{ href: "/indictments", label: "Indictments" }];
    }
    return [
      { href: "/indictments", label: "Indictments" },
      { href: cat.path, label: cat.nav },
    ];
  }
  if (isGroupOpsCategory(cat.id)) {
    if (cat.id === "group_ops_unspecified") {
      return [{ href: "/group-operations", label: "Operations" }];
    }
    return [
      { href: "/group-operations", label: "Operations" },
      { href: cat.path, label: cat.nav },
    ];
  }
  return [{ href: cat.path, label: cat.nav }];
}

/** Clickable trail: Home / Deaths / Celebrities / Name */
export function breadcrumbItems({
  path,
  label,
  categoryId,
  mode,
} = {}) {
  const items = [{ href: "/", label: "Home" }];
  const p = String(path || "/").split("?")[0] || "/";
  if (p === "/") return items;

  if (p.startsWith("/people/")) {
    const fact = attributeTagById(categoryId);
    if (categoryId === EPSTEIN_CLIENTS_CATEGORY && fact && !categoryById(categoryId)) {
      items.push({ href: fact.path, label: fact.nav });
      items.push({ href: p, label: label || "Person" });
      return items;
    }
    const cat = categoryById(categoryId);
    if (cat?.id === "notable") {
      items.push({ href: p, label: label || "Person" });
      return items;
    }
    const trail = categoryTrail(cat);
    items.push(...(trail.length ? trail : [{ href: "/firings", label: "Catalog" }]));
    items.push({ href: p, label: label || "Person" });
    return items;
  }
  if (p.startsWith("/posts/")) {
    items.push({ href: "/unsorted", label: "Unsorted" });
    items.push({ href: p, label: label || "Source post" });
    return items;
  }
  const comms = commsKindByPath(p);
  if (comms && p !== comms.path) {
    items.push({ href: comms.path, label: comms.label });
    items.push({ href: p, label: label || "Snapshot" });
    return items;
  }
  if (p.startsWith("/operations/") && p !== "/operations") {
    const trail = categoryTrail(categoryById(categoryId) || categoryById("group_ops_unspecified"));
    items.push(...(trail.length ? trail : [{ href: "/group-operations", label: "Operations" }]));
    items.push({ href: p, label: label || "Operation" });
    return items;
  }

  const cat = categoryByPath(p);
  if (cat) {
    items.push(...categoryTrail(cat));
    return items;
  }

  if (p === "/search") {
    items.push({ href: "/search", label: "Search" });
    if (label && label !== "Search") items.push({ href: p, label });
    return items;
  }
  if (p === "/add") {
    items.push({ href: "/add", label: "Add" });
    if (mode === "dog") items.push({ href: "/add?mode=dog", label: "Dog comms" });
    else if (mode === "operation") items.push({ href: "/add?mode=operation", label: "Operation" });
    else if (String(label || "").toLowerCase() === "queued") {
      items.push({ href: p, label: "Queued" });
    }
    return items;
  }
  if (p === "/downloads") {
    items.push({ href: "/downloads", label: "Downloads" });
    return items;
  }
  if (p === "/health") {
    items.push({ href: "/health", label: "Health" });
    return items;
  }
  if (p === "/dashboard" || p.startsWith("/dashboard/")) {
    items.push({ href: "/dashboard", label: "Dashboard" });
    const dim = DASH_DIMENSIONS.find((d) => d.path === p);
    if (dim) items.push({ href: dim.path, label: dim.nav });
    else if (p === DASH_AGE.path) items.push({ href: DASH_AGE.path, label: DASH_AGE.nav });
    else if (p === DASH_MISSING.path) items.push({ href: DASH_MISSING.path, label: DASH_MISSING.nav });
    return items;
  }
  if (p === GROKIPEDIA_PATH || p.startsWith(`${GROKIPEDIA_PATH}/`)) {
    items.push({ href: "/search", label: "Search" });
    return items;
  }
  items.push({ href: p, label: label || p.replace(/^\//, "") });
  return items;
}

export function breadcrumbNav(items) {
  const last = items.length - 1;
  return `<nav class="tui-q crumbs" aria-label="Breadcrumb">
    <span class="chev" aria-hidden="true">❯</span>
    <ol>
      ${items
        .map((item, i) => {
          const current = i === last;
          if (current) {
            return `<li><span class="crumb-current" aria-current="page">${esc(item.label)}</span></li>`;
          }
          return `<li><a href="${esc(item.href)}">${esc(item.label)}</a></li>`;
        })
        .join("")}
    </ol>
  </nav>`;
}

function topBar({ query, countLabel, path, crumbLabel, categoryId, mode, heading }) {
  const items = breadcrumbItems({
    path,
    label: crumbLabel || heading || query,
    categoryId,
    mode,
  });
  return `<header class="tui-top">
    ${breadcrumbNav(items)}
    <div class="tui-app"><a class="tui-app-link" href="/">exittrace.areveur.com</a></div>
    <div class="tui-n">${countLabel || ""}</div>
  </header>`;
}

export function layout({
  title,
  path,
  heading,
  intro,
  lede,
  body,
  mode,
  query,
  countLabel,
  pageSize,
  categoryId,
  crumbLabel,
  dashRange,
}) {
  const home = mode === "home";
  const sizeAttr =
    pageSize != null && PAGE_SIZES.includes(Number(pageSize))
      ? ` data-page-size="${Number(pageSize)}"`
      : "";
  const rangeToken = dashRange ? serializeDashRange(resolveDashRange(dashRange)) : "";
  const rangeAttr = rangeToken ? ` data-dash-range="${esc(rangeToken)}"` : "";
  return `<!doctype html>
<html lang="en" data-theme="${DEFAULT_THEME}"${sizeAttr}${rangeAttr}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · ExitTrace</title>
  ${themeBootScript()}
  ${pageSizeBootScript()}
  ${dashRangeBootScript()}
  ${resultsViewBootScript()}
  <link rel="stylesheet" href="/styles.css?v=${esc(ASSET_VERSION)}">
</head>
<body class="tui hud${home ? " tui-home" : ""}" data-toast="${home ? "home loaded" : "page loaded"}">
  ${topBar({
    query: query || heading || "home",
    countLabel,
    path,
    crumbLabel,
    categoryId,
    mode,
    heading,
  })}
  <div class="hud-stage">
    <main class="${home ? "home-stage" : "tui-main"}">
      ${home ? "" : `<h1 class="vh">${esc(heading || title)}</h1>`}
      ${!home && intro ? intro : ""}
      ${!home && lede ? `<p class="lede">${lede}</p>` : ""}
      ${body}
    </main>
    ${keymapFooter(path)}
  </div>
  ${chromeWidgets()}
  <script src="/app.js?v=${esc(ASSET_VERSION)}" defer></script>
</body>
</html>`;
}

function portraitSrc(href) {
  return `${href}?p=${PORTRAIT_CACHE}`;
}

/**
 * Same `?p=` bust as portraitSrc. Only a bare local /media path is versioned.
 * Remote http(s), data:, and hrefs that already have a query or hash stay as given,
 * so a second pass cannot emit `?p=7?p=7`.
 */
export function versionedMediaHref(href) {
  const text = String(href || "").trim();
  if (!text || text !== mediaHrefPath(text)) return text;
  return portraitSrc(text);
}

function portraitFallbackAttr() {
  return ` data-portrait-fallback="${esc(EMPTY_PORTRAIT_HREF)}"`;
}

/** Shared portrait well when src is empty or not a local still. One asset, every surface. */
function emptyPortraitImg({ size = "list", kind = "portrait", label = "" } = {}) {
  const detail = size === "detail";
  const cls = detail
    ? "detail-photo portrait empty-portrait"
    : `${kind} thumb empty-portrait`;
  const w = detail ? DETAIL_PORTRAIT_CSS_W : LIST_THUMB_CSS_W;
  const h = detail ? DETAIL_PORTRAIT_CSS_H : LIST_THUMB_CSS_H;
  const loading = detail ? "" : ` loading="lazy"`;
  return `<img class="${cls}" src="${esc(EMPTY_PORTRAIT_HREF)}" alt="${esc(label)}" width="${w}" height="${h}"${loading} decoding="async"${portraitFallbackAttr()}>`;
}

/** Wider than the 160w list thumb, so card view selects an uncropped file. */
const FIT_ORIGINAL_W = 960;

function listSrcset(src, ext) {
  const candidates = [
    [thumbHrefFor(src, { variant: "", ext }), LIST_THUMB_PX_W],
    [thumbHrefFor(src, { variant: ".2x", ext }), LIST_THUMB_2X_W],
  ];
  // .card / .card2x are 10:13 cover crops. Card view must not select them.
  if (ext === "webp") {
    const hero = thumbHrefFor(src, { variant: ".hero", ext: "webp" });
    if (hero) candidates.push([hero, FIT_ORIGINAL_W]);
  } else {
    const gold = goldMediaHref(src);
    if (gold) candidates.push([gold, FIT_ORIGINAL_W]);
  }
  return candidates
    .filter(([href]) => href)
    .map(([href, width]) => `${portraitSrc(href)} ${width}w`)
    .join(", ");
}

function listPortraitPicture(src, label, kind = "portrait") {
  const jpg = thumbHrefFor(src, { variant: "", ext: "jpg" });
  if (!jpg) return emptyPortraitImg({ size: "list", kind, label });
  const srcsetJpg = listSrcset(src, "jpg");
  const srcsetWebp = listSrcset(src, "webp");
  const source = srcsetWebp
    ? `<source type="image/webp" srcset="${esc(srcsetWebp)}" sizes="${LIST_THUMB_CSS_W}px">\n    `
    : "";
  return `<picture class="thumb-src" data-result-thumb>
    ${source}<img class="${kind} thumb" src="${esc(portraitSrc(jpg))}" srcset="${esc(srcsetJpg)}" sizes="${LIST_THUMB_CSS_W}px" alt="${esc(label)}" width="${LIST_THUMB_CSS_W}" height="${LIST_THUMB_CSS_H}" loading="lazy" decoding="async"${portraitFallbackAttr()}>
  </picture>`;
}

function peopleDetailPortrait(src, label) {
  const gold = goldMediaHref(src);
  if (!gold) return emptyPortraitImg({ size: "detail", label });
  const webpGold = gold.toLowerCase().endsWith(".webp");
  const webpHref = webpGold ? gold : thumbHrefFor(src, { variant: ".hero", ext: "webp" });
  const jpegHref = webpGold ? thumbHrefFor(src, { variant: ".hero", ext: "jpg" }) : gold;
  return `<picture class="detail-portrait">
    <source type="image/webp" srcset="${esc(portraitSrc(webpHref))}">
    <img class="detail-photo portrait" src="${esc(portraitSrc(jpegHref))}" alt="${esc(label)}" width="${DETAIL_PORTRAIT_CSS_W}" height="${DETAIL_PORTRAIT_CSS_H}" decoding="async"${portraitFallbackAttr()}>
  </picture>`;
}

/** List: small CSS + denser srcset + lazy. Detail: gold /media still, never the list thumb. */
function localPortraitImg(src, label, { size = "list", kind = "portrait" } = {}) {
  if (size === "detail") return peopleDetailPortrait(src, label);
  return listPortraitPicture(src, label, kind);
}

export function localMediaThumb(src, label, kind = "portrait") {
  return localPortraitImg(src, label, { size: "list", kind });
}

/** Local mp4 on this comm. Remote URLs and other catalogs stay out. */
function localCommVideoHref(row, mediaDir) {
  const href = String(row?.snapshot?.video || "").trim().split("?")[0];
  if (!href || !/\.mp4$/i.test(href) || !isCommsMediaHref(href, mediaDir)) return "";
  return href;
}

function commVideoInner(src, poster, label) {
  const href = versionedMediaHref(src);
  const posterHref = versionedMediaHref(poster);
  const posterAttr = posterHref ? ` poster="${esc(posterHref)}"` : "";
  return `<span class="detail-video"><video class="detail-photo" src="${esc(href)}"${posterAttr} preload="metadata" muted playsinline tabindex="-1" aria-label="${esc(label)}"></video><span class="detail-video-play" aria-hidden="true"></span></span>`;
}

/** Lightbox opens the gold /media still (or screenshot), never the 80×104 list thumb. */
function lightboxButton(src, inner, { alt = "", credit = "", kind = "image", poster = "" } = {}) {
  const href = versionedMediaHref(src);
  const body = String(inner || "");
  const video = kind === "video";
  if (!href || !body) return body;
  if (!video && !body.includes("<img")) return body;
  const kindAttr = video ? ` data-lightbox-kind="video"` : "";
  const posterHref = versionedMediaHref(poster);
  const posterAttr = video && posterHref ? ` data-lightbox-poster="${esc(posterHref)}"` : "";
  return `<button type="button" class="lightbox-open" data-lightbox="${esc(href)}" data-lightbox-alt="${esc(alt)}" data-lightbox-credit="${esc(credit)}"${kindAttr}${posterAttr}>${body}</button>`;
}

/** Strip http(s) URLs from captions — X URL belongs only under Source. */
function creditWithoutUrls(raw) {
  return String(raw || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s*[·|,;]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Supporting X posts stored on snapshot.supporting (never invents). */
export function kindSupportingEntries(row) {
  const raw = row?.snapshot?.supporting;
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const sourceUrl = String(item.source_url || "").trim();
    if (!sourceUrl || seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    out.push({
      index,
      source_url: sourceUrl,
      handle: String(item.handle || "").trim(),
      account_name: String(item.account_name || "").trim(),
      text: String(item.text || "").trim(),
      posted_at: String(item.posted_at || "").trim(),
      still: String(item.still || "").trim(),
      still_credit: String(item.still_credit || "").trim(),
      stills: Array.isArray(item.stills)
        ? item.stills.map((s) => String(s || "").trim()).filter(Boolean)
        : [],
      screenshot: normalizeScreenshotHref(item.screenshot),
      screenshot_credit: String(item.screenshot_credit || "").trim(),
    });
  });
  return out;
}

/** Local media hrefs nested under supporting entries (skip primary). */
export function kindSupportingStills(kind, row) {
  const spec = mediaSpec(kind);
  const primary = String(row?.still || "").trim();
  const seen = new Set(primary ? [primary] : []);
  const out = [];
  for (const entry of kindSupportingEntries(row)) {
    const hrefs = [entry.still, ...(entry.stills || [])];
    for (const href of hrefs) {
      if (!href || seen.has(href) || !isCommsMediaHref(href, spec.mediaDir)) continue;
      seen.add(href);
      out.push(href);
    }
  }
  return out;
}

/** Extra local stills: snapshot.stills + optional supporting stills (skip primary). */
export function kindExtraStills(kind, row, { includeSupporting = true } = {}) {
  const spec = mediaSpec(kind);
  const primary = String(row?.still || "").trim();
  const raw = row?.snapshot?.stills;
  const out = [];
  const seen = new Set(primary ? [primary] : []);
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const href = String(item || "").trim();
      if (!href || seen.has(href) || !isCommsMediaHref(href, spec.mediaDir)) continue;
      seen.add(href);
      out.push(href);
    }
  }
  if (includeSupporting) {
    for (const href of kindSupportingStills(kind, row)) {
      if (!href || seen.has(href)) continue;
      seen.add(href);
      out.push(href);
    }
  }
  return out;
}

/** Extra local stills from dog snapshot.stills (skip primary still). */
export function dogExtraStills(row) {
  return kindExtraStills("dog", row);
}

/** Primary Source line plus optional supporting X links (same tile; no wipe of gold). */
export function kindSourceHtml(row, { includeSupporting = true } = {}) {
  const lines = [detailSourceLine(row?.source_url)];
  if (includeSupporting) {
    for (const entry of kindSupportingEntries(row)) {
      const label = entry.handle
        ? `Supporting · ${entry.handle}`
        : "Supporting";
      lines.push(detailSourceLine(entry.source_url, { label }));
    }
  }
  return lines.filter(Boolean).join("");
}

/** That supporting entry's still / stills only (skip primary; fail-closed local media). */
export function kindEntryStills(kind, row, entry) {
  const spec = mediaSpec(kind);
  const primary = String(row?.still || "").trim();
  const seen = new Set(primary ? [primary] : []);
  const out = [];
  for (const href of [entry?.still, ...(entry?.stills || [])]) {
    const text = String(href || "").trim();
    if (!text || seen.has(text) || !isCommsMediaHref(text, spec.mediaDir)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/** Screenshot + stills options for one supporting entry (stored, normalized hrefs only). */
function supportingEntryMedia(kind, row, entry) {
  const handle = entry?.handle || row?.handle || "";
  const shot = kind === "dog" ? normalizeScreenshotHref(entry?.screenshot, "dog-comms") : "";
  const primary = String(entry?.still || "").trim();
  // The screenshot stands for one image or one video. Further attachments stay.
  const extras = kindEntryStills(kind, row, entry)
    .filter((src) => !(shot && src === primary))
    .map((src) => ({
      src,
      alt: `Post media for ${handle}`,
      credit: entry?.still_credit || "",
    }));
  return {
    screenshot: shot || entry?.screenshot,
    screenshotAlt: `X-post screenshot of ${handle}`,
    screenshotCredit: entry?.screenshot_credit,
    extraMedia: extras,
  };
}

/** Screenshot + stills for one supporting entry plus meta (Central Casting mixed group). */
function supportingEntryStrip(kind, row, entry, seen, metaHtml = "") {
  return detailMediaStrip({ ...supportingEntryMedia(kind, row, entry), seen, metaHtml });
}

/** Media tiles only for one supporting entry, tagged with its index for the shared masonry. */
function supportingEntryTiles(kind, row, entry, seen) {
  return detailMediaTiles({
    ...supportingEntryMedia(kind, row, entry),
    seen,
    tileData: { "supporting-index": String(entry?.index ?? "") },
  });
}

/** One frost group: cite-DRY + Source (this URL only) + screenshot/stills masonry.
 *  Central Casting clips still use this mixed group. Official-post pages do not. */
export function kindSupportingGroupHtml(kind, row, entry, seen) {
  return `<section class="supporting-group" data-supporting-index="${esc(String(entry?.index ?? ""))}">
    ${detailShell({
      title: "Supporting",
      mediaHtml: supportingEntryStrip(
        kind,
        row,
        entry,
        seen,
        detailMetaBlock({
          citeHtml: citeFromRow({
            handle: entry?.handle,
            account_name: entry?.account_name,
            posted_at: entry?.posted_at,
            text: entry?.text,
          }),
          sourceHtml: detailSourceLine(entry?.source_url),
        }),
      ),
      active: true,
      extraClass: "meta-box",
    })}
  </section>`;
}

export function kindSupportingGroupsHtml(kind, row, seen) {
  return kindSupportingEntries(row)
    .map((entry) => kindSupportingGroupHtml(kind, row, entry, seen))
    .join("");
}

function detailMediaTile({
  kind = "still",
  src = "",
  inner = "",
  alt = "",
  credit = "",
  mediaKind = "image",
  poster = "",
  tileData = null,
} = {}) {
  const href = String(src || "").trim();
  const body = lightboxButton(href, inner, { alt, credit, kind: mediaKind, poster });
  if (!body) return "";
  return `<figure class="detail-tile detail-tile--${esc(kind)}"${tileDataAttrs(tileData)}>${body}</figure>`;
}

/** data-* attributes from fixed code keys; every value is escaped and double-quoted. */
function tileDataAttrs(data) {
  if (!data || typeof data !== "object") return "";
  return Object.entries(data)
    .filter(([key, value]) => /^[a-z][a-z-]*$/.test(key) && value != null && String(value) !== "")
    .map(([key, value]) => ` data-${key}="${esc(String(value))}"`)
    .join("");
}

function screenshotTile(src, { alt = "", credit = "", tileData = null } = {}) {
  const href = normalizeScreenshotHref(src);
  if (!href) return "";
  const img = `<img class="detail-photo screenshot" src="${esc(versionedMediaHref(href))}" alt="${esc(alt)}" decoding="async">`;
  return detailMediaTile({
    kind: "screenshot",
    src: href,
    inner: img,
    alt,
    credit: creditWithoutUrls(credit),
    tileData,
  });
}

/** Text/meta tile — never opens the HD lightbox. */
function detailMetaTile(kind, inner) {
  const html = String(inner || "").trim();
  if (!html) return "";
  const mod = kind ? ` detail-tile--${esc(kind)}` : "";
  return `<section class="detail-tile detail-tile--meta${mod}">
    <div class="detail-copy">${html}</div>
  </section>`;
}

function splitJoinedTiles(html) {
  const raw = String(html || "").trim();
  if (!raw) return [];
  const parts = raw.match(/<(?:section|figure) class="detail-tile[\s\S]*?<\/(?:section|figure)>/g);
  return parts && parts.length ? parts : [raw];
}

/** Media then meta, then next media, then next meta — one dense masonry flow. */
function interleaveDetailTiles(mediaTiles, metaTiles) {
  const media = (mediaTiles || []).filter(Boolean);
  const meta = (metaTiles || []).filter(Boolean);
  const out = [];
  const n = Math.max(media.length, meta.length);
  for (let i = 0; i < n; i += 1) {
    if (i < media.length) out.push(media[i]);
    if (i < meta.length) out.push(meta[i]);
  }
  return out;
}

const mediaByteCache = new Map();

/** Sibling `{stem}.poster.jpg` next to a local mp4. Empty when the file is missing. */
export function siblingVideoPosterHref(src) {
  const rel = mediaHrefPath(src);
  if (!rel || !/\.mp4$/i.test(rel)) return "";
  const posterRel = rel.replace(/\.mp4$/i, ".poster.jpg");
  // Defense in depth: mediaHrefPath already rejects ".."; keep an explicit guard.
  if (posterRel === rel || posterRel.includes("..")) return "";
  const file = localMediaFile(posterRel);
  if (!localMediaFileReady(file)) return "";
  return posterRel;
}

/** Prefer an explicit poster; otherwise a sibling .poster.jpg when present on disk. */
export function resolveVideoPosterHref(src, explicit = "") {
  const given = mediaHrefPath(explicit);
  // Defense in depth beside mediaHrefPath / localMediaFile MEDIA_DIR containment.
  if (given && !given.includes("..") && !/\.mp4$/i.test(given)) {
    const file = localMediaFile(given);
    if (localMediaFileReady(file)) return given;
  }
  return siblingVideoPosterHref(src);
}

/** sha256 of a local media file. Empty when the file is missing — that is not a duplicate. */
function mediaByteId(href) {
  const rec = localMediaRecord(href);
  if (!rec) return "";
  const hit = mediaByteCache.get(rec.key);
  if (hit) return hit;
  let id = "";
  try {
    id = hashFileBytes(rec.file);
  } catch {
    return "";
  }
  mediaByteCache.set(rec.key, id);
  return id;
}

/** SHA-256 in fixed chunks so a long video is not one buffer. */
export function hashFileBytes(file) {
  const hash = createHash("sha256");
  const fd = openSync(file, "r");
  const buf = Buffer.alloc(64 * 1024);
  try {
    let n = 0;
    do {
      n = readSync(fd, buf, 0, buf.length, null);
      if (n > 0) hash.update(buf.subarray(0, n));
    } while (n > 0);
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/** One detail page shares this bag so the same bytes are drawn once. */
function detailMediaSeen() {
  return { paths: new Set(), ids: new Set() };
}

/**
 * Record href on the page. True when an earlier tile already used this path
 * or these exact bytes. A missing file is kept (tests and not-yet-copied media).
 */
function claimDetailMedia(seen, href) {
  const bag = seen || detailMediaSeen();
  const mediaPath = mediaHrefPath(href);
  if (!mediaPath) return false;
  if (bag.paths.has(mediaPath)) return true;
  const id = mediaByteId(mediaPath);
  if (id && bag.ids.has(id)) return true;
  bag.paths.add(mediaPath);
  if (id) bag.ids.add(id);
  return false;
}

/** Media tiles (portrait, screenshot, stills) in draw order. Same bytes drawn once per page. */
function detailMediaTiles({
  portraitHtml,
  portraitSrc = "",
  portraitAlt = "",
  portraitCredit = "",
  screenshot = "",
  screenshotAlt = "",
  screenshotCredit = "",
  extraMedia = [],
  seen,
  portraitKind = "image",
  portraitPoster = "",
  portraitTile = "",
  claimHrefs = [],
  tileData = null,
} = {}) {
  const bag = seen || detailMediaSeen();
  const portraitPath = mediaHrefPath(portraitSrc);
  for (const href of claimHrefs || []) {
    const claimed = mediaHrefPath(href);
    if (!claimed || claimed === portraitPath) continue;
    claimDetailMedia(bag, claimed);
  }
  const media = [];
  const videoTile = portraitKind === "video";
  if (portraitHtml) {
    const tile = detailMediaTile({
      kind: portraitTile || (videoTile ? "video" : "portrait"),
      src: portraitSrc,
      inner: portraitHtml,
      alt: portraitAlt,
      credit: creditWithoutUrls(portraitCredit),
      mediaKind: videoTile ? "video" : "image",
      poster: portraitPoster,
      tileData,
    });
    if (tile && !claimDetailMedia(bag, portraitSrc)) {
      if (videoTile && portraitPoster) claimDetailMedia(bag, portraitPoster);
      media.push(tile);
    }
  }
  const shotHref = normalizeScreenshotHref(screenshot);
  if (shotHref && !claimDetailMedia(bag, shotHref)) {
    const shot = screenshotTile(screenshot, {
      alt: screenshotAlt,
      credit: screenshotCredit,
      tileData,
    });
    if (shot) media.push(shot);
  }
  for (const item of extraMedia || []) {
    const href = String(item?.src || item || "").trim();
    if (!href || claimDetailMedia(bag, href)) continue;
    const alt = item?.alt || "Post media";
    const credit = creditWithoutUrls(item?.credit || "");
    const img = `<img class="detail-photo still" src="${esc(versionedMediaHref(href))}" alt="${esc(alt)}" decoding="async">`;
    media.push(
      detailMediaTile({
        kind: "still",
        src: href,
        inner: img,
        alt,
        credit,
        tileData,
      }),
    );
  }
  return media;
}

/** Shared masonry: media + text/meta tiles in one dense column pack (dog / people / ops). */
function detailMediaStrip({ metaHtml = "", metaTiles = [], ...mediaOpts } = {}) {
  const media = detailMediaTiles(mediaOpts);
  const meta = (metaTiles || []).filter(Boolean);
  if (!meta.length && metaHtml) meta.push(...splitJoinedTiles(metaHtml));
  const tiles = interleaveDetailTiles(media, meta);
  return `<div class="detail-media detail-media--masonry" data-tiles="${tiles.length}">${tiles.join("")}</div>`;
}

/** One meta tile. `line` may be HTML or `{ kind, html }` for a section type. */
function detailSectionTile(line, fallbackKind = "line") {
  if (!line) return "";
  if (typeof line === "string") return detailMetaTile(fallbackKind, line);
  const html = String(line.html || line.inner || "").trim();
  if (!html) return "";
  return detailMetaTile(line.kind || fallbackKind, html);
}

/** Shared text/meta tiles: optional title, ONE cite tile, other lines, ONE body, Source.
    Cite is handle + account + posted (X format) + body in a single glass tile.
    Source stays its own tile. Masonry pack is unchanged. */
function detailMetaBlock({
  title,
  ratingHtml = "",
  lines = [],
  citeHtml = "",
  attributionHtml = "",
  bodyTitle = "",
  bodyHtml = "",
  sourceKind = "source",
  sourceHtml = "",
  extraTiles = [],
} = {}) {
  const tiles = [];
  const credit = String(attributionHtml || "");
  const hasTitle = title != null || ratingHtml;
  if (hasTitle) {
    tiles.push(
      detailMetaTile(
        "title",
        `<h2 class="detail-title">${esc(title || "—")}</h2>${ratingHtml}${credit}`,
      ),
    );
  }
  // ONE cite tile — do not split handle / account / posted / body into TUI line tiles.
  // Comms have no title tile. The line sits under the cite head and above source cites.
  if (citeHtml) {
    let citeBody = citeHtml;
    if (!hasTitle && credit) {
      citeBody = citeHtml.includes("</header>")
        ? citeHtml.replace("</header>", `</header>${credit}`)
        : `${credit}${citeHtml}`;
    }
    tiles.push(detailMetaTile("cite", citeBody));
  } else if (!hasTitle && credit) {
    tiles.push(detailMetaTile("attribution", credit));
  }
  for (const line of (lines || []).filter(Boolean)) {
    tiles.push(detailSectionTile(line));
  }
  // ONE body tile — do not split bodyHtml by TUI lines or newlines.
  if (bodyTitle || bodyHtml) {
    tiles.push(
      detailMetaTile(
        "body",
        `${bodyTitle ? `<h3 class="pane-h">${esc(bodyTitle)}</h3>` : ""}${bodyHtml}`,
      ),
    );
  }
  if (sourceHtml) tiles.push(detailMetaTile(sourceKind || "source", sourceHtml));
  tiles.push(...(extraTiles || []).filter(Boolean));
  return tiles.join("");
}

/** Shared detail shell: frost box + one interleaved masonry (+ optional trailing HTML). */
function detailShell({
  title,
  mediaHtml = "",
  metaHtml = "",
  afterHtml = "",
  active = true,
  extraClass = "meta-box",
} = {}) {
  return boxFrame(
    title,
    `<div class="meta-pane meta-pane--stack">${mediaHtml}${metaHtml}${afterHtml}</div>`,
    { active, extraClass },
  );
}

export function localMediaPortrait(src, label, { dog = false, commsKind: kind } = {}) {
  const spec = kind ? mediaSpec(kind) : dog ? mediaSpec("dog") : null;
  if (spec) {
    const href = String(src || "").trim();
    if (isCommsMediaHref(href, spec.mediaDir)) {
      return `<img class="detail-photo portrait" src="${esc(versionedMediaHref(href))}" alt="${esc(label)}" width="${DETAIL_PORTRAIT_CSS_W}" height="${DETAIL_PORTRAIT_CSS_H}" decoding="async"${portraitFallbackAttr()}>`;
    }
    return emptyPortraitImg({ size: "detail", label });
  }
  return localPortraitImg(src, label, { size: "detail", kind: "portrait" });
}

function thumb(src, label, kind = "portrait") {
  return localMediaThumb(src, label, kind);
}

/** True only for an absolute http or https URL. Other schemes are not links. */
function isHttpUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return false;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Shared cite link. One place decides the markup:
 * http(s) URL → `<a class="source-link">` whose visible text is that URL
 * (href and title stay the full URL; CSS may shorten the display).
 * Optional muted outlet sits after the anchor so a leading snippet
 * stays flush against the link. Any other scheme is escaped plain text
 * with no href. No URL → plain text, no anchor.
 */
export function citeLink(url, { label = "" } = {}) {
  const href = String(url || "").trim();
  const outlet = String(label || "").trim();
  const outletHtml =
    outlet && outlet !== href ? `<span class="cite-outlet">${esc(outlet)}</span>` : "";
  if (!href) return outletHtml;
  if (!isHttpUrl(href)) {
    const text = esc(href);
    return outletHtml ? `${text} ${outletHtml}` : text;
  }
  const anchor = `<a class="source-link" href="${esc(href)}" title="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(href)}</a>`;
  return outletHtml ? `${anchor} ${outletHtml}` : anchor;
}

export function citeList(sources) {
  return `<ol class="sources cite-list">${(sources || [])
    .map((s) => {
      const label = s.publisher || s.title || "";
      const date = s.date
        ? ` <time datetime="${esc(s.date)}">${esc(formatDate(s.date))}</time>`
        : "";
      return `<li>${citeLink(s.url, { label })}${date}</li>`;
    })
    .join("")}</ol>`;
}

function sourceList(sources) {
  return citeList(sources);
}

function identityFact(label, valueHtml) {
  return `<div class="identity-fact"><div class="identity-label">${esc(label)}</div><div class="identity-value">${valueHtml}</div></div>`;
}

function netWorthCell(row) {
  const value = formatUsd(row.net_worth_usd);
  const note = row.net_worth_note ? esc(row.net_worth_note) : "";
  const source = String(row.net_worth_source || "").trim();
  const src = !source
    ? ""
    : isHttpUrl(source)
      ? ` <a class="nw-src" href="${esc(source)}" rel="noopener noreferrer">source</a>`
      : ` ${esc(source)}`;
  return `<span class="nw">${esc(value)}</span>${
    note ? `<span class="nw-note">${note}${src}</span>` : src
  }`;
}

function kindLabel(row) {
  const cat = categoryById(row.category);
  if (cat) return cat.nav;
  if (row.category === EPSTEIN_CLIENTS_CATEGORY) return "Flight log";
  return row.category || "Person";
}

/**
 * Fixed leading slot for every major-classification result row.
 * A missing portrait stays a same-size placeholder — the slot never collapses,
 * so name and meta share one x whether or not an img is inside.
 */
function classificationMediaSlot(inner) {
  const body = String(inner || "").trim();
  const content = body
    ? body
    : `<span class="row-media-spacer" aria-hidden="true"></span>`;
  return `<div class="row-media">${content}</div>`;
}

/** Stored exit date, or the cite day when the only entry is a Trump nickname. */
export function personListDate(row) {
  return asEventDate(row?.event_date) || nicknameCatalogDate(row) || "";
}

/** Office title for a card. Abbreviations are spelled out. A case caption is not an office. */
export function officePosition(raw) {
  return standardizePosition(raw);
}

/** A U.S. congressional office title, current or former. */
const CONGRESS_OFFICE = /^(?:Former )?U\.S\. (?:Senator|Representative)\b/;

/**
 * Body implied by a current congressional role. Only these two are mapped.
 * Any other role keeps the stored event organization.
 */
const BODY_BY_CURRENT_OFFICE = [
  [/^U\.S\. Senator\b/, "U.S. Senate"],
  [/^U\.S\. Representative\b/, "U.S. House of Representatives"],
];

/** The event this card is about: the first event of the card category. */
function personCardEvent(row) {
  const kind = String(row?.category || "").trim();
  if (!kind) return null;
  return personEvents(row).find((ev) => String(ev?.kind || "") === kind) || null;
}

/**
 * Office on a person result card. The event this card is about supplies position and
 * organization. Role is the person-level title when that event has none.
 * When both the role and that event name a U.S. congressional office, the
 * role wins: it is the current cited office, while the event keeps the office
 * held on that day. A current Senator or Representative role then implies
 * its chamber as the organization. Another event's office is not borrowed,
 * and the stored event is not changed.
 */
export function personCardOffice(row) {
  const match = personCardEvent(row);
  const eventPosition = officePosition(match?.position);
  const eventOrganization = String(match?.organization || "").trim();
  const role = officePosition(row?.role);
  const roleWins =
    role && (!eventPosition || (CONGRESS_OFFICE.test(role) && CONGRESS_OFFICE.test(eventPosition)));
  if (!roleWins) return { position: eventPosition, organization: eventOrganization };
  const implied = BODY_BY_CURRENT_OFFICE.find(([re]) => re.test(role))?.[1] || "";
  return { position: role, organization: implied || eventOrganization };
}

/** Title on a person result card. See personCardOffice. */
export function personCardPosition(row) {
  return personCardOffice(row).position;
}

/** Shared KEEP person row: dashboard slices, category lists, and search. */
export function personRow(row, { selected, showDeath, badges = "", date } = {}) {
  const href = `/people/${encodeURIComponent(row.id)}`;
  const previewDate =
    date !== undefined ? date : showDeath && row.death_date ? row.death_date : personListDate(row);
  const position = personCardPosition(row);
  const positionHtml = position ? `<div class="tui-position">${esc(position)}</div>` : "";
  return `<a class="tui-row person-card${selected ? " is-selected" : ""}" href="${esc(href)}">
    ${classificationMediaSlot(thumb(row.photo, row.name))}
    <div class="tui-row-text">
      <div class="tui-title">${esc(row.name || "—")}</div>
      ${positionHtml}
      <div class="tui-meta">${badges}<time datetime="${esc(previewDate || "")}">${esc(formatDate(previewDate))}</time> · ${esc(kindLabel(row))} · ${esc(formatUsd(row.net_worth_usd))}</div>
    </div>
  </a>`;
}

function posterLabel(handle) {
  const raw = String(handle || "").trim();
  if (!raw) return "—";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

/** Shared CITE block: handle + account + posted (X format) + body. No Source URL. */
export function citeBlock({
  handle = "",
  accountName = "",
  postedAt = "",
  body = "",
} = {}) {
  const posted = postedAtValue(postedAt);
  return `<div class="cite-block">
    <header class="cite-head">
      <span class="handle">${esc(posterLabel(handle))}</span>
      <span class="acct">${esc(String(accountName || "").trim() || "—")}</span>
      <time datetime="${esc(posted)}">${esc(formatPosted(posted))}</time>
    </header>
    <p class="post-text">${esc(body || "—")}</p>
  </div>`;
}

/** Map dog / source-post / matching people-ops-corona fields onto the shared cite. */
const ATTRIBUTION_TZ = "America/New_York";

function attributionDateEt(iso) {
  const parsed = new Date(iso);
  if (!iso || Number.isNaN(parsed.getTime())) return "";
  const formatted = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: ATTRIBUTION_TZ,
  }).format(parsed);
  return `${formatted} ET`;
}

function attributionLine(row) {
  if (!row || (row.channel && row.channel !== "x_mention")) return "";
  const name = String(row.submitter_display_name || "").trim();
  const handle = String(row.submitter_handle || "").trim().replace(/^@/, "");
  const date = attributionDateEt(row.submitted_at);
  if (!handle || !date) return "";
  return `Requested via X by ${name} @${handle} · ${date}`.replace("by  @", "by @");
}

const PERSON_SURFACE = "person";
const COMMS_SURFACES = new Set(["dog_comm", "red_folder_comm", "central_casting_comm"]);

function rowsForSurface(rows, surface) {
  const list = Array.isArray(rows) ? rows : [];
  if (surface === PERSON_SURFACE) {
    return list.filter((row) => !row?.target_kind || row.target_kind === "person");
  }
  if (surface === "operation") {
    return list.filter((row) => !row?.target_kind || row.target_kind === "operation");
  }
  if (COMMS_SURFACES.has(surface)) {
    return list.filter((row) => !row?.target_kind || row.target_kind === surface);
  }
  return list;
}

/**
 * Shared RequestAttribution partial.
 * Muted meta under the title and above cites. Empty input renders nothing.
 * Person surfaces (including Central Casting and Corona) show person rows only.
 * A dig that kept a comms row is displayed on that comm, not on the person.
 */
export function RequestAttribution(rows, { surface = "" } = {}) {
  const lines = rowsForSurface(rows, surface)
    .slice()
    .sort((a, b) => {
      const at = String(a?.submitted_at || "");
      const bt = String(b?.submitted_at || "");
      if (at < bt) return -1;
      if (at > bt) return 1;
      return String(a?.subject_status_id || "").localeCompare(String(b?.subject_status_id || ""));
    })
    .map(attributionLine)
    .filter(Boolean);
  if (!lines.length) return "";
  return lines
    .map((line) => `<p class="meta-line request-attribution">${esc(line)}</p>`)
    .join("");
}

export function requestAttributionHtml(rows, options) {
  return RequestAttribution(rows, options);
}

function attributionFrom(row, attributions, surface) {
  const source = attributions !== undefined ? attributions : row?.request_attributions;
  return RequestAttribution(source, { surface });
}

export function citeFromRow(row = {}) {
  const snap = row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
  const handle = String(row.handle || row.poster_handle || snap.handle || "").trim();
  const accountName = String(
    row.account_name || row.poster_name || snap.account_name || "",
  ).trim();
  const postedAt = postedAtValue(row.posted_at, snap.posted_at, snap.datetime);
  const body =
    row.text != null && String(row.text) !== ""
      ? String(row.text)
      : String(snap.text || "");
  if (!handle && !accountName && !postedAt && !body) return "";
  return citeBlock({ handle, accountName, postedAt, body });
}

export function detailSourceLine(url, { label = "Source" } = {}) {
  const href = String(url || "").trim();
  if (!href) return `<p class="meta-line">${esc(label)} · —</p>`;
  return `<p class="meta-line">${esc(label)} · ${citeLink(href)}</p>`;
}

export function sourcePostRow(row, { selected } = {}) {
  const href = `/posts/${encodeURIComponent(row.id)}`;
  const posted = formatDate(row.posted_at);
  return `<a class="tui-row source-card${selected ? " is-selected" : ""}" href="${esc(href)}">
    <span class="initials thumb" aria-hidden="true">—</span>
    <div class="tui-row-text">
      <div class="tui-title">—</div>
      <div class="tui-meta"><time datetime="${esc(row.posted_at || "")}">${esc(posted)}</time> posted · poster ${esc(posterLabel(row.poster_handle))} · ${esc(kindLabel(row))} · —</div>
    </div>
  </a>`;
}

function countCell(n) {
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  return Number.isInteger(num) ? String(num) : "—";
}

export function operationRow(row, { selected } = {}) {
  const href = `/operations/${encodeURIComponent(row.id)}`;
  const tags = normalizeOperationTags(row.tags);
  const tagLabel = tags.map((id) => operationTagLabel(id)).filter(Boolean).join(", ") || "Operation";
  const agencies = (row.agencies || []).filter(Boolean).join(", ") || "—";
  const portrait = operationPortraitFrom(row);
  return `<a class="tui-row operation-card${selected ? " is-selected" : ""}" href="${esc(href)}">
    ${classificationMediaSlot(thumb(portrait.photo, row.name || "OP", "portrait"))}
    <div class="tui-row-text">
      <div class="tui-title">${esc(row.name || "—")}</div>
      <div class="tui-meta"><time datetime="${esc(row.event_date || "")}">${esc(formatDate(row.event_date))}</time> · ${esc(tagLabel)} · ${esc(agencies)} · victims ${esc(countCell(row.victim_count))} · arrests ${esc(countCell(row.arrest_count))}</div>
    </div>
  </a>`;
}

/** PersonEventSection cites: url required, snippet only when stored. */
function sectionCites(raw) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item) continue;
    const url = String(typeof item === "string" ? item : item.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const snippet =
      typeof item === "string"
        ? ""
        : centralCastingStoredQuote({ text: item.snippet, quote: item.quote });
    const title = typeof item === "string" ? "" : String(item.title || "").trim();
    const source_label =
      typeof item === "string"
        ? ""
        : String(item.source_label || item.publisher || "").trim();
    const date = typeof item === "string" ? "" : String(item.date || "").trim();
    out.push({ url, snippet, source_label, title, date });
  }
  return out;
}

function sectionCiteList(cites, { anchor = false, start = 1 } = {}) {
  const from = Number(start) > 0 ? Number(start) : 1;
  const startAttr = from > 1 ? ` start="${from}"` : "";
  return `<ol class="sources cite-list"${startAttr}>${cites
    .map((s, i) => {
      const label = s.source_label || s.title || "";
      const date = s.date
        ? ` <time datetime="${esc(s.date)}">${esc(formatDate(s.date))}</time>`
        : "";
      const snippet = s.snippet
        ? `<blockquote class="event-snippet">${esc(s.snippet)}</blockquote>`
        : "";
      const link = citeLink(s.url, { label });
      const id = anchor ? ` id="source-${from + i}"` : "";
      // Standing rule (all kinds): each stored quote sits immediately before its own cite.
      // Cites without a snippet render exactly as before: link, then date.
      return `<li${id}>${snippet}${link}${date}</li>`;
    })
    .join("")}</ol>`;
}

/** The event note, as one paragraph. */
function commitProseHtml(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return `<p class="event-oneline">${esc(clean)}</p>`;
}

/** Date and title on one row. Title HTML is already escaped, plus an optional badge. */
function eventHeadHtml(titleHtml, date) {
  const when = String(date || "").trim().slice(0, 10);
  const time = when
    ? `<time class="event-date" datetime="${esc(when)}">${esc(formatDate(when))}</time>`
    : `<span class="event-date">—</span>`;
  return `<header class="person-event-head">${time}<h3 class="event-h">${titleHtml}</h3></header>`;
}

/** Position and organization for this event, on one line. */
function eventOfficeHtml(ev) {
  const position = standardizePosition(String(ev?.position || "").trim());
  const organization = String(ev?.organization || "").trim();
  const bits = [];
  if (position) bits.push(`Position · ${esc(position)}`);
  if (organization) bits.push(`Organization · ${esc(organization)}`);
  if (!bits.length) return "";
  return `<p class="event-facts">${bits.join(" · ")}</p>`;
}

/**
 * PersonEventSection. Shared person-detail event section.
 * title, cites[{url, snippet, source_label?}], optional summary, optional media.
 * Hidden when there is no body, summary, media, or cite.
 */
export function personEventSection({
  title = "",
  headingHtml = "",
  headHtml = "",
  kind = "",
  cites = [],
  summary = "",
  mediaHtml = "",
  bodyHtml = "",
  footHtml = "",
  className = "person-event-section",
  tag = "section",
  personId = "",
} = {}) {
  const heading = String(headingHtml || "").trim() || (String(title || "").trim() ? esc(String(title).trim()) : "");
  const head = String(headHtml || "").trim();
  if (!head && !heading) return "";
  const items = sectionCites(cites);
  const summaryText = String(summary || "").trim();
  const media = String(mediaHtml || "").trim();
  const body = String(bodyHtml || "").trim();
  const foot = String(footHtml || "").trim();
  if (!items.length && !summaryText && !media && !body && !foot) return "";
  const el = tag === "article" ? "article" : "section";
  const summaryHtml = summaryText ? `<p class="event-summary">${esc(summaryText)}</p>` : "";
  const citeHtml = items.length ? sectionCiteList(items) : "";
  const kindAttr = kind ? ` data-kind="${esc(kind)}"` : "";
  const personAttr = personId ? ` data-person-id="${esc(personId)}"` : "";
  const headBlock = head || `<h3 class="event-h">${heading}</h3>`;
  // Claim, then the source numbers that belong to it, then this event's media.
  return `<${el} class="${esc(className)}"${kindAttr}${personAttr} data-section="person-event">
    ${headBlock}
    ${body}
    ${summaryHtml}
    ${foot}
    ${media}
    ${citeHtml}
  </${el}>`;
}

/** Full cites, or the numbered source refs when the page has one source list. */
function eventCiteParts(ev, sourceNumbers) {
  if (!sourceNumbers) return { cites: eventSectionCites(ev), footHtml: "" };
  return { cites: [], footHtml: sourceRefHtml(ev?.sources, sourceNumbers) };
}

function postShotPercent(n) {
  const value = Math.round(Number(n) * 10000) / 100;
  if (!Number.isFinite(value)) return "";
  return `${value.toFixed(2)}%`;
}

/** Screenshot of the post. A video sits in the picture area of that same screenshot. */
function postShotFrame({ shot, video, alt }) {
  const img = `<img class="detail-photo screenshot" src="${esc(versionedMediaHref(shot))}" alt="${esc(alt)}" decoding="async">`;
  const box = findPostMediaBox(shot);
  const left = box ? postShotPercent(box.x) : "";
  const top = box ? postShotPercent(box.y) : "";
  const width = box ? postShotPercent(box.w) : "";
  const height = box ? postShotPercent(box.h) : "";
  const fitted = left
    ? `<span class="post-shot-media" style="left:${left};top:${top};width:${width};height:${height}">${commVideoInner(video, "", alt)}</span>`
    : `<span class="detail-video-play" aria-hidden="true"></span>`;
  return `<span class="post-shot">${img}${fitted}</span>`;
}

function dogMediaStem(src) {
  const base = String(src || "").split("/").pop().split("?")[0];
  return base
    .replace(/\.(mp4|jpe?g|png|webp)$/i, "")
    .replace(/\.shot$/i, "")
    .replace(/\.poster$/i, "");
}

function isDogShotSrc(src) {
  return /\/screenshots\//i.test(src) || /\.shot\.(jpe?g|png|webp)$/i.test(src);
}

/**
 * The screenshot is the post.
 * A video is fitted into that screenshot as one tile.
 * The extracted still of that single image or video is not drawn.
 * Any other attachment is its own tile.
 */
function collapseDogPostMedia(items) {
  const groups = new Map();
  const order = [];
  for (const item of items || []) {
    const key = dogMediaStem(item?.src);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(item);
  }
  const out = [];
  for (const key of order) {
    const group = groups.get(key);
    const videos = group.filter((item) => /\.mp4$/i.test(item.src));
    const images = group.filter((item) => !/\.mp4$/i.test(item.src));
    const namedShot = images.find((item) => isDogShotSrc(item.src));
    const png = images.find((item) => /\.png$/i.test(item.src));
    const shot = namedShot || (videos.length ? png : null);
    if (videos.length && shot) {
      const poster = images.find((item) => item !== shot && /\.jpe?g$/i.test(item.src));
      const video = videos[0];
      out.push({
        ...video,
        shot: shot.src,
        poster: poster?.src || "",
        alt: shot.alt || video.alt || "X-post screenshot",
        context: shot.context || video.context || "",
        url: shot.url || video.url || "",
        credit: shot.credit || video.credit || "",
      });
      continue;
    }
    if (videos.length) {
      const video = videos[0];
      const poster = images.find((item) => /\.jpe?g$/i.test(item.src));
      out.push({ ...video, poster: video.poster || poster?.src || "" });
      continue;
    }
    if (namedShot) {
      out.push(namedShot);
      continue;
    }
    out.push(...images);
  }
  return out;
}

/** One bottom-of-page figure. A stored context line sits before the cite link. */
function supportingMediaFigure(item, source) {
  const alt = item.alt || "Supporting media";
  const credit = creditWithoutUrls(item.credit || "");
  const href = String(source?.url || item.url || "").trim();
  const date = String(source?.date || "").trim();
  const dateHtml = date
    ? ` <time datetime="${esc(date)}">${esc(formatDate(date))}</time>`
    : "";
  const context = String(item.context || "").trim();
  const contextHtml = context
    ? `<p class="event-snippet support-context">${esc(context)}</p>`
    : "";
  const outlet = String(source?.publisher || source?.source_label || "").trim();
  const caption = href
    ? `${contextHtml}${mediaCaptionLink(href, outlet)}${dateHtml}`
    : `${contextHtml}${esc(credit || alt)}`;
  const shot = String(item.shot || "").trim();
  // Strip ?p= before the extension test so a versioned href is still a video.
  const videoSrc = /\.mp4$/i.test(String(item.src || "").split(/[?#]/)[0]);
  if (videoSrc && shot) {
    const frameInner = postShotFrame({ shot, video: item.src, alt });
    const button = lightboxButton(item.src, `<span class="detail-support-frame">${frameInner}</span>`, {
      alt,
      credit,
      kind: "video",
      poster: item.poster || "",
    });
    return `<figure class="detail-tile detail-tile--support detail-tile--postshot">${button}<figcaption class="event-media-caption">${caption}</figcaption></figure>`;
  }
  const videoPoster = videoSrc
    ? resolveVideoPosterHref(item.src, item.poster || "")
    : "";
  const frameInner = videoSrc
    ? commVideoInner(item.src, videoPoster, alt)
    : `<img class="detail-photo still" src="${esc(versionedMediaHref(item.src))}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  const button = lightboxButton(item.src, `<span class="detail-support-frame">${frameInner}</span>`, {
    alt,
    credit,
    kind: videoSrc ? "video" : "image",
    poster: videoPoster,
  });
  return `<figure class="detail-tile detail-tile--support">${button}<figcaption class="event-media-caption">${caption}</figcaption></figure>`;
}

/**
 * THE shared supporting-media masonry. Every surface that draws supporting media
 * (person card events, Notable, Shot, Central Casting, comms supporting) calls this.
 * CSS columns only — styles.css "Supporting media masonry". No tiles, no markup.
 */
export function supportingMediaHtml(tiles) {
  const list = (tiles || []).filter(Boolean);
  if (!list.length) return "";
  return `<div class="detail-media detail-media--masonry detail-support-masonry" data-tiles="${list.length}">${list.join("")}</div>`;
}

/** Titled bottom section around the shared masonry. Empty when no tiles remain. */
export function supportingMediaSection(tiles) {
  const masonry = supportingMediaHtml(tiles);
  if (!masonry) return "";
  return `<section class="detail-supporting" aria-label="Supporting media"><h3 class="event-h">Supporting media</h3>${masonry}</section>`;
}

/** Normalized event media items to figures, each paired with its stored cite. */
function supportingMediaFigures(items, sources) {
  const list = Array.isArray(sources) ? sources : [];
  return (items || []).map((item) => {
    const want = canonicalPublicUrl(item.url);
    const source = list.find((entry) => canonicalPublicUrl(entry?.url) === want) || null;
    return supportingMediaFigure(item, source);
  });
}

/** Supporting clips after every event section. Notable media stays on the Notable block. */
function personSupportingMediaHtml(row, seen) {
  const figures = [];
  for (const ev of personEvents(row)) {
    const kind = String(ev?.kind || "").trim();
    // Recorded-no media stays on people.events and is not rendered.
    // It is not orphaned and must not be cleaned up.
    // tests/vote-no-tags.test.mjs ("a passage card shows Final passage and Voted no, with cites escaped")
    if (kind === "notable" || kind === "shot" || kind === "endorsement" || VOTE_FACT_KINDS.has(kind)) continue;
    const sources = Array.isArray(ev.sources) ? ev.sources : [];
    // Dedupe (normalize, then collapse dog post groups) before the display cap.
    const media = normalizeEventMedia(ev.media);
    const items = (kind === "dog_comms" ? collapseDogPostMedia(media) : media).slice(
      0,
      EVENT_MEDIA_DISPLAY_MAX,
    );
    figures.push(...supportingMediaFigures(items, sources));
  }
  const shot = normalizeScreenshotHref(row?.screenshot, "people");
  if (shot && !claimDetailMedia(seen, shot)) {
    figures.push(
      supportingMediaFigure(
        {
          src: shot,
          alt: "Screenshot",
          credit: row.screenshot_credit || "",
        },
        null,
      ),
    );
  }
  return supportingMediaSection(figures);
}

/** Allowlisted stills and screenshots only. A bad path is omitted. Same bytes as an earlier tile are omitted. */
function centralCastingMediaHtml(clips, seen) {
  const bag = seen || detailMediaSeen();
  const parts = [];
  const push = (href, alt) => {
    const src = String(href || "").trim();
    if (!src) return;
    const shot = normalizeScreenshotHref(src, "central-casting-comms");
    const still = isCommsMediaHref(src, "central-casting-comms") ? src : "";
    const ok = shot || still;
    if (!ok || claimDetailMedia(bag, ok)) return;
    parts.push(supportingMediaFigure({ src: ok, alt }, null));
  };
  for (const clip of clips || []) {
    const alt = clip?.handle ? `Stored still for ${clip.handle}` : "Central Casting";
    push(clip?.still, alt);
    push(clip?.screenshot, clip?.handle ? `X-post screenshot of ${clip.handle}` : "X-post screenshot");
    for (const href of kindExtraStills("central_casting", clip)) push(href, alt);
    for (const entry of kindSupportingEntries(clip)) {
      push(entry.screenshot, entry.handle ? `X-post screenshot of ${entry.handle}` : "X-post screenshot");
    }
  }
  return supportingMediaHtml(parts);
}

function centralCastingClipsFor(row, clips) {
  const personId = String(row?.id || "").trim();
  return (clips || []).filter((clip) => {
    const id = String(clip?.person_id || "").trim();
    return !personId || !id || id === personId;
  });
}

function centralCastingSupportingSource(clip, entry) {
  const raw = clip?.snapshot?.supporting;
  if (!Array.isArray(raw)) return entry;
  const url = String(entry?.source_url || "").trim();
  return raw.find((item) => item && String(item.source_url || "").trim() === url) || entry;
}

/** One Central Casting section from evidence rows plus membership cites. Not a red-folder page. */
export function centralCastingDetailHtml(row, clips = [], seen) {
  const membership = (row?.central_casting || [])
    .map((url) => String(url || "").trim())
    .filter(Boolean);
  const own = centralCastingClipsFor(row, clips);
  const cites = [];
  for (const clip of own) {
    cites.push({
      url: clip.source_url,
      snippet: centralCastingStoredQuote(clip),
      source_label: String(clip.account_name || clip.handle || "").trim(),
      date: clip.posted_at || "",
    });
    for (const entry of kindSupportingEntries(clip)) {
      const source = centralCastingSupportingSource(clip, entry);
      cites.push({
        url: entry.source_url,
        snippet: centralCastingStoredQuote(source),
        source_label: String(entry.account_name || entry.handle || "").trim(),
        date: entry.posted_at || "",
      });
    }
  }
  for (const url of membership) cites.push({ url });
  if (!membership.length && !sectionCites(cites).length) return "";
  const summary = String(row.summary || "").trim();
  return personEventSection({
    title: "Central Casting",
    kind: "central_casting",
    cites,
    summary,
    mediaHtml: centralCastingMediaHtml(own, seen),
    personId: row?.id || "",
  });
}

export function kindListRow(kind, row, { selected } = {}) {
  const spec = commsKind(kind);
  const href = `${spec.path}/${encodeURIComponent(row.id)}`;
  return `<a class="tui-row ${spec.cardClass}${selected ? " is-selected" : ""}" href="${esc(href)}">
    ${classificationMediaSlot(thumb(row.still, row.handle, "still"))}
    <div class="tui-row-text">
      <div class="tui-title">${esc(row.handle)}</div>
      <div class="tui-meta"><time datetime="${esc(row.posted_at)}">${esc(formatPosted(row.posted_at))}</time> · ${esc(spec.label)}</div>
    </div>
  </a>`;
}

export function dogListRow(row, opts = {}) {
  return kindListRow("dog", row, opts);
}

function groupByYear(rows, dateKey, render) {
  return groupByYearItems(
    rows.map((row) => ({ date: row[dateKey], row })),
    (item, opts) => render(item.row, opts),
  );
}

function groupByYearItems(items, render) {
  const groups = new Map();
  for (const item of items) {
    const y = String(item.date || "").slice(0, 4) || "Undated";
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push(item);
  }
  const years = [...groups.keys()].sort((a, b) => {
    if (a === "Undated") return 1;
    if (b === "Undated") return -1;
    return b.localeCompare(a);
  });
  let first = true;
  return years
    .map((y) => {
      const bucket = groups.get(y);
      const html = bucket
        .map((item, i) => {
          const selected = first && i === 0;
          if (selected) first = false;
          return render(item, { selected });
        })
        .join("");
      return `<section class="tui-group">
      <h2 class="tui-group-h">${esc(y)}</h2>
      ${html}
    </section>`;
    })
    .join("");
}

export function peopleTable(rows, { showDeath } = {}) {
  return peopleList(rows, { showDeath });
}

export function peopleList(rows, { showDeath, listDate } = {}) {
  if (!rows.length) return `<p class="empty">No rows on this page.</p>`;
  const menuDate = typeof listDate === "function";
  const dateOf = (row) =>
    menuDate ? asEventDate(listDate(row)) || "" : personListDate(row) || "";
  const ordered = rows.slice().sort((a, b) => {
    const da = dateOf(a);
    const db = dateOf(b);
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  return `<div class="people-list tui-list">${groupByYearItems(
    ordered.map((row) => ({ date: dateOf(row), row })),
    (item, opts) =>
      personRow(item.row, {
        ...opts,
        showDeath: menuDate ? false : showDeath,
        date: menuDate ? dateOf(item.row) : undefined,
      }),
  )}</div>`;
}

export function catalogList(items, { showDeath } = {}) {
  if (!items.length) return `<p class="empty">No rows on this page.</p>`;
  return `<div class="people-list tui-list">${groupByYearItems(items, (item, opts) => {
    if (item.type === "source") return sourcePostRow(item.row, opts);
    if (item.type === "dog" || item.type === "red_folder" || isCommsKind(item.type)) {
      return kindListRow(item.type === "dog" ? "dog" : item.type, item.row, opts);
    }
    if (item.type === "operation") return operationRow(item.row, opts);
    return personRow(item.row, { ...opts, showDeath });
  })}</div>`;
}

export function sourcePostList(rows) {
  if (!rows.length) return `<p class="empty">No rows on this page.</p>`;
  return `<div class="people-list tui-list">${groupByYear(rows, "posted_at", sourcePostRow)}</div>`;
}

export function deathsIndexNav() {
  return identityFilterNav("/deaths", { tags: [] });
}

export function indictmentsIndexNav() {
  return identityFilterNav("/indictments", { tags: [] });
}

export function groupOpsIndexNav() {
  return identityFilterNav("/group-operations", { tags: [] });
}

export function operationList(rows) {
  if (!rows.length) return `<p class="empty">No rows on this page.</p>`;
  return `<div class="people-list tui-list">${groupByYear(rows, "event_date", operationRow)}</div>`;
}

export function kindList(kind, rows) {
  const spec = commsKind(kind);
  if (!rows.length) return `<p class="empty">No rows on this page.</p>`;
  return `<div class="${spec.pageClass} tui-list">${groupByYear(rows, "posted_at", (row, opts) =>
    kindListRow(kind, row, opts),
  )}</div>`;
}

/** Newest first, undated last, then name (or handle). One comparator for every mixed comms list. */
export function byDateDescThenName(a, b) {
  const da = String(a?.date || "");
  const db = String(b?.date || "");
  if (da !== db) {
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  }
  const na = String(a?.row?.name || a?.row?.handle || "");
  const nb = String(b?.row?.name || b?.row?.handle || "");
  return na.localeCompare(nb);
}

/**
 * One item builder for every comms list (dog, red folder, eagle, ronald, shot).
 * A post that names resolved people becomes one card per person; the post itself
 * is not a card then. A post with no resolved person stays a post row.
 * `snapshot.named` drops anyone it does not list. A person already shown is skipped.
 * People carrying the page's person tag are added once, after the linked cards.
 * Cards do not repeat the post media. Items keep post order; a caller that mixes
 * in tagged people sorts with byDateDescThenName.
 */
export function commsCatalogItems(posts, people, tagged = []) {
  const rows = Array.isArray(posts) ? posts : [];
  const seen = new Set();
  const items = [];
  for (const post of rows) {
    const linked = linkedPeopleForDetail(post, people);
    if (!linked.length) {
      items.push({ date: post.posted_at || "", type: "post", row: post });
      continue;
    }
    for (const person of linked) {
      if (!person?.id || seen.has(person.id)) continue;
      seen.add(person.id);
      items.push({
        date: post.posted_at || "",
        cardDate: asEventDate(post.posted_at) || "",
        type: "person",
        row: person,
      });
    }
  }
  for (const person of Array.isArray(tagged) ? tagged : []) {
    if (!person?.id || seen.has(person.id)) continue;
    seen.add(person.id);
    const date = asEventDate(person.event_date) || "";
    items.push({ date, cardDate: date, type: "person", row: person });
  }
  return items;
}

/** One list renderer for every comms page: person cards and post rows, grouped by year. */
export function commsCatalogList(kind, items) {
  const spec = commsKind(kind);
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return `<p class="empty">No rows on this page.</p>`;
  return `<div class="${esc(spec.pageClass)} tui-list">${groupByYearItems(rows, (item, opts) =>
    item.type === "person"
      ? personRow(item.row, { ...opts, date: item.cardDate })
      : kindListRow(kind, item.row, opts),
  )}</div>`;
}

export function shotCatalogList(posts, people) {
  return commsCatalogList("shot", commsCatalogItems(posts, people));
}

export function dogList(rows) {
  return kindList("dog", rows);
}

export function pager(meta, { basePath, noun = "rows", pageSizes } = {}) {
  const { page, totalPages, total, hasPrev, hasNext } = meta;
  const statusPage = `Page ${page} of ${totalPages}`;
  const statusCount = ` · ${total} ${noun}`;
  const prev = hasPrev
    ? `<a class="pager-btn keychip" href="${esc(pageHref(basePath, page - 1))}" rel="prev" data-key="ArrowLeft" aria-label="Previous page">${uiIcon("prev")}</a>`
    : `<span class="pager-btn keychip is-disabled" aria-disabled="true" aria-label="Previous page">${uiIcon("prev")}</span>`;
  const next = hasNext
    ? `<a class="pager-btn keychip" href="${esc(pageHref(basePath, page + 1))}" rel="next" data-key="ArrowRight" aria-label="Next page">${uiIcon("next")}</a>`
    : `<span class="pager-btn keychip is-disabled" aria-disabled="true" aria-label="Next page">${uiIcon("next")}</span>`;
  const nums = pageWindow(page, totalPages);
  const items = [];
  let prevN = 0;
  for (const n of nums) {
    if (prevN && n > prevN + 1) {
      items.push(`<li class="pager-gap" aria-hidden="true">…</li>`);
    }
    if (n === page) {
      items.push(
        `<li><a href="${esc(pageHref(basePath, n))}" aria-current="page">${n}</a></li>`,
      );
    } else {
      items.push(`<li><a href="${esc(pageHref(basePath, n))}">${n}</a></li>`);
    }
    prevN = n;
  }
  const sizeNav = pageSizes ? pageSizeSelector(meta.pageSize) : "";
  return `<nav class="pager" aria-label="Pagination">
    <div class="pager-main">
      <p class="pager-results-label">Results</p>
      <p class="pager-status"><span class="pager-status-page">${esc(statusPage)}</span><span class="pager-count">${esc(statusCount)}</span></p>
      <div class="pager-controls">
        ${prev}
        <ol class="pager-pages">${items.join("")}</ol>
        ${next}
      </div>
    </div>
    ${sizeNav}
  </nav>`;
}

function isResultList(html) {
  return typeof html === "string" && html.includes("tui-list");
}

function wantsResultsControls(listHtml, pagerHtml) {
  if (isResultList(listHtml)) return true;
  if (!pagerHtml || typeof listHtml !== "string") return false;
  if (listHtml.includes("dash-table") || listHtml.includes("dash-rank-page")) return false;
  return listHtml.includes("No rows on this page");
}

function sliceFirstDiv(html, className) {
  const source = String(html || "");
  const marker = `<div class="${className}">`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = re.exec(source))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return source.slice(start, match.index + match[0].length);
    } else {
      depth += 1;
    }
  }
  return "";
}

function pagerTotalPages(pagerHtml) {
  const match = String(pagerHtml || "").match(/Page \d+ of (\d+)/);
  if (!match) return 1;
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : 1;
}

/** Prev / page numbers / next only. Reuses the controls block pager() already built. */
function compactBottomPager(listHtml, pagerHtml) {
  if (!isResultList(listHtml) || pagerTotalPages(pagerHtml) <= 1) return "";
  const controls = sliceFirstDiv(pagerHtml, "pager-controls");
  if (!controls) return "";
  return `<nav class="pager pager--bottom" aria-label="Pagination (bottom)">${controls}</nav>`;
}

export function listSection(listHtml, pagerHtml, headHtml = "") {
  if (!wantsResultsControls(listHtml, pagerHtml)) {
    return `${headHtml}${pagerHtml}${listHtml}${pagerHtml}`;
  }
  const toolbar = resultsViewControl({ pagerHtml: pagerHtml || "" });
  return `${headHtml}${toolbar}${listHtml}${compactBottomPager(listHtml, pagerHtml)}`;
}

export function dogRow(row) {
  return dogListRow(row, {});
}

export function homeBody({ version }) {
  return `
    <div class="home-wordmark">
      <a class="pixel-link" href="/" aria-label="ExitTrace home">${pixelWordmark("EXITTRACE")}</a>
    </div>
    <p class="ver">v${esc(version || "unknown")}</p>
    <form class="tui-search" action="/search" method="get" role="search">
      <label class="tui-search-label">
        <span class="chev" aria-hidden="true">〉</span>
        <input type="search" name="q" placeholder="Search people, operations, dog comms, red-folder comms, central casting, and unsorted posts..." autocomplete="off" enterkeyhint="search">
      </label>
    </form>
    <p class="home-tag">Sourced public-role exits and official government dog-comms since 2017. A seed set, not a census.</p>`;
}

function eventKindTitle(kind) {
  const cat = categoryById(kind);
  return cat ? cat.title : kind || "Event";
}

function nicknameMetaLine(row) {
  const items = normalizeNicknames(row?.nicknames);
  if (!items.length) return "";
  const trump = items.every(isTrumpNickname);
  const label = trump ? trumpNicknameLabel(items.length) : items.length > 1 ? "Nicknames" : "Nickname";
  return `<p class="meta-line">${esc(label)} · ${esc(items.map((item) => item.name).join(", "))}</p>`;
}

function clearanceMetaLine(row) {
  const items = normalizeClearances(row?.clearances);
  if (!items.length) return "";
  const bits = items.map((item) => {
    const label = clearanceStatusLabel(item.status);
    return item.date ? `${label} · ${formatDate(item.date)}` : label;
  });
  return `<p class="meta-line">${esc(clearanceMetaLabel(items.length))} · ${esc(bits.join("; "))}</p>`;
}

function clearanceSectionList(row) {
  return normalizeClearances(row?.clearances)
    .map((item) => {
      const label = clearanceStatusLabel(item.status);
      const when = item.date
        ? `<p class="meta-line">${esc(label)} · <time datetime="${esc(item.date)}">${esc(formatDate(item.date))}</time></p>`
        : `<p class="meta-line">${esc(label)}</p>`;
      const authority = item.authority ? `<p class="meta-line">${esc(item.authority)}</p>` : "";
      const role = item.role ? `<p class="meta-line">${esc(item.role)}</p>` : "";
      const scope = item.scope ? `<p class="meta-line">${esc(item.scope)}</p>` : "";
      return personEventSection({
        title: "Security clearance",
        kind: "clearance",
        bodyHtml: `${when}${authority}${role}${scope}`,
        cites: item.sources,
        className: "person-event-section clearance-section",
      });
    })
    .filter(Boolean);
}

export function clearanceSections(row) {
  return clearanceSectionList(row).join("");
}

export function nicknameSections(row) {
  return normalizeNicknames(row?.nicknames)
    .map((item) => {
      const title = isTrumpNickname(item) ? "Trump nickname" : "Nickname";
      return personEventSection({
        title,
        kind: "nickname",
        bodyHtml: `<p class="meta-line">${esc(item.name)}</p>`,
        cites: item.sources,
        className: "person-event-section nickname-section",
      });
    })
    .join("");
}

export function personHeader(row, extras = {}) {
  const birth = row.birth_date
    ? `<p class="meta-line">Birth date · <time datetime="${esc(row.birth_date)}">${esc(formatDate(row.birth_date))}</time></p>`
    : "";
  const originValue = originText(row.country_of_origin);
  // Null origin stays blank. Never substitute a country.
  const label = row.name || "";
  const href = isPeopleMediaHref(row.photo) ? String(row.photo || "").trim() : "";
  claimDetailMedia(extras.seen, href);
  const inner = localMediaPortrait(row.photo, label);
  const framed = href
    ? lightboxButton(href, inner, { alt: label, credit: creditWithoutUrls(row.photo_credit) })
    : inner;
  const facts = [
    identityFact("Origin", originValue ? esc(originValue) : ""),
    identityFact("Net worth", netWorthCell(row)),
    identityFact("Tags", personTagChips(row)),
  ].join("");
  return `<header class="person-header">
    ${classificationMediaSlot(framed)}
    <div class="detail-copy">
      <h2 class="detail-title">${esc(row.name || "—")}</h2>
      <div class="identity-facts">${facts}</div>
      ${birth}
      ${nicknameMetaLine(row)}
      ${clearanceMetaLine(row)}
      ${grokipediaBlock(row, extras)}
      ${attributionFrom(row, extras.attributions, "person")}
      ${citeFromRow(row)}
    </div>
  </header>`;
}

/** Cite only. Never dumps synopsis/body already covered by news cites. */
export function grokipediaBlock(row, { filled = [], cite } = {}) {
  const item = cite || grokipediaCite(row, { filled });
  if (!item) return "";
  return `<p class="meta-line grokipedia-cite">Grokipedia · ${citeLink(item.url)}</p>`;
}

function eventSectionCites(ev) {
  return (ev?.sources || []).map((source) => ({
    url: source?.url || "",
    snippet: isUnofficialOrCommentarySocial(source?.url)
      ? ""
      : String(source?.snippet || source?.quote || source?.title || "").trim(),
    source_label: source?.publisher || "",
    title: source?.title || "",
    date: source?.date || "",
  }));
}

function xStatusSource(sources) {
  return (sources || []).find((source) =>
    /(?:^https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i.test(String(source?.url || "")),
  );
}

/** A Justice Department Epstein-file cite is that record, not a generic notable event. */
function notableSectionTitle(ev) {
  const sources = Array.isArray(ev?.sources) ? ev.sources : [];
  const epsteinFile = sources.some((source) =>
    /(?:^https?:\/\/)?(?:www\.)?justice\.gov\/epstein\//i.test(String(source?.url || "")),
  );
  if (epsteinFile) return "Epstein Files";
  const comments = String(ev?.comments || "");
  if (/h\.?\s*res\.?\s*1100/i.test(comments)) return "H. Res. 1100";
  if (/h\.?\s*r\.?\s*8035/i.test(comments)) return "H.R. 8035";
  return "Notable event";
}

function notableMediaFigures(ev) {
  const figures = [];
  const shot = normalizeScreenshotHref(ev?.screenshot, "people");
  if (shot) {
    const xSource = xStatusSource(ev.sources) || null;
    figures.push(
      supportingMediaFigure(
        { src: shot, alt: "X-post screenshot", url: xSource?.url || "" },
        xSource,
      ),
    );
  }
  figures.push(...supportingMediaFigures(displayEventMedia(ev?.media), ev?.sources));
  return figures;
}

/**
 * Bottom Notable block. Same masonry as supporting media, plus factual context and cites.
 * Not the header portrait strip. Empty when the event has no prose, cite, shot, or clip.
 */
function notableEventSection(ev, sourceNumbers) {
  const masonry = supportingMediaHtml(notableMediaFigures(ev));
  const cites = eventCiteParts(ev, sourceNumbers);
  return personEventSection({
    headHtml: eventHeadHtml(esc(notableSectionTitle(ev)), ev.event_date),
    kind: "notable",
    bodyHtml: `${commitProseHtml(ev.comments)}${eventOfficeHtml(ev)}`,
    mediaHtml: masonry,
    cites: cites.cites,
    footHtml: cites.footHtml,
    className: "detail-notable detail-supporting",
    tag: "section",
  });
}

export function notableMediaHtml(row, sourceNumbers) {
  return notableEvents(personEvents(row))
    .map((ev) => notableEventSection(ev, sourceNumbers))
    .filter(Boolean)
    .join("");
}

/** Stored endorsement. It does not replace the card category or date. */
function endorsementEventSection(ev, sourceNumbers) {
  const cites = eventCiteParts(ev, sourceNumbers);
  return personEventSection({
    headHtml: eventHeadHtml("Endorsement", ev.event_date),
    kind: "endorsement",
    bodyHtml: `${commitProseHtml(ev.comments)}${eventOfficeHtml(ev)}`,
    cites: cites.cites,
    footHtml: cites.footHtml,
    className: "detail-endorsement detail-supporting",
    tag: "section",
  });
}

export function endorsementEventHtml(row, sourceNumbers) {
  return personEvents(row)
    .filter((ev) => String(ev?.kind || "").trim() === "endorsement")
    .map((ev) => endorsementEventSection(ev, sourceNumbers))
    .filter(Boolean)
    .join("");
}

/** Recorded yea on the motion to refer H. Res. 1100. It does not replace the card category or date. */
function harassmentEventSection(ev, sourceNumbers) {
  const cites = eventCiteParts(ev, sourceNumbers);
  return personEventSection({
    headHtml: eventHeadHtml("H. Res. 1100", ev?.event_date),
    kind: "harassment_records",
    cites: cites.cites,
    footHtml: cites.footHtml,
    bodyHtml: `${commitProseHtml(ev?.comments)}${eventOfficeHtml(ev)}`,
    className: "detail-house-vote detail-supporting",
    tag: "section",
  });
}

export function harassmentRecordsEventHtml(row, sourceNumbers) {
  return personEvents(row)
    .filter((ev) => String(ev?.kind || "").trim() === "harassment_records")
    .map((ev) => harassmentEventSection(ev, sourceNumbers))
    .filter(Boolean)
    .join("");
}

/** Recorded yea on H.R. 8035. It does not replace the card category or date. */
function ukraineEventSection(ev, sourceNumbers) {
  const cites = eventCiteParts(ev, sourceNumbers);
  return personEventSection({
    headHtml: eventHeadHtml("H.R. 8035", ev?.event_date),
    kind: "ukraine_aid_flags",
    cites: cites.cites,
    footHtml: cites.footHtml,
    bodyHtml: `${commitProseHtml(ev?.comments)}${eventOfficeHtml(ev)}`,
    className: "detail-ukraine-aid detail-supporting",
    tag: "section",
  });
}

export function ukraineAidFlagsEventHtml(row, sourceNumbers) {
  return personEvents(row)
    .filter((ev) => String(ev?.kind || "").trim() === "ukraine_aid_flags")
    .map((ev) => ukraineEventSection(ev, sourceNumbers))
    .filter(Boolean)
    .join("");
}

/** Host and path, scheme and www dropped, so clerk and senate pages compare equal. */
function rollPageKey(url) {
  const canonical = canonicalPublicUrl(url);
  if (!canonical) return "";
  return canonical.replace(/^https?:\/\//, "");
}

/** Catalog roll for this event. A missing or mismatched id stays null. */
function rollForEvent(ev) {
  const id = normalizeRollCall(ev?.roll_call);
  if (!id) return null;
  const roll = VOTE_ROLLS[id];
  if (!roll || roll.tag !== String(ev?.kind || "").trim()) return null;
  return roll;
}

function recordedVoteTitle(ev) {
  const kind = String(ev?.kind || "").trim();
  const roll = rollForEvent(ev);
  if (roll) return voteRollTitle(roll);
  return attributeTagById(kind)?.nav || "Recorded vote";
}

function metaLine(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `<p class="meta-line">${esc(label)} · ${esc(text)}</p>`;
}

function voteEventCites(ev, roll) {
  const cites = eventSectionCites(ev);
  if (!roll) return cites;
  const official = officialRollPageUrl(roll.id);
  if (!official) return cites;
  const pages = new Set((roll.urls || []).map(rollPageKey).filter(Boolean));
  if (cites.some((cite) => pages.has(rollPageKey(cite.url)))) return cites;
  return cites.concat({
    url: official,
    source_label:
      roll.chamber === "House"
        ? "Office of the Clerk, U.S. House of Representatives"
        : "United States Senate",
    date: String(ev?.event_date || roll.date || "").trim(),
  });
}

/** One recorded-no roll. The same section serves every vote-no kind. */
function voteNoEventSection(ev) {
  const kind = String(ev?.kind || "").trim();
  const roll = rollForEvent(ev);
  const when = String(ev?.event_date || "").trim().slice(0, 10);
  const dateHtml = when
    ? `<p class="meta-line">Date · <time datetime="${esc(when)}">${esc(formatDate(when))}</time></p>`
    : "";
  const comments = String(ev?.comments || "").trim();
  const prose = comments && comments !== roll?.id ? commitProseHtml(comments) : "";
  const catalog = roll
    ? [
        metaLine(
          "Chamber",
          `${roll.chamber} · Congress ${roll.congress}, session ${roll.session} · ${roll.chamber === "Senate" ? "vote" : "roll"} ${roll.number}`,
        ),
        metaLine("Question", roll.question),
        metaLine("Stage", voteStageLabel(roll.stage)),
        metaLine("Result", `${roll.result} · ${roll.tally}`),
      ].join("")
    : "";
  return personEventSection({
    headHtml: eventHeadHtml(esc(recordedVoteTitle(ev)), ev?.event_date),
    kind,
    cites: voteEventCites(ev, roll),
    bodyHtml: `${dateHtml}${catalog}${metaLine("Position", "Voted no")}${prose}`,
    className: "detail-recorded-vote detail-supporting",
    tag: "section",
  });
}

/** Vote and endorsement cards oldest first; notables newest date first at the bottom. */
function specialEventNodes(row, sourceNumbers) {
  const render = {
    endorsement: endorsementEventSection,
    harassment_records: harassmentEventSection,
    ukraine_aid_flags: ukraineEventSection,
  };
  for (const kind of VOTE_NO_KINDS) render[kind] = voteNoEventSection;
  const nodes = personEvents(row)
    .filter((ev) => render[String(ev?.kind || "").trim()])
    .sort(compareTimelineEvents)
    .map((ev) => {
      const kind = String(ev.kind).trim();
      const html = render[kind](ev, sourceNumbers);
      return html ? { kind, html } : null;
    })
    .filter(Boolean);
  for (const ev of notableEvents(personEvents(row))) {
    const html = notableEventSection(ev, sourceNumbers);
    if (html) nodes.push({ kind: "notable", html });
  }
  return nodes;
}

/** Shot comm on a person card. Summary and cites stay here; the clip is not a generic supporting tile. */
export function shotEventHtml(row) {
  return personEvents(row)
    .filter((ev) => String(ev?.kind || "").trim() === "shot")
    .map((ev) => {
      const masonry = supportingMediaHtml(notableMediaFigures(ev));
      return personEventSection({
        title: "Shot",
        kind: "shot",
        bodyHtml: masonry,
        summary: String(ev.comments || "").trim(),
        cites: eventSectionCites(ev),
        className: "detail-shot detail-supporting",
        tag: "section",
      });
    })
    .filter(Boolean)
    .join("");
}

/** Outlet name on a clip. The full URL stays in the Sources list. */
function mediaCaptionLink(url, label) {
  const href = String(url || "").trim();
  if (!isHttpUrl(href)) return esc(label || href);
  let text = String(label || "").trim();
  if (!text || text === href) text = hostOf(href) || href;
  return `<a class="source-link" href="${esc(href)}" title="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
}

/** In-page pointers at the numbered Sources list. The full URL stays there once. */
function sourceRefHtml(sources, sourceNumbers) {
  if (!sourceNumbers) return "";
  const refs = [];
  const seen = new Set();
  for (const source of sources || []) {
    const url = String(source?.url || "").trim();
    if (!url) continue;
    const key = canonicalPublicUrl(url) || url;
    const n = sourceNumbers.get(key);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    refs.push(`<a class="source-ref" href="#source-${n}">[${n}]</a>`);
  }
  if (!refs.length) return "";
  return `<p class="event-source-refs"><span class="event-sources-label">Sources</span> ${refs.join(" ")}</p>`;
}

function eventSummaryLine(ev) {
  const comments = String(ev?.comments || "").trim();
  if (comments) return comments;
  const position = standardizePosition(String(ev?.position || "").trim());
  if (position) return position;
  const organization = String(ev?.organization || "").trim();
  if (organization) return organization;
  return "—";
}

export function eventTagRow(ev, { birthDate, sourceNumbers } = {}) {
  const kind = String(ev?.kind || "").trim();
  if (!isPersonTimelineKind(kind)) return "";
  const label =
    kind === "nickname"
      ? isTrumpNickname(ev)
        ? "Trump nickname"
        : "Nickname"
      : kind === "shot"
        ? "Shot"
        : kind === "corona_comms"
          ? categoryById(kind)?.nav || "Corona"
          : kind === "boot_comms"
            ? categoryById(kind)?.nav || "Boot"
            : eventKindTitle(kind);
  const eventDate = String(ev.event_date || "").trim();
  const announcedRaw = String(ev.announced_date || "").trim();
  const announced =
    announcedRaw && announcedRaw !== eventDate
      ? `<p class="meta-line">Announced · <time datetime="${esc(announcedRaw)}">${esc(formatDate(announcedRaw))}</time></p>`
      : "";
  const age = storedAgeAtEvent(ev, birthDate, ev.event_date);
  const ageLine =
    age != null
      ? `<p class="meta-line">Age at event · ${esc(String(age))}</p>`
      : "";
  const groupSize = eventHeadcount(ev);
  const groupLine =
    groupSize > 1
      ? `<p class="meta-line">Group size · ${esc(String(groupSize))}</p>`
      : "";
  const summaryLine = eventSummaryLine(ev);
  const shownAsSummary = new Set();
  if (sourceNumbers) {
    if (String(ev?.comments || "").trim()) shownAsSummary.add("comments");
    else if (standardizePosition(String(ev?.position || "").trim())) shownAsSummary.add("position");
    else if (String(ev?.organization || "").trim()) shownAsSummary.add("organization");
  }
  const attrs = EVENT_ATTR_FIELDS.map((field) => {
    let value = String(ev[field] || "").trim();
    if (!value || shownAsSummary.has(field)) return "";
    if (kind === "nickname" && field === "comments") return "";
    if (field === "status") value = coronaStatusLabel(value) || value;
    if (field === "position") value = standardizePosition(value);
    const name =
      kind === DEATH_UNCONFIRMED_ID && field === "comments"
        ? "Footnote"
        : EVENT_ATTR_LABELS[field] || field;
    return `<p class="meta-line">${esc(name)} · ${esc(value)}</p>`;
  }).join("");
  const unsealedBadge =
    isIndictmentKeepKind(kind) && ev.unsealed === true
      ? ` <span class="keychip event-badge" data-unsealed="true">Unsealed</span>`
      : "";
  const prose = commitProseHtml(summaryLine || "—");
  const facts = `${announced}${ageLine}${groupLine}${attrs}`;
  const factsHtml = facts ? `<div class="event-facts">${facts}</div>` : "";
  const refs = sourceRefHtml(ev?.sources, sourceNumbers);
  const mediaHtml = kind === "shot" ? supportingMediaHtml(notableMediaFigures(ev)) : "";
  return personEventSection({
    headHtml: eventHeadHtml(`${esc(label)}${unsealedBadge}`, eventDate),
    kind,
    cites: sourceNumbers ? [] : eventSectionCites(ev),
    bodyHtml: `${prose}${factsHtml}${refs}`,
    mediaHtml,
    className: kind === "shot" ? "event-tag-row detail-shot" : "event-tag-row",
    tag: "article",
  });
}

export function careerHistory(row) {
  const rows = visibleCareer(row, personEvents(row))
    .map((item) => {
      const line = careerLine(item);
      return line ? `<p class="meta-line career-line">${esc(line)}</p>` : "";
    })
    .filter(Boolean);
  if (!rows.length) return "";
  return `<section class="career-history" aria-label="Career / Service history">
    <h3 class="career-h">Career / Service</h3>
    ${rows.join("")}
  </section>`;
}


/** Epstein Flight Log. Hidden when legs is empty. */
export function epsteinFlightLogSection(legs = [], { note: lead = "" } = {}) {
  const rows = Array.isArray(legs) ? legs.filter(Boolean) : [];
  if (!rows.length) return "";
  const items = rows
    .map((leg) => {
      const rawDate = leg.flight_date;
      const date =
        rawDate instanceof Date
          ? rawDate.toISOString().slice(0, 10)
          : String(rawDate || "").slice(0, 10).trim();
      const route = [leg.dep || leg.dep_code || "?", leg.arr || leg.arr_code || "?"].join(" → ");
      const craft = String(leg.aircraft_tail || leg.aircraft || leg.aircraft_model || "").trim();
      const note = String(leg.comment || "").trim();
      const when = date
        ? `<time datetime="${esc(date)}">${esc(formatDate(date))}</time>`
        : "—";
      const craftBit = craft ? ` · ${esc(craft)}` : "";
      const noteBit = note ? ` · ${esc(note)}` : "";
      return `<li class="epstein-leg">${when} · ${esc(route)}${craftBit}${noteBit}</li>`;
    })
    .join("");
  const leadHtml = String(lead || "").trim()
    ? `<p class="event-summary">${esc(String(lead).trim())}</p>`
    : "";
  return personEventSection({
    title: "Epstein Flight Log",
    kind: "epstein_flight_log",
    bodyHtml: `${leadHtml}<ol class="epstein-flight-log">${items}</ol>`,
  });
}


function compareTimelineEvents(a, b) {
  const da = asEventDate(a?.event_date) || "";
  const db = asEventDate(b?.event_date) || "";
  if (da !== db) {
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  }
  return String(a?.kind || "").localeCompare(String(b?.kind || ""));
}

/** Event date ascending. Undated events stay last. Kind is the tie-break. */
function datedPersonEvents(row) {
  return personEvents(row).slice().sort(compareTimelineEvents);
}

function earliestSourceDate(sources) {
  let date = "";
  for (const source of sources || []) {
    const next = asEventDate(source?.date) || "";
    if (next && (!date || next < date)) date = next;
  }
  return date;
}

/** Nicknames are timeline rows. The date is the earliest official cite day, or blank. */
function nicknameTimelineEvents(row) {
  return normalizeNicknames(row?.nicknames).map((item) => ({
    kind: "nickname",
    by: item.by,
    event_date: earliestSourceDate(
      (item.sources || []).filter((source) => source?.supporting !== true),
    ),
    comments: item.name,
    sources: item.sources || [],
  }));
}

/** Rows on the person timeline. Notable stays at the bottom. dog_comms stays a tag, not a row. */
function isPersonTimelineKind(kind) {
  if (!kind || kind === "notable" || kind === "dog_comms") return false;
  if (kind === "shot" || kind === "nickname") return true;
  return isDisplayedEventKind(kind);
}

/** Dated and undated events, plus nickname rows, in one order. Nothing dated is dropped. */
function personTimelineEvents(row) {
  const events = personEvents(row).filter((ev) => isPersonTimelineKind(String(ev?.kind || "").trim()));
  return events.concat(nicknameTimelineEvents(row)).sort(compareTimelineEvents);
}

function pushPersonSource(items, seen, source) {
  const url = String(typeof source === "string" ? source : source?.url || "").trim();
  if (!url) return;
  const key = canonicalPublicUrl(url) || url;
  if (seen.has(key)) return;
  seen.add(key);
  if (typeof source === "string") {
    items.push({ url });
    return;
  }
  const snippet = isUnofficialOrCommentarySocial(url)
    ? ""
    : String(source.snippet || source.quote || "").trim();
  items.push({
    url,
    publisher: source.publisher || source.source_label || "",
    title: source.title || "",
    date: source.date || "",
    snippet,
  });
}

/** Title fills an empty stored quote the same way an event row used to. */
function eventSourceForList(source) {
  if (!source || typeof source !== "object") return source;
  const snippet = isUnofficialOrCommentarySocial(source.url)
    ? ""
    : String(source.snippet || source.quote || source.title || "").trim();
  return { ...source, snippet };
}

/** Label for the source group that belongs to one stored event. */
function eventSourceLabel(ev) {
  const kind = String(ev?.kind || "").trim();
  const date = String(ev?.event_date || "").trim().slice(0, 10);
  let title = eventKindTitle(kind);
  if (kind === "notable") title = notableSectionTitle(ev);
  else if (kind === "harassment_records") title = "H. Res. 1100";
  else if (kind === "ukraine_aid_flags") title = "H.R. 8035";
  else if (VOTE_NO_KINDS.has(kind)) title = recordedVoteTitle(ev);
  else if (kind === "endorsement") title = "Endorsement";
  else if (kind === "shot") title = "Shot";
  else if (kind === "nickname") title = isTrumpNickname(ev) ? "Trump nickname" : "Nickname";
  const when = date ? formatDate(date) : "";
  return when ? `${when} · ${title}` : title;
}

/** Every cite on the card, once, grouped by the event that owns it. */
function personSourceItems(row, { events = [], centralCastingClips = [], cite } = {}) {
  const items = [];
  const groups = [];
  const seen = new Set();
  const push = (source, label) => {
    const before = items.length;
    pushPersonSource(items, seen, source);
    if (items.length === before) return;
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) {
      group = { label, items: [] };
      groups.push(group);
    }
    group.items.push(items[items.length - 1]);
  };
  for (const item of normalizeNicknames(row?.nicknames)) {
    const label = isTrumpNickname(item) ? "Trump nickname" : "Nickname";
    for (const source of item.sources || []) push(source, label);
  }
  for (const item of normalizeClearances(row?.clearances)) {
    for (const source of item.sources || []) push(source, "Security clearance");
  }
  for (const ev of events) {
    const label = eventSourceLabel(ev);
    for (const source of ev?.sources || []) push(eventSourceForList(source), label);
  }
  for (const url of row?.central_casting || []) push(url, "Central casting");
  for (const clip of centralCastingClipsFor(row, centralCastingClips)) {
    if (clip?.source_url) {
      push({
        url: clip.source_url,
        publisher: String(clip.account_name || clip.handle || "").trim(),
        date: clip.posted_at || "",
      }, "Central casting");
    }
    for (const entry of kindSupportingEntries(clip)) {
      push({
        url: entry.source_url,
        publisher: String(entry.account_name || entry.handle || "").trim(),
        date: entry.posted_at || "",
      }, "Central casting");
    }
  }
  if (cite?.url) push(cite, "Grokipedia");
  if (row?.net_worth_source) push({ url: row.net_worth_source }, "Net worth");
  return { items, groups };
}

function sourceNumberMap(items) {
  const map = new Map();
  items.forEach((item, i) => {
    const url = String(item?.url || "").trim();
    const key = canonicalPublicUrl(url) || url;
    if (key && !map.has(key)) map.set(key, i + 1);
  });
  return map;
}

function personSourcesHtml(groups) {
  const list = Array.isArray(groups) ? groups.filter((group) => group?.items?.length) : [];
  if (!list.length) return "";
  let n = 1;
  const blocks = list.map((group) => {
    const cites = group.items.map((s) => ({
      url: s.url,
      snippet: s.snippet || "",
      source_label: s.publisher || "",
      title: s.title || "",
      date: s.date || "",
    }));
    const html = sectionCiteList(cites, { anchor: true, start: n });
    n += cites.length;
    const label = String(group.label || "").trim();
    const head = label ? `<h4 class="source-group-h">${esc(label)}</h4>` : "";
    return `<section class="source-group">${head}${html}</section>`;
  }).join("");
  return `<section class="person-sources" aria-label="Sources"><h3 class="event-h">Sources</h3>${blocks}</section>`;
}

function eventTimeline(row, events, clips = [], epsteinLegs = [], seen, sourceNumbers) {
  const nodes = clearanceSectionList(row).map((html) => ({ kind: "clearance", html }));
  for (const ev of events || []) {
    const kind = String(ev.kind || "").trim();
    if (!isPersonTimelineKind(kind)) continue;
    const html = eventTagRow(ev, { birthDate: row.birth_date, sourceNumbers });
    if (html) nodes.push({ kind, html });
  }
  const centralCasting = centralCastingDetailHtml(row, clips, seen);
  if (centralCasting) nodes.push({ kind: "central_casting", html: centralCasting });
  const flightNote =
    row.category === EPSTEIN_CLIENTS_CATEGORY ? String(row.summary || "").trim() : "";
  const epstein = epsteinFlightLogSection(epsteinLegs, { note: flightNote });
  if (epstein) nodes.push({ kind: "epstein_flight_log", html: epstein });
  nodes.push(...specialEventNodes(row, sourceNumbers));
  const graph = renderEventGraph(nodes);
  if (!graph) return "";
  return `<section class="event-timeline" aria-label="Event timeline">${graph}</section>`;
}

function personTagChips(row) {
  const tags = personTags(row);
  const cat = categoryById(row.category);
  const main = catalogMainPath(cat?.path || "/firings");
  const chips = tags
    .map((id) => {
      const fact = attributeTagById(id);
      if (fact) {
        return `<a class="keychip" href="${esc(attributeTagHref(fact))}">${esc(fact.nav)}</a>`;
      }
      const tag = IDENTITY_TAGS.find((t) => t.id === id);
      if (!tag) return "";
      return `<a class="keychip" href="${esc(filterPath(main, { tags: [id] }))}">${esc(tag.nav)}</a>`;
    })
    .filter(Boolean);
  // dog_comms is a post catalog, not a people.tags id. The chip is the event.
  if (personEvents(row).some((ev) => String(ev?.kind || "").trim() === "dog_comms")) {
    chips.push(`<a class="keychip" href="/dog-comms">Dog comms</a>`);
  }
  if (!chips.length) return "";
  return `<p class="person-tags"><span class="person-tags-label">Tags</span> ${chips.join("")}</p>`;
}

export function personDetail(row, { centralCastingClips = [], epsteinLegs = [], attributions } = {}) {
  const { row: filled, filled: keys, cite } = fillEmptyFromGrokipedia(row);
  const seen = detailMediaSeen();
  const events = datedPersonEvents(filled);
  const timeline = personTimelineEvents(filled);
  const sourceBundle = personSourceItems(filled, { events, centralCastingClips, cite });
  const sourceNumbers = sourceNumberMap(sourceBundle.items);
  return `<article class="detail person-detail">
    ${detailShell({
      title: "Identity",
      mediaHtml: personHeader(filled, { filled: keys, cite, attributions, seen }),
      afterHtml: `${careerHistory(filled)}${eventTimeline(filled, timeline, centralCastingClips, epsteinLegs, seen, sourceNumbers)}${personSourcesHtml(sourceBundle.groups)}${personSupportingMediaHtml(filled, seen)}`,
      active: true,
      extraClass: "person-pane",
    })}
  </article>`;
}

function sourceUrlItems(row) {
  const items = [];
  if (row.source_url) {
    items.push({ url: row.source_url, publisher: "Original post", title: "Original post", date: row.posted_at || "" });
  }
  if (row.quoted_url) {
    items.push({ url: row.quoted_url, publisher: "Quoted URL", title: "Quoted URL", date: "" });
  }
  if (row.card_url) {
    items.push({ url: row.card_url, publisher: "Card URL", title: "Card URL", date: "" });
  }
  for (const [i, url] of (row.media_urls || []).entries()) {
    items.push({ url, publisher: `Media ${i + 1}`, title: "Public media", date: "" });
  }
  return items;
}

export function sourcePostDetail(row) {
  const cat = categoryById(row.category);
  const kind = cat ? cat.title : row.category;
  const sources = sourceUrlItems(row);
  return `<article class="detail">
    ${boxFrame(
      "Metadata",
      `<div class="meta-pane">
      <span class="initials detail-photo" aria-hidden="true">—</span>
      <div class="detail-copy">
        <h2 class="detail-title">—</h2>
        <p class="rating">★ ${esc(formatUsd(null))} <span class="muted">Net worth (published estimate)</span></p>
        <p class="meta-line">Event date · —</p>
        <p class="meta-line">Kind · ${esc(kind)}</p>
        ${citeFromRow(row)}
      </div>
    </div>`,
      { extraClass: "meta-box" },
    )}
    ${boxFrame(
      `● Sources · ${sources.length} available · 1/${sources.length || 0}`,
      sourceList(sources),
      { active: true, extraClass: "sources-pane" },
    )}
  </article>`;
}

export function operationDetail(row, { attributions } = {}) {
  const tags = normalizeOperationTags(row.tags);
  const tagLine = tags.length
    ? tags.map((id) => operationTagLabel(id)).join(", ")
    : "—";
  const agencies = (row.agencies || []).filter(Boolean).join(", ") || "—";
  const announced =
    row.announced_date && row.announced_date !== row.event_date
      ? `<p class="meta-line">Announced · <time datetime="${esc(row.announced_date)}">${esc(formatDate(row.announced_date))}</time></p>`
      : "";
  const sources = row.sources || [];
  const sourceHtml = sources.length
    ? `<h3 class="pane-h">Sources</h3>${citeList(sources)}`
    : "";
  const portrait = operationPortraitFrom(row);
  return `<article class="detail operation-detail" data-operation-id="${esc(row.id)}">
    ${detailShell({
      title: "Operation",
      mediaHtml: detailMediaStrip({
        portraitHtml: localMediaPortrait(portrait.photo, row.name || "OP"),
        portraitSrc: portrait.photo,
        portraitAlt: row.name || "OP",
        portraitCredit: portrait.photo_credit,
        screenshot: row.screenshot,
        screenshotAlt: `X-post screenshot of ${row.name || "operation"}`,
        metaHtml: detailMetaBlock({
          title: row.name || "—",
          lines: [
            `<p class="meta-line">Event date · <time datetime="${esc(row.event_date || "")}">${esc(formatDate(row.event_date))}</time></p>`,
            announced,
            `<p class="meta-line">Agencies · ${esc(agencies)}</p>`,
            `<p class="meta-line">Tags · ${esc(tagLine)}</p>`,
            `<p class="meta-line">Victims · ${esc(countCell(row.victim_count))}</p>`,
            `<p class="meta-line">Arrests · ${esc(countCell(row.arrest_count))}</p>`,
          ],
          citeHtml: citeFromRow(row),
          attributionHtml: attributionFrom(row, attributions, "operation"),
          bodyTitle: "Summary",
          bodyHtml: `<p class="synopsis">${esc(row.summary || "—")}</p>`,
          sourceKind: "sources",
          sourceHtml,
        }),
      }),
      active: true,
      extraClass: "meta-box",
    })}
  </article>`;
}

const OFFICIAL_POST_IDS = new Set(["dog", "red_folder", "eagle", "ronald", "shot"]);

function commsAttributionSurface(specId) {
  if (specId === "dog") return "dog_comm";
  if (specId === "red_folder") return "red_folder_comm";
  if (specId === "central_casting") return "central_casting_comm";
  return "";
}

/** Context and citations: the official Source, then each supporting cite. No media. */
function officialPostContextHtml(spec, row) {
  const parts = [
    detailMetaBlock({
      sourceHtml: kindSourceHtml(row, { includeSupporting: false }),
    }),
  ];
  for (const entry of kindSupportingEntries(row)) {
    if (spec.supportingGroups) {
      parts.push(
        `<div class="detail-context-entry" data-supporting-index="${esc(String(entry.index))}">${detailMetaBlock({
          citeHtml: citeFromRow({
            handle: entry.handle,
            account_name: entry.account_name,
            posted_at: entry.posted_at,
            text: entry.text,
          }),
          sourceHtml: detailSourceLine(entry.source_url),
        })}</div>`,
      );
    } else {
      const label = entry.handle ? `Supporting · ${entry.handle}` : "Supporting";
      parts.push(
        detailMetaBlock({
          sourceHtml: detailSourceLine(entry.source_url, { label }),
        }),
      );
    }
  }
  return `<section class="detail-context" aria-label="Context and citations">${parts.join("")}</section>`;
}

function namedNeedles(row) {
  const named = row?.snapshot?.named;
  if (!Array.isArray(named)) return [];
  return named.map((n) => String(n || "").trim().toLowerCase()).filter(Boolean);
}

/** A stored `snapshot.named` list is who the post mentions. The speaker stays off that list. */
function personIsNamed(person, needles) {
  if (!needles.length) return true;
  const name = String(person?.name || "").trim().toLowerCase();
  if (!name) return false;
  return needles.some((n) => n === name || name.includes(n) || n.includes(name));
}

/** Resolved person rows in snapshot.person_ids order. Unknown ids are omitted. */
function linkedPeopleForDetail(row, people) {
  const ids = linkedPersonIds(row?.snapshot);
  if (!ids.length) return [];
  const byId = new Map();
  for (const person of people || []) {
    const id = String(person?.id || "").trim();
    if (id && !byId.has(id)) byId.set(id, person);
  }
  const needles = namedNeedles(row);
  return ids
    .map((id) => byId.get(id))
    .filter((person) => person && personIsNamed(person, needles));
}

/** Compact person cards. No post media — the shared post sits in supporting media. */
function officialPostLinkedHtml(people) {
  if (!people.length) return "";
  const cards = people.map((person) => personRow(person)).join("");
  return `<section class="detail-linked-people" aria-label="Linked individuals"><h3 class="event-h">Linked individuals</h3><div class="people-list tui-list">${cards}</div></section>`;
}

/**
 * The comm itself as one supporting entry: X screenshot, local video, and poster.
 * Files already claimed by the main strip are omitted by the shared seen bag.
 */
function officialPostOwnSupportTiles(spec, row, seen) {
  const videoHref = localCommVideoHref(row, spec.mediaDir);
  const stillHref = isCommsMediaHref(row.still, spec.mediaDir) ? row.still : "";
  const photo = videoHref
    ? commVideoInner(videoHref, stillHref, `Stored video for ${row.handle}`)
    : "";
  const extras = stillHref
    ? [{ src: stillHref, alt: `Post media for ${row.handle}`, credit: row.still_credit || "" }]
    : [];
  return detailMediaTiles({
    portraitHtml: photo,
    portraitSrc: videoHref,
    portraitAlt: videoHref ? `Stored video for ${row.handle}` : "",
    portraitCredit: row.still_credit,
    portraitKind: videoHref ? "video" : "image",
    portraitPoster: videoHref ? stillHref : "",
    screenshot: row.screenshot,
    screenshotAlt: `X-post screenshot of ${row.handle}`,
    screenshotCredit: row.screenshot_credit,
    extraMedia: extras,
    seen,
    tileData: { "supporting-own": "post" },
  });
}

/** Supporting stills and screenshots in ONE shared masonry. Omitted when nothing stored remains. */
function officialPostSupportHtml(spec, row, seen, { includeOwnPost = false } = {}) {
  const tiles = includeOwnPost ? officialPostOwnSupportTiles(spec, row, seen) : [];
  for (const entry of kindSupportingEntries(row)) {
    tiles.push(...supportingEntryTiles(spec.id, row, entry, seen));
  }
  return supportingMediaSection(tiles);
}

/** dog / red_folder / eagle / ronald / shot: main post, context, linked people, supporting media. */
function officialPostDetail(spec, row, { attributions, linkedPeople } = {}) {
  const seen = detailMediaSeen();
  const people = linkedPeopleForDetail(row, linkedPeople);
  const videoHref = localCommVideoHref(row, spec.mediaDir);
  const stillHref = isCommsMediaHref(row.still, spec.mediaDir) ? String(row.still).trim() : "";
  const shotHref = normalizeScreenshotHref(row.screenshot, spec.screenshotKind);
  const dogOne = spec.id === "dog" && shotHref;
  const extras = kindExtraStills(spec.id, row, { includeSupporting: false }).map((src) => ({
    src,
    alt: `Post media for ${row.handle}`,
    credit: row.still_credit || "",
  }));
  let portraitHtml = "";
  let portraitSrc = "";
  let portraitAlt = "";
  let portraitCredit = "";
  let portraitKind = "image";
  let portraitPoster = "";
  let portraitTile = "";
  let screenshot = "";
  let screenshotCredit = "";
  let extraMedia = extras;
  let claimHrefs = [];
  if (dogOne && videoHref) {
    portraitAlt = `X-post screenshot of ${row.handle}`;
    portraitHtml = postShotFrame({ shot: shotHref, video: videoHref, alt: portraitAlt });
    portraitSrc = videoHref;
    portraitCredit = row.screenshot_credit;
    portraitKind = "video";
    portraitPoster = stillHref;
    portraitTile = "postshot";
    claimHrefs = [shotHref, stillHref];
  } else if (dogOne) {
    portraitAlt = `X-post screenshot of ${row.handle}`;
    portraitHtml = `<img class="detail-photo screenshot" src="${esc(versionedMediaHref(shotHref))}" alt="${esc(portraitAlt)}" decoding="async">`;
    portraitSrc = shotHref;
    portraitCredit = row.screenshot_credit;
    portraitTile = "screenshot";
    claimHrefs = [stillHref];
  } else {
    portraitHtml = videoHref
      ? commVideoInner(videoHref, stillHref, `Stored video for ${row.handle}`)
      : localMediaPortrait(row.still, `Stored still for ${row.handle}`, {
          commsKind: spec.id,
        });
    portraitSrc = videoHref || stillHref;
    portraitAlt = videoHref ? `Stored video for ${row.handle}` : `Stored still for ${row.handle}`;
    portraitCredit = row.still_credit;
    portraitKind = videoHref ? "video" : "image";
    portraitPoster = videoHref ? stillHref : "";
    // Linked people share this post once at the bottom. Leave the X screenshot
    // unclaimed here so section 4 can draw it; the video and poster stay on top.
    screenshot = people.length ? "" : row.screenshot;
    screenshotCredit = people.length ? "" : row.screenshot_credit;
  }
  const mediaHtml = detailMediaStrip({
    portraitHtml,
    portraitSrc,
    portraitAlt,
    portraitCredit,
    portraitKind,
    portraitPoster,
    portraitTile,
    screenshot,
    screenshotAlt: `X-post screenshot of ${row.handle}`,
    screenshotCredit,
    extraMedia,
    claimHrefs,
    seen,
    metaHtml: detailMetaBlock({
      citeHtml: citeFromRow(row),
      attributionHtml: attributionFrom(row, attributions, commsAttributionSurface(spec.id)),
    }),
  });
  return `<article class="detail ${spec.detailClass}">
    ${detailShell({
      title: "Metadata",
      mediaHtml: `<section class="detail-official-post" aria-label="Main post">${mediaHtml}</section>`,
      metaHtml: officialPostContextHtml(spec, row),
      afterHtml: `${officialPostLinkedHtml(people)}${officialPostSupportHtml(spec, row, seen, {
        includeOwnPost: people.length > 0,
      })}`,
      active: true,
      extraClass: "meta-box",
    })}
  </article>`;
}

/** Shared harvest detail. Official-post kinds stack three sections. Central Casting keeps the mixed group. */
export function commsDetail(spec, row, options = {}) {
  if (OFFICIAL_POST_IDS.has(spec?.id)) return officialPostDetail(spec, row, options);
  const { attributions } = options;
  const grouped = !!spec.supportingGroups;
  const seen = detailMediaSeen();
  const videoHref = localCommVideoHref(row, spec.mediaDir);
  const stillHref = isCommsMediaHref(row.still, spec.mediaDir) ? row.still : "";
  const photo = videoHref
    ? commVideoInner(videoHref, stillHref, `Stored video for ${row.handle}`)
    : localMediaPortrait(row.still, `Stored still for ${row.handle}`, {
        commsKind: spec.id,
      });
  const extras = kindExtraStills(spec.id, row, { includeSupporting: !grouped }).map((src) => ({
    src,
    alt: `Post media for ${row.handle}`,
    credit: row.still_credit || "",
  }));
  // Main strip first so a later supporting copy of the same bytes is the one omitted.
  const mediaHtml = detailMediaStrip({
    portraitHtml: photo,
    portraitSrc: videoHref || stillHref,
    portraitAlt: videoHref ? `Stored video for ${row.handle}` : `Stored still for ${row.handle}`,
    portraitCredit: row.still_credit,
    portraitKind: videoHref ? "video" : "image",
    portraitPoster: videoHref ? stillHref : "",
    screenshot: row.screenshot,
    screenshotAlt: `X-post screenshot of ${row.handle}`,
    screenshotCredit: row.screenshot_credit,
    extraMedia: extras,
    seen,
    metaHtml: detailMetaBlock({
      citeHtml: citeFromRow(row),
      attributionHtml: attributionFrom(row, attributions, commsAttributionSurface(spec.id)),
      sourceHtml: kindSourceHtml(row, { includeSupporting: !grouped }),
    }),
  });
  const groups = grouped ? kindSupportingGroupsHtml(spec.id, row, seen) : "";
  return `<article class="detail ${spec.detailClass}">
    ${detailShell({
      title: "Metadata",
      mediaHtml,
      active: true,
      extraClass: "meta-box",
    })}${groups}
  </article>`;
}

export function kindDetail(kind, row, options) {
  return commsDetail(commsKind(kind), row, options);
}

export function dogDetail(row, options) {
  return kindDetail("dog", row, options);
}

export function searchBody(items, q) {
  if (!String(q || "").trim()) {
    return `<p class="empty">Type a name, role, handle, or stored post text. Search stays local.</p>`;
  }
  if (!items.length) {
    return `<p class="empty">No seeded rows match that query.</p>`;
  }
  const people = [];
  const operations = [];
  const comms = [];
  const sources = [];
  for (const item of items) {
    if (item.type === "source") sources.push(item);
    else if (isCommsKind(item.type)) comms.push(item);
    else if (item.type === "operation") operations.push(item);
    else people.push(item);
  }
  let first = true;
  const render = (item) => {
    const selected = first;
    first = false;
    if (isCommsKind(item.type)) {
      return kindListRow(item.type, item.row, { selected });
    }
    if (item.type === "source") return sourcePostRow(item.row, { selected });
    if (item.type === "operation") return operationRow(item.row, { selected });
    return personRow(item.row, { selected, showDeath: isDeathCategory(item.row.category) });
  };
  const blocks = [];
  if (people.length) blocks.push(people.map(render).join(""));
  if (operations.length) blocks.push(operations.map(render).join(""));
  if (comms.length) blocks.push(comms.map(render).join(""));
  if (sources.length) {
    blocks.push(
      `<section class="tui-group unsorted-group">
      <h2 class="tui-group-h">Unsorted</h2>
      ${sources.map(render).join("")}
    </section>`,
    );
  }
  return `<div class="tui-list search-list">${blocks.join("")}</div>`;
}

export function downloadsBody() {
  return `
    ${boxFrame(
      "● Data pack",
      `<p>The media pack (portraits, dog-comm stills, and the JSON seed) is published as a GitHub Release zip. This page describes that pack. It does not download or fetch the zip when you open it.</p>
      <dl class="facts">
        <dt>Moving tag</dt>
        <dd><code>data-latest</code></dd>
        <dt>Dated tag</dt>
        <dd><code>data-YYYYMMDD</code></dd>
        <dt>Asset</dt>
        <dd><code>exittrace-data-YYYYMMDD.zip</code> plus a matching <code>.sha256</code></dd>
        <dt>Release URL</dt>
        <dd><a href="https://github.com/areveur51/ExitTrace/releases">https://github.com/areveur51/ExitTrace/releases</a></dd>
      </dl>
      <p>To unpack a pack you already downloaded:</p>
      <pre><code>./scripts/fetch-data.sh
# or pass a zip URL:
./scripts/fetch-data.sh https://github.com/areveur51/ExitTrace/releases/download/data-latest/exittrace-data-YYYYMMDD.zip</code></pre>
      <p>The committed <code>data/seed.json</code> is enough to run the app. The zip is for redistributing the same seed plus <code>media/</code>.</p>`,
      { active: true },
    )}`;
}

function keepUpDash(v) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function keepUpFacts(keep) {
  if (!keep || typeof keep !== "object") return "";
  const rows = [
    ["timezone", keep.timezone || "America/New_York"],
    ["logical.stream_started", keepUpDash(keep.logical?.stream_started)],
    ["logical.last_verify", keepUpDash(keep.logical?.last_verify)],
    ["logical.lag_seconds", keepUpDash(keep.logical?.lag_seconds)],
    ["logical.apply_state", keepUpDash(keep.logical?.apply_state)],
    ["logical.apply_error_count", keepUpDash(keep.logical?.apply_error_count)],
    ["media_delta.last_success", keepUpDash(keep.media_delta?.last_success)],
    ["media_delta.last_with_files", keepUpDash(keep.media_delta?.last_with_files)],
    ["daily_ingest.last_pass", keepUpDash(keep.daily_ingest?.last_pass)],
    ["daily_pack.last_pass", keepUpDash(keep.daily_pack?.last_pass)],
    ["dump_restore.last_success", keepUpDash(keep.dump_restore?.last_success)],
    ["dump_restore.mode", keepUpDash(keep.dump_restore?.mode)],
  ];
  return `<h2 class="keep-up-h">keep_up</h2>
    <dl class="facts keep-up">${rows
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join("")}</dl>`;
}

export function healthBody(payload) {
  const keepHtml = keepUpFacts(payload?.keep_up);
  return boxFrame(
    "Health",
    `${keepHtml}<pre class="health">${esc(JSON.stringify(payload, null, 2))}</pre>`,
    { active: true },
  );
}

function dashCount(n) {
  if (n === null || n === undefined || n === "") {
    return `<span class="dash-count" data-count="">—</span>`;
  }
  const num = Math.max(0, Number(n) || 0);
  return `<span class="dash-count" data-count="${num}">${num}</span>`;
}

/** Cap SVG points so dashboard HTML stays small. First and last keys remain. */
export const DASH_CHART_MAX_POINTS = 96;

export function downsampleChartSeries(rows, max = DASH_CHART_MAX_POINTS) {
  const list = Array.isArray(rows) ? rows : [];
  const cap = Math.max(2, Number(max) || DASH_CHART_MAX_POINTS);
  if (list.length <= cap) return list;
  const out = [];
  const last = list.length - 1;
  let prev = -1;
  for (let i = 0; i < cap; i++) {
    const idx = i === cap - 1 ? last : Math.round((i * last) / (cap - 1));
    if (idx === prev) continue;
    out.push(list[idx]);
    prev = idx;
  }
  return out;
}

function dashChart(series, { title, kind = "line" } = {}) {
  const rows = downsampleChartSeries(Array.isArray(series) ? series : []);
  const values = rows.map((r) => Number(r.count) || 0);
  const w = 360;
  const h = 96;
  const padX = 10;
  const padY = 8;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const max = Math.max(1, ...values);
  if (!rows.length) {
    return `<div class="dash-chart empty" role="img" aria-label="${esc(title)}: no dates">
      <p class="empty">No rows on this page</p>
    </div>`;
  }
  const pts = values.map((v, i) => {
    const x = padX + (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW);
    const y = padY + innerH - (v / max) * innerH;
    return { x, y, v, key: rows[i]?.key || "" };
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const bars =
    kind === "bar"
      ? pts
          .map((p, i) => {
            const bw = Math.max(2, innerW / Math.max(values.length, 1) - 1);
            const x = padX + (i + 0.5) * (innerW / values.length) - bw / 2;
            const bh = innerH - (p.y - padY);
            return `<rect class="dash-bar" x="${x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, bh).toFixed(1)}" data-date="${esc(p.key)}" data-count="${p.v}" tabindex="0"><title>${esc(p.key)} · ${p.v}</title></rect>`;
          })
          .join("")
      : "";
  const dots =
    kind === "bar"
      ? ""
      : pts
          .map(
            (p) =>
              `<circle class="dash-pt" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" data-date="${esc(p.key)}" data-count="${p.v}" tabindex="0"><title>${esc(p.key)} · ${p.v}</title></circle>`,
          )
          .join("");
  const first = rows[0]?.key || "";
  const last = rows[rows.length - 1]?.key || "";
  return `<div class="dash-chart" role="img" aria-label="${esc(title)}: ${values.length} points from ${esc(first)} to ${esc(last)}">
    <svg class="dash-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <path class="dash-line" d="${esc(d)}" fill="none"></path>
      ${bars}
      ${dots}
    </svg>
    <p class="dash-tip" hidden role="tooltip"></p>
    <p class="dash-chart-ends"><span>${esc(first)}</span><span>${esc(last)}</span></p>
  </div>`;
}

function dashRankTable(rows, { empty = "No rows on this page", selfPath = "", rowData } = {}) {
  if (!rows.length) {
    return `<p class="empty">${esc(empty)}</p>`;
  }
  return `<table class="dash-table">
    <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Count</th></tr></thead>
    <tbody>
      ${rows
        .map((row, i) => {
          const hop = row.href && row.href !== selfPath;
          const name = hop
            ? `<a class="dash-link" href="${esc(row.href)}">${esc(row.label)}</a>`
            : `<span class="dash-label">${esc(row.label)}</span>`;
          const extra = typeof rowData === "function" ? rowData(row, i) : "";
          return `<tr${extra}>
            <td class="dash-rank">${i + 1}</td>
            <td>${name}</td>
            <td class="dash-n">${dashCount(row.count)}</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;
}

export function dashRangeNav(range, { path = "/dashboard", extra = {} } = {}) {
  const current = resolveDashRange(range);
  const chips = DASH_RANGE_PRESETS.filter((p) => p.id !== "custom")
    .map((p) => {
      const on = current.id === p.id;
      return `<a class="keychip dash-range-btn" href="${esc(dashRangeHref(path, { id: p.id }, extra))}" data-dash-range-set="${esc(p.id)}"${
        on ? ' aria-current="page"' : ""
      }>${esc(p.label)}</a>`;
    })
    .join("");
  const customOn = current.id === "custom";
  const band = parseAgeBand(extra.band);
  const bandHidden = band
    ? `<input type="hidden" name="band" value="${esc(band.id)}">`
    : "";
  const missing = parseMissingField(extra.field);
  const fieldHidden = missing
    ? `<input type="hidden" name="field" value="${esc(missing.id)}">`
    : "";
  return `<nav class="dash-range" aria-label="Event date range">
    <span class="dash-range-label" id="dash-range-label">Event date</span>
    <div class="dash-range-btns" role="group" aria-labelledby="dash-range-label">
      ${chips}
    </div>
    <form class="dash-range-custom" method="get" action="${esc(String(path || "/dashboard").split("?")[0])}">
      <input type="hidden" name="range" value="custom">
      ${bandHidden}
      ${fieldHidden}
      <label class="dash-range-field">From <input type="date" name="from" value="${esc(current.id === "custom" ? current.from : "")}"></label>
      <label class="dash-range-field">To <input type="date" name="to" value="${esc(current.id === "custom" ? current.to : "")}"></label>
      <button type="submit" class="keychip dash-range-apply" data-dash-range-set="custom"${
        customOn ? ' aria-current="page"' : ""
      }>Custom</button>
    </form>
  </nav>`;
}

export function dashboardBody(model, { path = "/dashboard", range } = {}) {
  const active = resolveDashRange(range || model.range);
  const dims = (model.dimensions || [])
    .map((dim) => {
      const more = `<p class="dash-more"><a class="keychip" href="${esc(dashRangeHref(dim.path, active))}">All by ${esc(dim.nav)}</a></p>`;
      return `<section class="dash-block" data-dash-dim="${esc(dim.id)}">
        ${boxFrame(
          `Top ${Math.max(dim.top.length, 1)} by ${dim.nav}`,
          `${dashRankTable(dim.top, { selfPath: dim.path })}${more}`,
          { extraClass: "dash-box" },
        )}
      </section>`;
    })
    .join("");
  const trends = model.trends || { total: [], perMonth: [], perWeek: [], events: 0, last: 0 };
  return `<div class="dash-hud">
    ${dashRangeNav(active, { path })}
    <section class="dash-stats" aria-label="Live counts">
      <p class="dash-stat"><span class="dash-stat-label">People</span> ${dashCount(model.people)}</p>
      <p class="dash-stat"><span class="dash-stat-label">Events</span> ${dashCount(trends.events)}</p>
      <p class="dash-stat"><span class="dash-stat-label">Operations</span> ${dashCount(model.operations?.all?.operations)}</p>
      <p class="dash-stat"><span class="dash-stat-label">Victims</span> ${dashCount(model.operations?.all?.victims)}</p>
      <p class="dash-stat"><span class="dash-stat-label">Arrests</span> ${dashCount(model.operations?.all?.arrests)}</p>
      <a class="dash-stat" href="/indictments?tags=unsealed" data-unsealed-count="${Math.max(0, Number(model.unsealed) || 0)}"><span class="dash-stat-label">Unsealed</span> ${dashCount(model.unsealed ?? 0)}</a>
      <a class="dash-stat" href="/deaths/unconfirmed" data-death-unconfirmed="${Math.max(0, Number(model.unconfirmed) || 0)}"><span class="dash-stat-label">Unconfirmed*</span> ${dashCount(model.unconfirmed ?? 0)}</a>
    </section>
    <div class="dash-standings">
      ${operationStandingBlock(model.operations)}
      ${ageStandingBlock(model.age, active)}
      ${missingStandingBlock(model.missing, model.operationsMissing, active)}
    </div>
    <div class="dash-grid">${dims}</div>
    <section class="dash-trends" aria-label="Event-date trends">
      <section class="dash-block">
        ${boxFrame("Trends · total", dashChart(trends.total, { title: "Total events" }), { extraClass: "dash-box" })}
      </section>
      <section class="dash-block">
        ${boxFrame("Trends · per month", dashChart(trends.perMonth, { title: "Events per month", kind: "bar" }), { extraClass: "dash-box" })}
      </section>
      <section class="dash-block">
        ${boxFrame("Trends · per week", dashChart(trends.perWeek, { title: "Events per week", kind: "bar" }), { extraClass: "dash-box" })}
      </section>
    </section>
  </div>`;
}

export function dashboardRankBody(dim, rows, { range } = {}) {
  const active = resolveDashRange(range);
  return `<div class="dash-hud dash-rank-page" data-dash-dim="${esc(dim.id)}">
    ${dashRangeNav(active, { path: dim.path })}
    ${boxFrame(`All by ${dim.nav}`, dashRankTable(rows, { selfPath: dim.path }), { extraClass: "dash-box", active: true })}
  </div>`;
}

function ageStandingBlock(bands, range) {
  const rows = Array.isArray(bands) && bands.length ? bands : AGE_BANDS.map((b) => ({
    key: b.id,
    label: b.label,
    count: 0,
  }));
  const ranked = rows.map((row) => {
    const count = Math.max(0, Number(row.count) || 0);
    return {
      key: row.key,
      label: row.label,
      count,
      href: dashRangeHref(DASH_AGE.path, range, { band: row.key }),
    };
  });
  const more = `<p class="dash-more"><a class="keychip" href="${esc(dashRangeHref(DASH_AGE.path, range))}" aria-label="All ages">All ages</a></p>`;
  return `<section class="dash-block" data-dash-dim="age" aria-label="Counts by Age">
    ${boxFrame(
      "Counts by Age",
      `${dashRankTable(ranked, {
        selfPath: DASH_AGE.path,
        rowData: (row) =>
          ` data-age-band="${esc(row.key)}" data-age-count="${Math.max(0, Number(row.count) || 0)}"`,
      })}${more}`,
      { extraClass: "dash-box" },
    )}
  </section>`;
}

export function ageBandFilterNav({ band, range } = {}) {
  const current = parseAgeBand(band);
  const options = [
    { href: dashRangeHref(DASH_AGE.path, range), label: "All ages", id: "all" },
    ...AGE_BANDS.map((b) => ({
      href: dashRangeHref(DASH_AGE.path, range, { band: b.id }),
      label: b.label,
      id: b.id,
    })),
  ];
  const currentId = current?.id || "all";
  const opts = options
    .map((o) => {
      const on = o.id === currentId;
      return `<option value="${esc(o.href)}"${on ? " selected" : ""}>${esc(o.label)}</option>`;
    })
    .join("");
  return `<nav class="identity-filters age-band-filters" aria-label="Age filters">
    <label class="identity-filters-label" for="age-band-filter">Age</label>
    <select class="identity-filter-select" id="age-band-filter" data-filter-select>${opts}</select>
  </nav>`;
}

export function dashboardAgeBody({ range, band } = {}) {
  const active = resolveDashRange(range);
  const extra = band ? { band: band.id } : {};
  return `<div class="dash-hud dash-age-page" data-dash-dim="age">
    ${dashRangeNav(active, { path: DASH_AGE.path, extra })}
    ${ageBandFilterNav({ band: band?.id, range: active })}
  </div>`;
}

function missingPct(count, total) {
  const c = Math.max(0, Number(count) || 0);
  const t = Math.max(0, Number(total) || 0);
  if (!t) return 0;
  return Math.min(100, Math.round((c / t) * 100));
}

function missingTile({ key, label, count, total, href, op = false }) {
  const c = Math.max(0, Number(count) || 0);
  const t = Math.max(0, Number(total) || 0);
  const pct = missingPct(c, t);
  const done = c === 0 ? " is-complete" : "";
  const data = op
    ? ` data-missing-op="${esc(key)}" data-missing-count="${c}"`
    : ` data-missing-field="${esc(key)}" data-missing-count="${c}"`;
  const inner = `<span class="dash-stat-label">${esc(label)}</span>
    <span class="dash-missing-nums">${dashCount(c)} <span class="dash-missing-of">of ${t}</span></span>
    <span class="dash-missing-meter" aria-hidden="true"><span class="dash-missing-fill" style="--missing-pct:${pct}"></span></span>`;
  if (href) {
    return `<a class="dash-stat dash-missing-tile${done}" href="${esc(href)}" aria-label="${esc(label)} · ${c} missing of ${t}"${data}>${inner}</a>`;
  }
  return `<p class="dash-stat dash-missing-tile is-static${done}"${data}>${inner}</p>`;
}

function missingStandingBlock(peopleRows, operationsMissing, range) {
  const rows = Array.isArray(peopleRows) ? peopleRows : [];
  const peopleGrid = rows
    .map((row) =>
      missingTile({
        key: row.key,
        label: row.label,
        count: row.count,
        total: row.total,
        href: row.href,
      }),
    )
    .join("");
  const peopleBlock = peopleGrid
    ? `<div class="dash-missing-group">
        <p class="dash-missing-kicker">People</p>
        <div class="dash-missing-grid">${peopleGrid}</div>
      </div>`
    : `<p class="empty">No rows on this page.</p>`;
  const opFields = operationsMissing?.fields || [];
  const opTotal = Math.max(0, Number(operationsMissing?.total) || 0);
  const opGrid = opFields
    .map((row) =>
      missingTile({
        key: row.key,
        label: row.label,
        count: row.count,
        total: opTotal,
        op: true,
      }),
    )
    .join("");
  const opBlock = opGrid
    ? `<div class="dash-missing-group">
        <p class="dash-missing-kicker">Operations</p>
        <div class="dash-missing-grid dash-missing-ops">${opGrid}</div>
      </div>`
    : "";
  const more = `<p class="dash-more"><a class="keychip" href="${esc(dashRangeHref(DASH_MISSING.path, range))}" aria-label="All missing fields">All missing</a></p>`;
  return `<section class="dash-block" data-dash-dim="missing" aria-label="Missing metadata">
    ${boxFrame(
      "Missing metadata",
      `<div class="dash-missing">${peopleBlock}${opBlock}</div>${more}`,
      { extraClass: "dash-box" },
    )}
  </section>`;
}

export function missingFieldFilterNav({ field, range } = {}) {
  const current = parseMissingField(field);
  const options = [
    { href: dashRangeHref(DASH_MISSING.path, range), label: "All fields", id: "all" },
    ...DASH_MISSING_FIELDS.map((f) => ({
      href: dashRangeHref(DASH_MISSING.path, range, { field: f.id }),
      label: f.label,
      id: f.id,
    })),
  ];
  const currentId = current?.id || "all";
  const opts = options
    .map((o) => {
      const on = o.id === currentId;
      return `<option value="${esc(o.href)}"${on ? " selected" : ""}>${esc(o.label)}</option>`;
    })
    .join("");
  return `<nav class="identity-filters missing-field-filters" aria-label="Missing field">
    <label class="identity-filters-label" for="missing-field-filter">Field</label>
    <select class="identity-filter-select" id="missing-field-filter" data-filter-select>${opts}</select>
  </nav>`;
}

export function dashboardMissingBody({ range, field } = {}) {
  const active = resolveDashRange(range);
  const extra = field ? { field: field.id } : {};
  return `<div class="dash-hud dash-missing-page" data-dash-dim="missing">
    ${dashRangeNav(active, { path: DASH_MISSING.path, extra })}
    ${missingFieldFilterNav({ field: field?.id, range: active })}
  </div>`;
}

function operationStandingBlock(standing) {
  const byTag = standing?.byTag || [];
  const rows = byTag
    .map((row) => {
      return `<tr>
        <td><a href="${esc(row.href)}">${esc(row.label)}</a></td>
        <td class="num">${dashCount(row.operations)}</td>
        <td class="num">${dashCount(row.victims)}</td>
        <td class="num">${dashCount(row.arrests)}</td>
      </tr>`;
    })
    .join("");
  const table = rows
    ? `<table class="dash-table">
        <thead><tr><th>Tag</th><th>Ops</th><th>Victims</th><th>Arrests</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    : `<p class="empty">No rows on this page.</p>`;
  return `<section class="dash-block" data-dash-dim="operations">
    ${boxFrame("Operations standing", table, { extraClass: "dash-box" })}
  </section>`;
}

const ADD_CATEGORIES = [
  { id: "", label: "Optional" },
  { id: "firings", label: "Firings" },
  { id: "resignations", label: "Resignations" },
  { id: "government_stepdowns", label: "Government step-downs" },
  { id: "death_celebrity", label: "Deaths — celebrities" },
  { id: "death_official", label: "Deaths — officials" },
  { id: "death_ceo", label: "Deaths — CEOs" },
  { id: "arrests", label: "Arrests" },
  { id: "notable", label: "Notable event" },
  { id: "corona_comms", label: "Corona Comms" },
  { id: "indictment_civilian", label: "Indictments — civilians" },
  { id: "indictment_non_civilian", label: "Indictments — non-civilians" },
];

export function addCiteRule() {
  return `<p class="cite-rule">One card per person. Each tagged event needs two or more verified official news or official government social citations. Unofficial or commentary social is extra only — it is not a cite. Wikipedia is not a cite. This form does not invent cites or copy a post date into the event date. A new person insert is fail-closed: country of origin, position, organization, reason of event, event date, two official cites, and an eligible portrait. Birth date is optional — unknown stores as null and is not invented from age or month-year. Military inserts also require branch (the existing event field). Country of origin and branch are not guessed. Origin is not the event country. If the person already exists, the new kind is attached — a second row is not created. A new person requires an eligible portrait: Wikimedia, an official government image, a curated news still, or a photo supplied for this card. The card is not created without one. A portrait over 400 KB or 1600 pixels on a side is stored as a compressed JPEG. Do not invent a face. Existing gold photos are not overwritten. Net worth is a published Forbes or Bloomberg estimate when one exists; otherwise USD stays blank with a short note that none was located. Existing gold net-worth is not overwritten. Group operations are a separate operation card — not a person. Operations need a name, event date, agencies, summary, a signed tag, and two official DOJ/gov/news-org cites. Victim and arrest counts stay blank unless a cite states them. Named children are not stored. A host process looks up published sources and applies the row.</p>`;
}

export function addBody({
  mode = "person",
  queued,
  error,
  values = {},
} = {}) {
  const person = mode === "person" || (!mode && mode !== "dog" && mode !== "operation");
  const dog = mode === "dog";
  const operation = mode === "operation";
  const tabs = `<nav class="add-modes" aria-label="Add mode">
    <a class="keychip" href="/add"${person ? ' aria-current="page"' : ""} data-key="p"><span class="br">[</span>p<span class="br">]</span> Person</a>
    <a class="keychip" href="/add?mode=operation"${operation ? ' aria-current="page"' : ""} data-key="g"><span class="br">[</span>g<span class="br">]</span> Operation</a>
    <a class="keychip" href="/add?mode=dog"${dog ? ' aria-current="page"' : ""} data-key="o"><span class="br">[</span>o<span class="br">]</span> Dog comms</a>
  </nav>`;
  if (queued) {
    return `${tabs}
    ${boxFrame(
      "Queued",
      `<p class="queued-msg">Request <code>${esc(queued.id)}</code> is queued.</p>
      <p>No row was added yet. Cites are not invented at submit time.</p>
      <p><a class="keychip" href="/add">Back to Add</a> <a class="keychip" href="/">Home</a></p>
      ${addCiteRule()}`,
      { active: true, extraClass: "add-box" },
    )}`;
  }
  const err = error ? `<p class="form-error" role="alert">${esc(error)}</p>` : "";
  if (person) {
    return `${tabs}
    ${boxFrame(
      "Add a person",
      `${err}
      <form class="tui-form add-form" method="post" action="/add">
        <input type="hidden" name="kind" value="person">
        <label class="field">
          <span>Name</span>
          <input type="text" name="subject" required value="${esc(values.subject || "")}" autocomplete="name">
        </label>
        <label class="field">
          <span>Category</span>
          <select name="category">
            ${ADD_CATEGORIES.map(
              (c) =>
                `<option value="${esc(c.id)}"${values.category === c.id ? " selected" : ""}>${esc(c.label)}</option>`,
            ).join("")}
          </select>
        </label>
        <label class="field">
          <span>Event date</span>
          <input type="date" name="event_date" value="${esc(values.event_date || "")}">
        </label>
        <label class="field">
          <span>Birth date</span>
          <input type="date" name="birth_date" value="${esc(values.birth_date || "")}">
        </label>
        <p class="hint">Optional. Leave blank when unknown (stored as null). Do not invent from age or month-year.</p>
        <label class="field">
          <span>Country of origin</span>
          <input type="text" name="country_of_origin" value="${esc(values.country_of_origin || "")}" autocomplete="off">
        </label>
        <p class="hint">Required on new insert. Do not guess. Event country is where the event happened if it differs.</p>
        <label class="field">
          <span>Position</span>
          <input type="text" name="position" value="${esc(values.position || "")}" autocomplete="off">
        </label>
        <label class="field">
          <span>Organization</span>
          <input type="text" name="organization" value="${esc(values.organization || "")}" autocomplete="off">
        </label>
        <label class="field">
          <span>Reason of event</span>
          <input type="text" name="comments" value="${esc(values.comments || "")}" autocomplete="off">
        </label>
        <label class="field">
          <span>Event country</span>
          <input type="text" name="country" value="${esc(values.country || "")}" autocomplete="off">
        </label>
        <label class="field">
          <span>Military</span>
          <input type="checkbox" name="military" value="true"${values.military ? " checked" : ""}>
        </label>
        <label class="field">
          <span>Branch</span>
          <input type="text" name="branch" value="${esc(values.branch || "")}" autocomplete="off">
        </label>
        <p class="hint">Event country only when it differs from origin. Branch is required when military; otherwise optional. Do not guess branch.</p>
        <label class="field">
          <span>Hint URL</span>
          <input type="url" name="hint_url" value="${esc(values.hint_url || "")}" placeholder="https://…" inputmode="url">
        </label>
        <label class="field">
          <span>Portrait URL</span>
          <input type="url" name="photo" value="${esc(values.photo || "")}" placeholder="https://upload.wikimedia.org/… or https://….gov/…" inputmode="url">
        </label>
        <p class="hint">A new person requires an eligible portrait: Wikimedia, official .gov, or a curated news still. Do not invent a photo.</p>
        <label class="field">
          <span>Net worth (USD)</span>
          <input type="text" name="net_worth_usd" inputmode="numeric" value="${esc(values.net_worth_usd || "")}" placeholder="2500000000" autocomplete="off">
        </label>
        <label class="field">
          <span>Net worth source</span>
          <input type="url" name="net_worth_source" value="${esc(values.net_worth_source || "")}" placeholder="https://www.forbes.com/profile/… or https://www.bloomberg.com/…" inputmode="url">
        </label>
        <p class="hint">Published Forbes or Bloomberg estimate only. Leave both blank if none — do not invent a figure.</p>
        <button type="submit" class="keychip add-submit"><span class="br">[</span>Enter<span class="br">]</span> Queue</button>
      </form>
      ${addCiteRule()}`,
      { active: true, extraClass: "add-box" },
    )}`;
  }
  if (operation) {
    const tagOpts = GROUP_OPS_KEEP_IDS.map((id) => {
      const cat = categoryById(id);
      const on = (values.category || values.tag || "missing_kids") === id;
      return `<option value="${esc(id)}"${on ? " selected" : ""}>${esc(cat?.title || id)}</option>`;
    }).join("");
    return `${tabs}
    ${boxFrame(
      "Add an operation",
      `${err}
      <form class="tui-form add-form" method="post" action="/add?mode=operation">
        <input type="hidden" name="kind" value="operation">
        <label class="field">
          <span>Name</span>
          <input type="text" name="subject" required value="${esc(values.subject || values.name || "")}" placeholder="Operation Restore Justice" autocomplete="off">
        </label>
        <label class="field">
          <span>Tag</span>
          <select name="category">${tagOpts}</select>
        </label>
        <label class="field">
          <span>Event date</span>
          <input type="date" name="event_date" value="${esc(values.event_date || "")}">
        </label>
        <label class="field">
          <span>Announced date</span>
          <input type="date" name="announced_date" value="${esc(values.announced_date || "")}">
        </label>
        <p class="hint">Announced date only when it differs from the event date.</p>
        <label class="field">
          <span>Agencies / orgs</span>
          <input type="text" name="agencies" value="${esc(Array.isArray(values.agencies) ? values.agencies.join(", ") : values.agencies || "")}" autocomplete="off">
        </label>
        <label class="field">
          <span>Reason / summary</span>
          <input type="text" name="summary" value="${esc(values.summary || values.comments || "")}" autocomplete="off">
        </label>
        <label class="field">
          <span>Victim count</span>
          <input type="number" name="victim_count" min="0" inputmode="numeric" value="${esc(values.victim_count ?? "")}" autocomplete="off">
        </label>
        <label class="field">
          <span>Arrest count</span>
          <input type="number" name="arrest_count" min="0" inputmode="numeric" value="${esc(values.arrest_count ?? "")}" autocomplete="off">
        </label>
        <p class="hint">Leave counts blank unless a cite states them. Do not invent. Named children are not stored.</p>
        <label class="field">
          <span>Hint URL</span>
          <input type="url" name="hint_url" value="${esc(values.hint_url || "")}" placeholder="https://…" inputmode="url">
        </label>
        <button type="submit" class="keychip add-submit"><span class="br">[</span>Enter<span class="br">]</span> Queue</button>
      </form>
      ${addCiteRule()}`,
      { active: true, extraClass: "add-box" },
    )}`;
  }
  return `${tabs}
    ${boxFrame(
      "Add official dog comms",
      `${err}
      <form class="tui-form add-form" method="post" action="/add?mode=dog">
        <input type="hidden" name="kind" value="dog">
        <label class="field">
          <span>Official government handle</span>
          <input type="text" name="handle" value="${esc(values.handle || "")}" placeholder="@POTUS" autocomplete="off">
        </label>
        <label class="field">
          <span>Official post URL</span>
          <input type="url" name="source_url" value="${esc(values.source_url || "")}" placeholder="https://x.com/…" inputmode="url">
        </label>
        <label class="field">
          <span>Date</span>
          <input type="date" name="posted_at" value="${esc(values.posted_at || "")}">
        </label>
        <p class="hint">Official government accounts only. Unofficial social is rejected.</p>
        <button type="submit" class="keychip add-submit"><span class="br">[</span>Enter<span class="br">]</span> Queue</button>
      </form>
      ${addCiteRule()}`,
      { active: true, extraClass: "add-box" },
    )}`;
}


