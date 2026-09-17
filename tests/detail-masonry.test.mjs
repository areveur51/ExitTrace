import assert from "node:assert/strict";
import { test } from "node:test";
import { dogDetail, dogExtraStills, operationDetail, personDetail } from "../app/lib/html.mjs";

function dog(overrides = {}) {
  return {
    id: "ezraacohen-dow-2026",
    posted_at: "2026-01-15",
    handle: "@EzraACohen",
    account_name: "Ezra Cohen",
    text: "Multi-still dog post.",
    still: "/media/dog-comms/ezraacohen-dow-2026.jpg",
    still_credit: "Stored snapshot",
    screenshot: "/media/screenshots/dog-comms/ezraacohen-dow-2026.png",
    screenshot_credit:
      "@EzraACohen · live x.com dark border-crop expand+ts · https://x.com/EzraACohen/status/2092784717917462982",
    source_url: "https://x.com/EzraACohen/status/2092784717917462982",
    snapshot: {
      stills: [
        "/media/dog-comms/ezraacohen-dow-2026.jpg",
        "/media/dog-comms/ezraacohen-dow-2026-2.jpg",
        "/media/dog-comms/ezraacohen-dow-2026-3.jpg",
        "/media/dog-comms/ezraacohen-dow-2026-4.jpg",
      ],
    },
    ...overrides,
  };
}

function masonryInner(html) {
  const start = html.indexOf('class="detail-media detail-media--masonry"');
  if (start < 0) return "";
  const open = html.indexOf(">", start);
  let depth = 1;
  let i = open + 1;
  while (i < html.length && depth > 0) {
    if (html.startsWith("<div", i)) {
      depth += 1;
      i += 4;
      continue;
    }
    if (html.startsWith("</div>", i)) {
      depth -= 1;
      if (depth === 0) return html.slice(open + 1, i);
      i += 6;
      continue;
    }
    i += 1;
  }
  return html.slice(open + 1);
}

