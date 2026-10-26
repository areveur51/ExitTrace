import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TAG_MENU_MAX_LABEL, keymapFooter, tagMenuItem } from "../app/lib/html.mjs";
import { ATTRIBUTE_TAGS, MENU_ATTRIBUTE_TAGS } from "../app/lib/tags.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Rendered Tags-menu chips from the shared keymap footer. */
function renderedTagChips(activePath = "/") {
  const html = keymapFooter(activePath);
  const nav = html.match(/<nav class="keymap-group keymap-tags"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(nav, "Tags menu renders");
  return [...nav[1].matchAll(/<a class="keychip keymap-tag" href="([^"]+)"([^>]*)>([^<]*)<\/a>/g)].map((m) => {
    const title = m[2].match(/\btitle="([^"]*)"/);
    return { href: m[1], attrs: m[2], label: decode(m[3]), title: title ? decode(title[1]) : null };
  });
}

test("every Tags-menu label is at most the max length, and a shortened label carries the full name as title", () => {
  assert.equal(TAG_MENU_MAX_LABEL, 18);
  const chips = renderedTagChips();
  assert.equal(chips.length, MENU_ATTRIBUTE_TAGS.length);
  for (const [i, tag] of MENU_ATTRIBUTE_TAGS.entries()) {
    const chip = chips[i];
    assert.equal(chip.href, tag.path, `${tag.id} keeps its slug`);
    assert.ok(chip.label.length <= TAG_MENU_MAX_LABEL, `${tag.id} label "${chip.label}" is ${chip.label.length} > ${TAG_MENU_MAX_LABEL}`);
    if (chip.label === tag.nav) assert.equal(chip.title, null, `${tag.id} is not shortened, so no title`);
    else assert.equal(chip.title, tag.nav, `${tag.id} title holds the full name`);
  }
});

test("the long tag names get short display labels; tag data and page titles keep the full name", () => {
  const byId = Object.fromEntries(ATTRIBUTE_TAGS.map((t) => [t.id, t]));
  const table = [
    ["big_beautiful_bill_act", "One Big Beautiful Bill Act", "Big Beautiful Bill", "/tags/one-big-beautiful-bill-act"],
    ["secure_the_border_act", "Secure the Border Act", "Secure the Border", "/tags/secure-the-border-act"],
    ["s_5271_photo_id", "S. 5271", "S. 5271", "/tags/s-5271"],
    ["former_intel_agency_personnel", "Former intel", "Former intel", "/tags/former-intel-agency-personnel"],
    ["harassment_records", "Harassment records", "Harassment records", "/tags/harassment-records"],
    ["clearance_revoked", "Revoked clearances", "Revoked clearances", "/tags/clearance-revoked"],
  ];
  for (const [id, nav, label, href] of table) {
    const tag = byId[id];
    assert.ok(tag, id);
    assert.equal(tag.nav, nav, `${id} nav is unchanged`);
    assert.equal(tag.path, href, `${id} slug is unchanged`);
    const item = tagMenuItem(tag);
    assert.equal(item.label, label);
    assert.equal(item.href, href);
    assert.equal(item.title, label === nav ? undefined : nav);
  }
  const html = keymapFooter("/");
  assert.match(html, /href="\/tags\/one-big-beautiful-bill-act" title="One Big Beautiful Bill Act">Big Beautiful Bill</);
  assert.match(html, /href="\/tags\/secure-the-border-act" title="Secure the Border Act">Secure the Border</);
});

test("the active tag chip keeps aria-current alongside the full-name title", () => {
  const chip = renderedTagChips("/tags/one-big-beautiful-bill-act").find((c) => c.href === "/tags/one-big-beautiful-bill-act");
  assert.match(chip.attrs, /aria-current="page" title="One Big Beautiful Bill Act"/);
  assert.equal(chip.label, "Big Beautiful Bill");
});

test("Tags-menu chips are nowrap, with a slightly smaller font only in the rail", () => {
  const css = fs.readFileSync(path.join(ROOT, "app/public/styles.css"), "utf8");
  const base = css.match(/\n\.keymap-tag \{([^}]*)\}/);
  assert.ok(base, ".keymap-tag rule");
  assert.match(base[1], /white-space: nowrap;/);
  assert.match(base[1], /overflow: hidden;/);
  const rail = css.match(/@media \(min-width: 721px\) \{[\s\S]*?\.keymap \.keymap-tag \{\s*font-size: 0\.94em;\s*\}/);
  assert.ok(rail, "rail tag font-size rule");
});
