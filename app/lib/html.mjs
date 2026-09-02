import {
  categoryById,
  categoryByPath,
  formatDate,
  formatUsd,
  initials,
  isDeathCategory,
  isIndictmentCategory,
} from "./categories.mjs";
import { personEvents } from "./promote.mjs";
import {
  PAGE_SIZE,
  PAGE_SIZES,
  PAGE_SIZE_STORAGE_KEY,
  pageHref,
  pageWindow,
} from "./paginate.mjs";
import { listThumbHref, LIST_THUMB_CSS_H, LIST_THUMB_CSS_W } from "./thumb.mjs";
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
import { DASH_DIMENSIONS } from "./dashboard.mjs";

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
  const shadow = [];
  const ink = [];
  letters.forEach((ch, li) => {
    const glyph = PIXELS[ch];
    if (!glyph) return;
    const ox = li * (letterW + letterGap);
    glyph.forEach((line, y) => {
      [...line].forEach((bit, x) => {
        if (bit !== "1") return;
        const px = ox + x * (cell + gap);
        const py = y * (cell + gap);
        shadow.push(
          `<rect x="${px + extra}" y="${py + extra}" width="${cell}" height="${cell}" fill="var(--brick)"/>`,
        );
        ink.push(
          `<rect x="${px}" y="${py}" width="${cell}" height="${cell}" fill="var(--label)"/>`,
        );
      });
    });
  });
  return `<svg class="pixel-wordmark" viewBox="0 0 ${width + extra} ${height + extra}" width="${width + extra}" height="${height + extra}" role="img" aria-label="ExitTrace" xmlns="http://www.w3.org/2000/svg">${shadow.join("")}${ink.join("")}</svg>`;
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
    { key: "b", href: "/dashboard", label: "Dashboard" },
    { key: "u", href: "/unsorted" },
    { key: "c", href: "/dog-comms", label: "Dog" },
    { key: "n", href: "/add", label: "Add" },
    { key: "s", href: "/search", label: "Search" },
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

export function ageFilterForm(actionPath, { minAge, maxAge, tags, deaths } = {}) {
  const minVal = minAge != null ? String(minAge) : "";
  const maxVal = maxAge != null ? String(maxAge) : "";
  const selected = normalizeTags(tags);
  const hidden = selected.length
    ? `<input type="hidden" name="tags" value="${esc(selected.join(","))}">`
    : "";
  const label = deaths ? "Age at death" : "Age";
  return `<form class="age-filter" method="get" action="${esc(catalogMainPath(actionPath))}" role="search">
    ${hidden}
    <span class="age-filter-label" id="age-filter-label">${label}</span>
    <div class="age-filter-fields" role="group" aria-labelledby="age-filter-label">
      <label class="age-filter-field">Min <input type="number" name="min_age" min="0" max="150" inputmode="numeric" value="${esc(minVal)}"></label>
      <label class="age-filter-field">Max <input type="number" name="max_age" min="0" max="150" inputmode="numeric" value="${esc(maxVal)}"></label>
      <button type="submit" class="keychip age-filter-apply">Apply</button>
    </div>
  </form>`;
}

