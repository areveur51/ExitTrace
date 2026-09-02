import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { test } from "node:test";
import { fileURLToPath } from "url";
import { keymapFooter, layout, themeSwitcher } from "../app/lib/html.mjs";
import {
  DEFAULT_THEME,
  THEME_IDS,
  THEME_STORAGE_KEY,
  THEMES,
  applyTheme,
  normalizeTheme,
} from "../app/lib/themes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LARP =
  /CLOSE HACK|CLOSE HACK IMMEDIATELY|SAMURAI PROTOCOL|BREACH PROTOCOL|ROOT@|SurveilTrack|BIO-INTERFACE|ADMIN ACCESS GRANTED|BATTLEDECK|KILO MICROCYBER|Batman|Batmobile|Warner|DC Comics|BATMOBILE GUNNER/i;

test("normalizeTheme is glass-only and defaults to glass", () => {
  assert.equal(DEFAULT_THEME, "glass");
  assert.deepEqual(THEME_IDS, ["glass"]);
  assert.deepEqual(
    THEMES.map((t) => t.label),
    ["Glass"],
  );
  assert.equal(normalizeTheme("glass"), "glass");
  assert.equal(normalizeTheme("cyberdeck"), "glass");
  assert.equal(normalizeTheme("phosphor"), "glass");
  assert.equal(normalizeTheme("greyscale"), "glass");
  assert.equal(normalizeTheme("stencil"), "glass");
  assert.equal(normalizeTheme("visual-novel"), "glass");
  assert.equal(normalizeTheme("nope"), "glass");
  assert.equal(normalizeTheme(""), "glass");
  assert.equal(normalizeTheme(null), "glass");
});

test("applyTheme always locks Glass and clears stale theme storage", () => {
  const attrs = {};
  const store = { [THEME_STORAGE_KEY]: "cyberdeck" };
  const removed = [];
  const root = { setAttribute(k, v) { attrs[k] = v; } };
  const storage = {
    setItem(k, v) { store[k] = v; },
    getItem(k) { return store[k]; },
    removeItem(k) {
      removed.push(store[k]);
      delete store[k];
    },
  };

  assert.equal(applyTheme("phosphor", { root, storage }), "glass");
  assert.equal(attrs["data-theme"], "glass");
  assert.equal(store[THEME_STORAGE_KEY], "glass");
  assert.ok(removed.includes("cyberdeck"));

  assert.equal(applyTheme("unknown", { root, storage }), "glass");
  assert.equal(attrs["data-theme"], "glass");
  assert.equal(store[THEME_STORAGE_KEY], "glass");

  assert.equal(applyTheme("glass", { root, storage }), "glass");
  assert.equal(attrs["data-theme"], "glass");
});

test("layout defaults to Glass with real catalog routes and no theme picker", () => {
  const switcher = themeSwitcher();
  const footer = keymapFooter("/firings");
  const page = layout({
    title: "Firings",
    path: "/firings",
    heading: "Firings",
    body: `<p class="list-head">Firings</p>`,
  });

  assert.equal(switcher, "");
  for (const html of [switcher, footer, page]) {
    assert.doesNotMatch(html, /data-theme-set=/);
    assert.doesNotMatch(html, /class="theme-switch"/);
    assert.doesNotMatch(html, /theme-btn/);
    assert.doesNotMatch(html, />Cyberdeck</);
    assert.doesNotMatch(html, />Phosphor</);
    assert.doesNotMatch(html, />Greyscale</);
    assert.doesNotMatch(html, />Stencil</);
    assert.doesNotMatch(html, LARP);
  }

  assert.match(page, /data-theme="glass"/);
  assert.match(page, /exittrace-theme/);
  assert.match(page, /localStorage\.removeItem/);
  assert.doesNotMatch(page, /data-theme="cyberdeck"/);
  assert.match(footer, /href="\/firings"/);
  assert.match(footer, /href="\/resignations"/);
  assert.match(footer, /href="\/government"/);
  assert.match(footer, /href="\/deaths"/);
  assert.match(footer, /href="\/arrests"/);
  assert.match(footer, /href="\/corona-comms"/);
  assert.match(footer, /href="\/dashboard"/);
  assert.match(footer, /href="\/indictments"/);
  assert.match(footer, /href="\/unsorted"/);
  assert.match(footer, /href="\/add"/);
  assert.match(footer, /href="\/dog-comms"/);
  assert.match(footer, /\]<\/span> Firings</);
  assert.match(footer, /\]<\/span> Resignations</);
  assert.match(footer, /\]<\/span> Arrests</);
  assert.match(footer, /\]<\/span> Corona</);
  assert.match(footer, /\]<\/span> Dashboard</);
  assert.match(footer, /\]<\/span> Indictments</);
  assert.match(footer, /\]<\/span> Unsorted</);
  assert.doesNotMatch(footer, /CLOSE HACK|BREACH PROTOCOL|SurveilTrack|ROOT@/i);
});

