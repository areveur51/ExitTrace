import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { dogDetail, personDetail } from "../app/lib/html.mjs";
import { findPostMediaBox, mediaBoxFromRgba } from "../app/lib/post-shot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function picture(width, height, rect) {
  const png = new PNG({ width, height });
  png.data.fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      png.data[i + 3] = 255;
    }
  }
  for (let y = 24; y < 36; y += 1) {
    for (let x = 16; x < 70; x += 1) {
      const i = (y * width + x) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = 230;
    }
  }
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const i = (y * width + x) * 4;
      png.data[i] = 190;
      png.data[i + 1] = 30;
      png.data[i + 2] = 30;
    }
  }
  return png;
}

test("the media box is the picture, not the text line", () => {
  const png = picture(200, 400, { x: 10, y: 160, w: 180, h: 160 });
  const box = mediaBoxFromRgba(png);
  assert.ok(box, "box");
  assert.ok(box.y > 0.35 && box.y < 0.48, JSON.stringify(box));
  assert.ok(box.h > 0.32 && box.h < 0.5, JSON.stringify(box));
  assert.ok(box.x < 0.12 && box.w > 0.8, JSON.stringify(box));
});

test("a dog image post shows the screenshot and not the still", () => {
  const html = dogDetail({
    id: "nypost-sunny",
    posted_at: "2026-09-16T08:58:54Z",
    handle: "@nypost",
    account_name: "New York Post",
    text: "Barack Obama announces death of 'cherished' former first dog Sunny",
    still: "/media/dog-comms/nypost-sunny-2026.jpg",
    screenshot: "/media/screenshots/dog-comms/nypost-sunny.png",
    source_url: "https://x.com/nypost/status/1",
    snapshot: { stills: ["/media/dog-comms/nypost-sunny-2026.jpg", "/media/dog-comms/nypost-sunny-extra.jpg"] },
  });
  assert.match(html, /src="\/media\/screenshots\/dog-comms\/nypost-sunny\.png"/);
  assert.doesNotMatch(html, /nypost-sunny-2026\.jpg/);
  assert.match(html, /nypost-sunny-extra\.jpg/);
  assert.equal((html.match(/detail-tile--screenshot/g) || []).length, 1);
  assert.equal((html.match(/detail-tile--still/g) || []).length, 1);
  assert.doesNotMatch(html, /detail-tile--postshot|data-lightbox-kind="video"/);
});

