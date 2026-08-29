import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { test } from "node:test";
import {
  findLocalPortrait,
  isEligiblePortraitUrl,
  isPeopleMediaHref,
  resolvePortrait,
} from "../app/lib/portrait.mjs";

function writeStill(dir, name, bytes = "portrait-bytes") {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

test("only Wikimedia and official-gov URLs are eligible portraits", () => {
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
  assert.equal(isEligiblePortraitUrl("https://x.com/RandomCat/photo.jpg"), false);
  assert.equal(isEligiblePortraitUrl("/media/people/casey-vale.jpg"), false);
  assert.equal(isPeopleMediaHref("/media/people/casey-vale.jpg"), true);
  assert.equal(isPeopleMediaHref("/media/people/../secret.jpg"), false);
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
