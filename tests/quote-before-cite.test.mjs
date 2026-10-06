import assert from "node:assert/strict";
import { test } from "node:test";
import { personDetail, personEventSection } from "../app/lib/html.mjs";

const NEWS = "https://www.npr.org/2020/05/07/852247792/justice-department-is-dropping-case-against-ex-trump-adviser-michael-flynn";
const PLAIN = "https://www.bbc.com/news/world-us-canada-38965557";

function resignationRow(sources) {
  return {
    id: "quote-order-fixture",
    name: "Quote Order Fixture",
    category: "resignations",
    event_date: "2017-02-13",
    events: [{ kind: "resignations", event_date: "2017-02-13", comments: "Resigned.", sources }],
  };
}

test("resignation cite with a snippet renders the quote immediately before its link", () => {
  const html = personDetail(resignationRow([
    { url: NEWS, date: "2020-05-07", publisher: "NPR", snippet: "He was an innocent man" },
  ]));
  const esc = NEWS.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  assert.match(
    html,
    new RegExp(`<li><blockquote class="event-snippet">He was an innocent man</blockquote><a class="source-link" href="${esc}"`),
  );
  assert.doesNotMatch(html, new RegExp(`<a class="source-link" href="${esc}"[^<]*</a>[^<]*(<span[^>]*>[^<]*</span>)?\\s*(<time[^>]*>[^<]*</time>)?<blockquote`));
});

test("resignation cite without a snippet renders unchanged: link then date, no blockquote", () => {
  const html = personDetail(resignationRow([{ url: PLAIN, date: "2017-02-13" }]));
  const esc = PLAIN.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  assert.match(
    html,
    new RegExp(`<li><a class="source-link" href="${esc}" title="${esc}" target="_blank" rel="noopener noreferrer">${esc}</a> <time datetime="2017-02-13">Feb 13, 2017</time></li>`),
  );
  assert.doesNotMatch(html, /event-snippet/);
});

test("every kind pairs a stored snippet before its cite (no per-kind switch)", () => {
  for (const kind of ["resignations", "firings", "corona_comms", "boot_comms", "central_casting", "arrests", "notable"]) {
    const html = personEventSection({
      title: "T",
      kind,
      cites: [{ url: NEWS, snippet: "Quote", source_label: "NPR" }, { url: PLAIN }],
    });
    assert.match(html, /<li><blockquote class="event-snippet">Quote<\/blockquote><a class="source-link"/, kind);
    assert.match(html, /<li><a class="source-link" href="https:\/\/www\.bbc\.com/, kind);
  }
});
