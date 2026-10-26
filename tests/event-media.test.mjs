import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { eventTagRow, personDetail } from "../app/lib/html.mjs";
import {
  EVENT_MEDIA_DISPLAY_MAX,
  EVENT_MEDIA_STORE_MAX,
  displayEventMedia,
  normalizeEventMedia,
} from "../app/lib/event-attrs.mjs";
import { attachPersonEvent, incomingPersonEvent, projectPerson } from "../app/lib/promote.mjs";

const CLIP = "/media/people/joe-biden/support/2105403923754316173.mp4";
const POSTER = "/media/people/joe-biden/support/2105403923754316173.jpg";

test("event media keeps a local support clip and drops portraits and remote video", () => {
  const media = normalizeEventMedia([
    { src: CLIP, poster: POSTER, credit: "Video posted by @_Realmelgibson1" },
    { src: "/media/people/joe-biden.jpg" },
    { src: "https://video.twimg.com/ext_tw_video/example.mp4" },
    { src: "/media/screenshots/people/joe-biden.jpg" },
    { src: "/media/people/joe-biden/../joe-biden.jpg" },
  ]);
  assert.deepEqual(media, [
    { src: CLIP, poster: POSTER, credit: "Video posted by @_Realmelgibson1" },
  ]);
});

test("projectPerson keeps support media on the event", () => {
  const person = projectPerson({
    id: "joe-biden",
    name: "Joe Biden",
    category: "government_stepdowns",
    event_date: "2024-07-21",
    events: [
      {
        kind: "government_stepdowns",
        event_date: "2024-07-21",
        comments: "Announced he would not seek re-election in 2024 and would finish his term.",
        sources: [{ url: "https://apnews.com/article/biden-letter" }],
        media: [{ src: CLIP, poster: POSTER, alt: "Ear protrusion question" }],
      },
    ],
  });
  assert.deepEqual(person.events[0].media, [
    { src: CLIP, poster: POSTER, alt: "Ear protrusion question" },
  ]);
  assert.equal(person.photo, undefined);
});

