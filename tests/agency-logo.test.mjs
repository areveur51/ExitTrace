import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  OPERATION_LEAD_OVERRIDES,
  SEAL_SOURCES,
  knownSealKeys,
  operationLeadAgencyId,
  operationLeadLogo,
} from "../app/lib/agency-logo.mjs";
import { operationDetail, operationRow } from "../app/lib/html.mjs";
import { mergeOperationAnnotate, normalizeOperation, operationPortraitFrom } from "../app/lib/operation.mjs";

const CASES = [
  [["U.S. Department of Justice", "U.S. Department of Health and Human Services", "Federal Bureau of Investigation"], "fbi"],
  [["DOJ", "HHS-OIG", "FBI", "DEA", "CMS"], "hhs-oig"],
  [["U.S. Department of Justice"], "doj"],
  [["U.S. Department of Justice", "Federal Bureau of Investigation", "U.S. Department of the Treasury"], "fbi"],
  [["U.S. Department of Justice", "U.S. Department of Homeland Security", "U.S. Department of State", "Homeland Security Investigations", "U.S. Customs and Border Protection"], "hsi"],
  [["U.S. Marshals Service", "Bureau of Alcohol", "Tobacco", "Firearms and Explosives", "Drug Enforcement Administration", "Federal Bureau of Investigation", "United States Attorney's Office for the District of Columbia"], "usms"],
  [["FBI", "U.S. Department of Justice", "White House Task Force to Eliminate Fraud"], "fbi"],
  [["U.S. Department of Homeland Security", "U.S. Department of Health and Human Services", "U.S. Department of Justice", "ICE"], "ice"],
  [["New York State Division of Criminal Justice Services Missing Persons Clearinghouse", "New York State Office of Children and Family Services", "National Child Protection Task Force", "New York State Police", "Federal Bureau of Investigation"], "nysp"],
  [["U.S. Department of Justice", "DEA", "Government of Mexico"], "dea"],
  [["ICE", "DHS"], "ice"],
  [["U.S. Department of Justice", "Office of Juvenile Justice and Delinquency Prevention"], "doj"],
  [["U.S. Department of Justice", "Internet Crimes Against Children Task Forces"], "doj"],
  [["Federal Bureau of Investigation", "U.S. Department of Justice"], "fbi"],
  [["U.S. Department of Justice", "Drug Enforcement Administration"], "dea"],
  [["U.S. Department of Justice", "Homeland Security Investigations"], "hsi"],
  [["U.S. Marshals Service", "U.S. Department of Justice"], "usms"],
  [["Department of Justice", "Federal Bureau of Investigation"], "fbi"],
  [["U.S. Attorney's Office Central District of California", "ICE"], "ice"],
  [["Drug Enforcement Administration", "U.S. Department of Justice"], "dea"],
  [["U.S. Department of Justice", "Federal Bureau of Investigation", "Drug Enforcement Administration", "Bureau of Alcohol, Tobacco, Firearms and Explosives", "U.S. Marshals Service"], "fbi"],
  [["ICE", "Homeland Security Investigations", "ATF", "Georgia State Patrol"], "ice"],
  [["U.S. Department of Justice", "U.S. Marshals Service"], "usms"],
  [["U.S. Department of Justice", "U.S. Department of State"], "doj"],
  [["U.S. Department of Justice", "FBI", "Child Exploitation and Obscenity Section", "U.S. Attorney's Offices"], "fbi"],
  [["CBP", "HSI", "NCMEC", "Internet Crimes Against Children Task Force"], "cbp"],
  [["U.S. Department of Justice", "Federal Bureau of Investigation", "U.S. Department of Homeland Security", "U.S. Department of the Treasury", "U.S. Postal Inspection Service"], "fbi"],
  [["U.S. Immigration and Customs Enforcement", "Florida Highway Patrol", "Lee County Sheriff's Office", "U.S. Customs and Border Protection"], "ice"],
  [["Department of Homeland Security"], "dhs"],
  [["Example Clearinghouse"], ""],
  [[], ""],
];