test("CSS tokens cover Glass only and keep schematic HUD chrome", () => {
  const css = fs.readFileSync(path.join(ROOT, "app", "public", "styles.css"), "utf8");
  const themeIds = [...css.matchAll(/html\[data-theme="([^"]+)"\]/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(themeIds)], ["glass"]);
  assert.match(css, /html\[data-theme="glass"\]/);
  assert.doesNotMatch(css, /html\[data-theme="cyberdeck"\]/);
  assert.doesNotMatch(css, /html\[data-theme="phosphor"\]/);
  assert.doesNotMatch(css, /html\[data-theme="greyscale"\]/);
  assert.doesNotMatch(css, /html\[data-theme="stencil"\]/);
  assert.doesNotMatch(css, /visual-novel/);
  assert.match(css, /--bg:\s*#000000/i);
  assert.match(css, /--red:\s*#e23a32/i);
  assert.match(css, /--cyan:\s*#f4f6f8/i);
  assert.match(css, /--amber:\s*#ffb000/i);
  assert.match(css, /--ink:\s*#f4f6f8/i);
  assert.match(css, /--label:\s*#ffffff/i);
  assert.match(css, /--status-ok:\s*#ffb000/i);
  assert.match(css, /--status-alert:\s*#e23a32/i);
  assert.match(css, /backdrop-filter:\s*blur\(/);
  assert.match(css, /repeating-radial-gradient/);
  assert.doesNotMatch(css, /\.theme-switch/);
  assert.doesNotMatch(css, /\.theme-btn/);
  assert.doesNotMatch(css, /data-theme-set/);
  assert.match(css, /url\("\/media\/themes\/glass-bg\.webp"\)/);
  assert.match(css, /html\[data-theme="glass"\] \.crumbs a,\s*html\[data-theme="glass"\] \.crumb-current \{[^}]*border:\s*0;/);
  assert.match(css, /html\[data-theme="glass"\] \.crumbs a,\s*html\[data-theme="glass"\] \.crumb-current \{[^}]*backdrop-filter:\s*none;/);
  assert.doesNotMatch(css, /pinterest|pinimg|i\.pinimg/i);
  assert.ok(
    fs.existsSync(path.join(ROOT, "app", "public", "media", "themes", "glass-bg.webp")),
    "glass theme still is vendored locally",
  );
  assert.doesNotMatch(css, /#7ee9ff|#5ec8e0|#f07a18|#c45a12/);
  assert.doesNotMatch(css, /#e6c384|#0d0d12|#c4b5fd|#4c1d95|#7c3aed|#fbbf24/);
  assert.doesNotMatch(css, LARP);
});

test("app.js locks Glass and clears stale localStorage theme keys", () => {
  const js = fs.readFileSync(path.join(ROOT, "app", "public", "app.js"), "utf8");
  assert.match(js, /"glass"/);
  assert.match(js, /lockGlassTheme/);
  assert.match(js, /exittrace-theme/);
  assert.match(js, /localStorage\.setItem/);
  assert.match(js, /localStorage\.getItem/);
  assert.match(js, /localStorage\.removeItem/);
  assert.match(js, /setAttribute\("data-theme"/);
  assert.doesNotMatch(js, /data-theme-set/);
  assert.doesNotMatch(js, /theme-switch/);
  assert.doesNotMatch(js, /cyberdeck|phosphor|greyscale|stencil|visual-novel/);
  assert.doesNotMatch(js, LARP);
});
