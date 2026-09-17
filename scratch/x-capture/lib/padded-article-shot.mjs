/**
 * ExitTrace live X capture recipe — DARK + grey-border crop + tall-media right tighten.
 *
 * Rules:
 * 1) Force X dark theme only
 * 2) Clip to X grey borders (column L + post-cell bottom; R when content fills column)
 * 3) Top: avatar+handle; nothing north; top pad == side inset
 * 4) Tall/narrow media: reflow article to media width so no empty right gutter
 * 5) No artificial pad frame; no ExitTrace chrome; live x.com only
 *
 * Env: ET_SS_MODE=border|pad  ET_SS_PAD (legacy pad mode)
 */
export const ET_SS_PAD_DEFAULT = 40;
export const ET_SS_MODE_DEFAULT = "border";

export function etSsPad() {
  const n = Number(process.env.ET_SS_PAD);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : ET_SS_PAD_DEFAULT;
}

export function etSsMode() {
  const m = String(process.env.ET_SS_MODE || ET_SS_MODE_DEFAULT).toLowerCase();
  return m === "pad" ? "pad" : "border";
}

export async function forceXDarkTheme(page) {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => {
    try {
      localStorage.setItem("theme", "dark");
      localStorage.setItem("nightmode", "true");
    } catch {}
    document.documentElement.style.colorScheme = "dark";
    document.documentElement.setAttribute("data-color-scheme", "dark");
    document.documentElement.setAttribute("data-theme", "dark");
  }).catch(() => {});
}

/** Reflow article when tall/narrow media leaves a large empty right gutter. */
export async function tightenTallMedia(page, article) {
  const info = await article.evaluate((art) => {
    const ar = art.getBoundingClientRect();
    let best = null;
    for (const el of art.querySelectorAll("img, video")) {
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 120) continue;
      const area = r.width * r.height;
      if (!best || area > best.area) {
        best = { w: r.width, h: r.height, x: r.x, right: r.right, y: r.y, area };
      }
    }
    return {
      ar: { x: ar.x, w: ar.width, right: ar.right },
      media: best,
    };
  });

  if (!info.media) return { tightened: false, reason: "no_media" };
  const gap = info.ar.right - info.media.right;
  const aspect = info.media.h / info.media.w;
  // Tighten when there's meaningful empty room to the right of media
  // (typical portrait posts: gap > ~48px and media not near-full width)
  if (gap < 48) return { tightened: false, reason: "gap_small", gap };
  if (info.media.w >= info.ar.w * 0.88) return { tightened: false, reason: "media_wide", gap };

  const leftInset = Math.max(0, info.media.x - info.ar.x);
  // Target article width so media fills content with symmetric insets
  const targetArtW = Math.ceil(info.media.w + leftInset * 2);

  await article.evaluate((art, tw) => {
      art.style.setProperty("max-width", `${tw}px`, "important");
      art.style.setProperty("width", `${tw}px`, "important");
      art.style.boxSizing = "border-box";
      art.style.overflow = "hidden";
      // Tighten media wrappers to content width
      for (const el of art.querySelectorAll("div")) {
        const r = el.getBoundingClientRect();
        if (r.width > tw + 20) {
          el.style.setProperty("max-width", `${tw}px`, "important");
        }
      }
      // Tighten wrapping cell so bottom grey line matches content width
      let el = art.parentElement;
      for (let i = 0; i < 8 && el && el !== document.body; i++) {
        const s = getComputedStyle(el);
        const bb = parseFloat(s.borderBottomWidth) || 0;
        const isLi = el.tagName === "LI";
        if (bb >= 1 || isLi) {
          const ar = art.getBoundingClientRect();
          const er = el.getBoundingClientRect();
          const pad = Math.max(0, ar.x - er.x);
          el.style.setProperty("max-width", `${tw + pad * 2}px`, "important");
          el.style.setProperty("width", `${tw + pad * 2}px`, "important");
          el.style.boxSizing = "border-box";
          break;
        }
        el = el.parentElement;
      }
    }, targetArtW);
  await page.waitForTimeout(450);
  return {
    tightened: true,
    reason: "tall_media_reflow",
    gap,
    aspect,
    targetArtW,
    mediaW: info.media.w,
  };
}

