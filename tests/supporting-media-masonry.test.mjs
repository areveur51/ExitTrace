import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  kindDetail,
  notableMediaHtml,
  personDetail,
  supportingMediaHtml,
  supportingMediaSection,
} from "../app/lib/html.mjs";
import { EVENT_MEDIA_DISPLAY_MAX, EVENT_MEDIA_STORE_MAX } from "../app/lib/event-attrs.mjs";

// v1.2.35 (Admiral 2026-10-26): supporting media follows ONE masonry on every surface,
// drawn by supportingMediaHtml() and laid out by one CSS block.

const HTML_SRC = readFileSync(new URL("../app/lib/html.mjs", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../app/public/styles.css", import.meta.url), "utf8");
const MASONRY_OPEN = 'class="detail-media detail-media--masonry detail-support-masonry"';

function fnBody(name) {
  const at = HTML_SRC.search(new RegExp(`\\nfunction ${name}\\(|\\nexport function ${name}\\(`));
  assert.ok(at >= 0, `function ${name} exists`);
  const end = HTML_SRC.indexOf("\n}\n", at);
  return HTML_SRC.slice(at, end);
}

function media(n, id = "masonry-test") {
  return Array.from({ length: n }, (_, i) => ({
    src: `/media/people/${id}/support/clip-${i + 1}.jpg`,
    alt: `Support still ${i + 1}`,
    credit: `Credit ${i + 1}`,
  }));
}

function person(n, extra = {}) {
  return {
    id: "masonry-test",
    name: "Masonry Test",
    category: "firings",
    event_date: "2025-01-02",
    events: [
      {
        kind: "firings",
        event_date: "2025-01-02",
        comments: "Stored event.",
        sources: [{ url: "https://apnews.com/article/masonry-test" }],
        media: media(n),
        ...extra,
      },
    ],
  };
}

function tilesIn(html) {
  const m = html.match(/detail-support-masonry" data-tiles="(\d+)"/);
  return m ? Number(m[1]) : 0;
}

test("caps are unchanged: 24 stored, 8 displayed", () => {
  assert.equal(EVENT_MEDIA_STORE_MAX, 24);
  assert.equal(EVENT_MEDIA_DISPLAY_MAX, 8);
});

test("every supporting-media surface calls the shared helper", () => {
  // The masonry wrapper markup is written exactly once, inside supportingMediaHtml.
  assert.equal(HTML_SRC.split('detail-support-masonry" data-tiles=').length - 1, 1);
  assert.match(fnBody("supportingMediaHtml"), /detail-support-masonry" data-tiles=/);
  assert.match(fnBody("supportingMediaSection"), /supportingMediaHtml\(/);
  for (const name of [
    "personSupportingMediaHtml", // person card: every event's media + card screenshot
    "officialPostSupportHtml", // comms: dog, red folder, eagle, ronald, shot
  ]) {
    assert.match(fnBody(name), /supportingMediaSection\(/, name);
  }
  for (const name of [
    "kindEventSection", // Notable and Red Folder blocks
    "shotEventHtml", // Shot comm on a person card
    "eventTagRow", // shot event row
    "centralCastingMediaHtml", // Central Casting clips on a person card
  ]) {
    assert.match(fnBody(name), /supportingMediaHtml\(/, name);
  }
  // Figures come from one partial; the old per-surface figure is gone.
  assert.doesNotMatch(HTML_SRC, /function eventMediaFigure\(/);
  assert.doesNotMatch(HTML_SRC, /<figure class="event-media">/);
  assert.match(fnBody("notableMediaFigures"), /supportingMediaFigures\(/);
  assert.match(fnBody("personSupportingMediaHtml"), /supportingMediaFigures\(/);
});

test("helper: 0 tiles render nothing; n tiles render one masonry with data-tiles=n", () => {
  assert.equal(supportingMediaHtml([]), "");
  assert.equal(supportingMediaHtml(["", null]), "");
  assert.equal(supportingMediaSection([]), "");
  for (const n of [1, 2, 8, 12]) {
    const tiles = Array.from({ length: n }, (_, i) => `<figure class="detail-tile">${i}</figure>`);
    const html = supportingMediaHtml(tiles);
    assert.equal(tilesIn(html), n);
    assert.equal(html.split(MASONRY_OPEN).length - 1, 1);
    const section = supportingMediaSection(tiles);
    assert.match(section, /^<section class="detail-supporting" aria-label="Supporting media"><h3 class="event-h">Supporting media<\/h3>/);
  }
});

test("person card image-count matrix: 0, 1, 2, 8 and 12 (display cap 8)", () => {
  for (const [n, want] of [
    [0, 0],
    [1, 1],
    [2, 2],
    [8, 8],
    [12, 8],
  ]) {
    const html = personDetail(person(n));
    if (want === 0) {
      assert.doesNotMatch(html, /detail-support-masonry/, `n=${n}`);
      assert.doesNotMatch(html, /aria-label="Supporting media"/, `n=${n}`);
      continue;
    }
    assert.equal(html.split(MASONRY_OPEN).length - 1, 1, `n=${n}`);
    assert.equal(tilesIn(html), want, `n=${n}`);
    assert.equal(html.split('class="detail-tile detail-tile--support"').length - 1, want, `n=${n}`);
    // Lazy loading, alt and credit stay on every figure.
    assert.equal(html.split('loading="lazy" decoding="async"').length - 1 >= want, true, `n=${n}`);
    assert.match(html, /alt="Support still 1"/);
    assert.match(html, /data-lightbox="\/media\/people\/masonry-test\/support\/clip-1\.jpg\?p=7"/);
    if (n > 8) assert.doesNotMatch(html, /clip-9\.jpg/);
  }
});

test("Notable media uses the same masonry and the same caps", () => {
  for (const [n, want] of [
    [0, 0],
    [1, 1],
    [2, 2],
    [8, 8],
    [12, 8],
  ]) {
    const html = notableMediaHtml(
      person(n, { kind: "notable", comments: "Notable stored event." }),
    );
    if (want === 0) {
      assert.doesNotMatch(html, /detail-support-masonry/, `n=${n}`);
      continue;
    }
    assert.equal(tilesIn(html), want, `n=${n}`);
  }
});

test("comms supporting entries share ONE masonry, tagged by entry index", () => {
  const row = {
    id: "flotus-2026-09-17-abc12345",
    handle: "@FLOTUS",
    account_name: "First Lady",
    text: "Main post.",
    posted_at: "2026-09-17",
    source_url: "https://x.com/FLOTUS/status/1",
    still: "/media/red-folder-comms/main.jpg",
    snapshot: {
      supporting: [
        {
          handle: "@One",
          source_url: "https://x.com/One/status/2",
          still: "/media/red-folder-comms/one.jpg",
        },
        {
          handle: "@Two",
          source_url: "https://x.com/Two/status/3",
          still: "/media/red-folder-comms/two.jpg",
          stills: ["/media/red-folder-comms/two-2.jpg"],
        },
      ],
    },
  };
  const html = kindDetail("red_folder", row);
  const support = html.slice(html.indexOf('class="detail-supporting"'));
  assert.equal(support.split(MASONRY_OPEN).length - 1, 1);
  assert.equal(tilesIn(support), 3);
  assert.equal(support.split('data-supporting-index="0"').length - 1, 1);
  assert.equal(support.split('data-supporting-index="1"').length - 1, 2);
  assert.doesNotMatch(html, /class="supporting-group"/);
});

test("hostile alt, credit and handle are escaped and double-quoted", () => {
  const evil = `"><img src=x onerror=alert(1)><script>alert(2)</script>`;
  const html = personDetail(
    person(1, {
      media: [{ src: "/media/people/masonry-test/support/evil.jpg", alt: evil, credit: evil }],
    }),
  );
  const masonry = html.slice(html.indexOf(MASONRY_OPEN));
  assert.doesNotMatch(masonry, /<script>alert\(2\)/);
  assert.doesNotMatch(masonry, /<img src=x/);
  assert.doesNotMatch(masonry, /"\s*onerror=/);
  assert.doesNotMatch(masonry, / on[a-z]+="/i);
  // Every attribute in the masonry is double-quoted.
  for (const tag of masonry.replace(/"[^"]*"/g, '""').match(/<[a-z][^>]*>/gi) || []) {
    assert.doesNotMatch(tag, /\s[a-z-]+=[^"]/i, tag);
  }

  const comm = kindDetail("red_folder", {
    id: "evil-2026-09-17-abc12345",
    handle: "@Main",
    source_url: "https://x.com/Main/status/1",
    still: "/media/red-folder-comms/main.jpg",
    snapshot: {
      supporting: [
        {
          handle: evil,
          source_url: "https://x.com/Evil/status/2",
          still: "/media/red-folder-comms/evil.jpg",
          still_credit: evil,
        },
      ],
    },
  });
  const support = comm.slice(comm.indexOf('class="detail-supporting"'));
  assert.match(support, /detail-support-masonry/);
  assert.doesNotMatch(support, /<script>alert\(2\)/);
  assert.doesNotMatch(support, /<img src=x/);
  assert.doesNotMatch(support, / on[a-z]+="/i);
  assert.match(support, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("non-media hrefs never reach the masonry (no new URL schemes)", () => {
  const html = personDetail(
    person(1, {
      media: [
        { src: "javascript:alert(1)" },
        { src: "data:image/png;base64,AAAA" },
        { src: "https://evil.example/x.jpg" },
        { src: "/media/people/masonry-test/support/ok.jpg", url: "javascript:alert(1)" },
      ],
    }),
  );
  assert.equal(tilesIn(html), 1);
  assert.doesNotMatch(html, /javascript:|data:image|evil\.example/);
});

test("supporting-media selectors live only inside the one CSS block (O'Brien R1)", () => {
  const at = CSS.indexOf("/* Supporting media masonry");
  assert.ok(at > 0);
  const before = CSS.slice(0, at);
  const block = CSS.slice(at);
  for (const token of ["detail-support-masonry", "detail-tile--support", "detail-support-frame"]) {
    assert.equal(before.includes(token), false, `${token} outside the block`);
  }
  assert.match(block, /detail-support-masonry/);
  assert.match(block, /detail-tile--support/);
  assert.match(block, /\.detail-support-frame \{[^}]*min-width:\s*0/);
  // Dead list figure rules are gone; the caption rule stays (supporting figures use it).
  assert.doesNotMatch(CSS, /\.event-media[\s{.]/);
  assert.match(CSS, /\.event-media-caption \{/);
  // Central Casting mixed groups keep their own rules.
  assert.match(CSS, /\.supporting-group \{/);
  // The old one-tile override is folded into :has(> .detail-tile:only-child).
  assert.doesNotMatch(CSS, /data-tiles="1"/);
});

test("one CSS block: CSS columns, 2 on a phone, 3 from 720, 4 from 1280, 1 for one tile", () => {
  const at = CSS.indexOf("/* Supporting media masonry");
  assert.ok(at >= 0);
  assert.equal(CSS.split("/* Supporting media masonry").length - 1, 1);
  const block = CSS.slice(at);
  assert.match(block, /\.detail-media\.detail-media--masonry\.detail-support-masonry \{[^}]*column-count:\s*2/);
  assert.match(block, /@media \(min-width: 720px\) \{\s*\.detail-media\.detail-media--masonry\.detail-support-masonry \{\s*column-count:\s*3/);
  assert.match(block, /@media \(min-width: 1280px\) \{\s*\.detail-media\.detail-media--masonry\.detail-support-masonry \{\s*column-count:\s*4/);
  assert.match(block, /:has\(> \.detail-tile:only-child\) \{\s*column-count:\s*1/);
  assert.match(block, /:has\(> \.detail-tile:nth-child\(2\):last-child\) \{\s*column-count:\s*2/);
  assert.match(block, /break-inside:\s*avoid/);
  // Block tiles so two tiles split across two columns (inline-block lines obey orphans/widows).
  assert.match(block, /\.detail-media--masonry\.detail-support-masonry > \.detail-tile \{\s*display:\s*block/);
  // Plain CSS only: no imports, remote fonts or CDN urls; no grid spans.
  assert.doesNotMatch(CSS, /@import|url\(\s*["']?https?:|fonts\.googleapis|cdn\./i);
  assert.doesNotMatch(block, /grid-template|grid-column/);
});
