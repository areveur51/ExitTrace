import { CATEGORIES, formatDate, formatUsd, initials } from "./categories.mjs";
import { pageHref, pageWindow } from "./paginate.mjs";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nav(activePath) {
  const links = [
    { href: "/", label: "Home" },
    ...CATEGORIES.map((c) => ({ href: c.path, label: c.nav })),
    { href: "/downloads", label: "Downloads" },
  ];
  return `<nav class="nav" aria-label="Sections">${links
    .map((l) => {
      const on = l.href === activePath;
      return `<a href="${esc(l.href)}"${on ? ' aria-current="page"' : ""}>${esc(l.label)}</a>`;
    })
    .join("")}</nav>`;
}

export function layout({ title, path, heading, lede, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · ExitTrace</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="mast">
    <div class="mast-brand">
      <a class="wordmark" href="/">ExitTrace</a>
      <p class="tag">Sourced public-role exits and official government dog-comms since 2017. A seed set, not a census.</p>
    </div>
    ${nav(path)}
  </header>
  <main>
    <header class="page-head">
      <h1>${esc(heading)}</h1>
      ${lede ? `<p class="lede">${lede}</p>` : ""}
    </header>
    ${body}
  </main>
  <footer class="foot">
    <p>Neutral record. Each person row cites two published news sources. Net-worth figures are published estimates (Forbes, Bloomberg, or official disclosure) or left blank. Dog-comm snapshots are stored locally; source URLs are citations only. No live X, Wikimedia, or news fetches.</p>
    <p><a href="/health">Health</a> · <a href="/downloads">Data pack</a> · MIT License</p>
  </footer>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

function photoCell(row) {
  if (row.photo) {
    return `<img class="portrait" src="${esc(row.photo)}" alt="${esc(row.name)}" width="56" height="56">`;
  }
  return `<span class="initials" aria-hidden="true">${esc(initials(row.name))}</span>`;
}

function sourceList(sources) {
  return `<ol class="sources">${(sources || [])
    .map((s) => {
      const label = s.publisher || s.title || s.url;
      return `<li><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(label)}</a>${
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

function personCard(row, { showDeath } = {}) {
  const death = showDeath
    ? `<div><dt>Death date</dt><dd><time datetime="${esc(row.death_date)}">${esc(formatDate(row.death_date))}</time></dd></div>`
    : "";
  return `<article class="person-card">
    <div class="person-card-top">
      ${photoCell(row)}
      <div class="person-card-id">
        <h3>${esc(row.name)}</h3>
        <p class="role">${esc(row.role)}</p>
      </div>
    </div>
    ${row.summary ? `<p class="summary">${esc(row.summary)}</p>` : ""}
    <dl class="person-meta">
      <div>
        <dt>Event date</dt>
        <dd><time datetime="${esc(row.event_date)}">${esc(formatDate(row.event_date))}</time></dd>
      </div>
      ${death}
      <div>
        <dt>Net worth (published estimate)</dt>
        <dd class="col-nw">${netWorthCell(row)}</dd>
      </div>
    </dl>
    <div class="person-sources">
      <h3>Sources</h3>
      ${sourceList(row.sources)}
    </div>
  </article>`;
}

export function peopleTable(rows, { showDeath } = {}) {
  const deathCol = showDeath
    ? `<th scope="col">Death date</th>`
    : "";
  const body = rows
    .map((row) => {
      const death = showDeath
        ? `<td data-label="Death date"><time datetime="${esc(row.death_date)}">${esc(formatDate(row.death_date))}</time></td>`
        : "";
      return `<tr>
        <td class="col-photo" data-label="Photo">${photoCell(row)}</td>
        <td data-label="Name">
          <strong>${esc(row.name)}</strong>
          <div class="role">${esc(row.role)}</div>
          ${row.summary ? `<p class="summary">${esc(row.summary)}</p>` : ""}
        </td>
        <td data-label="Event date"><time datetime="${esc(row.event_date)}">${esc(formatDate(row.event_date))}</time></td>
        ${death}
        <td class="col-nw" data-label="Net worth (published estimate)">${netWorthCell(row)}</td>
        <td data-label="Sources">${sourceList(row.sources)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="grid">
    <thead>
      <tr>
        <th scope="col">Photo</th>
        <th scope="col">Name</th>
        <th scope="col">Event date</th>
        ${deathCol}
        <th scope="col">Net worth (published estimate)</th>
        <th scope="col">Sources</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

export function peopleList(rows, { showDeath } = {}) {
  if (!rows.length) {
    return `<p class="empty">No rows on this page.</p>`;
  }
  return `<div class="people-list">
    <div class="person-cards">${rows.map((row) => personCard(row, { showDeath })).join("")}</div>
    ${peopleTable(rows, { showDeath })}
  </div>`;
}

export function pager(meta, { basePath, noun = "rows" } = {}) {
  const { page, totalPages, total, hasPrev, hasNext } = meta;
  const status = `Page ${page} of ${totalPages} · ${total} ${noun}`;
  const prev = hasPrev
    ? `<a class="pager-btn" href="${esc(pageHref(basePath, page - 1))}" rel="prev">Previous</a>`
    : `<span class="pager-btn is-disabled" aria-disabled="true">Previous</span>`;
  const next = hasNext
    ? `<a class="pager-btn" href="${esc(pageHref(basePath, page + 1))}" rel="next">Next</a>`
    : `<span class="pager-btn is-disabled" aria-disabled="true">Next</span>`;
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

export function listSection(listHtml, pagerHtml) {
  return `${pagerHtml}${listHtml}${pagerHtml}`;
}

export function dogCard(row) {
  const still = row.still
    ? `<img class="still" src="${esc(row.still)}" alt="Stored still for ${esc(row.handle)}" width="320" height="200">`
    : "";
  const credit = row.still_credit
    ? `<p class="credit">${esc(row.still_credit)}</p>`
    : "";
  return `<article class="dog-card" data-snapshot-id="${esc(row.id)}">
    <header>
      <span class="handle">${esc(row.handle)}</span>
      <span class="acct">${esc(row.account_name)}</span>
      <time datetime="${esc(row.posted_at)}">${esc(formatDate(row.posted_at))}</time>
    </header>
    <p class="post-text">${esc(row.text)}</p>
    ${still}
    ${credit}
    <p class="cite">Citation: <a href="${esc(row.source_url)}" rel="noopener noreferrer">${esc(row.source_url)}</a></p>
  </article>`;
}

export function dogRow(row) {
  const previewId = `preview-${esc(row.id)}`;
  return `<li class="dog-row" data-snapshot-id="${esc(row.id)}">
    <button type="button" class="dog-row-toggle" aria-expanded="false" aria-controls="${previewId}">
      <div class="dog-row-main">
        <span class="handle">${esc(row.handle)}</span>
        <time datetime="${esc(row.posted_at)}">${esc(formatDate(row.posted_at))}</time>
        <p>${esc(row.text)}</p>
      </div>
      <span class="preview-hint">View snapshot</span>
    </button>
    <div class="hover-preview" id="${previewId}" hidden>
      ${dogCard(row)}
    </div>
  </li>`;
}

export function homeBody({ counts, peoplePreview, dogsPreview }) {
  const cards = CATEGORIES.map((c) => {
    const n = counts.byCategory[c.id] || 0;
    return `<a class="cat-card" href="${esc(c.path)}">
      <h2>${esc(c.title)}</h2>
      <p>${esc(c.blurb)}</p>
      <span class="count">${n} seeded rows</span>
    </a>`;
  }).join("");
  return `
    <p class="notice">This catalog is a verified seed (8–12 rows per exit category, 7+ official dog-comms posts). It is not exhaustive.</p>
    <section class="cards">${cards}</section>
    <section>
      <h2>Recent exits in the seed</h2>
      ${peopleList(peoplePreview, { showDeath: true })}
    </section>
    <section>
      <h2>Recent dog comms</h2>
      <p class="hint">Hover or tap a row for the stored snapshot. Nothing is fetched from X at view time.</p>
      <ul class="dog-list">${dogsPreview.map(dogRow).join("")}</ul>
    </section>`;
}

export function downloadsBody() {
  return `
    <p>The media pack (portraits, dog-comm stills, and the JSON seed) is published as a GitHub Release zip. This page describes that pack. It does not download or fetch the zip when you open it.</p>
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
    <p>The committed <code>data/seed.json</code> is enough to run the app. The zip is for redistributing the same seed plus <code>media/</code>.</p>`;
}

export function healthBody(payload) {
  return `<pre class="health">${esc(JSON.stringify(payload, null, 2))}</pre>`;
}
