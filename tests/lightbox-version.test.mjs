import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { operationDetail, personDetail, personHeader, versionedMediaHref } from "../app/lib/html.mjs";
import { PORTRAIT_CACHE } from "../app/lib/thumb.mjs";

const Q = `?p=${PORTRAIT_CACHE}`;

function queryOf(url) {
  const i = String(url || "").indexOf("?");
  return i < 0 ? "" : url.slice(i);
}

function attr(html, name) {
  const match = String(html || "").match(new RegExp(`${name}="([^"]+)"`));
  assert.ok(match, name);
  return match[1];
}

function srcsetUrls(html) {
  const urls = [];
  for (const match of String(html || "").matchAll(/srcset="([^"]+)"/g)) {
    for (const part of match[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url) urls.push(url);
    }
  }
  return urls;
}

/** Visible tile and its lightbox share one ?p= value. No second scheme. */
function assertSameCache(html, { lightboxPath } = {}) {
  const light = attr(html, "data-lightbox");
  const src = attr(html, "src");
  assert.equal(queryOf(light), Q);
  assert.equal(queryOf(src), Q);
  assert.equal(light.split("?")[1], src.split("?")[1]);
  if (lightboxPath) assert.equal(light, `${lightboxPath}${Q}`);
  for (const url of srcsetUrls(html)) {
    assert.equal(queryOf(url), Q, url);
    assert.equal(url.split("?")[1], light.split("?")[1]);
  }
  assert.doesNotMatch(html, /\?p=[^"'\s]*\?p=/);
}

function retire(dir) {
  const destDir = "/tmp/et-seal-retired";
  mkdirSync(destDir, { recursive: true });
  renameSync(dir, path.join(destDir, `${path.basename(dir)}-${Date.now()}`));
}

test("an operation seal lightbox matches the tile image cache param", () => {
  const html = operationDetail({
    id: "2026-election-crime-cases",
    name: "2026 Election Crime Cases",
    agencies: ["U.S. Department of Justice"],
    summary: "Roundup.",
  });
  const tile = html.match(/<figure class="detail-tile detail-tile--portrait">[\s\S]*?<\/figure>/);
  assert.ok(tile);
  assertSameCache(tile[0], { lightboxPath: "/media/agencies/doj.jpg" });
});

test("a person portrait lightbox matches the header image cache param", () => {
  const html = personHeader({
    id: "james-comey",
    name: "James Comey",
    photo: "/media/people/james-comey.jpg",
    photo_credit: "Official photo https://example.com/credit",
  });
  assert.match(html, /class="person-header"/);
  assertSameCache(html, { lightboxPath: "/media/people/james-comey.jpg" });
  assert.doesNotMatch(html, /example\.com\/credit\?p=/);
});

test("a supporting still uses the same cache param on img src and data-lightbox", () => {
  const src = "/media/people/casey-vale/support/desk-still.jpg";
  const html = personDetail({
    id: "casey-vale",
    name: "Casey Vale",
    category: "firings",
    event_date: "2024-01-02",
    events: [
      {
        kind: "firings",
        event_date: "2024-01-02",
        comments: "Left the post.",
        sources: [{ url: "https://example.com/desk", publisher: "Desk", date: "2024-01-02" }],
        media: [
          { src, alt: "Desk still" },
          { src: "https://video.twimg.com/ext_tw_video/example.mp4" },
          { src: "data:image/png;base64,aaaa" },
        ],
      },
    ],
  });
  const supportAt = html.indexOf('aria-label="Supporting media"');
  assert.ok(supportAt >= 0);
  const support = html.slice(supportAt);
  const light = attr(support, "data-lightbox");
  const img = attr(support, "src");
  assert.equal(light, `${src}${Q}`);
  assert.equal(img, `${src}${Q}`);
  assert.doesNotMatch(html, /video\.twimg\.com/);
  assert.doesNotMatch(html, /data:image\/png/);
  assert.doesNotMatch(html, /example\.com\/desk\?p=/);
  assert.doesNotMatch(html, /\?p=[^"'\s]*\?p=/);
});

test("a supporting video lightbox and poster are versioned; remote and queried hrefs are not doubled", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "et-lightbox-"));
  const prev = process.env.MEDIA_DIR;
  try {
    const supportDir = path.join(dir, "people", "casey-vale", "support");
    mkdirSync(supportDir, { recursive: true });
    writeFileSync(path.join(supportDir, "clip.mp4"), Buffer.from("fake-mp4"));
    writeFileSync(path.join(supportDir, "clip.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    process.env.MEDIA_DIR = dir;
    const src = "/media/people/casey-vale/support/clip.mp4";
    const poster = "/media/people/casey-vale/support/clip.jpg";
    const remote = "https://video.twimg.com/amplify_video/remote.mp4";
    const html = personDetail({
      id: "casey-vale",
      name: "Casey Vale",
      category: "firings",
      event_date: "2024-01-02",
      events: [
        {
          kind: "firings",
          event_date: "2024-01-02",
          comments: "Stored clip.",
          sources: [{ url: "https://example.com/clip", publisher: "Desk", date: "2024-01-02" }],
          media: [{ src, poster, alt: "Stored clip", url: "https://example.com/clip" }, { src: remote }],
        },
      ],
    });
    const support = html.slice(html.indexOf('aria-label="Supporting media"'));
    assert.equal(attr(support, "data-lightbox"), `${src}${Q}`);
    assert.equal(attr(support, "data-lightbox-poster"), `${poster}${Q}`);
    assert.match(support, new RegExp(`src="${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?p=${PORTRAIT_CACHE}"`));
    assert.match(support, new RegExp(`poster="${poster.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?p=${PORTRAIT_CACHE}"`));
    assert.doesNotMatch(html, /amplify_video/);
    assert.doesNotMatch(html, /example\.com\/clip\?p=/);
    assert.doesNotMatch(html, /\?p=[^"'\s]*\?p=/);
  } finally {
    if (prev === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = prev;
    retire(dir);
  }

  const local = "/media/agencies/hud-oig.png";
  assert.equal(versionedMediaHref(local), `${local}${Q}`);
  assert.equal(versionedMediaHref(`${local}${Q}`), `${local}${Q}`);
  assert.equal(versionedMediaHref(`${local}?x=1`), `${local}?x=1`);
  assert.equal(versionedMediaHref("https://cdn.example/a.png"), "https://cdn.example/a.png");
  assert.equal(versionedMediaHref("http://cdn.example/a.png"), "http://cdn.example/a.png");
  assert.equal(versionedMediaHref("data:image/png;base64,aaaa"), "data:image/png;base64,aaaa");
  assert.equal(versionedMediaHref(""), "");
});

test("an event still uses the same cache param on img src and data-lightbox", () => {
  const still = "/media/central-casting-comms/cache-bust-still.jpg";
  const html = personDetail(
    {
      id: "casey-vale",
      name: "Casey Vale",
      category: "firings",
      event_date: "2024-01-02",
      central_casting: ["https://x.com/nytimes/status/1"],
    },
    {
      centralCastingClips: [
        {
          person_id: "casey-vale",
          handle: "@nytimes",
          account_name: "The New York Times",
          text: "Stored central-casting snapshot.",
          posted_at: "2024-01-02",
          source_url: "https://x.com/nytimes/status/1",
          still,
        },
      ],
    },
  );
  const fig = html.match(/<figure class="event-media">[\s\S]*?<\/figure>/);
  assert.ok(fig);
  assertSameCache(fig[0], { lightboxPath: still });
  assert.doesNotMatch(html, /x\.com\/nytimes\/status\/1\?p=/);
});