async function measureGeo(page, article) {
  return page.evaluate((art) => {
    if (!art) return { err: "no_article" };
    const ar = art.getBoundingClientRect();

    let column = null;
    for (const el of document.querySelectorAll("main, div, section")) {
      const s = getComputedStyle(el);
      const bl = parseFloat(s.borderLeftWidth) || 0;
      const br = parseFloat(s.borderRightWidth) || 0;
      if (bl < 1 || br < 1) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 280 || r.width > 800) continue;
      if (!(r.x <= ar.x + 2 && r.right >= ar.right - 2)) continue;
      column = {
        x: r.x, y: r.y, w: r.width, h: r.height,
        right: r.right, bottom: r.bottom, bl, br, color: s.borderLeftColor,
      };
      break;
    }

    let cell = null;
    let cellEl = art.parentElement;
    while (cellEl && cellEl !== document.body) {
      const s = getComputedStyle(cellEl);
      const bb = parseFloat(s.borderBottomWidth) || 0;
      if (bb >= 1) {
        const r = cellEl.getBoundingClientRect();
        if (r.height >= ar.height * 0.7 && r.height < Math.max(ar.height * 4, 4000)) {
          cell = {
            x: r.x, y: r.y, w: r.width, h: r.height,
            right: r.right, bottom: r.bottom, bb, color: s.borderBottomColor, via: "border-bottom",
          };
          break;
        }
      }
      cellEl = cellEl.parentElement;
    }
    if (!cell) {
      const wrap = art.closest("li") || art.parentElement;
      if (wrap) {
        const r = wrap.getBoundingClientRect();
        const s = getComputedStyle(wrap);
        let bottom = r.bottom;
        const nxt = wrap.nextElementSibling;
        if (nxt) {
          const nr = nxt.getBoundingClientRect();
          if (nr.y >= r.y) bottom = Math.min(bottom, nr.y);
        }
        cell = {
          x: r.x, y: r.y, w: r.width, h: bottom - r.y,
          right: r.right, bottom, bb: parseFloat(s.borderBottomWidth) || 0,
          color: s.borderBottomColor, via: "wrap-li",
        };
      }
    }
    if (cell) {
      for (const el of document.querySelectorAll("div,hr")) {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.height <= 2 && r.width >= cell.w * 0.5 &&
            r.y >= cell.bottom - 2 && r.y <= cell.bottom + 3) {
          cell.bottom = Math.max(cell.bottom, r.bottom);
          cell.via = (cell.via || "") + "+sep";
          break;
        }
      }
    }

    let avatar = null;
    for (const img of art.querySelectorAll("img")) {
      const r = img.getBoundingClientRect();
      if (r.width < 28 || r.width > 80 || r.height < 28 || r.height > 80) continue;
      if (r.y > ar.y + 120) continue;
      avatar = { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
      break;
    }
    if (!avatar) {
      const a = art.querySelector("a img") || art.querySelector("img");
      if (a) {
        const r = a.getBoundingClientRect();
        avatar = { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
      }
    }

    // Content ink right: max of media / text / metrics within article
    let contentRight = ar.right;
    let bestMedia = null;
    for (const el of art.querySelectorAll("img, video")) {
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) continue;
      contentRight = Math.max(contentRight, r.right);
      if (!bestMedia || r.width * r.height > bestMedia.w * bestMedia.h) {
        bestMedia = { w: r.width, h: r.height, right: r.right, x: r.x };
      }
    }

    return {
      article: { x: ar.x, y: ar.y, w: ar.width, h: ar.height, right: ar.right, bottom: ar.bottom },
      column,
      cell,
      avatar,
      contentRight,
      media: bestMedia,
    };
  }, await article.elementHandle());
}

