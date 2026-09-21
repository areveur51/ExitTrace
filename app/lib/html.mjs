import {
  categoryById,
  categoryByPath,
  formatDate,
  formatPosted,
  formatUsd,
  postedAtValue,
  initials,
  isDeathCategory,
  isGroupOpsCategory,
  isIndictmentCategory,
  GROUP_OPS_KEEP_IDS,
  PROMOTE_CATEGORY_IDS,
} from "./categories.mjs";
import { normalizeOperationTags, operationTagLabel } from "./operation.mjs";
import { storedAgeAtEvent } from "./age.mjs";
import { EVENT_ATTR_FIELDS, EVENT_ATTR_LABELS } from "./event-attrs.mjs";
import { careerLine, visibleCareer } from "./career.mjs";
import { personEvents } from "./promote.mjs";
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
import { commsKind, commsKindByPath, isCommsKind } from "./kind-comms.mjs";
import { isPeopleMediaHref } from "./portrait.mjs";
import { normalizeScreenshotHref } from "./screenshot.mjs";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
} from "./themes.mjs";
import {
  IDENTITY_TAGS,
  catalogMainPath,
  filterPath,
  normalizeTags,
  personTags,
} from "./tags.mjs";
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
import { readFileSync } from "node:fs";
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
    { key: "o", href: "/corona-comms" },
    { key: "i", href: "/indictments" },
    { key: "d", href: "/deaths" },
    { key: "m", href: "/group-operations" },
    { key: "b", href: "/dashboard", label: "Dashboard" },
    { key: "u", href: "/unsorted" },
    { key: "c", href: "/dog-comms", label: "Dog" },
    { key: "e", href: "/red-folder-comms", label: "Red Folder" },
    { key: "w", href: "/downloads", label: "Downloads" },
  ].map((item) => ({
    ...item,
    label: item.label || categoryByPath(item.href)?.nav || item.href,
  }));
  if (activePath !== "/") keys.push({ key: "h", href: "/", label: "Home" });
  return keys;
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

export function pageSizeSelector(activeSize = PAGE_SIZE) {
  const current = PAGE_SIZES.includes(Number(activeSize)) ? Number(activeSize) : PAGE_SIZE;
  return `<nav class="page-size" aria-label="Rows per page">
    <span class="page-size-label" id="page-size-label">Rows</span>
    <div class="page-size-btns" role="group" aria-labelledby="page-size-label">
      ${PAGE_SIZES.map((n) => {
        const on = n === current;
        return `<button type="button" class="page-size-btn keychip" data-page-size-set="${n}" aria-pressed="${
          on ? "true" : "false"
        }">${n}</button>`;
      }).join("")}
    </div>
  </nav>`;
}

export function identityFilterNav(basePath, { tags = [] } = {}) {
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
  const currentHref = filterPath(basePath, { tags: selected });
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

export function keymapFooter(activePath) {
  const chips = keymapItems(activePath)
    .map((k, i) => {
      const on = k.href === activePath;
      return `<a class="keychip" href="${esc(k.href)}" data-key="${esc(k.key)}" style="--key-order:${i}"${
        on ? ' aria-current="page"' : ""
      }><span class="br">[</span>${esc(k.key)}<span class="br">]</span> ${esc(k.label)}</a>`;
    })
    .join("");
  return `<footer class="keymap" aria-label="Catalog">
    <div class="keymap-keys">${chips}</div>
    <p class="fineprint">Neutral record. One card per person. Two published news citations on every tagged event. Official news and official government social count; unofficial or commentary social is extra only, not a cite. Wikipedia is not a cite. Grokipedia may appear as an extra encyclopedia cite; it does not replace official news cites. Net-worth figures are published estimates or left blank. Dog-comm and red-folder-comm stills and post text are stored locally. No live X, Wikimedia, or news fetches.</p>
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
      <figcaption id="lightbox-title" class="credit"></figcaption>
      <button type="button" class="keychip" data-close-lightbox><span class="br">[</span>Esc<span class="br">]</span> Back</button>
    </figure>
  </div>`;
}

function categoryTrail(cat) {
  if (!cat) return [];
  if (isDeathCategory(cat.id)) {
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
    const cat = categoryById(categoryId);
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
    <div class="tui-app"><a class="tui-app-link" href="/">exittrace</a></div>
    <div class="tui-n">${countLabel || ""}</div>
  </header>`;
}

