/**
 * LIVE headed x.com capture — dark theme + grey-border crop.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import {
  screenshotArticlePadded,
  forceXDarkTheme,
  etSsMode,
} from "./lib/padded-article-shot.mjs";

const OUT = process.argv[2];
const STATUS = process.argv[3];
if (!OUT || !STATUS) {
  console.error("usage: capture-live-x.mjs <out.png> <https://x.com/.../status/ID>");
  process.exit(2);
}
if (!/^https:\/\/(x|twitter)\.com\//i.test(STATUS)) {
  console.error("FAIL: only live x.com/twitter.com URLs");
  process.exit(2);
}
if (/fxtwitter|vxtwitter|api\.fxtwitter/i.test(STATUS)) {
  console.error("FAIL: banned proxy URL");
  process.exit(2);
}


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

const HEADLESS = process.env.HEADLESS === "1";
const DISPLAY = process.env.DISPLAY || ":4";

async function dismissNoise(page) {
  for (const sel of [
    '[data-testid="cookiePolicyBannerDismiss"]',
    '[aria-label="Close"]',
    'button:has-text("Accept all cookies")',
    'button:has-text("Accept")',
    'button:has-text("Refuse non-essential")',
  ]) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 400 })) await el.click({ timeout: 800 });
    } catch {}
  }
}

async function main() {
  process.env.DISPLAY = DISPLAY;
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
  let result = { ok: false, reason: "", url: STATUS, out: OUT, mode: etSsMode() };

  try {
    await forceXDarkTheme(page);
    const resp = await page.goto(STATUS, { waitUntil: "domcontentloaded", timeout: 60000 });
    result.http = resp ? resp.status() : 0;
    await page.waitForTimeout(4000);
    await forceXDarkTheme(page);
    await dismissNoise(page);
    try {
      await page.waitForSelector("article", { timeout: 25000 });
    } catch {}
    const articles = page.locator("article");
    const n = await articles.count();
    result.articleCount = n;
    if (n === 0) {
      const bodyText = await page.innerText("body").catch(() => "");
      result.reason = /Sign in to X|Log in to X|Create your account/i.test(bodyText)
        ? "login_wall"
        : "no_article";
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(1);
    }
    const article = await findStatusArticle(page, STATUS);
    if (!article) {
      result.reason = "no_article";
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(1);
    }
    // Expand + timestamp prove happen fail-closed inside screenshotArticlePadded
    await page.waitForTimeout(300);
    try {
      await article.scrollIntoViewIfNeeded();
      const media = article.locator("img, video").nth(1);
      if (await media.count()) await media.scrollIntoViewIfNeeded().catch(() => {});
    } catch {}
    await page.waitForTimeout(800);

    const articleText = await article.innerText().catch(() => "");
    if (/X post snapshot\s*·\s*ExitTrace/i.test(articleText)) {
      result.reason = "synthetic_card_detected";
      console.log(JSON.stringify(result));
      await browser.close();
      process.exit(1);
    }
    result.hasTime = await article.locator("time").count().then((c) => c > 0).catch(() => false);
    result.articleChars = articleText.length;
    result.articleSample = articleText.slice(0, 160).replace(/\s+/g, " ");

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const meta = await screenshotArticlePadded(page, article, OUT, { statusUrl: STATUS });
    result.clip = meta.clip;
    result.tighten = meta.tighten || null;
    result.expand = meta.expand || null;
    result.timestamp = meta.timestamp || null;
    result.resolvedUrl = meta.resolvedUrl || null;
    result.navigatedToOriginal = !!meta.navigatedToOriginal;
    result.sidePad = meta.sidePad;
    result.mode = meta.mode;
    const st = fs.statSync(OUT);
    result.bytes = st.size;
    result.ok = st.size > 8000 && articleText.length > 30;
    result.reason = result.ok ? "captured_live_x_dark_border" : "too_small_or_empty";
    console.log(JSON.stringify(result));
    await browser.close();
    process.exit(result.ok ? 0 : 1);
  } catch (e) {
    result.reason = "exception:" + String(e.message || e);
    console.log(JSON.stringify(result));
    await browser.close().catch(() => {});
    process.exit(1);
  }
}
main();