test("support clips render at the bottom with the cite link, and unofficial cites stay links", () => {
  const cite = "https://x.com/_Realmelgibson1/status/2105403923754316173";
  const html = personDetail({
    id: "joe-biden",
    name: "Joe Biden",
    category: "government_stepdowns",
    event_date: "2024-07-21",
    events: [
      {
        kind: "government_stepdowns",
        event_date: "2024-07-21",
        comments: "The Masks tag records that question. It is not a finding that a mask was used.",
        sources: [
          {
            url: "https://www.reuters.com/article/world/fact-check-biden",
            publisher: "Reuters",
            date: "2020-10-07",
            snippet: "The neck line is a lighting shadow.",
          },
          {
            url: cite,
            publisher: "Supporting post",
            date: "2026-09-30",
            snippet: "Is it a hearing aid or a mask?",
          },
        ],
        media: [
          {
            src: CLIP,
            poster: POSTER,
            url: `${cite}?s=20`,
            alt: "Ear protrusion question",
          },
          { src: "https://video.twimg.com/ext_tw_video/example.mp4" },
        ],
      },
    ],
  });
  const eventAt = html.indexOf('data-kind="government_stepdowns"');
  const mediaAt = html.indexOf('class="detail-supporting"');
  assert.ok(eventAt >= 0 && mediaAt > eventAt);
  assert.match(html, new RegExp(`src="${CLIP}\\?p=7"`));
  // Poster is emitted only when the file exists on disk (explicit or sibling .poster.jpg).
  assert.match(html, /playsinline/);
  assert.match(html, /data-lightbox-kind="video"/);
  assert.match(html, /detail-support-masonry/);
  assert.match(html, /detail-tile--support/);
  assert.match(html, /detail-support-frame/);
  assert.match(html, new RegExp(`class="event-media-caption"[\\s\\S]*href="${cite}"`));
  assert.match(html, /The neck line is a lighting shadow\./);
  assert.doesNotMatch(html, /Is it a hearing aid or a mask\?/);
  assert.doesNotMatch(html, /video\.twimg\.com/);
  const row = eventTagRow({
    kind: "government_stepdowns",
    event_date: "2024-07-21",
    sources: [{ url: cite, snippet: "Is it a hearing aid or a mask?" }],
    media: [{ src: CLIP, url: cite }],
  });
  assert.doesNotMatch(row, new RegExp(CLIP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(row, /event-snippet/);
  assert.match(row, new RegExp(`href="${cite}"`));
});

test("sibling .poster.jpg fills empty supporting video poster", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "et-poster-"));
  const prev = process.env.MEDIA_DIR;
  try {
    const support = path.join(dir, "people", "joe-biden", "support");
    mkdirSync(support, { recursive: true });
    const stem = "2105403923754316173";
    writeFileSync(path.join(support, `${stem}.mp4`), Buffer.from("fake-mp4"));
    writeFileSync(path.join(support, `${stem}.poster.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    process.env.MEDIA_DIR = dir;
    const cite = "https://x.com/_Realmelgibson1/status/2105403923754316173";
    const html = personDetail({
      id: "joe-biden",
      name: "Joe Biden",
      category: "government_stepdowns",
      event_date: "2024-07-21",
      events: [
        {
          kind: "government_stepdowns",
          event_date: "2024-07-21",
          comments: "Sibling poster proof.",
          sources: [
            { url: "https://www.reuters.com/article/world/fact-check-biden", publisher: "Reuters", date: "2020-10-07" },
            { url: cite, publisher: "Supporting post", date: "2026-09-30" },
          ],
          media: [{ src: `/media/people/joe-biden/support/${stem}.mp4`, url: cite, alt: "Ear protrusion question" }],
        },
      ],
    });
    const poster = `/media/people/joe-biden/support/${stem}.poster.jpg`;
    assert.match(html, new RegExp(`poster="${poster.replace(/\./g, "\\.")}\\?p=7"`));
    assert.match(html, /playsinline/);
    assert.match(html, /preload="metadata"/);
    assert.match(html, /data-lightbox-poster="/);
  } finally {
    if (prev === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing sibling poster leaves supporting video without a poster attr", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "et-poster-miss-"));
  const prev = process.env.MEDIA_DIR;
  try {
    const support = path.join(dir, "people", "joe-biden", "support");
    mkdirSync(support, { recursive: true });
    const stem = "2105403923754316173";
    writeFileSync(path.join(support, `${stem}.mp4`), Buffer.from("fake-mp4"));
    process.env.MEDIA_DIR = dir;
    const cite = "https://x.com/_Realmelgibson1/status/2105403923754316173";
    const html = personDetail({
      id: "joe-biden",
      name: "Joe Biden",
      category: "government_stepdowns",
      event_date: "2024-07-21",
      events: [
        {
          kind: "government_stepdowns",
          event_date: "2024-07-21",
          comments: "No sibling poster.",
          sources: [
            { url: "https://www.reuters.com/article/world/fact-check-biden", publisher: "Reuters", date: "2020-10-07" },
            { url: cite, publisher: "Supporting post", date: "2026-09-30" },
          ],
          media: [{ src: `/media/people/joe-biden/support/${stem}.mp4`, url: cite, alt: "Ear protrusion question" }],
        },
      ],
    });
    assert.match(html, new RegExp(`src="/media/people/joe-biden/support/${stem}\\.mp4\\?p=7"`));
    assert.doesNotMatch(html, /poster="/);
    assert.match(html, /playsinline/);
  } finally {
    if (prev === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit poster that exists still renders on supporting video", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "et-poster-explicit-"));
  const prev = process.env.MEDIA_DIR;
  try {
    const support = path.join(dir, "people", "joe-biden", "support");
    mkdirSync(support, { recursive: true });
    const clip = "explicit-clip.mp4";
    const posterName = "explicit-named-poster.jpg";
    writeFileSync(path.join(support, clip), Buffer.from("fake-mp4"));
    writeFileSync(path.join(support, posterName), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    // Sibling poster also present; explicit must win.
    writeFileSync(path.join(support, "explicit-clip.poster.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    process.env.MEDIA_DIR = dir;
    const cite = "https://x.com/example/status/1";
    const src = `/media/people/joe-biden/support/${clip}`;
    const poster = `/media/people/joe-biden/support/${posterName}`;
    const html = personDetail({
      id: "joe-biden",
      name: "Joe Biden",
      category: "government_stepdowns",
      event_date: "2024-07-21",
      events: [
        {
          kind: "government_stepdowns",
          event_date: "2024-07-21",
          comments: "Explicit poster proof.",
          sources: [
            { url: "https://www.reuters.com/article/world/fact-check-biden", publisher: "Reuters", date: "2020-10-07" },
            { url: cite, publisher: "Supporting post", date: "2026-09-30" },
          ],
          media: [{ src, poster, url: cite, alt: "Explicit poster clip" }],
        },
      ],
    });
    assert.match(html, new RegExp(`src="${src.replace(/\./g, "\\.")}\\?p=7"`));
    assert.match(html, new RegExp(`poster="${poster.replace(/\./g, "\\.")}\\?p=7"`));
    assert.doesNotMatch(html, /explicit-clip\.poster\.jpg/);
    assert.match(html, /playsinline/);
  } finally {
    if (prev === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("supporting tile shows stored context and leaves unofficial snippets off the event", () => {
  const cite = "https://x.com/Saulito46107740/status/1929291227842641967";
  const other = "https://x.com/Saulito46107740/status/1929291229197488286";
  const context = "Meghan McCain said, “My Father, you can’t kill him again, but whatever.”";
  const media = normalizeEventMedia([
    {
      src: "/media/people/john-mccain/support/1929291227842641967.png",
      url: cite,
      context: `${context} https://x.com/example`,
      alt: "X post",
    },
    {
      src: "/media/people/john-mccain/support/1929291229197488286.png",
      url: other,
      alt: "Second X post",
    },
  ]);
  assert.equal(media[0].context, context);
  assert.equal(media[1].context, undefined);
  const html = personDetail({
    id: "john-mccain",
    name: "John McCain",
    category: "death_official",
    event_date: "2018-08-25",
    events: [
      {
        kind: "boot_comms",
        event_date: "2017-11-06",
        comments: "Achilles tendon.",
        sources: [
          {
            url: "https://www.cnn.com/2017/11/06/politics/john-mccain-treated-for-achilles-tendon",
            date: "2017-11-06",
            snippet: "Walking boot.",
          },
          {
            url: cite,
            publisher: "Supporting post",
            date: "2025-06-01",
            snippet: "This snippet stays off the boot row.",
          },
          { url: other, publisher: "Supporting post", date: "2025-06-01" },
        ],
        media,
      },
    ],
  });
  const bootAt = html.indexOf('data-kind="boot_comms"');
  const supportAt = html.indexOf('aria-label="Supporting media"');
  assert.ok(bootAt >= 0 && supportAt > bootAt);
  const boot = html.slice(bootAt, supportAt);
  const support = html.slice(supportAt);
  assert.match(boot, /Achilles tendon\./);
  assert.doesNotMatch(boot, /My Father/);
  assert.doesNotMatch(boot, /This snippet stays off the boot row\./);
  assert.equal((support.match(/support-context/g) || []).length, 1);
  assert.match(support, /My Father, you can’t kill him again, but whatever\./);
  assert.match(support, new RegExp(`href="${cite}"`));
  assert.match(support, new RegExp(`href="${other}"`));
  assert.doesNotMatch(support, /https:\/\/x\.com\/example/);
});


