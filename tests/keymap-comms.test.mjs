import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { keymapCommsItems, keymapFooter } from "../app/lib/html.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const COMMS = [
  { key: "c", href: "/dog-comms", label: "Dog" },
  { key: "e", href: "/red-folder-comms", label: "Red Folder" },
  { key: "l", href: "/eagle-comms", label: "Eagle" },
  { key: "n", href: "/ronald-comms", label: "Ronald" },
  { key: "k", href: "/boot-comms", label: "Boot" },
  { key: "o", href: "/corona-comms", label: "Corona" },
  { key: "t", href: "/central-casting", label: "Central Casting" },
];

function parts(html) {
  const top = html.match(/<div class="keymap-keys">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const comms = html.match(/<nav class="keymap-group keymap-comms"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
  const tags = html.match(/<nav class="keymap-group keymap-tags"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
  return { top, comms, tags };
}

test("keymap Comms section uses the shared section pattern with the 7 comms links in order", () => {
  assert.deepEqual(keymapCommsItems(), COMMS);
  for (const active of ["/", "/firings", "/dog-comms", "/central-casting", "/tags/masks"]) {
    const html = keymapFooter(active);
    const { top, comms, tags } = parts(html);
    assert.match(html, /<nav class="keymap-group keymap-comms" aria-label="Comms"><p class="keymap-section">Comms<\/p>/);
    assert.match(html, /<nav class="keymap-group keymap-tags" aria-label="Fact tags"><p class="keymap-section">Tags<\/p>/);
    assert.ok(html.indexOf("keymap-comms") < html.indexOf("keymap-tags"), "Comms renders before Tags");
    assert.ok(tags.length > 0);

    const links = [...comms.matchAll(/<a class="keychip keymap-comm" href="([^"]+)" data-key="([^"]+)"[^>]*>[\s\S]*?<span class="br">\]<\/span> ([^<]+)<\/a>/g)].map(
      (m) => ({ key: m[2], href: m[1], label: m[3] }),
    );
    assert.deepEqual(links, COMMS);

    for (const c of COMMS) {
      assert.doesNotMatch(top, new RegExp(`href="${c.href}"`), `${c.href} is not at the top level`);
      assert.doesNotMatch(top, new RegExp(`data-key="${c.key}"`), `${c.key} is not at the top level`);
      assert.equal(html.split(`href="${c.href}"`).length - 1, 1, `${c.href} renders exactly once`);
    }
  }
});

test("keymap Comms marks the active comms page and keeps shortcut keys", () => {
  const html = keymapFooter("/corona-comms");
  assert.match(html, /class="keychip keymap-comm" href="\/corona-comms" data-key="o" aria-current="page"><span class="br">\[<\/span>o<span class="br">\]<\/span> Corona</);
  assert.doesNotMatch(html, /href="\/dog-comms"[^>]*aria-current/);
});

test("Comms and Tags share the same desktop and mobile section CSS", () => {
  const css = fs.readFileSync(path.join(ROOT, "app", "public", "styles.css"), "utf8");
  assert.doesNotMatch(css, /\.keymap-tags/);
  assert.doesNotMatch(css, /\.keymap-comms/);
  assert.match(css, /\.keymap-group \{[^}]*order:\s*90;/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.keymap-group \.keychip \{/);
  assert.match(css, /@media \(min-width: 721px\) \{\s*\.keymap-group \{[^}]*flex-direction:\s*column;/);
});
