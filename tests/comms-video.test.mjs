import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { kindDetail, layout } from "../app/lib/html.mjs";

function eagle(video) {
  return {
    id: "dhsgov-2026-09-30-42e68497",
    posted_at: "2026-09-30T20:09:06Z",
    handle: "@DHSgov",
    account_name: "Homeland Security",
    text: "",
    still: "/media/eagle-comms/dhsgov-2026-09-30-42e68497.jpg",
    still_credit: "Stored video thumbnail of @DHSgov X post (bald eagle close-up)",
    screenshot: "/media/screenshots/eagle-comms/dhsgov-2026-09-30-42e68497.png",
    screenshot_credit: "@DHSgov · live x.com dark border-crop expand+ts",
    source_url: "https://x.com/DHSgov/status/2105389496074387894",
    snapshot: {
      stills: ["/media/eagle-comms/dhsgov-2026-09-30-42e68497.jpg"],
      video,
    },
  };
}

test("a local comm video opens in the lightbox as a video", () => {
  const html = kindDetail(
    "eagle",
    eagle("/media/eagle-comms/dhsgov-2026-09-30-42e68497.mp4"),
  );
  assert.match(html, /data-lightbox-kind="video"/);
  assert.match(
    html,
    /data-lightbox="\/media\/eagle-comms\/dhsgov-2026-09-30-42e68497\.mp4"/,
  );
  assert.match(
    html,
    /data-lightbox-poster="\/media\/eagle-comms\/dhsgov-2026-09-30-42e68497\.jpg"/,
  );
  assert.match(
    html,
    /<video class="detail-photo" src="\/media\/eagle-comms\/dhsgov-2026-09-30-42e68497\.mp4" poster="\/media\/eagle-comms\/dhsgov-2026-09-30-42e68497\.jpg"/,
  );
  assert.match(html, /class="detail-video-play"/);
  assert.doesNotMatch(html, /<img[^>]+src="\/media\/eagle-comms\/dhsgov-2026-09-30-42e68497\.mp4"/);
  assert.doesNotMatch(html, /<img[^>]+src="\/media\/eagle-comms\/dhsgov-2026-09-30-42e68497\.jpg"/);
});

test("a remote or non-mp4 video stays a still", () => {
  for (const video of [
    "https://video.twimg.com/amplify_video/x.mp4",
    "/media/dog-comms/dhsgov-2026-09-30-42e68497.mp4",
    "/media/eagle-comms/dhsgov-2026-09-30-42e68497.jpg",
    "",
  ]) {
    const html = kindDetail("eagle", eagle(video));
    assert.doesNotMatch(html, /data-lightbox-kind="video"/);
    assert.match(
      html,
      /data-lightbox="\/media\/eagle-comms\/dhsgov-2026-09-30-42e68497\.jpg"/,
    );
  }
});

test("the page chrome plays a video in the same lightbox", () => {
  const page = layout({
    title: "Eagle",
    path: "/eagle-comms/dhsgov-2026-09-30-42e68497",
    heading: "Eagle",
    body: "",
  });
  assert.match(page, /<video id="lightbox-video" controls playsinline hidden><\/video>/);
  assert.match(page, /id="lightbox-img"/);
});

test("a hidden lightbox still does not stay on screen beside the video", () => {
  const css = readFileSync(new URL("../app/public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.tui-lightbox-frame img\[hidden\]/);
  assert.match(css, /\.tui-lightbox-frame video\[hidden\]/);
});