export async function computeBorderCropClip(page, article, opts = {}) {
  const geo = await measureGeo(page, article);
  if (geo.err) throw new Error(geo.err);
  if (!geo.column) throw new Error("column_border_not_found");
  if (!geo.cell) throw new Error("post_cell_border_not_found");
  if (!geo.avatar) throw new Error("avatar_not_found");

  const sidePad = Math.max(0, geo.avatar.x - geo.column.x);
  const top = Math.max(0, geo.avatar.y - sidePad);
  const x = Math.max(0, geo.column.x);

  // Right edge: follow content — mirror left inset from article to column.
  // After tall-media tighten, article.right sits near media; avoids empty gutter.
  // Never exceed column.right (keeps right grey border when content fills column).
  const innerLeft = Math.max(0, geo.article.x - geo.column.x);
  let right = Math.min(geo.column.right, geo.article.right + innerLeft);
  // If still a large empty band vs media, prefer media.right + sidePad
  if (geo.media && geo.column.right - geo.media.right > sidePad + 40) {
    const mediaRight = geo.media.right + sidePad;
    // only pull in if article was tightened (article near media) or media defines width
    if (geo.article.right <= geo.media.right + innerLeft + 8) {
      right = Math.min(right, Math.max(mediaRight, geo.article.right + innerLeft));
    } else if (opts.forceContentRight) {
      right = Math.min(right, Math.max(mediaRight, geo.article.right + innerLeft));
    }
  }

  const bottom = geo.cell.bottom;
  const width = right - x;
  const height = bottom - top;
  if (width < 180 || height < 80) throw new Error("border_clip_too_small");

  return {
    clip: { x, y: top, width, height },
    sidePad,
    mode: "border",
    meta: geo,
    tightened: !!opts.tightened,
  };
}

export async function computePadClip(page, article, pad) {
  await article.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  let box = await article.boundingBox();
  if (!box) throw new Error("article_bbox_missing");
  const vp0 = page.viewportSize() || { width: 1100, height: 2000 };
  const needW = Math.ceil(box.width + pad * 2 + 24);
  const needH = Math.ceil(Math.min(box.height + pad * 2 + 80, 9000));
  if (needW > vp0.width || needH > vp0.height) {
    await page.setViewportSize({
      width: Math.max(vp0.width, needW),
      height: Math.max(vp0.height, needH),
    });
    await article.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    box = await article.boundingBox();
  }
  if (box.y < pad + 4 || box.x < pad + 4) {
    await page.evaluate(
      ({ pad, x, y }) => {
        window.scrollTo(
          Math.max(0, window.scrollX + Math.min(0, x - pad - 8)),
          Math.max(0, window.scrollY + Math.min(0, y - pad - 8)),
        );
      },
      { pad, x: box.x, y: box.y },
    );
    await page.waitForTimeout(150);
    box = await article.boundingBox();
  }
  const vp = page.viewportSize() || vp0;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const width = Math.min(box.width + pad * 2, vp.width - x);
  const height = Math.min(box.height + pad * 2, vp.height - y);
  return { clip: { x, y, width, height }, pad, mode: "pad" };
}


