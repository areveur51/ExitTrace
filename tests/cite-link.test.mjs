import assert from "node:assert/strict";
import { test } from "node:test";
import {
  citeLink,
  citeList,
  detailSourceLine,
  grokipediaBlock,
  kindSourceHtml,
  operationDetail,
  personEventSection,
} from "../app/lib/html.mjs";

const URL = "https://www.washingtonpost.com/politics/example";

function anchorText(html) {
  const match = String(html).match(/<a class="source-link"[^>]*>([^<]*)<\/a>/);
  return match ? match[1] : "";
}

test("cite link text is the full URL when a URL is present", () => {
  const html = citeLink(URL, { label: "Washington Post" });
  assert.equal(
    html,
    `<a class="source-link" href="${URL}" title="${URL}" target="_blank" rel="noopener noreferrer">${URL}</a> <span class="cite-outlet">Washington Post</span>`,
  );
  assert.equal(anchorText(html), URL);
  assert.notEqual(anchorText(html), "Washington Post");
  assert.doesNotMatch(html, /<a[^>]*>Washington Post<\/a>/);

  const bare = citeLink(URL);
  assert.equal(anchorText(bare), URL);
  assert.doesNotMatch(bare, /cite-outlet/);

  const same = citeLink(URL, { label: URL });
  assert.equal(anchorText(same), URL);
  assert.doesNotMatch(same, /cite-outlet/);
});

test("cite link with no URL is plain text and not an anchor", () => {
  const html = citeLink("", { label: "Washington Post" });
  assert.equal(html, `<span class="cite-outlet">Washington Post</span>`);
  assert.doesNotMatch(html, /<a\b/);
  assert.equal(citeLink("  ", { label: "X" }), `<span class="cite-outlet">X</span>`);
  assert.equal(citeLink(""), "");
});

test("person event, ops, dog source, and grokipedia cites use the URL as link text", () => {
  const list = citeList([
    { publisher: "Washington Post", title: "Headline only", url: URL, date: "2024-01-02" },
    { publisher: "No URL outlet" },
  ]);
  assert.equal(anchorText(list), URL);
  assert.match(list, /class="cite-outlet">Washington Post</);
  assert.match(list, /<span class="cite-outlet">No URL outlet<\/span>/);
  assert.doesNotMatch(list, /<a[^>]*>Washington Post<\/a>/);
  assert.doesNotMatch(list, /<a[^>]*href=""/);

  const casting = personEventSection({
    title: "Central Casting",
    kind: "central_casting",
    pairSnippetBefore: true,
    cites: [
      {
        url: "https://x.com/realDonaldTrump/status/1",
        snippet: "He looks like he is out of central casting.",
        source_label: "Donald J. Trump",
      },
    ],
  });
  assert.match(
    casting,
    /<blockquote class="event-snippet">He looks like he is out of central casting\.<\/blockquote><a class="source-link" href="https:\/\/x\.com\/realDonaldTrump\/status\/1" title="https:\/\/x\.com\/realDonaldTrump\/status\/1" target="_blank" rel="noopener noreferrer">https:\/\/x\.com\/realDonaldTrump\/status\/1<\/a>/,
  );
  assert.match(casting, /class="cite-outlet">Donald J\. Trump</);
  assert.equal(anchorText(casting), "https://x.com/realDonaldTrump/status/1");

  const corona = personEventSection({
    title: "Corona",
    kind: "corona_comms",
    cites: [
      {
        url: "https://www.bbc.com/news/casey-corona",
        snippet: "Corona note",
        source_label: "BBC News",
      },
    ],
  });
  assert.match(
    corona,
    /<a class="source-link" href="https:\/\/www\.bbc\.com\/news\/casey-corona"[\s\S]*<blockquote class="event-snippet">Corona note<\/blockquote>/,
  );
  assert.equal(anchorText(corona), "https://www.bbc.com/news/casey-corona");
  assert.doesNotMatch(corona, /<a[^>]*>BBC News<\/a>/);

  const source = detailSourceLine("https://x.com/EzraACohen/status/2092784717917462982");
  assert.match(
    source,
    /Source · <a class="source-link" href="https:\/\/x\.com\/EzraACohen\/status\/2092784717917462982" title="https:\/\/x\.com\/EzraACohen\/status\/2092784717917462982" target="_blank" rel="noopener noreferrer">https:\/\/x\.com\/EzraACohen\/status\/2092784717917462982<\/a>/,
  );
  assert.equal(detailSourceLine(""), `<p class="meta-line">Source · —</p>`);

  const dog = kindSourceHtml({ source_url: "https://x.com/EzraACohen/status/1" });
  assert.equal(anchorText(dog), "https://x.com/EzraACohen/status/1");

  const op = operationDetail({
    id: "op-1",
    name: "Example Op",
    event_date: "2024-01-02",
    tags: [],
    agencies: [],
    sources: [{ publisher: "Washington Post", url: URL, title: "Headline" }],
  });
  assert.equal(anchorText(op), URL);
  assert.match(op, /class="cite-outlet">Washington Post</);
  assert.doesNotMatch(op, /<a[^>]*>Washington Post<\/a>/);

  const grok = grokipediaBlock(
    {},
    { cite: { url: "https://grokipedia.com/page/James_Comey", publisher: "Grokipedia" } },
  );
  assert.match(grok, /grokipedia-cite/);
  assert.match(grok, /Grokipedia · /);
  assert.equal(anchorText(grok), "https://grokipedia.com/page/James_Comey");
  assert.doesNotMatch(grok, />grokipedia\.com<\/a>/);
});
