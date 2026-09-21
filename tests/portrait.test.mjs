import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { test } from "node:test";
import {
  findLocalPortrait,
  isBlockedPortraitHost,
  isEligiblePortraitUrl,
  isNewsPortraitHost,
  isPeopleMediaHref,
  resolvePortrait,
} from "../app/lib/portrait.mjs";

function writeStill(dir, name, bytes = "portrait-bytes") {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

test("Wikimedia, official-gov, and curated news URLs are eligible portraits", () => {
  assert.equal(
    isEligiblePortraitUrl(
      "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg",
    ),
    true,
  );
  assert.equal(
    isEligiblePortraitUrl("https://commons.wikimedia.org/wiki/File:Example.jpg"),
    true,
  );
  assert.equal(
    isEligiblePortraitUrl("https://en.wikipedia.org/wiki/Special:FilePath/Example.jpg"),
    true,
  );
  assert.equal(isEligiblePortraitUrl("https://www.fbi.gov/image.jpg"), true);
  assert.equal(isEligiblePortraitUrl("https://example.com/selfie.jpg"), false);
  assert.equal(
    isEligiblePortraitUrl("https://i.guim.co.uk/img/media/example.jpg"),
    true,
  );
  assert.equal(
    isEligiblePortraitUrl("https://www.eluniversal.com.mx/resizer/v2/example.jpg"),
    true,
  );
  assert.equal(isNewsPortraitHost("i.guim.co.uk"), true);
  assert.equal(isNewsPortraitHost("media.guim.co.uk"), true);
  assert.equal(isNewsPortraitHost("www.theguardian.com"), true);
  assert.equal(isNewsPortraitHost("theguardian.com"), true);
  assert.equal(isNewsPortraitHost("evil.example"), false);
  assert.equal(isNewsPortraitHost("evil.guim.co.uk"), false);
  assert.equal(isNewsPortraitHost("cdn.theguardian.com"), false);
  assert.equal(isNewsPortraitHost("attacker.bbc.com"), false);
  assert.equal(isNewsPortraitHost("guim.co.uk"), false);
  assert.equal(isNewsPortraitHost("static.independent.co.uk"), true);
  assert.equal(isNewsPortraitHost("assets.apnews.com"), true);
  assert.equal(
    isEligiblePortraitUrl("https://static.independent.co.uk/2026/09/09/example.jpg"),
    true,
  );
  assert.equal(
    isEligiblePortraitUrl("https://assets.apnews.com/ab/cd/example.jpg"),
    true,
  );
  assert.equal(isNewsPortraitHost("evil.independent.co.uk"), false);
  assert.equal(isNewsPortraitHost("cdn.independent.co.uk"), false);
  assert.equal(isNewsPortraitHost("notassets.apnews.com"), false);
  assert.equal(isNewsPortraitHost("evil.apnews.com"), false);
  assert.equal(isEligiblePortraitUrl("https://x.com/RandomCat/photo.jpg"), false);
  assert.equal(isEligiblePortraitUrl("/media/people/casey-vale.jpg"), false);
  assert.equal(isEligiblePortraitUrl("file:///etc/passwd"), false);
  assert.equal(isPeopleMediaHref("/media/people/casey-vale.jpg"), true);
  assert.equal(isPeopleMediaHref("/media/people/../secret.jpg"), false);
});

test("portrait fetch hosts reject loopback, RFC1918, and link-local", () => {
  const rfc10 = ["10", "1", "2", "3"].join(".");
  const rfc192 = ["192", "168", "1", "1"].join(".");
  assert.equal(isBlockedPortraitHost("127.0.0.1"), true);
  assert.equal(isBlockedPortraitHost("localhost"), true);
  assert.equal(isBlockedPortraitHost("::1"), true);
  assert.equal(isBlockedPortraitHost("[::1]"), true);
  assert.equal(isBlockedPortraitHost("169.254.169.254"), true);
  assert.equal(isBlockedPortraitHost(rfc10), true);
  assert.equal(isBlockedPortraitHost(rfc192), true);
  assert.equal(isBlockedPortraitHost("172.16.0.1"), true);
  assert.equal(isBlockedPortraitHost("i.guim.co.uk"), false);
  assert.equal(isEligiblePortraitUrl(`https://${rfc10}/still.jpg`), false);
  assert.equal(isEligiblePortraitUrl("https://127.0.0.1/still.jpg"), false);
  assert.equal(isEligiblePortraitUrl("https://localhost/still.jpg"), false);
});

test("resolvePortrait uses a same-id local still and ignores another person's file", async () => {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), "et-portrait-"));
  writeStill(path.join(media, "people"), "casey-vale.jpg");
  writeStill(path.join(media, "people"), "james-comey.jpg", "gold-bytes");

  const found = findLocalPortrait(media, "casey-vale");
  assert.equal(found.href, "/media/people/casey-vale.jpg");

  const attached = await resolvePortrait({
    mediaDir: media,
    personId: "casey-vale",
  });
  assert.equal(attached.href, "/media/people/casey-vale.jpg");

  const wrong = await resolvePortrait({
    mediaDir: media,
    personId: "riley-chen",
    supplied: "/media/people/james-comey.jpg",
  });
  assert.equal(wrong, null);
  assert.equal(findLocalPortrait(media, "riley-chen"), null);

  const missing = await resolvePortrait({
    mediaDir: media,
    personId: "riley-chen",
    supplied: "https://example.com/selfie.jpg",
  });
  assert.equal(missing, null);

  const blank = await resolvePortrait({
    mediaDir: media,
    personId: "riley-chen",
  });
  assert.equal(blank, null);
});