test("a dog video post is one screenshot with the video in the picture", () => {
  const dir = path.join(ROOT, "media/screenshots/dog-comms");
  const file = path.join(dir, "boxcheck.png");
  fs.mkdirSync(dir, { recursive: true });
  const png = picture(200, 400, { x: 10, y: 160, w: 180, h: 160 });
  fs.writeFileSync(file, PNG.sync.write(png));
  try {
    const html = dogDetail({
      id: "scavino-video",
      posted_at: "2026-10-03T13:30:00Z",
      handle: "@DanScavino",
      account_name: "Dan Scavino",
      text: "BIG DOG",
      still: "/media/dog-comms/scavino-video.jpg",
      screenshot: "/media/screenshots/dog-comms/boxcheck.png",
      source_url: "https://x.com/DanScavino/status/1",
      snapshot: {
        video: "/media/dog-comms/scavino-video.mp4",
        stills: ["/media/dog-comms/scavino-video.jpg", "/media/dog-comms/scavino-other.jpg"],
      },
    });
    assert.equal((html.match(/class="post-shot"/g) || []).length, 1);
    assert.match(html, /src="\/media\/screenshots\/dog-comms\/boxcheck\.png"/);
    assert.match(html, /data-lightbox="\/media\/dog-comms\/scavino-video\.mp4"/);
    assert.match(html, /data-lightbox-kind="video"/);
    assert.match(html, /class="post-shot-media" style="left:[0-9.]+%;top:[0-9.]+%;width:[0-9.]+%;height:[0-9.]+%"/);
    assert.match(html, /<video class="detail-photo" src="\/media\/dog-comms\/scavino-video\.mp4"/);
    assert.doesNotMatch(html, /<img[^>]+scavino-video\.jpg/);
    assert.match(html, /scavino-other\.jpg/);
    assert.equal((html.match(/detail-tile--postshot/g) || []).length, 1);
    assert.equal((html.match(/detail-tile--still/g) || []).length, 1);
    assert.equal((html.match(/detail-tile--screenshot/g) || []).length, 0);
    const box = findPostMediaBox("/media/screenshots/dog-comms/boxcheck.png");
    assert.ok(box && box.y > 0.35 && box.h > 0.32);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test("a dog post with no screenshot still shows its still", () => {
  const html = dogDetail({
    id: "still-only",
    posted_at: "2022-10-11",
    handle: "@POTUS46Archive",
    account_name: "Archive",
    text: "Best meeting companion.",
    still: "/media/dog-comms/biden-dog.jpg",
    source_url: "https://x.com/POTUS46Archive/status/1",
  });
  assert.match(html, /src="\/media\/dog-comms\/biden-dog\.jpg"/);
  assert.doesNotMatch(html, /class="post-shot"/);
});

function dogPerson(media) {
  return {
    id: "dog-media-fixture",
    name: "Dog Media Fixture",
    category: "nickname",
    role: "Example",
    events: [
      {
        kind: "dog_comms",
        event_date: "2026-09-16",
        comments: "On September 16, 2026, @nypost posted: \"Sunny.\"",
        sources: [{ url: "https://x.com/nypost/status/1", title: "New York Post", publisher: "Supporting post" }],
        media,
      },
    ],
  };
}

test("a person dog section keeps the screenshot when the post is an image", () => {
  const html = personDetail(dogPerson([
    {
      src: "/media/people/dog-media-fixture/support/nypost.jpg",
      context: "The post says, \"Sunny.\"",
      url: "https://x.com/nypost/status/1",
    },
    {
      src: "/media/people/dog-media-fixture/support/nypost.shot.jpg",
      context: "Post by @nypost, 4:58 AM Eastern on September 16, 2026.",
      url: "https://x.com/nypost/status/1",
    },
  ]));
  const section = html.slice(html.indexOf('aria-label="Supporting media"'));
  assert.match(section, /nypost\.shot\.jpg/);
  assert.doesNotMatch(section, /support\/nypost\.jpg/);
  assert.match(section, /Post by @nypost/);
  assert.equal((section.match(/<figure /g) || []).length, 1);
});

test("a person dog section shows attachments beyond the one image", () => {
  const html = personDetail(dogPerson([
    {
      src: "/media/people/dog-media-fixture/support/nypost.jpg",
      url: "https://x.com/nypost/status/1",
    },
    {
      src: "/media/people/dog-media-fixture/support/nypost.shot.jpg",
      context: "Post by @nypost, 4:58 AM Eastern on September 16, 2026.",
      url: "https://x.com/nypost/status/1",
    },
    {
      src: "/media/people/dog-media-fixture/support/nypost-2.jpg",
      context: "Second photo from the same post.",
      url: "https://x.com/nypost/status/1",
    },
  ]));
  const section = html.slice(html.indexOf('aria-label="Supporting media"'));
  assert.match(section, /nypost\.shot\.jpg/);
  assert.match(section, /nypost-2\.jpg/);
  assert.doesNotMatch(section, /support\/nypost\.jpg/);
  assert.equal((section.match(/<figure /g) || []).length, 2);
});

test("a person dog section fits each video into its screenshot", () => {
  const html = personDetail(dogPerson([
    {
      src: "/media/people/dog-media-fixture/support/jessey.mp4",
      context: "The post quotes the line.",
      url: "https://x.com/jesseyjay94/status/1",
    },
    {
      src: "/media/people/dog-media-fixture/support/jessey.png",
      context: "Post by @jesseyjay94, 8:30 PM Eastern on October 9, 2026.",
      url: "https://x.com/jesseyjay94/status/1",
    },
    {
      src: "/media/people/dog-media-fixture/support/benny.mp4",
      url: "https://x.com/bennyjohnson/status/2",
    },
    {
      src: "/media/people/dog-media-fixture/support/benny.png",
      context: "Post by @bennyjohnson, 8:26 PM Eastern on October 9, 2026.",
      url: "https://x.com/bennyjohnson/status/2",
    },
  ]));
  const section = html.slice(html.indexOf('aria-label="Supporting media"'));
  assert.equal((section.match(/class="post-shot"/g) || []).length, 2);
  assert.match(section, /data-lightbox="\/media\/people\/dog-media-fixture\/support\/jessey\.mp4"/);
  assert.match(section, /src="\/media\/people\/dog-media-fixture\/support\/jessey\.png"/);
  assert.match(section, /data-lightbox="\/media\/people\/dog-media-fixture\/support\/benny\.mp4"/);
  assert.match(section, /src="\/media\/people\/dog-media-fixture\/support\/benny\.png"/);
  assert.equal((section.match(/<figure /g) || []).length, 2);
  assert.match(section, /Post by @jesseyjay94/);
  assert.match(section, /Post by @bennyjohnson/);
});
