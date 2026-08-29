import {
  categoryById,
  formatDate,
  formatUsd,
  initials,
  isDeathCategory,
} from "./categories.mjs";
import { pageHref, pageWindow } from "./paginate.mjs";

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
          `<rect x="${px + extra}" y="${py + extra}" width="${cell}" height="${cell}" fill="#7a6240"/>`,
        );
        ink.push(
          `<rect x="${px}" y="${py}" width="${cell}" height="${cell}" fill="#e6c384"/>`,
        );
      });
    });
  });
  return `<svg class="pixel-wordmark" viewBox="0 0 ${width + extra} ${height + extra}" width="${width + extra}" height="${height + extra}" role="img" aria-label="ExitTrace" xmlns="http://www.w3.org/2000/svg">${shadow.join("")}${ink.join("")}</svg>`;
}

function keymapItems(activePath) {
  const keys = [
    { key: "f", href: "/firings", label: "Firings" },
    { key: "r", href: "/resignations", label: "Resignations" },
    { key: "g", href: "/government", label: "Gov" },
    { key: "a", href: "/arrests", label: "Arrests" },
    { key: "d", href: "/deaths", label: "Deaths" },
    { key: "u", href: "/unsorted", label: "Unsorted" },
    { key: "c", href: "/dog-comms", label: "Dog" },
    { key: "n", href: "/add", label: "Add" },
    { key: "w", href: "/downloads", label: "Downloads" },
  ];
  if (String(activePath).startsWith("/deaths")) {
    keys.splice(
      4,
      1,
      { key: "d", href: "/deaths", label: "Deaths" },
      { key: "1", href: "/deaths/celebrities", label: "Celebs" },
      { key: "2", href: "/deaths/officials", label: "Officials" },
      { key: "3", href: "/deaths/ceos", label: "CEOs" },
    );
  }
  if (activePath !== "/") keys.push({ key: "h", href: "/", label: "Home" });
  return keys;
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
    <p class="fineprint">Neutral record. Two published news citations on every person row. Official news and official government social count; unofficial or commentary social is extra only, not a cite. Net-worth figures are published estimates or left blank. Dog-comm snapshots are stored locally. No live X, Wikimedia, or news fetches.</p>
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

function topBar({ query, countLabel }) {
  return `<header class="tui-top">
    <div class="tui-q"><span class="chev" aria-hidden="true">❯</span> ${esc(query || "")}</div>
    <div class="tui-app">exittrace</div>
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
}) {
  const home = mode === "home";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · ExitTrace</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="tui${home ? " tui-home" : ""}" data-toast="${home ? "home loaded" : "page loaded"}">
  ${home ? "" : topBar({ query: query || heading, countLabel })}
  <main class="${home ? "home-stage" : "tui-main"}">
    ${home ? "" : `<h1 class="vh">${esc(heading || title)}</h1>`}
    ${!home && lede ? `<p class="lede">${lede}</p>` : ""}
    ${body}
  </main>
  ${keymapFooter(path)}
  ${chromeWidgets()}
  <script src="/app.js" defer></script>
</body>
</html>`;
}

function thumb(src, label, kind = "portrait") {
  if (src) {
    return `<img class="${kind} thumb" src="${esc(src)}" alt="${esc(label)}" width="48" height="64">`;
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
  return `<nav class="death-nav" aria-label="Sorted death lists">
    <a class="keychip" href="/deaths/celebrities">Celebrities</a>
    <a class="keychip" href="/deaths/officials">Officials</a>
    <a class="keychip" href="/deaths/ceos">CEOs</a>
  </nav>`;
}

export function dogList(rows) {
  if (!rows.length) return `<p class="empty">No rows on this page.</p>`;
  return `<div class="dog-page tui-list">${groupByYear(rows, "posted_at", dogListRow)}</div>`;
}

export function pager(meta, { basePath, noun = "rows" } = {}) {
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
  return `<nav class="pager" aria-label="Pagination">
    <p class="pager-status">${esc(status)}</p>
    <div class="pager-controls">
      ${prev}
      <ol class="pager-pages">${items.join("")}</ol>
      ${next}
    </div>
  </nav>`;
}

export function listSection(listHtml, pagerHtml, headHtml = "") {
  return `${headHtml}${pagerHtml}${listHtml}${pagerHtml}`;
}

export function dogCard(row) {
  const still = row.still
    ? `<img class="still" src="${esc(row.still)}" alt="Stored still for ${esc(row.handle)}" width="320" height="200">`
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

export function personDetail(row) {
  const cat = categoryById(row.category);
  const kind = cat ? cat.title : row.category;
  const death = isDeathCategory(row.category)
    ? `<p class="meta-line">Death date · <time datetime="${esc(row.death_date || "")}">${esc(formatDate(row.death_date))}</time></p>`
    : "";
  const photo = row.photo
    ? `<img class="detail-photo" src="${esc(row.photo)}" alt="${esc(row.name)}" width="120" height="150">`
    : `<span class="initials detail-photo" aria-hidden="true">${esc(initials(row.name) || "—")}</span>`;
  const sources = row.sources || [];
  return `<article class="detail">
    ${boxFrame(
      "Metadata",
      `<div class="meta-pane">
      ${photo}
      <div class="detail-copy">
        <h2 class="detail-title">${esc(row.name || "—")}</h2>
        <p class="rating">★ ${netWorthCell(row)} <span class="muted">Net worth (published estimate)</span></p>
        <p class="meta-line"><time datetime="${esc(row.event_date || "")}">${esc(formatDate(row.event_date))}</time> · ${esc(row.role || "—")} · ${esc(kind)}</p>
        ${death}
        <hr class="hr">
        <h3 class="pane-h">Synopsis</h3>
        <p class="synopsis">${esc(row.summary || "—")}</p>
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
    ? `<img class="detail-photo" src="${esc(row.still)}" alt="Stored still for ${esc(row.handle)}" width="120" height="150">`
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

const ADD_CATEGORIES = [
  { id: "", label: "Optional" },
  { id: "firings", label: "Firings" },
  { id: "resignations", label: "Resignations" },
  { id: "government_stepdowns", label: "Government step-downs" },
  { id: "death_celebrity", label: "Deaths — celebrities" },
  { id: "death_official", label: "Deaths — officials" },
  { id: "death_ceo", label: "Deaths — CEOs" },
  { id: "arrests", label: "Arrests" },
];

export function addCiteRule() {
  return `<p class="cite-rule">Person rows need two or more verified official news or official government social citations. Unofficial or commentary social is extra only — it is not a cite. This form does not invent cites or copy a post date into the event date. A host process looks up published sources and applies the row.</p>`;
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