export function layout({
  title,
  path,
  heading,
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

function listPortraitPicture(src, label, kind = "portrait") {
  const jpg = thumbHrefFor(src, { variant: "", ext: "jpg" });
  if (!jpg) {
    return `<span class="initials thumb" aria-hidden="true">${esc(initials(label))}</span>`;
  }
  const jpg2 = thumbHrefFor(src, { variant: ".2x", ext: "jpg" });
  const webp = thumbHrefFor(src, { variant: "", ext: "webp" });
  const webp2 = thumbHrefFor(src, { variant: ".2x", ext: "webp" });
  const srcsetJpg = `${portraitSrc(jpg)} ${LIST_THUMB_PX_W}w, ${portraitSrc(jpg2)} ${LIST_THUMB_2X_W}w`;
  const srcsetWebp = `${portraitSrc(webp)} ${LIST_THUMB_PX_W}w, ${portraitSrc(webp2)} ${LIST_THUMB_2X_W}w`;
  return `<picture class="thumb-src">
    <source type="image/webp" srcset="${esc(srcsetWebp)}" sizes="${LIST_THUMB_CSS_W}px">
    <img class="${kind} thumb" src="${esc(portraitSrc(jpg))}" srcset="${esc(srcsetJpg)}" sizes="${LIST_THUMB_CSS_W}px" alt="${esc(label)}" width="${LIST_THUMB_CSS_W}" height="${LIST_THUMB_CSS_H}" loading="lazy" decoding="async">
  </picture>`;
}

function peopleDetailPortrait(src, label) {
  const gold = goldMediaHref(src);
  if (!gold) {
    return `<span class="initials detail-photo portrait" aria-hidden="true">${esc(initials(label))}</span>`;
  }
  const webpGold = gold.toLowerCase().endsWith(".webp");
  const webpHref = webpGold ? gold : thumbHrefFor(src, { variant: ".hero", ext: "webp" });
  const jpegHref = webpGold ? thumbHrefFor(src, { variant: ".hero", ext: "jpg" }) : gold;
  return `<picture class="detail-portrait">
    <source type="image/webp" srcset="${esc(portraitSrc(webpHref))}">
    <img class="detail-photo portrait" src="${esc(portraitSrc(jpegHref))}" alt="${esc(label)}" width="${DETAIL_PORTRAIT_CSS_W}" height="${DETAIL_PORTRAIT_CSS_H}" decoding="async">
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

/** Lightbox opens the gold /media still (or screenshot), never the 80×104 list thumb. */
function lightboxButton(src, inner, { alt = "", credit = "" } = {}) {
  const href = String(src || "").trim();
  if (!href || !String(inner || "").includes("<img")) return inner;
  return `<button type="button" class="lightbox-open" data-lightbox="${esc(href)}" data-lightbox-alt="${esc(alt)}" data-lightbox-credit="${esc(credit)}">${inner}</button>`;
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
  const spec = commsKind(kind);
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
  const spec = commsKind(kind);
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
  const spec = commsKind(kind);
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

/** One frost group: cite-DRY + Source (this URL only) + screenshot/stills masonry. */
export function kindSupportingGroupHtml(kind, row, entry) {
  const handle = entry?.handle || row?.handle || "";
  const extras = kindEntryStills(kind, row, entry).map((src) => ({
    src,
    alt: `Post media for ${handle}`,
    credit: entry?.still_credit || "",
  }));
  return `<section class="supporting-group" data-supporting-index="${esc(String(entry?.index ?? ""))}">
    ${detailShell({
      title: "Supporting",
      mediaHtml: detailMediaStrip({
        screenshot: entry?.screenshot,
        screenshotAlt: `X-post screenshot of ${handle}`,
        screenshotCredit: entry?.screenshot_credit,
        extraMedia: extras,
        metaHtml: detailMetaBlock({
          citeHtml: citeFromRow({
            handle: entry?.handle,
            account_name: entry?.account_name,
            posted_at: entry?.posted_at,
            text: entry?.text,
          }),
          sourceHtml: detailSourceLine(entry?.source_url),
        }),
      }),
      active: true,
      extraClass: "meta-box",
    })}
  </section>`;
}

export function kindSupportingGroupsHtml(kind, row) {
  return kindSupportingEntries(row)
    .map((entry) => kindSupportingGroupHtml(kind, row, entry))
    .join("");
}

function detailMediaTile({
  kind = "still",
  src = "",
  inner = "",
  alt = "",
  credit = "",
} = {}) {
  const href = String(src || "").trim();
  const body = lightboxButton(href, inner, { alt, credit });
  if (!body) return "";
  return `<figure class="detail-tile detail-tile--${esc(kind)}">${body}</figure>`;
}

function screenshotTile(src, { alt = "", credit = "" } = {}) {
  const href = normalizeScreenshotHref(src);
  if (!href) return "";
  const img = `<img class="detail-photo screenshot" src="${esc(href)}" alt="${esc(alt)}" decoding="async">`;
  return detailMediaTile({
    kind: "screenshot",
    src: href,
    inner: img,
    alt,
    credit: creditWithoutUrls(credit),
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

/** Shared masonry: media + text/meta tiles in one dense column pack (dog / people / ops). */
function detailMediaStrip({
  portraitHtml,
  portraitSrc = "",
  portraitAlt = "",
  portraitCredit = "",
  screenshot = "",
  screenshotAlt = "",
  screenshotCredit = "",
  extraMedia = [],
  metaHtml = "",
  metaTiles = [],
} = {}) {
  const media = [];
  if (portraitHtml) {
    media.push(
      detailMediaTile({
        kind: "portrait",
        src: portraitSrc,
        inner: portraitHtml,
        alt: portraitAlt,
        credit: creditWithoutUrls(portraitCredit),
      }),
    );
  }
  const shot = screenshotTile(screenshot, {
    alt: screenshotAlt,
    credit: screenshotCredit,
  });
  if (shot) media.push(shot);
  for (const item of extraMedia || []) {
    const href = String(item?.src || item || "").trim();
    if (!href) continue;
    const alt = item?.alt || "Post media";
    const credit = creditWithoutUrls(item?.credit || "");
    const img = `<img class="detail-photo still" src="${esc(href)}" alt="${esc(alt)}" decoding="async">`;
    media.push(
      detailMediaTile({
        kind: "still",
        src: href,
        inner: img,
        alt,
        credit,
      }),
    );
  }
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
  bodyTitle = "",
  bodyHtml = "",
  sourceKind = "source",
  sourceHtml = "",
  extraTiles = [],
} = {}) {
  const tiles = [];
  if (title != null || ratingHtml) {
    tiles.push(
      detailMetaTile(
        "title",
        `<h2 class="detail-title">${esc(title || "—")}</h2>${ratingHtml}`,
      ),
    );
  }
  // ONE cite tile — do not split handle / account / posted / body into TUI line tiles.
  if (citeHtml) tiles.push(detailMetaTile("cite", citeHtml));
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
  const spec = kind ? commsKind(kind) : dog ? commsKind("dog") : null;
  if (spec) {
    const href = String(src || "").trim();
    if (isCommsMediaHref(href, spec.mediaDir)) {
      return `<img class="detail-photo portrait" src="${esc(href)}" alt="${esc(label)}" width="${DETAIL_PORTRAIT_CSS_W}" height="${DETAIL_PORTRAIT_CSS_H}" decoding="async">`;
    }
    return `<span class="initials detail-photo portrait" aria-hidden="true">${esc(initials(label))}</span>`;
  }
  return localPortraitImg(src, label, { size: "detail", kind: "portrait" });
}

function thumb(src, label, kind = "portrait") {
  return localMediaThumb(src, label, kind);
}

export function citeList(sources) {
  return `<ol class="sources cite-list">${(sources || [])
    .map((s) => {
      const label = s.publisher || s.title || s.url;
      return `<li><a class="source-link" href="${esc(s.url)}" rel="noopener noreferrer" data-label="${esc(label)}" data-title="${esc(s.title || "")}" data-date="${esc(s.date || "")}">${esc(label)}</a>${
        s.date ? ` <time datetime="${esc(s.date)}">${esc(formatDate(s.date))}</time>` : ""
      }</li>`;
    })
    .join("")}</ol>`;
}

function sourceList(sources) {
  return citeList(sources);
}

function netWorthCell(row) {
  const value = formatUsd(row.net_worth_usd);
  const note = row.net_worth_note ? esc(row.net_worth_note) : "";
  const src = row.net_worth_source
    ? ` <a class="nw-src" href="${esc(row.net_worth_source)}" rel="noopener noreferrer">source</a>`
    : "";
  return `<span class="nw">${esc(value)}</span>${
    note ? `<span class="nw-note">${note}${src}</span>` : src
  }`;
}

function kindLabel(row) {
  const cat = categoryById(row.category);
  return cat ? cat.nav : row.category || "Person";
}

export function personRow(row, { selected, showDeath } = {}) {
  const href = `/people/${encodeURIComponent(row.id)}`;
  const previewDate =
    showDeath && row.death_date ? row.death_date : row.event_date;
  return `<a class="tui-row person-card${selected ? " is-selected" : ""}" href="${esc(href)}">
    ${thumb(row.photo, row.name)}
    <div class="tui-row-text">
      <div class="tui-title">${esc(row.name || "—")}</div>
      <div class="tui-meta"><time datetime="${esc(previewDate || "")}">${esc(formatDate(previewDate))}</time> · ${esc(kindLabel(row))} · ${esc(formatUsd(row.net_worth_usd))}</div>
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
  return `<p class="meta-line">${esc(label)} · <a class="source-link" href="${esc(href)}" rel="noopener noreferrer" data-label="${esc(label)}" data-title="" data-date="">${esc(href)}</a></p>`;
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
  return `<a class="tui-row operation-card${selected ? " is-selected" : ""}" href="${esc(href)}">
    <span class="initials thumb" aria-hidden="true">${esc(initials(row.name || "OP"))}</span>
    <div class="tui-row-text">
      <div class="tui-title">${esc(row.name || "—")}</div>
      <div class="tui-meta"><time datetime="${esc(row.event_date || "")}">${esc(formatDate(row.event_date))}</time> · ${esc(tagLabel)} · ${esc(agencies)} · victims ${esc(countCell(row.victim_count))} · arrests ${esc(countCell(row.arrest_count))}</div>
    </div>
  </a>`;
}

export function kindListRow(kind, row, { selected } = {}) {
  const spec = commsKind(kind);
  const href = `${spec.path}/${encodeURIComponent(row.id)}`;
  return `<a class="tui-row ${spec.cardClass}${selected ? " is-selected" : ""}" href="${esc(href)}">
    ${thumb(row.still, row.handle, "still")}
    <div class="tui-row-text">
      <div class="tui-title">${esc(row.handle)}</div>
      <div class="tui-meta"><time datetime="${esc(row.posted_at)}">${esc(formatDate(row.posted_at))}</time> · ${esc(spec.label)}</div>
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
  const years = [...groups.keys()].sort((a, b) => b.localeCompare(a));
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

export function peopleList(rows, { showDeath } = {}) {
  if (!rows.length) return `<p class="empty">No rows on this page.</p>`;
  return `<div class="people-list tui-list">${groupByYear(rows, "event_date", (row, opts) =>
    personRow(row, { ...opts, showDeath }),
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

export function dogList(rows) {
  return kindList("dog", rows);
}

export function pager(meta, { basePath, noun = "rows", pageSizes } = {}) {
  const { page, totalPages, total, hasPrev, hasNext } = meta;
  const status = `Page ${page} of ${totalPages} · ${total} ${noun}`;
  const prev = hasPrev
    ? `<a class="pager-btn keychip" href="${esc(pageHref(basePath, page - 1))}" rel="prev" data-key="ArrowLeft"><span class="br">[</span>←<span class="br">]</span> Prev</a>`
    : `<span class="pager-btn keychip is-disabled" aria-disabled="true"><span class="br">[</span>←<span class="br">]</span> Prev</span>`;
  const next = hasNext
    ? `<a class="pager-btn keychip" href="${esc(pageHref(basePath, page + 1))}" rel="next" data-key="ArrowRight"><span class="br">[</span>→<span class="br">]</span> Next</a>`
    : `<span class="pager-btn keychip is-disabled" aria-disabled="true"><span class="br">[</span>→<span class="br">]</span> Next</span>`;
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
    <p class="pager-status">${esc(status)}</p>
    <div class="pager-controls">
      ${prev}
      <ol class="pager-pages">${items.join("")}</ol>
      ${next}
    </div>
    ${sizeNav}
  </nav>`;
}

export function listSection(listHtml, pagerHtml, headHtml = "") {
  return `${headHtml}${pagerHtml}${listHtml}${pagerHtml}`;
}

export function dogRow(row) {
  return dogListRow(row, {});
}

export function homeBody({ version }) {
  return `
    <div class="home-wordmark">
      <a class="pixel-link" href="/" aria-label="ExitTrace home">${pixelWordmark("EXITTRACE")}</a>
    </div>
    <p class="ver">v${esc(version || "1.0.0")}</p>
    <form class="tui-search" action="/search" method="get" role="search">
      <label class="tui-search-label">
        <span class="chev" aria-hidden="true">〉</span>
        <input type="search" name="q" placeholder="Search people, operations, dog comms, red-folder comms, and unsorted posts..." autocomplete="off" enterkeyhint="search">
      </label>
    </form>
    <p class="home-tag">Sourced public-role exits and official government dog-comms since 2017. A seed set, not a census.</p>`;
}

function eventKindTitle(kind) {
  const cat = categoryById(kind);
  return cat ? cat.title : kind || "Event";
}

export function personHeader(row, extras = {}) {
  const birth = row.birth_date
    ? `<p class="meta-line">Birth date · <time datetime="${esc(row.birth_date)}">${esc(formatDate(row.birth_date))}</time></p>`
    : "";
  const origin = row.country_of_origin
    ? `<p class="meta-line">Origin · ${esc(row.country_of_origin)}</p>`
    : "";
  return `<header class="person-header">
    ${detailMediaStrip({
      portraitHtml: localMediaPortrait(row.photo, row.name),
      portraitSrc: isPeopleMediaHref(row.photo) ? row.photo : "",
      portraitAlt: row.name,
      portraitCredit: row.photo_credit,
      screenshot: row.screenshot,
      screenshotAlt: `X-post screenshot of ${row.name}`,
      screenshotCredit: row.screenshot_credit,
      metaHtml: detailMetaBlock({
        title: row.name || "—",
        ratingHtml: `<p class="rating">★ ${netWorthCell(row)} <span class="muted">Net worth (published estimate)</span></p>`,
        lines: [birth, origin, personTagChips(row), grokipediaBlock(row, extras)],
        citeHtml: citeFromRow(row),
      }),
    })}
  </header>`;
}

/** Cite only. Never dumps synopsis/body already covered by news cites. */
export function grokipediaBlock(row, { filled = [], cite } = {}) {
  const item = cite || grokipediaCite(row, { filled });
  if (!item) return "";
  return `<p class="meta-line grokipedia-cite">Grokipedia · <a class="source-link" href="${esc(item.url)}" rel="noopener noreferrer" data-label="Grokipedia" data-title="Grokipedia">grokipedia.com</a></p>`;
}

export function eventTagRow(ev, { birthDate } = {}) {
  const kind = String(ev?.kind || "").trim();
  if (!kind || !PROMOTE_CATEGORY_IDS.includes(kind)) return "";
  const label = eventKindTitle(kind);
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
  const attrs = EVENT_ATTR_FIELDS.map((field) => {
    const value = String(ev[field] || "").trim();
    if (!value) return "";
    const name = EVENT_ATTR_LABELS[field] || field;
    return `<p class="meta-line">${esc(name)} · ${esc(value)}</p>`;
  }).join("");
  return `<article class="event-tag-row" data-kind="${esc(kind)}">
    <h3 class="event-h">${esc(label)}</h3>
    <p class="meta-line event-line"><time datetime="${esc(eventDate)}">${esc(formatDate(eventDate))}</time></p>
    ${announced}
    ${ageLine}
    ${attrs}
    ${citeList(ev.sources || [])}
  </article>`;
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

function eventTimeline(row) {
  const events = personEvents(row).filter((ev) =>
    PROMOTE_CATEGORY_IDS.includes(String(ev.kind || "").trim()),
  );
  if (!events.length) return "";
  const rows = events
    .map((ev) => eventTagRow(ev, { birthDate: row.birth_date }))
    .filter(Boolean)
    .join("");
  return `<section class="event-timeline" aria-label="Event timeline">${rows}</section>`;
}

function personTagChips(row) {
  const tags = personTags(row);
  if (!tags.length) return "";
  const cat = categoryById(row.category);
  const main = catalogMainPath(cat?.path || "/firings");
  const chips = tags
    .map((id) => {
      const tag = IDENTITY_TAGS.find((t) => t.id === id);
      if (!tag) return "";
      return `<a class="keychip" href="${esc(filterPath(main, { tags: [id] }))}">${esc(tag.nav)}</a>`;
    })
    .filter(Boolean)
    .join("");
  return `<p class="person-tags"><span class="person-tags-label">Tags</span> ${chips}</p>`;
}

export function personDetail(row) {
  const { row: filled, filled: keys, cite } = fillEmptyFromGrokipedia(row);
  return `<article class="detail person-detail">
    ${detailShell({
      title: "Identity",
      mediaHtml: personHeader(filled, { filled: keys, cite }),
      afterHtml: `${careerHistory(filled)}${eventTimeline(filled)}`,
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

export function operationDetail(row) {
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
  return `<article class="detail operation-detail" data-operation-id="${esc(row.id)}">
    ${detailShell({
      title: "Operation",
      mediaHtml: detailMediaStrip({
        portraitHtml: `<span class="initials detail-photo" aria-hidden="true">${esc(initials(row.name || "OP"))}</span>`,
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

export function kindDetail(kind, row) {
  const spec = commsKind(kind);
  const grouped = !!spec.supportingGroups;
  const photo = localMediaPortrait(row.still, `Stored still for ${row.handle}`, {
    commsKind: spec.id,
  });
  const extras = kindExtraStills(spec.id, row, { includeSupporting: !grouped }).map((src) => ({
    src,
    alt: `Post media for ${row.handle}`,
    credit: row.still_credit || "",
  }));
  const groups = grouped ? kindSupportingGroupsHtml(spec.id, row) : "";
  return `<article class="detail ${spec.detailClass}">
    ${detailShell({
      title: "Metadata",
      mediaHtml: detailMediaStrip({
        portraitHtml: photo,
        portraitSrc: isCommsMediaHref(row.still, spec.mediaDir) ? row.still : "",
        portraitAlt: `Stored still for ${row.handle}`,
        portraitCredit: row.still_credit,
        screenshot: row.screenshot,
        screenshotAlt: `X-post screenshot of ${row.handle}`,
        screenshotCredit: row.screenshot_credit,
        extraMedia: extras,
        metaHtml: detailMetaBlock({
          citeHtml: citeFromRow(row),
          sourceHtml: kindSourceHtml(row, { includeSupporting: !grouped }),
        }),
      }),
      active: true,
      extraClass: "meta-box",
    })}${groups}
  </article>`;
}

export function dogDetail(row) {
  return kindDetail("dog", row);
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
  const dogs = [];
  const folders = [];
  const sources = [];
  for (const item of items) {
    if (item.type === "source") sources.push(item);
    else if (item.type === "dog") dogs.push(item);
    else if (item.type === "red_folder") folders.push(item);
    else if (item.type === "operation") operations.push(item);
    else people.push(item);
  }
  let first = true;
  const render = (item) => {
    const selected = first;
    first = false;
    if (item.type === "dog" || item.type === "red_folder") {
      return kindListRow(item.type, item.row, { selected });
    }
    if (item.type === "source") return sourcePostRow(item.row, { selected });
    if (item.type === "operation") return operationRow(item.row, { selected });
    return personRow(item.row, { selected, showDeath: isDeathCategory(item.row.category) });
  };
  const blocks = [];
  if (people.length) blocks.push(people.map(render).join(""));
  if (operations.length) blocks.push(operations.map(render).join(""));
  if (dogs.length) blocks.push(dogs.map(render).join(""));
  if (folders.length) blocks.push(folders.map(render).join(""));
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
  { id: "corona_comms", label: "Corona Comms" },
  { id: "indictment_civilian", label: "Indictments — civilians" },
  { id: "indictment_non_civilian", label: "Indictments — non-civilians" },
];

export function addCiteRule() {
  return `<p class="cite-rule">One card per person. Each tagged event needs two or more verified official news or official government social citations. Unofficial or commentary social is extra only — it is not a cite. Wikipedia is not a cite. This form does not invent cites or copy a post date into the event date. A new person insert is fail-closed: country of origin, position, organization, reason of event, event date, and two official cites. Birth date is optional — unknown stores as null and is not invented from age or month-year. Military inserts also require branch (the existing event field). Country of origin and branch are not guessed. Origin is not the event country. If the person already exists, the new kind is attached — a second row is not created. A Wikimedia or official government portrait is attached when an eligible still already exists; missing stills stay blank. Existing gold photos are not overwritten. Net worth is a published Forbes or Bloomberg estimate when one exists; otherwise USD stays blank with a short note that none was located. Existing gold net-worth is not overwritten. Group operations are a separate operation card — not a person. Operations need a name, event date, agencies, summary, a signed tag, and two official DOJ/gov/news-org cites. Victim and arrest counts stay blank unless a cite states them. Named children are not stored. A host process looks up published sources and applies the row.</p>`;
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
        <p class="hint">Wikimedia Commons or official .gov still only. Leave blank if none — do not invent a photo.</p>
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


