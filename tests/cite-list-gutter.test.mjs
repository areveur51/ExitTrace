import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { citeList } from "../app/lib/html.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(ROOT, "app/public/styles.css"), "utf8");

function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\>:]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `css rule ${selector}`);
  return m[1];
}

test("cite list renders one <li> per source in an ordered cite-list (1-, 2- and 3-digit counts)", () => {
  for (const n of [1, 12, 123]) {
    const sources = Array.from({ length: n }, (_, i) => ({
      url: `https://example.com/a/very/long/path/${"x".repeat(80)}/${i}`,
      publisher: `Outlet ${i}`,
      date: "2026-10-25",
    }));
    const html = citeList(sources);
    assert.match(html, /^<ol class="sources cite-list">/);
    assert.equal(html.match(/<li>/g).length, n);
    assert.doesNotMatch(html, /\[\d+\]|<span class="cite-num/, "numbers come from CSS, not markup");
  }
});

test("cite numbers sit in a fixed right-aligned gutter from counter(list-item)", () => {
  const ol = rule("ol.cite-list");
  assert.match(ol, /list-style:\s*none/);
  assert.match(ol, /padding-left:\s*0/);
  assert.match(ol, /--cite-num-w:\s*4ch/, "gutter fits a 3-digit number and its dot");

  const li = rule("ol.cite-list > li");
  assert.match(li, /position:\s*relative/);
  assert.match(li, /padding-left:\s*calc\(var\(--cite-num-w\) \+ var\(--cite-gap\)\)/);
  assert.match(li, /overflow-wrap:\s*anywhere/);
  assert.match(li, /min-width:\s*0/);

  const num = rule("ol.cite-list > li::before");
  assert.match(num, /content:\s*counter\(list-item\) "\."/, "list-item honors <ol start>");
  assert.match(num, /position:\s*absolute/);
  assert.match(num, /width:\s*var\(--cite-num-w\)/);
  assert.match(num, /text-align:\s*right/);
  assert.match(num, /font-variant-numeric:\s*tabular-nums/);
  assert.match(num, /white-space:\s*nowrap/);

  assert.match(rule("ol.cite-list time"), /white-space:\s*nowrap/);
});

test("inline [n] source pointers have fixed-width digits and even spacing", () => {
  const ref = rule(".person-detail .source-ref");
  assert.match(ref, /display:\s*inline-block/);
  assert.match(ref, /min-width:\s*3ch/);
  assert.match(ref, /font-variant-numeric:\s*tabular-nums/);
  assert.match(rule(".person-detail .event-source-refs"), /gap:\s*0\.3rem 0\.5rem/);
});