function metaTiles(html) {
  return html.match(/<section class="detail-tile detail-tile--meta[\s\S]*?<\/section>/g) || [];
}

function tileByKind(html, kind) {
  const re = new RegExp(
    `<section class="detail-tile detail-tile--meta detail-tile--${kind}"[\\s\\S]*?</section>`,
    "g",
  );
  return html.match(re) || [];
}

test("dogExtraStills skips primary and keeps local dog media only", () => {
  assert.deepEqual(dogExtraStills(dog()), [
    "/media/dog-comms/ezraacohen-dow-2026-2.jpg",
    "/media/dog-comms/ezraacohen-dow-2026-3.jpg",
    "/media/dog-comms/ezraacohen-dow-2026-4.jpg",
  ]);
  assert.deepEqual(dogExtraStills(dog({ snapshot: {} })), []);
  assert.deepEqual(
    dogExtraStills(
      dog({
        snapshot: {
          stills: [
            "/media/dog-comms/ezraacohen-dow-2026.jpg",
            "https://evil.example/x.jpg",
            "/media/people/james-comey.jpg",
          ],
        },
      }),
    ),
    [],
  );
});

test("dog detail masonry: interleaved media + meta; lightbox on media only; X URL only under Source", () => {
  const html = dogDetail(dog());
  assert.match(html, /detail-media--masonry/);
  assert.doesNotMatch(html, /detail-media--tiles-3/);
  // 5 media + title + handle/account/posted + ONE body + Source
  assert.match(html, /data-tiles="11"/);
  assert.match(html, /detail-tile--portrait/);
  assert.match(html, /detail-tile--screenshot/);
  assert.match(html, /detail-tile--meta/);
  assert.match(html, /detail-tile--title/);
  assert.equal(tileByKind(html, "handle").length, 1);
  assert.equal(tileByKind(html, "account").length, 1);
  assert.equal(tileByKind(html, "posted").length, 1);
  assert.equal(tileByKind(html, "body").length, 1);
  assert.equal(tileByKind(html, "source").length, 1);
  assert.equal((html.match(/detail-tile--line/g) || []).length, 0);
  assert.equal((html.match(/detail-tile--still/g) || []).length, 3);
  const inner = masonryInner(html);
  assert.match(inner, /detail-tile--portrait/);
  assert.match(inner, /detail-tile--meta/);
  assert.match(inner, /Handle ·/);
  assert.match(inner, /Account ·/);
  assert.match(inner, /Body ·/);
  // Interleave: first media, then first meta, then screenshot
  assert.match(inner, /detail-tile--portrait[\s\S]*detail-tile--meta[\s\S]*detail-tile--screenshot/);
  assert.doesNotMatch(html, /detail-media--masonry[\s\S]*<\/div>\s*<div class="detail-copy"/);
  assert.match(html, /data-lightbox="\/media\/dog-comms\/ezraacohen-dow-2026\.jpg"/);
  assert.match(html, /data-lightbox="\/media\/screenshots\/dog-comms\/ezraacohen-dow-2026\.png"/);
  assert.match(html, /data-lightbox="\/media\/dog-comms\/ezraacohen-dow-2026-2\.jpg"/);
  assert.match(html, /data-lightbox="\/media\/dog-comms\/ezraacohen-dow-2026-4\.jpg"/);
  for (const tile of metaTiles(html)) {
    assert.doesNotMatch(tile, /lightbox-open/);
    assert.doesNotMatch(tile, /data-lightbox="/);
  }
  const sourceTile = tileByKind(html, "source")[0];
  assert.match(sourceTile, /Source · <a class="source-link" href="https:\/\/x\.com\/EzraACohen\/status\/2092784717917462982"/);
  assert.doesNotMatch(sourceTile, /Body ·/);
  assert.doesNotMatch(tileByKind(html, "body")[0], /Source ·/);
  // No X URL / capture cite clutter outside Source (screenshot credit stripped).
  const withoutSource = html.replace(
    /<p class="meta-line">Source ·[\s\S]*?<\/p>/,
    "",
  );
  assert.doesNotMatch(withoutSource, /https:\/\/x\.com\/EzraACohen\/status\/2092784717917462982/);
  assert.doesNotMatch(html, /screenshot-credit/);
  assert.doesNotMatch(html, /Batcave/i);
  assert.doesNotMatch(html, /Sources · \d+ available/);
});

test("dog body is one glass tile even when the post has several TUI lines; Source stays separate", () => {
  const html = dogDetail(
    dog({
      text: "First TUI line of the post.\nSecond TUI line of the post.\nThird line.",
    }),
  );
  const bodies = tileByKind(html, "body");
  const sources = tileByKind(html, "source");
  assert.equal(bodies.length, 1);
  assert.equal(sources.length, 1);
  assert.match(bodies[0], /First TUI line of the post/);
  assert.match(bodies[0], /Second TUI line of the post/);
  assert.match(bodies[0], /Third line/);
  assert.doesNotMatch(bodies[0], /Source ·/);
  assert.doesNotMatch(bodies[0], /lightbox-open|data-lightbox="/);
  assert.match(sources[0], /Source ·/);
  assert.doesNotMatch(sources[0], /First TUI line of the post/);
  assert.doesNotMatch(sources[0], /lightbox-open|data-lightbox="/);
  assert.equal(tileByKind(html, "handle").length, 1);
  assert.equal(tileByKind(html, "account").length, 1);
  assert.equal(tileByKind(html, "posted").length, 1);
});

test("people / ops / corona reuse interleaved masonry detailMediaStrip + detailMetaBlock", () => {
  const person = personDetail({
    id: "james-comey",
    category: "firings",
    name: "James Comey",
    event_date: "2017-05-09",
    photo: "/media/people/james-comey.jpg",
    screenshot: "/media/screenshots/people/james-comey.jpg",
    sources: [
      { url: "https://www.example.com/a", title: "A" },
      { url: "https://www.example.com/b", title: "B" },
    ],
    events: [],
  });
  assert.match(person, /detail-media--masonry/);
  assert.match(person, /detail-tile--portrait/);
  assert.match(person, /detail-tile--screenshot/);
  assert.match(person, /detail-tile--meta/);
  assert.match(masonryInner(person), /detail-tile--meta[\s\S]*James Comey/);
  assert.match(person, /data-lightbox="\/media\/people\/james-comey\.jpg"/);
  for (const tile of metaTiles(person)) {
    assert.doesNotMatch(tile, /lightbox-open/);
    assert.doesNotMatch(tile, /data-lightbox="/);
  }
  assert.doesNotMatch(person, /Batcave/i);

  const corona = personDetail({
    id: "casey-vale",
    category: "corona_comms",
    name: "Casey Vale",
    event_date: "2024-07-20",
    photo: "/media/people/james-comey.jpg",
    sources: [],
    events: [],
  });
  assert.match(corona, /detail-media--masonry/);
  assert.match(corona, /detail-tile--meta/);
  assert.doesNotMatch(corona, /Batcave/i);

  const op = operationDetail({
    id: "operation-restore-justice",
    name: "Operation Restore Justice",
    event_date: "2024-08-01",
    agencies: ["U.S. Department of Justice"],
    summary: "Federal operation.",
    tags: ["missing_kids"],
    sources: [{ url: "https://www.justice.gov/opa/pr/restore-justice" }],
    screenshot: "/media/screenshots/operations/restore.jpg",
  });
  assert.match(op, /detail-media--masonry/);
  assert.match(op, /detail-tile--screenshot/);
  assert.match(op, /detail-tile--meta/);
  assert.match(op, /detail-tile--body/);
  assert.match(op, /detail-tile--sources/);
  assert.equal(tileByKind(op, "body").length, 1);
  assert.equal(tileByKind(op, "sources").length, 1);
  assert.doesNotMatch(tileByKind(op, "body")[0], /pane-h">Sources</);
  assert.doesNotMatch(tileByKind(op, "sources")[0], /Federal operation/);
  const opInner = masonryInner(op);
  assert.match(opInner, /Operation Restore Justice/);
  assert.match(opInner, /pane-h">Sources</);
  assert.match(opInner, /cite-list/);
  assert.match(op, /data-lightbox="\/media\/screenshots\/operations\/restore\.jpg"/);
  for (const tile of metaTiles(op)) {
    assert.doesNotMatch(tile, /lightbox-open/);
    assert.doesNotMatch(tile, /data-lightbox="/);
  }
  assert.doesNotMatch(op, /sources-pane/);
  assert.doesNotMatch(op, /Batcave/i);
});

test("dense masonry counts media + meta tiles; no screenshot span / tiles-3 class", () => {
  const multi = dogDetail(dog());
  assert.doesNotMatch(multi, /detail-media--tiles-3/);
  assert.match(multi, /detail-tile--screenshot/);
  assert.match(multi, /data-tiles="11"/);

  const two = dogDetail(
    dog({
      snapshot: { stills: ["/media/dog-comms/ezraacohen-dow-2026.jpg"] },
      screenshot: "/media/screenshots/dog-comms/ezraacohen-dow-2026.png",
    }),
  );
  // portrait + screenshot + title + handle/account/posted + body + Source
  assert.doesNotMatch(two, /detail-media--tiles-3/);
  assert.match(two, /data-tiles="8"/);
  assert.match(two, /detail-tile--screenshot/);
  assert.match(two, /detail-tile--meta/);
  assert.equal(tileByKind(two, "body").length, 1);
  assert.equal(tileByKind(two, "source").length, 1);
  assert.equal((two.match(/detail-tile--line/g) || []).length, 0);
});