test("lead seal is the first law-enforcement agency, then a department fallback", () => {
  for (const [agencies, id] of CASES) {
    assert.equal(operationLeadAgencyId(agencies), id, agencies.join(" | "));
  }
  const dojOnly = operationLeadLogo(["U.S. Department of Justice"]);
  assert.equal(dojOnly.photo, "/media/agencies/doj.jpg");
  assert.match(dojOnly.photo_credit, /Department of Justice/);
  assert.match(dojOnly.photo_credit, /Wikimedia Commons/);
  assert.doesNotMatch(dojOnly.photo_credit, /https?:\/\//);
  assert.deepEqual(operationLeadLogo(["Example Clearinghouse"]), { photo: "", photo_credit: "" });
});

test("a stored gold still is kept and a screenshot path is not a portrait", () => {
  const kept = normalizeOperation({
    id: "operation-restore-justice",
    name: "Operation Restore Justice",
    agencies: ["FBI"],
    photo: "/media/people/jordan-hale.jpg",
    photo_credit: "Supplied still",
  });
  assert.equal(kept.photo, "/media/people/jordan-hale.jpg");
  assert.equal(kept.photo_credit, "Supplied still");

  const derived = normalizeOperation({
    id: "operation-restore-justice",
    name: "Operation Restore Justice",
    agencies: ["U.S. Department of Justice", "FBI"],
    photo: "/media/screenshots/operations/restore.jpg",
  });
  assert.equal(derived.photo, "/media/agencies/fbi.png");
  assert.match(derived.photo_credit, /Federal Bureau of Investigation/);

  const merged = mergeOperationAnnotate(
    { id: "op", name: "Op", agencies: [] },
    { id: "op", name: "Op", agencies: ["Drug Enforcement Administration"] },
  );
  assert.equal(merged.photo, "/media/agencies/dea.png");
});

test("operation list and detail paint the seal and leave an unmapped card empty", () => {
  const list = operationRow({
    id: "long-island-missing-child-rescue-operation",
    name: "Long Island Missing Child Rescue Operation",
    agencies: [
      "National Child Protection Task Force",
      "New York State Police",
      "Federal Bureau of Investigation",
    ],
  });
  assert.match(list, /\/media\/thumbs\/agencies\/nysp\.jpg\?p=7/);
  assert.doesNotMatch(list, /\/media\/thumbs\/agencies\/fbi/);
  assert.doesNotMatch(list, /class="[^"]*empty-portrait/);

  const detail = operationDetail({
    id: "2026-election-crime-cases",
    name: "2026 Election Crime Cases",
    agencies: ["U.S. Department of Justice"],
    summary: "Roundup.",
  });
  assert.match(detail, /\/media\/agencies\/doj\.jpg\?p=7/);
  assert.match(detail, /data-lightbox="\/media\/agencies\/doj\.jpg\?p=7"/);
  assert.match(detail, /United States Department of Justice/);
  assert.doesNotMatch(detail, /class="[^"]*empty-portrait/);

  const blank = operationRow({
    id: "unmapped",
    name: "Unmapped",
    agencies: ["National Child Protection Task Force"],
  });
  assert.match(blank, /empty-portrait/);
  assert.doesNotMatch(blank, /\/media\/agencies\//);
});