/** Click every visible "Show more" in article (and nested quote/RT) until none remain. Fail-closed. */
export async function expandAllShowMore(page, article, { maxRounds = 12 } = {}) {
  const selectors = [
    '[data-testid="tweet-text-show-more-link"]',
    'article [data-testid="tweet-text-show-more-link"]',
    'span:has-text("Show more")',
    'div[role="button"]:has-text("Show more")',
    'button:has-text("Show more")',
    'div[role="button"]:has-text("Show replies")', // not expand text; skip later
  ];
  let clicks = 0;
  for (let round = 0; round < maxRounds; round++) {
    let clickedThisRound = 0;
    // Prefer testid first
    for (const sel of [
      '[data-testid="tweet-text-show-more-link"]',
      'span:has-text("Show more")',
      'div[role="button"]:has-text("Show more")',
      'button:has-text("Show more")',
    ]) {
      const locs = article.locator(sel);
      const n = await locs.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const el = locs.nth(i);
        try {
          if (!(await el.isVisible({ timeout: 300 }))) continue;
          const txt = ((await el.innerText().catch(() => "")) || "").trim();
          // Avoid unrelated buttons
          if (txt && !/show more/i.test(txt) && !/show$/i.test(txt)) continue;
          await el.scrollIntoViewIfNeeded().catch(() => {});
          await el.click({ timeout: 1200 });
          clicks++;
          clickedThisRound++;
          await page.waitForTimeout(450);
        } catch {}
      }
    }
    // Also click Show more inside quoted tweets nested under article
    const nested = article.locator('div[role="link"] span:has-text("Show more"), div[data-testid="quoteTweet"] span:has-text("Show more")');
    const nq = await nested.count().catch(() => 0);
    for (let i = 0; i < nq; i++) {
      try {
        const el = nested.nth(i);
        if (await el.isVisible({ timeout: 250 })) {
          await el.click({ timeout: 1000 });
          clicks++;
          clickedThisRound++;
          await page.waitForTimeout(400);
        }
      } catch {}
    }
    if (clickedThisRound === 0) break;
  }
  // Fail-closed: any remaining visible Show more?
  const remain = await article.evaluate((art) => {
    const nodes = [...art.querySelectorAll("span, div, a, button")];
    return nodes.filter((n) => {
      const t = (n.textContent || "").trim();
      if (!/^show more$/i.test(t) && t !== "Show more") return false;
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length;
  });
  if (remain > 0) {
    return { ok: false, reason: "show_more_still_visible", clicks, remain };
  }
  // Also check for truncated ellipsis affordance still linked
  const testidLeft = await article.locator('[data-testid="tweet-text-show-more-link"]').count().catch(() => 0);
  if (testidLeft > 0) {
    // one more pass
    try {
      await article.locator('[data-testid="tweet-text-show-more-link"]').first().click({ timeout: 1000 });
      await page.waitForTimeout(500);
    } catch {}
    const still = await article.locator('[data-testid="tweet-text-show-more-link"]').count().catch(() => 0);
    if (still > 0) return { ok: false, reason: "show_more_testid_remains", clicks, remain: still };
  }
  return { ok: true, clicks, remain: 0 };
}

/**
 * Prove X-native FULL datetime is visible in the article.
 * Standing: must be expanded format like "6:39 PM · Aug 26, 2026" (or <time> showing AM/PM).
 * Relative Mon DD alone (timeline / RT cards) is NOT enough — callers should fall back
 * to the embedded original status detail via ensureFullTimestampArticle.
 */
export async function proveNativeTimestamp(page, article) {
  // Scroll lower article (datetime often under media / near engagement)
  try {
    await article.evaluate((art) => art.scrollIntoView({ block: "end", behavior: "instant" }));
  } catch {}
  await page.waitForTimeout(250);

  // Best: visible <time datetime="...">
  let timeCount = await article.locator("time").count().catch(() => 0);
  if (timeCount > 0) {
    try { await article.locator("time").first().scrollIntoViewIfNeeded(); } catch {}
  }
  let timeVisible = false;
  let datetimeAttr = null;
  let timeText = "";
  if (timeCount > 0) {
    try {
      timeVisible = await article.locator("time").first().isVisible({ timeout: 400 });
      datetimeAttr = await article.locator("time").first().getAttribute("datetime");
      timeText = ((await article.locator("time").first().innerText()) || "").trim();
    } catch {}
  }

  const text = await article.innerText().catch(() => "");
  const hasFull =
    /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i.test(text) &&
    (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text) || /·/.test(text));
  const hasMonthDay =
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b/i.test(text);

  // Visible date link/node (logged-out X often uses "Aug 26" without <time>)
  const dateNode = await article.evaluate((art) => {
    const re = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?$/i;
    const reTime = /^\d{1,2}:\d{2}\s*(AM|PM)/i;
    for (const n of art.querySelectorAll("a, span, time")) {
      const t = (n.textContent || "").trim();
      if (!t || t.length > 40) continue;
      if (!(re.test(t) || reTime.test(t) || n.tagName === "TIME")) continue;
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { text: t, tag: n.tagName, href: n.getAttribute("href"), datetime: n.getAttribute("datetime") };
      }
    }
    return null;
  });

  if (dateNode) {
    // Bring date into view for crop
    try {
      await article.locator(`text=${dateNode.text}`).first().scrollIntoViewIfNeeded();
    } catch {}
  }

  // HARD REQUIRE full expanded datetime — Mon DD / dateNode alone fails closed
  const timeShowsFull = timeVisible && /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i.test(timeText || "");
  const ok = hasFull || timeShowsFull;

  if (!ok) {
    return {
      ok: false,
      reason: hasMonthDay || dateNode ? "timestamp_relative_only" : "timestamp_not_visible",
      timeCount,
      timeVisible,
      datetimeAttr,
      timeText,
      hasFull,
      hasMonthDay,
      dateNode,
      sample: text.slice(0, 280).replace(/\s+/g, " "),
    };
  }
  return {
    ok: true,
    timeCount,
    timeVisible,
    datetimeAttr,
    timeText,
    hasFull: true,
    hasMonthDay,
    dateNode,
  };
}