function supportItems(n, slug = "ian-brinksman") {
  return Array.from({ length: n }, (_, i) => ({
    src: `/media/people/${slug}/support/item-${i + 1}.png`,
    alt: `Item ${i + 1}`,
  }));
}

function arrestPerson(media) {
  return {
    id: "ian-brinksman",
    name: "Ian Brinksman",
    category: "arrests",
    event_date: "2026-01-26",
    events: [
      {
        kind: "arrests",
        event_date: "2026-01-26",
        comments: "Arrested on a federal complaint.",
        sources: [{ url: "https://www.justice.gov/usao-edva" }],
        media,
      },
    ],
  };
}

test("event media storage keeps a 9th item and caps at 24, display shows 8", () => {
  assert.equal(EVENT_MEDIA_STORE_MAX, 24);
  assert.equal(EVENT_MEDIA_DISPLAY_MAX, 8);
  const nine = supportItems(9);
  assert.equal(normalizeEventMedia(nine).length, 9);
  assert.equal(normalizeEventMedia(nine)[8].src, nine[8].src);
  const twentyFive = supportItems(25);
  const stored = normalizeEventMedia(twentyFive);
  assert.equal(stored.length, 24);
  assert.deepEqual(stored.map((m) => m.src), twentyFive.slice(0, 24).map((m) => m.src));
  assert.equal(displayEventMedia(nine).length, 8);
  assert.deepEqual(displayEventMedia(twentyFive).map((m) => m.src), twentyFive.slice(0, 8).map((m) => m.src));
});