test("resolvePortrait fetch uses redirect:manual and refuses private final hosts", async () => {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), "et-portrait-redir-"));
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), redirect: opts?.redirect });
    return {
      ok: false,
      status: 302,
      url: String(url),
      headers: {
        get(name) {
          return String(name).toLowerCase() === "location" ? "http://127.0.0.1/secret.jpg" : null;
        },
      },
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
  try {
    const got = await resolvePortrait({
      mediaDir: media,
      personId: "casey-vale",
      supplied: "https://i.guim.co.uk/img/media/example.jpg",
    });
    assert.equal(got, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].redirect, "manual");
    assert.equal(calls.some((c) => c.url.includes("127.0.0.1")), false);
    assert.equal(findLocalPortrait(media, "casey-vale"), null);
  } finally {
    globalThis.fetch = orig;
  }
});

test("resolvePortrait fill-empty stays blank without --photo and keeps a gold still", async () => {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), "et-portrait-fill-"));
  writeStill(path.join(media, "people"), "casey-vale.jpg", "gold-still-bytes");
  const orig = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("fetch should not run when gold exists or photo is omitted");
  };
  try {
    const existing = await resolvePortrait({
      mediaDir: media,
      personId: "casey-vale",
      supplied: "https://i.guim.co.uk/img/media/example.jpg",
    });
    assert.equal(existing.href, "/media/people/casey-vale.jpg");
    assert.equal(fetches, 0);

    const omitted = await resolvePortrait({
      mediaDir: media,
      personId: "riley-chen",
    });
    assert.equal(omitted, null);
    assert.equal(fetches, 0);
    assert.equal(findLocalPortrait(media, "riley-chen"), null);
  } finally {
    globalThis.fetch = orig;
  }
});

test("resolvePortrait does not follow a redirect onto an unlisted apex subdomain", async () => {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), "et-portrait-wild-"));
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), redirect: opts?.redirect });
    return {
      ok: false,
      status: 302,
      url: String(url),
      headers: {
        get(name) {
          return String(name).toLowerCase() === "location"
            ? "https://evil.guim.co.uk/img/media/example.jpg"
            : null;
        },
      },
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
  try {
    const got = await resolvePortrait({
      mediaDir: media,
      personId: "riley-chen",
      supplied: "https://i.guim.co.uk/img/media/example.jpg",
    });
    assert.equal(got, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].redirect, "manual");
    assert.equal(calls.some((c) => c.url.includes("evil.guim.co.uk")), false);
  } finally {
    globalThis.fetch = orig;
  }
});

test("resolvePortrait stores an eligible news still when fetch is 200", async () => {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), "et-portrait-ok-"));
  const orig = globalThis.fetch;
  const body = Buffer.alloc(900, 7);
  globalThis.fetch = async (url, opts) => {
    assert.equal(opts?.redirect, "manual");
    return {
      ok: true,
      status: 200,
      url: String(url),
      headers: { get: () => null },
      arrayBuffer: async () => body,
    };
  };
  try {
    const got = await resolvePortrait({
      mediaDir: media,
      personId: "riley-chen",
      supplied: "https://i.guim.co.uk/img/media/example.jpg",
    });
    assert.equal(got.href, "/media/people/riley-chen.jpg");
    assert.equal(got.credit, "News organization portrait");
    assert.equal(findLocalPortrait(media, "riley-chen").href, "/media/people/riley-chen.jpg");
  } finally {
    globalThis.fetch = orig;
  }
});
