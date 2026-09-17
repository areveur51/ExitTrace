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

test("dog detail masonry: portrait + screenshot + extra stills; shared lightbox; X URL only under Source", () => {
  const html = dogDetail(dog());
  assert.match(html, /detail-media--masonry/);
  assert.match(html, /detail-media--tiles-3/);
  assert.match(html, /data-tiles="5"/);
  assert.match(html, /detail-tile--portrait/);
  assert.match(html, /detail-tile--screenshot/);
  assert.equal((html.match(/detail-tile--still/g) || []).length, 3);
  assert.match(html, /data-lightbox="\/media\/dog-comms\/ezraacohen-dow-2026\.jpg"/);
  assert.match(html, /data-lightbox="\/media\/screenshots\/dog-comms\/ezraacohen-dow-2026\.png"/);
  assert.match(html, /data-lightbox="\/media\/dog-comms\/ezraacohen-dow-2026-2\.jpg"/);
  assert.match(html, /data-lightbox="\/media\/dog-comms\/ezraacohen-dow-2026-4\.jpg"/);
  assert.match(html, /Source · <a class="source-link" href="https:\/\/x\.com\/EzraACohen\/status\/2092784717917462982"/);
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

test("people / ops / corona reuse masonry detailMediaStrip", () => {
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
  assert.doesNotMatch(op, /Batcave/i);
});

test("larger masonry: tiles-3 class only when ≥3 tiles; screenshot tile present for span", () => {
  const multi = dogDetail(dog());
  assert.match(multi, /detail-media--tiles-3/);
  assert.match(multi, /detail-tile--screenshot/);

  const two = dogDetail(
    dog({
      snapshot: { stills: ["/media/dog-comms/ezraacohen-dow-2026.jpg"] },
      screenshot: "/media/screenshots/dog-comms/ezraacohen-dow-2026.png",
    }),
  );
  // portrait + screenshot = 2 tiles → no tiles-3 (3-col only ≥1400 when ≥3)
  assert.doesNotMatch(two, /detail-media--tiles-3/);
  assert.match(two, /data-tiles="2"/);
  assert.match(two, /detail-tile--screenshot/);
});