test("event media dedup still works past 8 items", () => {
  const nine = supportItems(9);
  const dup = [...nine, nine[0], { ...nine[8], alt: "Dup" }, nine[3].src];
  const stored = normalizeEventMedia(dup);
  assert.equal(stored.length, 9);
  assert.equal(new Set(stored.map((m) => m.src)).size, 9);
  assert.equal(stored[8].alt, "Item 9");
});

test("projectPerson and the AMEND merge keep 9+ media items, capped at 24", () => {
  const nine = projectPerson(arrestPerson(supportItems(9)));
  assert.equal(nine.events[0].media.length, 9);
  const big = projectPerson(arrestPerson(supportItems(25)));
  assert.equal(big.events[0].media.length, 24);
});

test("a 9-item event card renders 8 tiles and a 25-item one also renders 8", () => {
  for (const n of [9, 25]) {
    const html = personDetail(arrestPerson(supportItems(n)));
    const tiles = html.match(/detail-tile--support/g) || [];
    assert.equal(tiles.length, 8, `n=${n}`);
    assert.ok(html.includes("item-8.png"));
    assert.ok(!html.includes("item-9.png"));
  }
});

test("AMEND merge: attachPersonEvent with 20 stored + 20 new items keeps exactly 24", () => {
  const stored = supportItems(20);
  const fresh = Array.from({ length: 20 }, (_, i) => ({
    src: `/media/people/ian-brinksman/support/new-${i + 1}.png`,
    alt: `New ${i + 1}`,
  }));
  const person = projectPerson(arrestPerson(stored));
  assert.equal(person.events[0].media.length, 20);
  const { person: next, existed } = attachPersonEvent(person, {
    kind: "arrests",
    event_date: "2026-01-26",
    sources: [{ url: "https://www.justice.gov/usao-edva/pr/example" }],
    media: fresh,
  });
  assert.equal(existed, true);
  assert.equal(next.events.length, 1);
  const media = next.events[0].media;
  assert.equal(media.length, 24);
  assert.deepEqual(
    media.map((m) => m.src),
    [...stored, ...fresh.slice(0, 4)].map((m) => m.src),
  );
});

test("intake normalizes event media: remote, portrait and duplicate items stay out", () => {
  const ev = incomingPersonEvent(
    {
      category: "arrests",
      event_date: "2026-01-26",
      media: [
        { src: "/media/people/ian-brinksman/support/a.png", alt: "A" },
        { src: "/media/people/ian-brinksman/support/a.png", alt: "Dup" },
        { src: "https://example.com/x.png" },
        { src: "/media/people/ian-brinksman.jpg" },
      ],
    },
    [],
  );
  assert.deepEqual(ev.media, [{ src: "/media/people/ian-brinksman/support/a.png", alt: "A" }]);
  const none = incomingPersonEvent({ category: "arrests", event_date: "2026-01-26", media: [] }, []);
  assert.equal(none.media, undefined);
});

test("display dedupes before the cap: a duplicated item does not cost a tile", () => {
  const nine = supportItems(9);
  const html = personDetail(arrestPerson([nine[0], nine[0], ...nine.slice(1)]));
  assert.equal((html.match(/detail-tile--support/g) || []).length, 8);
  assert.ok(html.includes("item-8.png"));
  assert.ok(!html.includes("item-9.png"));
});
