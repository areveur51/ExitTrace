import assert from "node:assert/strict";
import { test } from "node:test";
import { eventTagRow, personDetail } from "../app/lib/html.mjs";
import { normalizeEventMedia } from "../app/lib/event-attrs.mjs";
import { projectPerson } from "../app/lib/promote.mjs";

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
  assert.match(html, new RegExp(`src="${CLIP}"`));
  assert.match(html, new RegExp(`poster="${POSTER}"`));
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