export function statusIdFromUrl(url) {
  const m = String(url || "").match(/status\/(\d+)/i);
  return m ? m[1] : "";
}

export async function findStatusArticle(page, statusUrl) {
  const sid = statusIdFromUrl(statusUrl);
  const articles = page.locator("article");
  const n = await articles.count();
  if (n === 0) return null;
  if (!sid) return articles.first();
  for (let i = 0; i < n; i++) {
    const a = articles.nth(i);
    const hit = await a.locator(`a[href*="/status/${sid}"]`).count().catch(() => 0);
    if (hit > 0) return a;
  }
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

/** Prefer a different /status/ID inside the article (RT/quote → original detail). */
export async function embeddedOriginalStatusUrl(article, statusUrl) {
  const sid = statusIdFromUrl(statusUrl);
  const href = await article.evaluate((art, selfId) => {
    const seen = new Set();
    const out = [];
    for (const a of art.querySelectorAll('a[href*="/status/"]')) {
      const raw = a.getAttribute("href") || "";
      if (/\/photo\/|\/analytics|\/retweets|\/likes|\/quotes/i.test(raw)) continue;
      const m = raw.match(/\/([^\/]+)\/status\/(\d+)/i) || raw.match(/\/status\/(\d+)/i);
      if (!m) continue;
      const id = m[2] || m[1];
      if (selfId && id === selfId) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const abs = raw.startsWith("http") ? raw.split("?")[0] : `https://x.com${raw.split("?")[0]}`;
      // Prefer plain status permalinks
      if (/\/status\/\d+\/?$/.test(abs)) out.unshift(abs);
      else out.push(abs);
    }
    return out[0] || null;
  }, sid);
  return href;
}

/**
 * Expand Show more, prove full AM/PM timestamp; if RT/timeline only has Mon DD,
 * navigate to embedded original status detail and re-prove (fail-closed).
 */
export async function ensureFullTimestampArticle(page, article, statusUrl, { forceDark } = {}) {
  let expand = await expandAllShowMore(page, article);
  if (!expand.ok) {
    return { ok: false, reason: expand.reason || "show_more_unexpanded", article, expand, timestamp: null, navigated: false, url: statusUrl };
  }
  let ts = await proveNativeTimestamp(page, article);
  if (ts.ok && ts.hasFull) {
    return { ok: true, article, expand, timestamp: ts, navigated: false, url: statusUrl };
  }

  const alt = await embeddedOriginalStatusUrl(article, statusUrl);
  if (!alt) {
    return {
      ok: false,
      reason: ts.reason || "timestamp_full_format_required",
      article,
      expand,
      timestamp: ts,
      navigated: false,
      url: statusUrl,
    };
  }

  if (typeof forceDark === "function") await forceDark(page).catch(() => {});
  const resp = await page.goto(alt, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3500);
  if (typeof forceDark === "function") await forceDark(page).catch(() => {});
  await page.waitForSelector("article", { timeout: 25000 }).catch(() => {});
  const next = await findStatusArticle(page, alt);
  if (!next) {
    return {
      ok: false,
      reason: "original_status_no_article",
      article,
      expand,
      timestamp: ts,
      navigated: true,
      url: alt,
      http: resp ? resp.status() : 0,
    };
  }
  expand = await expandAllShowMore(page, next);
  if (!expand.ok) {
    return {
      ok: false,
      reason: expand.reason || "show_more_unexpanded_on_original",
      article: next,
      expand,
      timestamp: null,
      navigated: true,
      url: alt,
    };
  }
  ts = await proveNativeTimestamp(page, next);
  if (!(ts.ok && ts.hasFull)) {
    // one retry
    await expandAllShowMore(page, next);
    await page.waitForTimeout(600);
    ts = await proveNativeTimestamp(page, next);
  }
  if (!(ts.ok && ts.hasFull)) {
    return {
      ok: false,
      reason: ts.reason || "timestamp_full_format_required",
      article: next,
      expand,
      timestamp: ts,
      navigated: true,
      url: alt,
    };
  }
  return { ok: true, article: next, expand, timestamp: ts, navigated: true, url: alt };
}

export async function screenshotArticlePadded(page, article, outPath, opts = {}) {
  const mode = opts.mode || etSsMode();
  let art = article;
  await art.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);

  // STANDING FAIL-CLOSED: expand Show more + FULL native datetime (AM/PM · date) in crop.
  // RT/timeline cards with only Mon DD navigate to embedded original status detail.
  const statusUrl = opts.statusUrl || opts.url || "";
  const ensured = await ensureFullTimestampArticle(page, art, statusUrl, {
    forceDark: forceXDarkTheme,
  });
  if (!ensured.ok) {
    throw new Error(ensured.reason || "timestamp_full_format_required");
  }
  art = ensured.article;
  opts._expand = ensured.expand;
  opts._timestamp = ensured.timestamp;
  opts._resolvedUrl = ensured.url;
  opts._navigatedToOriginal = !!ensured.navigated;

  let result;
  let tighten = { tightened: false };
  if (mode === "pad") {
    const pad = opts.pad != null ? opts.pad : etSsPad();
    result = await computePadClip(page, art, pad);
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    await art.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);

    // Tall/narrow media: reflow so text/metrics match media width (kills right gutter)
    tighten = await tightenTallMedia(page, art);
    await art.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    result = await computeBorderCropClip(page, art, {
      tightened: tighten.tightened,
      forceContentRight: tighten.tightened,
    });

    if (result.clip.y < 0) {
      await page.evaluate((dy) => window.scrollBy(0, dy), result.clip.y - 4);
      await page.waitForTimeout(200);
      result = await computeBorderCropClip(page, art, {
        tightened: tighten.tightened,
        forceContentRight: tighten.tightened,
      });
    }
    const vp = page.viewportSize() || { width: 1200, height: 2000 };
    if (result.clip.height + 20 > vp.height || result.clip.y + result.clip.height > vp.height) {
      await page.setViewportSize({
        width: vp.width,
        height: Math.min(Math.ceil(result.clip.height + result.clip.y + 80), 9000),
      });
      await page.waitForTimeout(250);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      await art.scrollIntoViewIfNeeded();
      result = await computeBorderCropClip(page, art, {
        tightened: tighten.tightened,
        forceContentRight: tighten.tightened,
      });
    }
  }

  const vp = page.viewportSize() || { width: 1200, height: 2000 };
  const clip = {
    x: Math.max(0, result.clip.x),
    y: Math.max(0, result.clip.y),
    width: Math.min(result.clip.width, vp.width - Math.max(0, result.clip.x)),
    height: Math.min(result.clip.height, vp.height - Math.max(0, result.clip.y)),
  };
  if (clip.width < 180 || clip.height < 80) throw new Error("final_clip_too_small");

  await page.screenshot({
    path: outPath,
    type: "png",
    clip,
    animations: "disabled",
  });

  return {
    ...result,
    clip,
    tighten,
    expand: opts._expand || null,
    timestamp: opts._timestamp || null,
    resolvedUrl: opts._resolvedUrl || null,
    navigatedToOriginal: !!opts._navigatedToOriginal,
  };
}