test("an injected override wins and a stored gold still still wins", () => {
  const map = { "op-x": "hud-oig" };
  assert.equal(operationLeadAgencyId(["FBI"], "op-x", map), "hud-oig");
  assert.equal(operationLeadAgencyId(["FBI"], "  op-x  ", map), "hud-oig");
  const logo = operationLeadLogo(["FBI"], "op-x", map);
  assert.equal(logo.photo, "/media/agencies/hud-oig.png");
  assert.ok(logo.photo_credit.length > 0);
  assert.doesNotMatch(logo.photo_credit, /https?:\/\//);

  const normalized = normalizeOperation({
    id: "op-x",
    name: "Op X",
    agencies: ["FBI"],
  }, map);
  assert.equal(normalized.photo, "/media/agencies/hud-oig.png");

  const fromId = operationPortraitFrom({
    id: "op-x",
    agencies: ["Federal Bureau of Investigation"],
  }, map);
  assert.equal(fromId.photo, "/media/agencies/hud-oig.png");

  const fromSlug = operationPortraitFrom({
    slug: "op-x",
    agencies: ["FBI"],
  }, map);
  assert.equal(fromSlug.photo, "/media/agencies/hud-oig.png");

  const gold = operationPortraitFrom({
    id: "op-x",
    agencies: ["FBI"],
    photo: "/media/people/jordan-hale.jpg",
    photo_credit: "Supplied still",
  }, map);
  assert.equal(gold.photo, "/media/people/jordan-hale.jpg");
  assert.equal(gold.photo_credit, "Supplied still");
});

test("Array#map's index is not an override table", () => {
  const row = { id: "op-x", name: "Op X", agencies: ["FBI"] };
  const map = { "op-x": "hud-oig" };
  assert.equal(normalizeOperation(row, map).photo, "/media/agencies/hud-oig.png");

  const direct = normalizeOperation(row);
  const viaDefault = operationLeadLogo(row.agencies, row.id, OPERATION_LEAD_OVERRIDES);
  assert.equal(direct.photo, viaDefault.photo);
  assert.equal(direct.photo_credit, viaDefault.photo_credit);

  for (const got of [
    [row].map(normalizeOperation)[0],
    normalizeOperation(row, 0),
    normalizeOperation(row, 5),
    normalizeOperation(row, []),
    operationPortraitFrom(row, 0),
    [row].map(operationPortraitFrom)[0],
  ]) {
    assert.equal(got.photo, direct.photo);
    assert.equal(got.photo_credit, direct.photo_credit);
  }

  // An array whose index is a real seal must not replace the default table.
  const indexed = { id: "0", name: "Op 0", agencies: ["FBI"] };
  const blocked = normalizeOperation(indexed, ["hud-oig"]);
  const indexedDirect = normalizeOperation(indexed);
  assert.equal(blocked.photo, indexedDirect.photo);
  assert.equal(blocked.photo_credit, indexedDirect.photo_credit);
  assert.equal(blocked.photo, operationLeadLogo(["FBI"], "0", OPERATION_LEAD_OVERRIDES).photo);
  assert.equal(blocked.photo, "/media/agencies/fbi.png");
});

test("an operation id with no override keeps the agencies-derived seal", () => {
  for (const [agencies, id] of CASES) {
    const label = agencies.join(" | ");
    assert.equal(operationLeadAgencyId(agencies, "operation-without-override"), id, label);
    assert.equal(
      operationLeadAgencyId(agencies, "operation-without-override", OPERATION_LEAD_OVERRIDES),
      id,
      label,
    );
  }
  const derived = normalizeOperation({
    id: "operation-restore-justice",
    name: "Operation Restore Justice",
    agencies: ["U.S. Department of Justice", "FBI"],
  });
  assert.equal(derived.photo, "/media/agencies/fbi.png");
  const namedOnly = [
    ["Bureau of Alcohol, Tobacco, Firearms and Explosives"],
    ["ATF"],
    ["U.S. Department of Labor"],
    ["DOL-OIG"],
    ["USDA Office of Inspector General"],
    ["HUD OIG"],
    ["Executive Office for United States Attorneys"],
  ];
  for (const agencies of namedOnly) {
    assert.equal(operationLeadAgencyId(agencies), "", agencies.join(" | "));
    assert.equal(operationLeadAgencyId(agencies, "no-such-op", OPERATION_LEAD_OVERRIDES), "");
  }
});

test("unknown override keys and prototype ids fall back", () => {
  const fbi = ["FBI"];
  for (const value of ["not-a-seal", "", null, "__proto__", "toString"]) {
    assert.equal(operationLeadAgencyId(fbi, "op-x", { "op-x": value }), "fbi", String(value));
  }
  assert.equal(operationLeadAgencyId(fbi, "__proto__", { "__proto__": "hud-oig" }), "fbi");
  assert.equal(operationLeadAgencyId(fbi, "constructor", { constructor: "hud-oig" }), "fbi");
  assert.equal(operationLeadAgencyId(fbi, "toString", { toString: "hud-oig" }), "fbi");
  assert.equal(operationLeadLogo(["Example Clearinghouse"], "op-x", { "op-x": "not-a-seal" }).photo, "");
});

test("the six audited lead overrides beat the stored agency list", () => {
  const expected = {
    "operation-guardian-angel": "usao",
    "operation-protect-the-vote": "usao",
    "operation-clean-house": "hud-oig",
    "afscme-local-1746-wire-fraud-charges": "dol",
    "2025-national-health-care-fraud-takedown": "doj",
    "operation-low-voltage": "hsi",
  };
  assert.deepEqual({ ...OPERATION_LEAD_OVERRIDES }, expected);
  const known = new Set(knownSealKeys());
  const cases = [
    [
      "operation-guardian-angel",
      ["U.S. Attorney's Office Central District of California", "ICE"],
      "/media/agencies/usao.png",
    ],
    [
      "operation-protect-the-vote",
      [
        "U.S. Department of Justice",
        "U.S. Attorney's Office for the Central District of California",
        "Homeland Security Investigations",
      ],
      "/media/agencies/usao.png",
    ],
    [
      "operation-clean-house",
      [
        "U.S. Department of Housing and Urban Development Office of Inspector General",
        "U.S. Marshals Service",
      ],
      "/media/agencies/hud-oig.png",
    ],
    [
      "afscme-local-1746-wire-fraud-charges",
      [
        "U.S. Department of Labor Office of Labor-Management Standards",
        "U.S. Attorney's Office for the Northern District of Ohio",
      ],
      "/media/agencies/dol.png",
    ],
    [
      "2025-national-health-care-fraud-takedown",
      ["DOJ", "HHS-OIG", "FBI", "DEA", "CMS"],
      "/media/agencies/doj.jpg",
    ],
    [
      "operation-low-voltage",
      ["ICE", "Homeland Security Investigations", "ATF", "Georgia State Patrol"],
      "/media/agencies/hsi.jpg",
    ],
  ];
  for (const [slug, agencies, photo] of cases) {
    assert.equal(known.has(OPERATION_LEAD_OVERRIDES[slug]), true, slug);
    assert.equal(operationLeadLogo(agencies, slug).photo, photo, slug);
    const stored = normalizeOperation({ id: slug, name: "x", agencies });
    assert.equal(stored.photo, photo, slug);
  }
  const untouched = normalizeOperation({
    id: "operation-restore-justice",
    name: "x",
    agencies: ["U.S. Department of Justice", "FBI"],
  });
  assert.equal(untouched.photo, "/media/agencies/fbi.png");
});

test("the override table is frozen and every entry names a known seal", () => {
  assert.equal(Object.isFrozen(OPERATION_LEAD_OVERRIDES), true);
  const known = new Set(knownSealKeys());
  for (const id of Object.keys(OPERATION_LEAD_OVERRIDES)) {
    assert.equal(Object.prototype.hasOwnProperty.call(OPERATION_LEAD_OVERRIDES, id), true);
    const value = Object.getOwnPropertyDescriptor(OPERATION_LEAD_OVERRIDES, id).value;
    assert.equal(typeof value, "string");
    assert.equal(known.has(value), true, id);
  }
});

test("each new seal has a file, a URL-free credit, a Commons source, and nine thumbs", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const keys = ["usda-oig", "dol-oig", "hud-oig", "usao", "dol", "atf"];
  const suffixes = [
    ".jpg", ".webp",
    ".2x.jpg", ".2x.webp",
    ".card.jpg", ".card.webp",
    ".card2x.jpg", ".card2x.webp",
    ".hero.webp",
  ];
  const known = new Set(knownSealKeys());
  assert.equal(Object.isFrozen(SEAL_SOURCES), true);
  for (const key of keys) {
    assert.equal(known.has(key), true, key);
    const src = path.join(root, "media", "agencies", `${key}.png`);
    assert.equal(fs.existsSync(src), true, src);
    const logo = operationLeadLogo([], `check-${key}`, { [`check-${key}`]: key });
    assert.equal(logo.photo, `/media/agencies/${key}.png`);
    assert.ok(logo.photo_credit.trim().length > 0, key);
    assert.doesNotMatch(logo.photo_credit, /https?:\/\//);
    assert.equal(Object.prototype.hasOwnProperty.call(SEAL_SOURCES, key), true, key);
    const meta = Object.getOwnPropertyDescriptor(SEAL_SOURCES, key).value;
    assert.match(meta.source, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.equal(typeof meta.license, "string");
    assert.ok(meta.license.trim().length > 0, key);
    for (const suffix of suffixes) {
      const thumb = path.join(root, "media", "thumbs", "agencies", `${key}${suffix}`);
      assert.equal(fs.existsSync(thumb), true, thumb);
    }
  }
});

test("each new seal source is an opaque 800x1040 canvas on the seal background", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const keys = ["usda-oig", "dol-oig", "hud-oig", "usao", "dol", "atf"];
  const corners = [
    [0, 0],
    [799, 0],
    [0, 1039],
    [799, 1039],
  ];
  for (const key of keys) {
    const png = PNG.sync.read(fs.readFileSync(path.join(root, "media", "agencies", `${key}.png`)));
    assert.equal(png.width, 800, key);
    assert.equal(png.height, 1040, key);
    for (const [x, y] of corners) {
      const i = (y * png.width + x) * 4;
      assert.deepEqual(
        [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]],
        [13, 13, 18, 255],
        `${key} ${x},${y}`,
      );
    }
  }
});

test("the hud-oig seal is a near-square seal, not a banner", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const png = PNG.sync.read(fs.readFileSync(path.join(root, "media", "agencies", "hud-oig.png")));
  let x0 = png.width;
  let y0 = png.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i] === 13 && png.data[i + 1] === 13 && png.data[i + 2] === 18) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  assert.ok(w >= 600 && h >= 600, `${w}x${h}`);
  assert.ok(w / h > 0.9 && w / h < 1.1, `${w}x${h}`);
  assert.ok(x0 >= 64 && x1 <= 735 && y0 >= 184 && y1 <= 855, `${x0},${y0}..${x1},${y1}`);
  const meta = SEAL_SOURCES["hud-oig"];
  assert.match(meta.source, /Seal_of_the_United_States_Department_of_Housing_and_Urban_Development/);
});
