/**
 * Batch LIVE headed x.com captures — dark theme + grey-border crop.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import {
  screenshotArticlePadded,
  forceXDarkTheme,
  etSsMode,
} from "./lib/padded-article-shot.mjs";

const batch = JSON.parse(fs.readFileSync("/workspace/et-live-capture/batch.json", "utf8"));
const OUTDIR = "/workspace/et-live-capture/out/dog-comms";
const LOG = "/workspace/et-live-capture/results-expand.jsonl";
const DISPLAY = process.env.DISPLAY || ":4";
const HEADLESS = process.env.HEADLESS === "1";
const START = Number(process.env.START || 0);
const LIMIT = Number(process.env.LIMIT || batch.length);

function statusIdFromUrl(url) {
  const m = String(url).match(/status\/(\d+)/i);
  return m ? m[1] : "";
}

async function findStatusArticle(page, statusUrl) {
  const sid = statusIdFromUrl(statusUrl);
  const articles = page.locator("article");
  const n = await articles.count();
  if (n === 0) return null;
  if (!sid) return articles.first();
  // Prefer article that links to this status id (permalink / time link)
  for (let i = 0; i < n; i++) {
    const a = articles.nth(i);
    const hit = await a.locator(`a[href*="/status/${sid}"]`).count().catch(() => 0);
    if (hit > 0) return a;
  }
  // Fallback: largest article in primary column (main post often tallest among top few)
  let best = articles.first();
  let bestH = 0;
  for (let i = 0; i < Math.min(n, 6); i++) {
    const a = articles.nth(i);
    const box = await a.boundingBox().catch(() => null);
    if (box && box.height > bestH) {
      bestH = box.height;
      best = a;
    }
  }
  return best;
}

const MODE = etSsMode();

fs.mkdirSync(OUTDIR, { recursive: true });
if (START === 0) fs.writeFileSync(LOG, "");
process.env.DISPLAY = DISPLAY;

async function dismissNoise(page) {
  for (const sel of [
    '[data-testid="cookiePolicyBannerDismiss"]',
    '[aria-label="Close"]',
    'button:has-text("Accept all cookies")',
    'button:has-text("Accept")',
  ]) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 400 })) await el.click({ timeout: 800 });
    } catch {}
  }
}

async function captureOne(page, row) {
  const out = path.join(OUTDIR, row.leaf);
  const result = {
    id: row.id,
    source_url: row.source_url,
    leaf: row.leaf,
    ok: false,
    reason: "",
    mode: MODE,
  };
  if (!/^https:\/\/(x|twitter)\.com\//i.test(row.source_url)) {
    result.reason = "skip_non_x";
    return result;
  }
  try {
    await forceXDarkTheme(page);
    const resp = await page.goto(row.source_url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    result.http = resp ? resp.status() : 0;
    await page.waitForTimeout(3500);
    await forceXDarkTheme(page);
    await dismissNoise(page);
    try {
      await page.waitForSelector("article", { timeout: 20000 });
    } catch {}
    const articles = page.locator("article");
    const n = await articles.count();
    result.articleCount = n;
    if (n === 0) {
      const bodyText = await page.innerText("body").catch(() => "");
      result.sample = bodyText.slice(0, 280).replace(/\s+/g, " ");
      result.reason = /Sign in to X|Log in to X|Create your account/i.test(bodyText)
        ? "login_wall"
        : "no_article";
      return result;
    }
    const article = await findStatusArticle(page, row.source_url);
    if (!article) {
      result.reason = "no_article";
      return result;
    }
    // Expand+timestamp fail-closed inside screenshotArticlePadded
    await page.waitForTimeout(300);
    try {
      await article.scrollIntoViewIfNeeded();
      const media = article.locator("img, video").nth(1);
      if (await media.count()) await media.scrollIntoViewIfNeeded().catch(() => {});
    } catch {}
    await page.waitForTimeout(600);
    const articleText = await article.innerText().catch(() => "");
    if (/X post snapshot\s*·\s*ExitTrace/i.test(articleText)) {
      result.reason = "synthetic_card_detected";
      return result;
    }
    result.articleChars = articleText.length;
    result.hasTime =
      (await article.locator("time").count().catch(() => 0)) > 0 ||
      /\b(AM|PM)\b.*·|\d{1,2}:\d{2}/.test(articleText);
    const meta = await screenshotArticlePadded(page, article, out, { mode: MODE, statusUrl: row.source_url });
    result.clip = meta.clip;
    result.expand = meta.expand || null;
    result.timestamp = meta.timestamp || null;
    result.resolvedUrl = meta.resolvedUrl || null;
    result.navigatedToOriginal = !!meta.navigatedToOriginal;
    result.sidePad = meta.sidePad;
    const st = fs.statSync(out);
    result.bytes = st.size;
    result.ok = st.size > 8000 && articleText.length > 30;
    result.reason = result.ok ? "captured_live_x_dark_border" : "too_small_or_empty";
    result.out = out;
    return result;
  } catch (e) {
    result.reason = "exception:" + String(e.message || e).slice(0, 220);
    return result;
  }
}

const slice = batch.slice(START, START + LIMIT);
console.error(`BATCH_DARK_BORDER mode=${MODE} start=${START} n=${slice.length} total=${batch.length}`);

const browser = await chromium.launch({
  headless: HEADLESS,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});
const context = await browser.newContext({
  viewport: { width: 1200, height: 2400 },
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  locale: "en-US",
  colorScheme: "dark",
});
await context.addInitScript(() => {
  try {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("nightmode", "true");
  } catch {}
});
const page = await context.newPage();

let ok = 0, fail = 0, skip = 0;
const summary = [];
for (let i = 0; i < slice.length; i++) {
  const row = slice[i];
  const abs = START + i;
  process.stderr.write(`[${abs + 1}/${batch.length}] ${row.id} ... `);
  const r = await captureOne(page, row);
  fs.appendFileSync(LOG, JSON.stringify(r) + "\n");
  summary.push(r);
  if (r.ok) {
    ok++;
    process.stderr.write(`OK ${r.bytes}b sidePad=${r.sidePad}\n`);
  } else if (String(r.reason).startsWith("skip")) {
    skip++;
    process.stderr.write(`SKIP ${r.reason}\n`);
  } else {
    fail++;
    process.stderr.write(`FAIL ${r.reason}\n`);
  }
  await page.waitForTimeout(800);
}

await browser.close();
const report = { ok, fail, skip, done: summary.length, total: batch.length, start: START, mode: MODE };
fs.writeFileSync(
  "/workspace/et-live-capture/batch-summary-expand.json",
  JSON.stringify({ report, summary }, null, 2),
);
console.log(JSON.stringify(report));
process.exit(fail && ok === 0 ? 1 : 0);
