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
  /CLOSE HACK|CLOSE HACK IMMEDIATELY|SAMURAI PROTOCOL|BREACH PROTOCOL|ROOT@|SurveilTrack|BIO-INTERFACE|ADMIN ACCESS GRANTED|BATTLEDECK|KILO MICROCYBER/i;

test("normalizeTheme keeps the five HUD ids and defaults to cyberdeck", () => {
  assert.equal(DEFAULT_THEME, "cyberdeck");
  assert.deepEqual(THEME_IDS, ["cyberdeck", "phosphor", "greyscale", "stencil", "glass"]);
  assert.deepEqual(
    THEMES.map((t) => t.label),
    ["Cyberdeck", "Phosphor", "Greyscale", "Stencil", "Glass"],
  );
  assert.equal(normalizeTheme("phosphor"), "phosphor");
  assert.equal(normalizeTheme("greyscale"), "greyscale");
  assert.equal(normalizeTheme("stencil"), "stencil");
  assert.equal(normalizeTheme("glass"), "glass");
  assert.equal(normalizeTheme("cyberdeck"), "cyberdeck");
  assert.equal(normalizeTheme("nope"), "cyberdeck");
  assert.equal(normalizeTheme(""), "cyberdeck");
  assert.equal(normalizeTheme(null), "cyberdeck");
});

test("applyTheme writes data-theme and persists the choice", () => {
  const attrs = {};
  const store = {};
  const pressed = [];
  const root = { setAttribute(k, v) { attrs[k] = v; } };
  const storage = {
    setItem(k, v) { store[k] = v; },
    getItem(k) { return store[k]; },
  };
  const buttons = THEME_IDS.map((id) => ({
    id,
    getAttribute(name) {
      if (name === "data-theme-set") return id;
      if (name === "aria-pressed") return pressed[id];
      return null;
    },
    setAttribute(name, value) {
      if (name === "aria-pressed") pressed[id] = value;
    },
  }));

  assert.equal(applyTheme("stencil", { root, storage, buttons }), "stencil");
  assert.equal(attrs["data-theme"], "stencil");
  assert.equal(store[THEME_STORAGE_KEY], "stencil");
  assert.equal(pressed.stencil, "true");
  assert.equal(pressed.cyberdeck, "false");

  assert.equal(applyTheme("glass", { root, storage, buttons }), "glass");
  assert.equal(attrs["data-theme"], "glass");
  assert.equal(store[THEME_STORAGE_KEY], "glass");
  assert.equal(pressed.glass, "true");
  assert.equal(pressed.stencil, "false");

  assert.equal(applyTheme("unknown", { root, storage, buttons }), "cyberdeck");
  assert.equal(attrs["data-theme"], "cyberdeck");
  assert.equal(store[THEME_STORAGE_KEY], "cyberdeck");
  assert.equal(pressed.cyberdeck, "true");
  assert.equal(pressed.glass, "false");
});

test("theme switcher and layout default to Cyberdeck with real catalog routes", () => {
  const switcher = themeSwitcher();
  const footer = keymapFooter("/firings");
  const page = layout({
    title: "Firings",
    path: "/firings",
    heading: "Firings",
    body: `<p class="list-head">Firings</p>`,
  });

  for (const html of [switcher, footer, page]) {
    assert.match(html, /data-theme-set="cyberdeck"/);
    assert.match(html, /data-theme-set="phosphor"/);
    assert.match(html, /data-theme-set="greyscale"/);
    assert.match(html, /data-theme-set="stencil"/);
    assert.match(html, /data-theme-set="glass"/);
    assert.match(html, />Cyberdeck</);
    assert.match(html, />Phosphor</);
    assert.match(html, />Greyscale</);
    assert.match(html, />Stencil</);
    assert.match(html, />Glass</);
    assert.doesNotMatch(html, LARP);
  }

  assert.match(page, /data-theme="cyberdeck"/);
  assert.match(page, /exittrace-theme/);
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

test("CSS tokens cover five themes and keep cyberdeck as the default palette", () => {
  const css = fs.readFileSync(path.join(ROOT, "app", "public", "styles.css"), "utf8");
  const themeIds = [...css.matchAll(/html\[data-theme="([^"]+)"\]/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(themeIds)], ["cyberdeck", "phosphor", "greyscale", "stencil", "glass"]);
  assert.match(css, /html\[data-theme="cyberdeck"\]/);
  assert.match(css, /html\[data-theme="phosphor"\]/);
  assert.match(css, /html\[data-theme="greyscale"\]/);
  assert.match(css, /html\[data-theme="stencil"\]/);
  assert.match(css, /html\[data-theme="glass"\]/);
  assert.match(css, /--bg:\s*#0a0203/i);
  assert.match(css, /--red:\s*#e23a32/i);
  assert.match(css, /--cyan:\s*#3fe0e8/i);
  assert.match(css, /--ink:\s*#00e08a/i);
  assert.match(css, /--red:\s*#00e08a/i);
  assert.match(css, /--status-ok:\s*#3dcc6a/i);
  assert.match(css, /--status-alert:\s*#d94a42/i);
  assert.match(css, /--status-warn:\s*#d4a017/i);
  assert.match(css, /--red:\s*#ff6a00/i);
  assert.match(css, /--cyan:\s*#a0d8e0/i);
  assert.match(css, /--bg:\s*#121212/i);
  assert.match(css, /backdrop-filter:\s*blur\(/);
  assert.match(css, /--status-ok:\s*#c6e020/i);
  assert.match(css, /--status-alert:\s*#e08a28/i);
  assert.match(css, /--ink:\s*#f5f6f8/i);
  assert.match(css, /\.theme-btn\[data-theme-set="glass"\]/);
  assert.match(css, /\.theme-switch/);
  assert.match(css, /\.theme-btn/);
  assert.match(css, /url\("\/media\/themes\/glass-bg\.webp"\)/);
  assert.match(css, /html\[data-theme="glass"\] \.crumbs a,\s*html\[data-theme="glass"\] \.crumb-current \{[^}]*border:\s*0;/);
  assert.match(css, /html\[data-theme="glass"\] \.crumbs a,\s*html\[data-theme="glass"\] \.crumb-current \{[^}]*backdrop-filter:\s*none;/);
  assert.doesNotMatch(css, /pinterest|pinimg|i\.pinimg/i);
  assert.ok(
    fs.existsSync(path.join(ROOT, "app", "public", "media", "themes", "glass-bg.webp")),
    "glass theme still is vendored locally",
  );
  assert.doesNotMatch(css, /#e6c384|#0d0d12|#c4b5fd|#4c1d95|#7c3aed|#fbbf24/);
  assert.doesNotMatch(css, LARP);
});

test("app.js switches data-theme immediately and writes localStorage", () => {
  const js = fs.readFileSync(path.join(ROOT, "app", "public", "app.js"), "utf8");
  for (const id of THEME_IDS) {
    assert.match(js, new RegExp(`"${id}"`));
  }
  assert.match(js, /exittrace-theme/);
  assert.match(js, /localStorage\.setItem/);
  assert.match(js, /localStorage\.getItem/);
  assert.match(js, /setAttribute\("data-theme"/);
  assert.match(js, /data-theme-set/);
  assert.match(js, /aria-pressed/);
  assert.doesNotMatch(js, LARP);
});