export function identityFilterNav(basePath, { tags = [], minAge, maxAge } = {}) {
  const main = catalogMainPath(basePath);
  const selected = normalizeTags(tags);
  const locked = main === "/government" ? ["official"] : [];
  const age = { minAge, maxAge };
  const allHref = filterPath(main, { tags: locked, ...age });
  const options = [{ href: allHref, label: "All" }];
  for (const tag of IDENTITY_TAGS) {
    if (locked.includes(tag.id)) continue;
    const href = filterPath(main, { tags: [...new Set([...locked, tag.id])], ...age });
    options.push({ href, label: tag.nav });
  }
  const currentHref = filterPath(main, { tags: selected, ...age });
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
  return `<footer class="keymap" aria-label="Catalog">
    ${keymapItems(activePath)
      .map((k) => {
        const on = k.href === activePath;
        return `<a class="keychip" href="${esc(k.href)}" data-key="${esc(k.key)}"${
          on ? ' aria-current="page"' : ""
        }><span class="br">[</span>${esc(k.key)}<span class="br">]</span> ${esc(k.label)}</a>`;
      })
      .join("")}
    <p class="fineprint">Neutral record. One card per person. Two published news citations on every tagged event. Official news and official government social count; unofficial or commentary social is extra only, not a cite. Wikipedia is not a cite. Net-worth figures are published estimates or left blank. Dog-comm snapshots are stored locally. No live X, Wikimedia, or news fetches.</p>
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
  if (p.startsWith("/dog-comms/") && p !== "/dog-comms") {
    items.push({ href: "/dog-comms", label: "Dog comms" });
    items.push({ href: p, label: label || "Snapshot" });
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
}) {
  const home = mode === "home";
  const sizeAttr =
    pageSize != null && PAGE_SIZES.includes(Number(pageSize))
      ? ` data-page-size="${Number(pageSize)}"`
      : "";
  return `<!doctype html>
<html lang="en" data-theme="${DEFAULT_THEME}"${sizeAttr}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · ExitTrace</title>
  ${themeBootScript()}
  ${pageSizeBootScript()}
  <link rel="stylesheet" href="/styles.css">
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
  <script src="/app.js" defer></script>
</body>
</html>`;
}

function thumb(src, label, kind = "portrait") {
  const href = listThumbHref(src);
  if (href) {
    return `<img class="${kind} thumb" src="${esc(href)}" alt="${esc(label)}" width="${LIST_THUMB_CSS_W}" height="${LIST_THUMB_CSS_H}" loading="lazy" decoding="async">`;
  }
  return `<span class="initials thumb" aria-hidden="true">${esc(initials(label))}</span>`;
}

function sourceList(sources) {
  return `<ol class="sources">${(sources || [])
    .map((s) => {
      const label = s.publisher || s.title || s.url;
      return `<li><a class="source-link" href="${esc(s.url)}" rel="noopener noreferrer" data-label="${esc(label)}" data-title="${esc(s.title || "")}" data-date="${esc(s.date || "")}">${esc(label)}</a>${
        s.date ? ` <time datetime="${esc(s.date)}">${esc(formatDate(s.date))}</time>` : ""
      }</li>`;
    })
    .join("")}</ol>`;
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

export function dogListRow(row, { selected } = {}) {
  const href = `/dog-comms/${encodeURIComponent(row.id)}`;
  return `<a class="tui-row dog-card${selected ? " is-selected" : ""}" href="${esc(href)}">
    ${thumb(row.still, row.handle, "still")}
    <div class="tui-row-text">
      <div class="tui-title">${esc(row.handle)}</div>
      <div class="tui-meta"><time datetime="${esc(row.posted_at)}">${esc(formatDate(row.posted_at))}</time> · Dog comms</div>
    </div>
  </a>`;
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
    if (item.type === "dog") return dogListRow(item.row, opts);
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

export function dogList(rows) {
  if (!rows.length) return `<p class="empty">No rows on this page.</p>`;
  return `<div class="dog-page tui-list">${groupByYear(rows, "posted_at", dogListRow)}</div>`;
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

export function dogCard(row) {
  const still = row.still
    ? `<img class="still" src="${esc(row.still)}" alt="Stored still for ${esc(row.handle)}" width="320" height="200" decoding="async">`
    : "";
  const credit = row.still_credit
    ? `<p class="credit">${esc(row.still_credit)}</p>`
    : "";
  return `<article class="dog-snapshot" data-snapshot-id="${esc(row.id)}">
    <header>
      <span class="handle">${esc(row.handle)}</span>
      <span class="acct">${esc(row.account_name)}</span>
      <time datetime="${esc(row.posted_at)}">${esc(formatDate(row.posted_at))}</time>
    </header>
    <p class="post-text">${esc(row.text)}</p>
    ${still}
    ${credit}
    <p class="cite">Citation: <a class="source-link" href="${esc(row.source_url)}" rel="noopener noreferrer" data-label="Citation" data-title="Stored snapshot citation" data-date="${esc(row.posted_at)}">${esc(row.source_url)}</a></p>
  </article>`;
}

export function dogRow(row) {
  return dogListRow(row, {});
}

export function homeBody({ version }) {
  return `
    <a class="pixel-link" href="/" aria-label="ExitTrace home">${pixelWordmark("EXITTRACE")}</a>
    <p class="ver">v${esc(version || "1.0.0")}</p>
    <form class="tui-search" action="/search" method="get" role="search">
      <label class="tui-search-label">
        <span class="chev" aria-hidden="true">〉</span>
        <input type="search" name="q" placeholder="Search people, dog comms, and unsorted posts..." autocomplete="off" enterkeyhint="search">
      </label>
    </form>
    <p class="home-tag">Sourced public-role exits and official government dog-comms since 2017. A seed set, not a census.</p>`;
}

function eventKindTitle(kind) {
  const cat = categoryById(kind);
  return cat ? cat.title : kind || "Event";
}

function personEventBlocks(row) {
  const events = personEvents(row);
  if (!events.length) {
    const cat = categoryById(row.category);
    const kind = cat ? cat.title : row.category;
    const death = isDeathCategory(row.category)
      ? `<p class="meta-line">Death date · <time datetime="${esc(row.death_date || "")}">${esc(formatDate(row.death_date))}</time></p>`
      : "";
    return {
      meta: `<p class="meta-line"><time datetime="${esc(row.event_date || "")}">${esc(formatDate(row.event_date))}</time> · ${esc(row.role || "—")} · ${esc(kind)}</p>${death}`,
      sourcesHtml: sourceList(row.sources || []),
      sourceCount: (row.sources || []).length,
    };
  }
  const meta = events
    .map((ev) => {
      const label = eventKindTitle(ev.kind);
      const death = isDeathCategory(ev.kind)
        ? ` · death date`
        : "";
      const announced = ev.announced_date
        ? ` · announced <time datetime="${esc(ev.announced_date)}">${esc(formatDate(ev.announced_date))}</time>`
        : "";
      const bits = [
        ev.position && `Position · ${ev.position}`,
        ev.organization && `Organization · ${ev.organization}`,
        ev.country && `Country · ${ev.country}`,
        ev.branch && `Branch · ${ev.branch}`,
      ].filter(Boolean);
      const attrs = bits.length ? ` · ${esc(bits.join(" · "))}` : "";
      const comments = ev.comments
        ? `<p class="meta-line">Comments · ${esc(ev.comments)}</p>`
        : "";
      return `<p class="meta-line event-line"><time datetime="${esc(ev.event_date || "")}">${esc(formatDate(ev.event_date))}</time> · ${esc(label)}${death}${announced}${attrs}</p>${comments}`;
    })
    .join("");
  const role = row.role
    ? `<p class="meta-line">Role · ${esc(row.role)}</p>`
    : "";
  const sourcesHtml = events
    .map((ev) => {
      const label = eventKindTitle(ev.kind);
      return `<section class="event-cites">
        <h4 class="event-h">${esc(label)} · <time datetime="${esc(ev.event_date || "")}">${esc(formatDate(ev.event_date))}</time></h4>
        ${sourceList(ev.sources || [])}
      </section>`;
    })
    .join("");
  const sourceCount = events.reduce((n, ev) => n + (ev.sources || []).length, 0);
  return { meta: `${role}${meta}`, sourcesHtml, sourceCount };
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
  const photo = row.photo
    ? `<img class="detail-photo" src="${esc(row.photo)}" alt="${esc(row.name)}" width="120" height="150" decoding="async">`
    : `<span class="initials detail-photo" aria-hidden="true">${esc(initials(row.name) || "—")}</span>`;
  const { meta, sourcesHtml, sourceCount } = personEventBlocks(row);
  return `<article class="detail">
    ${boxFrame(
      "Metadata",
      `<div class="meta-pane">
      ${photo}
      <div class="detail-copy">
        <h2 class="detail-title">${esc(row.name || "—")}</h2>
        <p class="rating">★ ${netWorthCell(row)} <span class="muted">Net worth (published estimate)</span></p>
        ${meta}
        ${personTagChips(row)}
        <hr class="hr">
        <h3 class="pane-h">Synopsis</h3>
        <p class="synopsis">${esc(row.summary || "—")}</p>
      </div>
    </div>`,
      { extraClass: "meta-box" },
    )}
    ${boxFrame(
      `● Sources · ${sourceCount} available · 1/${sourceCount || 0}`,
      sourcesHtml,
      { active: true, extraClass: "sources-pane" },
    )}
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
  const poster = posterLabel(row.poster_handle);
  const posterName = row.poster_name ? ` (${row.poster_name})` : "";
  return `<article class="detail">
    ${boxFrame(
      "Metadata",
      `<div class="meta-pane">
      <span class="initials detail-photo" aria-hidden="true">—</span>
      <div class="detail-copy">
        <h2 class="detail-title">—</h2>
        <p class="rating">★ ${esc(formatUsd(null))} <span class="muted">Net worth (published estimate)</span></p>
        <p class="meta-line">Event date · —</p>
        <p class="meta-line">Posted · <time datetime="${esc(row.posted_at || "")}">${esc(formatDate(row.posted_at))}</time> · ${esc(kind)}</p>
        <p class="meta-line">Poster · ${esc(poster)}${esc(posterName)}</p>
        <hr class="hr">
        <h3 class="pane-h">Synopsis</h3>
        <p class="synopsis post-text">${esc(row.text || "—")}</p>
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

export function dogDetail(row) {
  const photo = row.still
    ? `<img class="detail-photo" src="${esc(row.still)}" alt="Stored still for ${esc(row.handle)}" width="120" height="150" decoding="async">`
    : `<span class="initials detail-photo" aria-hidden="true">${esc(initials(row.handle))}</span>`;
  return `<article class="detail">
    ${boxFrame(
      "Metadata",
      `<div class="meta-pane">
      ${photo}
      <div class="detail-copy">
        <h2 class="detail-title">${esc(row.handle)}</h2>
        <p class="rating">★ stored snapshot</p>
        <p class="meta-line"><time datetime="${esc(row.posted_at)}">${esc(formatDate(row.posted_at))}</time> · ${esc(row.account_name)} · Dog comms</p>
        <hr class="hr">
        <h3 class="pane-h">Synopsis</h3>
        <p class="synopsis post-text">${esc(row.text)}</p>
      </div>
    </div>`,
      { extraClass: "meta-box" },
    )}
    ${boxFrame(
      "● Snapshot · 1 available · 1/1",
      `<p class="hint">Tap opens this stored card. Nothing is fetched from X at view time.</p>
      <button type="button" class="keychip snapshot-open" data-snapshot-open><span class="br">[</span>v<span class="br">]</span> View snapshot</button>
      <div class="snapshot-store" hidden>${dogCard(row)}</div>`,
      { active: true, extraClass: "sources-pane snapshot-pane" },
    )}
  </article>`;
}

export function searchBody(items, q) {
  if (!String(q || "").trim()) {
    return `<p class="empty">Type a name, role, handle, or stored post text. Search stays local.</p>`;
  }
  if (!items.length) {
    return `<p class="empty">No seeded rows match that query.</p>`;
  }
  const people = [];
  const dogs = [];
  const sources = [];
  for (const item of items) {
    if (item.type === "source") sources.push(item);
    else if (item.type === "dog") dogs.push(item);
    else people.push(item);
  }
  let first = true;
  const render = (item) => {
    const selected = first;
    first = false;
    if (item.type === "dog") return dogListRow(item.row, { selected });
    if (item.type === "source") return sourcePostRow(item.row, { selected });
    return personRow(item.row, { selected, showDeath: isDeathCategory(item.row.category) });
  };
  const blocks = [];
  if (people.length) blocks.push(people.map(render).join(""));
  if (dogs.length) blocks.push(dogs.map(render).join(""));
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

export function healthBody(payload) {
  return boxFrame("Health", `<pre class="health">${esc(JSON.stringify(payload, null, 2))}</pre>`, {
    active: true,
  });
}

function dashCount(n) {
  const num = Math.max(0, Number(n) || 0);
  return `<span class="dash-count" data-count="${num}">${num}</span>`;
}

function dashChart(series, { title, kind = "line" } = {}) {
  const rows = Array.isArray(series) ? series : [];
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
    return { x, y, v };
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const bars =
    kind === "bar"
      ? pts
          .map((p, i) => {
            const bw = Math.max(2, innerW / Math.max(values.length, 1) - 1);
            const x = padX + (i + 0.5) * (innerW / values.length) - bw / 2;
            const bh = innerH - (p.y - padY);
            return `<rect class="dash-bar" x="${x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, bh).toFixed(1)}"></rect>`;
          })
          .join("")
      : "";
  const first = rows[0]?.key || "";
  const last = rows[rows.length - 1]?.key || "";
  return `<div class="dash-chart" role="img" aria-label="${esc(title)}: ${values.length} points from ${esc(first)} to ${esc(last)}">
    <svg class="dash-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <path class="dash-line" d="${esc(d)}" fill="none"></path>
      ${bars}
    </svg>
    <p class="dash-chart-ends"><span>${esc(first)}</span><span>${esc(last)}</span></p>
  </div>`;
}

function dashRankTable(rows, { empty = "No rows on this page", selfPath = "" } = {}) {
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
          return `<tr>
            <td class="dash-rank">${i + 1}</td>
            <td>${name}</td>
            <td class="dash-n">${dashCount(row.count)}</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;
}

export function dashboardBody(model) {
  const dims = (model.dimensions || [])
    .map((dim) => {
      const more = `<p class="dash-more"><a class="keychip" href="${esc(dim.path)}">All by ${esc(dim.nav)}</a></p>`;
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
    <section class="dash-stats" aria-label="Live counts">
      <p class="dash-stat"><span class="dash-stat-label">People</span> ${dashCount(model.people)}</p>
      <p class="dash-stat"><span class="dash-stat-label">Events</span> ${dashCount(trends.events)}</p>
    </section>
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

export function dashboardRankBody(dim, rows) {
  return `<div class="dash-hud dash-rank-page" data-dash-dim="${esc(dim.id)}">
    ${boxFrame(`All by ${dim.nav}`, dashRankTable(rows, { selfPath: dim.path }), { extraClass: "dash-box", active: true })}
  </div>`;
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
  return `<p class="cite-rule">One card per person. Each tagged event needs two or more verified official news or official government social citations. Unofficial or commentary social is extra only — it is not a cite. Wikipedia is not a cite. This form does not invent cites or copy a post date into the event date. If the person already exists, the new kind is attached — a second row is not created. A Wikimedia or official government portrait is attached when an eligible still already exists; missing stills stay blank. Existing gold photos are not overwritten. Net worth is a published Forbes or Bloomberg estimate when one exists; otherwise USD stays blank with a short note that none was located. Existing gold net-worth is not overwritten. A host process looks up published sources and applies the row.</p>`;
}

export function addBody({
  mode = "person",
  queued,
  error,
  values = {},
} = {}) {
  const person = mode !== "dog";
  const tabs = `<nav class="add-modes" aria-label="Add mode">
    <a class="keychip" href="/add"${person ? ' aria-current="page"' : ""} data-key="p"><span class="br">[</span>p<span class="br">]</span> Person</a>
    <a class="keychip" href="/add?mode=dog"${person ? "" : ' aria-current="page"'} data-key="o"><span class="br">[</span>o<span class="br">]</span> Dog comms</a>
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


