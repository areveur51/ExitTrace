import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { CATEGORIES } from "../app/lib/categories.mjs";
import {
  CARD_SIZE_STORAGE_KEY,
  CARD_SIZES,
  DEFAULT_CARD_SIZE,
  DEFAULT_RESULTS_VIEW,
  RESULTS_VIEW_STORAGE_KEY,
  RESULTS_VIEWS,
  layout,
  listSection,
  operationRow,
  pageSizeSelector,
  pager,
  peopleList,
  resultsViewControl,
  searchBody,
} from "../app/lib/html.mjs";
import { PAGE_SIZES } from "../app/lib/paginate.mjs";
import { handle } from "../app/server.mjs";
import { loadSeedFile, setMemory } from "../app/lib/store.mjs";
import { ATTRIBUTE_TAGS } from "../app/lib/tags.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      url: pathname,
      headers: { host: "127.0.0.1" },
    };
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      writeHead(status) {
        this.statusCode = status;
      },
      end(body) {
        if (body) chunks.push(body);
        resolve({
          status: this.statusCode || 200,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

function countToolbar(html) {
  return (html.match(/data-results-toolbar/g) || []).length;
}

test("results view control is list/cards plus small/medium/large", () => {
  assert.deepEqual(RESULTS_VIEWS, ["list", "cards"]);
  assert.deepEqual(CARD_SIZES, ["s", "m", "l"]);
  assert.equal(DEFAULT_RESULTS_VIEW, "list");
  assert.equal(DEFAULT_CARD_SIZE, "m");
  assert.equal(RESULTS_VIEW_STORAGE_KEY, "exittrace-results-view");
  assert.equal(CARD_SIZE_STORAGE_KEY, "exittrace-card-size");
  const html = resultsViewControl();
  assert.match(html, /data-results-toolbar/);
  assert.match(html, /data-results-view-set="list"[^>]*aria-pressed="true"/);
  assert.match(html, /data-results-view-set="cards"[^>]*aria-pressed="false"/);
  assert.match(html, /data-card-size-set="s"/);
  assert.match(html, /data-card-size-set="m"[^>]*aria-pressed="true"/);
  assert.match(html, /data-card-size-set="l"/);
  assert.match(html, /aria-labelledby="results-view-label"/);
  assert.match(html, /aria-labelledby="card-size-label"/);
  assert.match(html, />List</);
  assert.match(html, />Cards</);
  assert.match(html, /data-results-view-set="list"[^>]*>[\s\S]*class="ui-icon"/);
  assert.match(html, /data-card-size-set="s"[^>]*aria-label="Small"[^>]*>[\s\S]*ui-icon-solid/);
  assert.match(html, /aria-label="Small"/);
  assert.match(html, /aria-label="Medium"/);
  assert.match(html, /aria-label="Large"/);
  assert.match(html, /class="card-size-label" id="card-size-label"/);
  assert.match(html, />Card size</);
  assert.doesNotMatch(html, />Small</);
  assert.doesNotMatch(html, />Medium</);
  assert.doesNotMatch(html, />Large</);
});

test("toolbar sits once above a result list and stays off empty or rank markup", () => {
  const rows = [
    {
      id: "ada",
      name: "Ada Lovelace",
      category: "firing",
      event_date: "2024-01-02",
      net_worth_usd: null,
      photo: "",
    },
  ];
  const list = peopleList(rows);
  assert.match(list, /class="tui-row person-card/);
  assert.match(list, /tui-title/);
  assert.doesNotMatch(list, /data-results-toolbar/);
  const section = listSection(list, "<nav class='pager'></nav>", "<p class='list-head'>Firings</p>");
  assert.equal(countToolbar(section), 1);
  assert.ok(section.indexOf("data-results-toolbar") < section.indexOf("people-list"));
  assert.ok(section.indexOf("data-results-toolbar") < section.indexOf("class='pager'"));
  const empty = listSection("<p class='empty'>No rows on this page.</p>", "", "");
  assert.equal(countToolbar(empty), 0);
  const emptyPaged = listSection(
    "<p class='empty'>No rows on this page.</p>",
    "<nav class='pager'></nav>",
    "",
  );
  assert.equal(countToolbar(emptyPaged), 1);
  const rank = listSection("<table class='dash-table'><tr><td>Reason</td></tr></table>", "", "");
  assert.equal(countToolbar(rank), 0);
  const rankPaged = listSection(
    "<div class='dash-hud dash-rank-page'><table class='dash-table'><tr><td>Reason</td></tr></table></div>",
    "<nav class='pager'></nav>",
    "",
  );
  assert.equal(countToolbar(rankPaged), 0);
  const prompt = listSection(searchBody([], ""), "", "");
  assert.equal(countToolbar(prompt), 0);
});

test("layout boot script restores view and card size from localStorage before paint", () => {
  const page = layout({
    title: "Firings",
    path: "/firings",
    heading: "Firings",
    body: "<p>rows</p>",
  });
  assert.match(page, new RegExp(RESULTS_VIEW_STORAGE_KEY));
  assert.match(page, new RegExp(CARD_SIZE_STORAGE_KEY));
  assert.match(page, /localStorage\.getItem/);
  assert.match(page, /data-results-view/);
  assert.match(page, /data-card-size/);
  assert.doesNotMatch(page, /exittrace-results-view=/);
});

test("catalog, search, and people lists include one toolbar; home, detail, and rank tables do not", async () => {
  setMemory(goldSeed());
  const surfaces = [
    "/firings",
    "/resignations",
    "/government",
    "/arrests",
    "/deaths",
    "/indictments",
    "/group-operations",
    "/unsorted",
    "/dog-comms",
    "/red-folder-comms",
    "/eagle-comms",
    "/ronald-comms",
    "/shot-comms",
    "/central-casting",
    "/corona-comms",
    "/tags/trump-nicknames",
    "/search?q=comey",
    "/dashboard/missing",
    "/dashboard/age",
  ];
  const sawList = [];
  for (const pathname of surfaces) {
    const res = await requestPage(pathname);
    assert.equal(res.status, 200, pathname);
    const hasList = res.body.includes("tui-list") || res.body.includes("No rows on this page");
    assert.equal(countToolbar(res.body), hasList ? 1 : 0, pathname);
    if (hasList) {
      sawList.push(pathname);
      assert.match(res.body, /data-results-view-set="list"/, pathname);
      assert.match(res.body, /data-card-size-set="s"/, pathname);
      assert.match(res.body, /data-card-size-set="m"/, pathname);
      assert.match(res.body, /data-card-size-set="l"/, pathname);
    }
  }
  for (const pathname of ["/firings", "/deaths", "/dog-comms", "/search?q=comey"]) {
    assert.ok(sawList.includes(pathname), pathname);
  }
  const without = ["/", "/people/james-comey", "/dashboard", "/dashboard/reason", "/add", "/search"];
  for (const pathname of without) {
    const res = await requestPage(pathname);
    assert.equal(res.status, 200, pathname);
    assert.equal(countToolbar(res.body), 0, pathname);
  }
});

test("app.js persists results view and card size without a reload", () => {
  const js = fs.readFileSync(path.join(ROOT, "app", "public", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "app", "public", "styles.css"), "utf8");
  assert.match(js, /exittrace-results-view/);
  assert.match(js, /exittrace-card-size/);
  assert.match(js, /data-results-view-set/);
  assert.match(js, /data-card-size-set/);
  assert.match(js, /data-page-size-select/);
  assert.match(js, /localStorage\.setItem/);
  assert.match(js, /applyResultThumbSizes/);
  assert.match(js, /picture\.thumb-src source\[srcset\]/);
  assert.match(js, /view === "cards" \? "eager" : "lazy"/);
  assert.match(js, /46vw, 14rem/);
  assert.match(js, /92vw, 28rem/);
  assert.doesNotMatch(js, /results-view[\s\S]{0,400}location\.assign/);
  assert.match(css, /html\[data-results-view="cards"\] \.tui-group/);
  assert.match(css, /column-width:\s*var\(--result-card-min\)/);
  assert.match(css, /column-span:\s*all/);
  assert.match(css, /break-inside:\s*avoid/);
  assert.match(css, /html\[data-results-view="cards"\] \.tui-row > \.row-media/);
  assert.match(css, /html\[data-results-view="cards"\] \.tui-row > \.row-media img/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /height:\s*auto/);
  assert.match(css, /\.ui-icon \{[^}]*stroke:\s*currentColor/);
  assert.match(css, /\.ui-icon\.ui-icon-solid \{[^}]*fill:\s*currentColor/);
  assert.match(css, /\.page-size-label \{[^}]*flex:\s*0 0 auto/);
  assert.match(css, /html\[data-results-view="cards"\] \.card-size \{\s*display:\s*flex/);
  assert.match(css, /\.card-size \{\s*display:\s*none/);
  assert.match(css, /--result-card-min:\s*8\.25rem/);
  assert.match(css, /--result-card-min:\s*16rem/);
  assert.match(css, /\.results-controls/);
  assert.match(css, /@media \(min-width: 820px\)/);
  assert.match(css, /@media \(min-width: 1200px\)/);
  assert.doesNotMatch(css, /@media \(min-width: 1440px\)/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*\.results-controls \.pager-controls \{[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(css, /@container results-pager \(max-width: 17rem\)/);
  assert.match(css, /pager-pages > li:not\(:first-child\):not\(:last-child\):not\(:has\(a\[aria-current="page"\]\)\)/);
  assert.match(css, /@media \(min-width: 431px\) and \(max-width: 1199px\)[\s\S]*\.results-controls-row--page \{[\s\S]*?align-items:\s*start/);
  assert.match(css, /@media \(min-width: 431px\) and \(max-width: 1199px\)[\s\S]*\.results-controls \.pager-controls \{[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(css, /@container results-pager-row \(max-width: 17rem\)[\s\S]*:nth-child\(6\)/);
  assert.match(css, /@container results-pager-row \(max-width: 12\.25rem\)/);
});

test("operation cards share the result portrait slot and the sharp srcset", () => {
  const html = operationRow({
    id: "operation-restore-justice",
    name: "Operation Restore Justice",
    event_date: "2024-08-01",
    agencies: ["FBI"],
  });
  assert.match(html, /class="tui-row operation-card/);
  assert.match(html, /<div class="row-media">/);
  assert.match(html, /data-result-thumb/);
  assert.match(html, /sizes="40px"/);
  assert.match(html, /\/media\/thumbs\/agencies\/fbi\.jpg\?p=7 80w/);
  assert.match(html, /\/media\/thumbs\/agencies\/fbi\.2x\.jpg\?p=7 160w/);
  assert.match(html, /\/media\/agencies\/fbi\.png\?p=7 960w/);
  assert.match(html, /\/media\/thumbs\/agencies\/fbi\.hero\.webp\?p=7 960w/);
  assert.doesNotMatch(html, /fbi\.card/);
  assert.doesNotMatch(html, /person-card/);
});

test("combined results-controls bar is view, card size, pager, then rows", () => {
  const rows = [
    {
      id: "ada",
      name: "Ada Lovelace",
      category: "firing",
      event_date: "2024-01-02",
      net_worth_usd: null,
      photo: "",
    },
  ];
  const list = peopleList(rows);
  const nav = pager(
    { page: 2, totalPages: 15, total: 289, hasPrev: true, hasNext: true, pageSize: 34 },
    { basePath: "/firings", pageSizes: PAGE_SIZES },
  );
  const section = listSection(list, nav, `<p class="list-head">Firings</p>`);
  assert.equal(countToolbar(section), 1);
  assert.match(section, /class="results-controls results-view"/);
  assert.match(section, /results-controls-row--view/);
  assert.match(section, /results-controls-row--page/);
  const iToolbar = section.indexOf("data-results-toolbar");
  const iViewRow = section.indexOf("results-controls-row--view");
  const iView = section.indexOf("data-results-view-set");
  const iCard = section.indexOf("data-card-size-set");
  const iPageRow = section.indexOf("results-controls-row--page");
  const iPage = section.indexOf("pager-status-page");
  const iRows = section.indexOf("data-page-size-set");
  const iList = section.indexOf("people-list");
  assert.ok(iToolbar < iViewRow);
  assert.ok(iViewRow < iView);
  assert.ok(iView < iCard);
  assert.ok(iCard < iPageRow);
  assert.ok(iPageRow < iPage);
  assert.ok(iPage < iRows);
  assert.ok(iRows < iList);
  assert.match(section, /Page 2 of 15/);
  assert.match(section, /rel="prev"/);
  assert.match(section, /rel="next"/);
  assert.match(section, /data-key="ArrowLeft"/);
  assert.match(section, /data-key="ArrowRight"/);
  assert.match(section, /aria-current="page"/);
  assert.match(section, /data-page-size-select/);
  assert.match(section, /data-page-size-set="17"/);
  assert.match(section, /data-page-size-set="34"/);
  assert.match(section, /data-page-size-set="51"/);
  assert.equal((section.match(/data-results-toolbar/g) || []).length, 1);
  assert.equal((section.match(/data-page-size-select/g) || []).length, 1);
  assert.equal((section.match(/<nav class="page-size"/g) || []).length, 1);
  assert.equal((section.match(/<nav class="pager"/g) || []).length, 1);
  assert.match(section, /· 289 rows/);
  const afterList = section.slice(iList);
  assert.match(afterList, /class="pager pager--bottom"/);
  assert.match(afterList, /aria-label="Pagination \(bottom\)"/);
  assert.doesNotMatch(afterList, /pager-status/);
  assert.doesNotMatch(afterList, /pager-count/);
  assert.doesNotMatch(afterList, /data-page-size/);
  assert.doesNotMatch(afterList, /Rows per page/);
});

test("rows selector keeps 17/34/51 buttons and a wide-screen select", () => {
  const html = pageSizeSelector(34);
  assert.match(html, /data-page-size-set="17"/);
  assert.match(html, /data-page-size-set="34" aria-pressed="true"/);
  assert.match(html, /data-page-size-set="51"/);
  assert.match(html, /data-page-size-select/);
  assert.match(html, /<option value="34" selected>/);
  assert.match(html, /class="vh">Rows</);
  assert.match(html, /Rows per page/);
});

test("every catalog list route renders the combined bar; home and detail do not", async () => {
  setMemory(goldSeed());
  const listRoutes = [
    ...CATEGORIES.filter((c) => c.path).map((c) => c.path),
    ...ATTRIBUTE_TAGS.map((t) => t.path),
    "/search?q=comey",
    "/dashboard/missing",
    "/dashboard/age",
  ];
  const sawList = [];
  for (const pathname of listRoutes) {
    const res = await requestPage(pathname);
    assert.equal(res.status, 200, pathname);
    const hasList = res.body.includes("tui-list") || res.body.includes("No rows on this page");
    assert.equal(countToolbar(res.body), 1, pathname);
    assert.ok(hasList, pathname);
    sawList.push(pathname);
    const toolbarAt = res.body.indexOf("data-results-toolbar");
    const listAt = res.body.includes("tui-list")
      ? res.body.indexOf("tui-list")
      : res.body.indexOf("No rows on this page");
    assert.ok(toolbarAt >= 0 && toolbarAt < listAt, pathname);
    assert.match(res.body, /class="results-controls/, pathname);
    assert.match(res.body, /results-controls-row--view/, pathname);
    assert.match(res.body, /data-results-view-set="list"/, pathname);
    assert.match(res.body, /data-card-size-set="s"/, pathname);
    assert.match(res.body, /data-card-size-set="m"/, pathname);
    assert.match(res.body, /data-card-size-set="l"/, pathname);
    assert.match(res.body, /exittrace-results-view/, pathname);
    assert.match(res.body, /exittrace-card-size/, pathname);
  }
  const enumerated = [
    "/firings",
    "/resignations",
    "/government",
    "/arrests",
    "/indictments",
    "/indictments/civilians",
    "/indictments/non-civilians",
    "/deaths",
    "/deaths/celebrities",
    "/deaths/officials",
    "/deaths/ceos",
    "/deaths/unconfirmed",
    "/group-operations",
    "/group-operations/missing-kids",
    "/group-operations/human-smuggling",
    "/group-operations/fugitives",
    "/group-operations/cybercrime",
    "/group-operations/drug-trafficking",
    "/group-operations/violent-crime",
    "/group-operations/fraud",
    "/unsorted",
    "/dog-comms",
    "/eagle-comms",
    "/ronald-comms",
    "/shot-comms",
    "/boot-comms",
    "/red-folder-comms",
    "/corona-comms",
    "/central-casting",
    "/search?q=comey",
    "/dashboard/missing",
    "/dashboard/age",
    ...ATTRIBUTE_TAGS.map((t) => t.path),
  ];
  for (const pathname of enumerated) {
    assert.ok(listRoutes.includes(pathname), `enumerated ${pathname}`);
  }
  for (const pathname of enumerated) {
    assert.ok(sawList.includes(pathname), pathname);
  }
  const without = [
    "/",
    "/people/james-comey",
    "/dashboard",
    "/dashboard/reason",
    "/add",
    "/search",
  ];
  for (const pathname of without) {
    const res = await requestPage(pathname);
    assert.equal(res.status, 200, pathname);
    assert.equal(countToolbar(res.body), 0, pathname);
    assert.doesNotMatch(res.body, /class="results-controls/, pathname);
  }
});

function sliceDivContaining(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return { start: -1, end: -1, html: "" };
  const start = html.lastIndexOf("<div", at);
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = re.exec(html))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        const end = match.index + match[0].length;
        return { start, end, html: html.slice(start, end) };
      }
    } else {
      depth += 1;
    }
  }
  return { start, end: -1, html: "" };
}

function sliceNavAt(html, start) {
  const re = /<\/?nav\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = re.exec(html))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(start, match.index + match[0].length);
    } else {
      depth += 1;
    }
  }
  return "";
}

function barListRoutes() {
  return [
    ...CATEGORIES.filter((c) => c.path).map((c) => c.path),
    ...ATTRIBUTE_TAGS.map((t) => t.path),
    "/search?q=comey",
    "/dashboard/missing",
    "/dashboard/age",
  ];
}

function sampleRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `person-${i + 1}`,
    name: `Person ${i + 1}`,
    category: "firing",
    event_date: "2024-01-02",
    net_worth_usd: null,
    photo: "",
  }));
}

function pagingMeta(page, totalPages, total) {
  return {
    page,
    totalPages,
    total,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    pageSize: 17,
  };
}

test("bar pages keep one rows control and a bottom nav only for multi-page lists with rows", () => {
  const head = `<p class="list-head">Firings</p>`;
  const emptyNav = pager(pagingMeta(1, 1, 0), {
    basePath: "/indictments",
    noun: "rows",
    pageSizes: PAGE_SIZES,
  });
  const empty = listSection(`<p class="empty">No rows on this page.</p>`, emptyNav, head);
  assert.equal(countToolbar(empty), 1);
  assert.equal((empty.match(/<nav class="pager"/g) || []).length, 1);
  assert.equal((empty.match(/data-page-size-select/g) || []).length, 1);
  assert.equal((empty.match(/pager--bottom/g) || []).length, 0);
  assert.match(empty, /Page 1 of 1/);
  assert.match(empty, /· 0 rows/);
  const emptyBar = sliceDivContaining(empty, "data-results-toolbar");
  assert.match(emptyBar.html, /pager-status/);
  assert.equal(empty.slice(emptyBar.end).includes("pager-status"), false);

  const emptyMulti = listSection(
    `<p class="empty">No rows on this page.</p>`,
    pager(pagingMeta(1, 4, 0), { basePath: "/indictments", pageSizes: PAGE_SIZES }),
    head,
  );
  assert.equal((emptyMulti.match(/pager--bottom/g) || []).length, 0);
  assert.equal((emptyMulti.match(/data-page-size-select/g) || []).length, 1);

  const single = listSection(
    peopleList(sampleRows(1)),
    pager(pagingMeta(1, 1, 4), { basePath: "/firings", noun: "rows", pageSizes: PAGE_SIZES }),
    head,
  );
  assert.equal(countToolbar(single), 1);
  assert.match(single, /tui-list/);
  assert.match(single, /Page 1 of 1/);
  assert.match(single, /· 4 rows/);
  assert.equal((single.match(/<nav class="pager"/g) || []).length, 1);
  assert.equal((single.match(/<nav class="page-size"/g) || []).length, 1);
  assert.equal((single.match(/data-page-size-select/g) || []).length, 1);
  assert.equal((single.match(/pager--bottom/g) || []).length, 0);
  const singleBar = sliceDivContaining(single, "data-results-toolbar");
  assert.equal((singleBar.html.match(/data-page-size-select/g) || []).length, 1);
  assert.equal(single.slice(singleBar.end).includes("pager-status"), false);

  const multi = listSection(
    peopleList(sampleRows(2)),
    pager(pagingMeta(2, 3, 36), { basePath: "/deaths", noun: "rows", pageSizes: PAGE_SIZES }),
    head,
  );
  assert.equal(countToolbar(multi), 1);
  assert.equal((multi.match(/<nav class="pager"/g) || []).length, 1);
  assert.equal((multi.match(/<nav class="pager pager--bottom"/g) || []).length, 1);
  assert.equal((multi.match(/data-page-size-select/g) || []).length, 1);
  assert.equal((multi.match(/class="pager-status"/g) || []).length, 1);
  assert.match(multi, /Page 2 of 3/);
  assert.match(multi, /· 36 rows/);
  const multiBar = sliceDivContaining(multi, "data-results-toolbar");
  const listAt = multi.indexOf("tui-list");
  const bottomAt = multi.indexOf(`<nav class="pager pager--bottom"`);
  assert.ok(multiBar.end < listAt);
  assert.ok(bottomAt > listAt);
  assert.equal((multiBar.html.match(/<nav class="pager"/g) || []).length, 1);
  assert.equal((multiBar.html.match(/data-page-size-select/g) || []).length, 1);
  assert.match(multiBar.html, /pager-count/);
  const bottom = sliceNavAt(multi, bottomAt);
  assert.match(bottom, /aria-label="Pagination \(bottom\)"/);
  assert.match(bottom, /class="pager-controls"/);
  assert.match(bottom, /class="pager-pages"/);
  assert.match(bottom, /aria-label="Previous page"/);
  assert.match(bottom, /aria-label="Next page"/);
  assert.match(bottom, /rel="prev"/);
  assert.match(bottom, /rel="next"/);
  assert.doesNotMatch(bottom, /pager-status/);
  assert.doesNotMatch(bottom, /pager-count/);
  assert.doesNotMatch(bottom, /pager-results-label/);
  assert.doesNotMatch(bottom, /data-page-size/);
  assert.doesNotMatch(bottom, /page-size/);
  assert.doesNotMatch(bottom, /Rows per page/);
  const outside = multi.slice(0, multiBar.start) + multi.slice(multiBar.end, bottomAt) + multi.slice(bottomAt + bottom.length);
  assert.equal((outside.match(/pager-status/g) || []).length, 0);
  assert.equal((outside.match(/data-page-size-select/g) || []).length, 0);
});

test("rank tables keep the standalone pager when the results bar is absent", () => {
  const nav = pager(pagingMeta(1, 2, 20), {
    basePath: "/dashboard/reason",
    noun: "rows",
    pageSizes: PAGE_SIZES,
  });
  const rank = listSection(
    `<div class="dash-hud dash-rank-page"><table class="dash-table"><tr><td>Reason</td></tr></table></div>`,
    nav,
    `<p class="list-head">Reason</p>`,
  );
  assert.equal(countToolbar(rank), 0);
  assert.doesNotMatch(rank, /results-controls/);
  assert.equal((rank.match(/<nav class="pager"/g) || []).length, 2);
  assert.equal((rank.match(/class="pager-status"/g) || []).length, 2);
  assert.equal((rank.match(/data-page-size-select/g) || []).length, 2);
  assert.equal((rank.match(/<nav class="page-size"/g) || []).length, 2);
  assert.equal((rank.match(/pager--bottom/g) || []).length, 0);
  const listAt = rank.indexOf("dash-table");
  assert.ok(rank.indexOf("pager-status") < listAt);
  assert.ok(rank.indexOf("pager-status", listAt) > listAt);
});

test("row count stays visible in the results bar at every width", () => {
  const css = fs.readFileSync(path.join(ROOT, "app", "public", "styles.css"), "utf8");
  assert.match(css, /\.results-controls \.pager-status \{[^}]*display:\s*flex/);
  assert.doesNotMatch(css, /\.results-controls \.pager-status \{[^}]*display:\s*none/);
  assert.doesNotMatch(css, /\.pager-count\b[^}]*display:\s*none/);
});

test("every results-bar list renders the pager and rows control once", async () => {
  setMemory(goldSeed());
  const routes = barListRoutes();
  let sawEmpty = false;
  let sawSingle = false;
  let sawMulti = false;
  for (const pathname of routes) {
    const res = await requestPage(pathname);
    assert.equal(res.status, 200, pathname);
    assert.equal(countToolbar(res.body), 1, pathname);
    const bar = sliceDivContaining(res.body, "data-results-toolbar");
    assert.ok(bar.end > bar.start, pathname);
    assert.equal((bar.html.match(/<nav class="pager"/g) || []).length, 1, pathname);
    assert.equal((bar.html.match(/pager--bottom/g) || []).length, 0, pathname);
    assert.match(bar.html, /aria-label="Pagination"/, pathname);
    assert.match(bar.html, /class="pager-status"/, pathname);
    assert.match(bar.html, /class="pager-count"/, pathname);
    assert.match(bar.html, /Page \d+ of \d+/, pathname);
    assert.match(bar.html, /· \d+ (?:rows|posts|results)/, pathname);

    const outside = res.body.slice(0, bar.start) + res.body.slice(bar.end);
    assert.equal((outside.match(/pager-status/g) || []).length, 0, pathname);
    assert.equal((outside.match(/<nav class="pager"/g) || []).length, 0, pathname);
    assert.equal((outside.match(/data-page-size-select/g) || []).length, 0, pathname);
    assert.equal((outside.match(/<nav class="page-size"/g) || []).length, 0, pathname);

    const selects = res.body.match(/data-page-size-select/g) || [];
    const sizeNavs = res.body.match(/<nav class="page-size"/g) || [];
    if (pathname.startsWith("/search")) {
      assert.equal(selects.length, 0, pathname);
      assert.equal(sizeNavs.length, 0, pathname);
    } else {
      assert.equal(selects.length, 1, pathname);
      assert.equal(sizeNavs.length, 1, pathname);
      assert.equal((bar.html.match(/data-page-size-select/g) || []).length, 1, pathname);
      assert.equal((bar.html.match(/<nav class="page-size"/g) || []).length, 1, pathname);
    }

    const totalPages = Number((bar.html.match(/Page \d+ of (\d+)/) || [])[1]);
    assert.ok(totalPages >= 1, pathname);
    const hasRows = res.body.includes("tui-list");
    const bottoms = res.body.match(/<nav class="pager pager--bottom"/g) || [];
    const wantBottom = hasRows && totalPages > 1;
    assert.equal(bottoms.length, wantBottom ? 1 : 0, pathname);
    if (!hasRows) sawEmpty = true;
    else if (totalPages === 1) sawSingle = true;
    else sawMulti = true;
    if (!wantBottom) continue;
    const bottomAt = res.body.indexOf(`<nav class="pager pager--bottom"`);
    const listAt = res.body.indexOf("tui-list");
    assert.ok(bottomAt > bar.end, pathname);
    assert.ok(bottomAt > listAt, pathname);
    const bottom = sliceNavAt(res.body, bottomAt);
    assert.match(bottom, /aria-label="Pagination \(bottom\)"/, pathname);
    assert.match(bottom, /pager-controls/, pathname);
    assert.match(bottom, /pager-pages/, pathname);
    assert.match(bottom, /aria-label="Previous page"/, pathname);
    assert.match(bottom, /aria-label="Next page"/, pathname);
    assert.doesNotMatch(bottom, /pager-status/, pathname);
    assert.doesNotMatch(bottom, /pager-count/, pathname);
    assert.doesNotMatch(bottom, /data-page-size/, pathname);
    assert.doesNotMatch(bottom, /page-size/, pathname);
    assert.doesNotMatch(bottom, /Rows per page/, pathname);
  }
  assert.equal(sawEmpty, true);
  assert.equal(sawSingle, true);
  assert.equal(sawMulti, true);

  const rank = await requestPage("/dashboard/reason");
  assert.equal(rank.status, 200);
  assert.equal(countToolbar(rank.body), 0);
  assert.doesNotMatch(rank.body, /pager--bottom/);
  assert.ok((rank.body.match(/<nav class="pager"/g) || []).length >= 2);
  assert.ok((rank.body.match(/pager-status/g) || []).length >= 2);
  assert.ok((rank.body.match(/data-page-size-select/g) || []).length >= 2);
});
