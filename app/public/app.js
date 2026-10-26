// Local UI only. No third-party embed scripts. No live X, Wikimedia, or news fetches.

/** List HTML ships sizes=40px. Cards need the column width before the lazy fetch. */
const RESULT_THUMB_LIST_SIZES = "40px";
const RESULT_THUMB_CARD_SIZES = {
  s: "(max-width: 720px) 46vw, 14rem",
  m: "(max-width: 720px) 72vw, 20rem",
  l: "(max-width: 720px) 92vw, 28rem",
};

function applyResultThumbSizes(view, size) {
  const sizes =
    view === "cards"
      ? RESULT_THUMB_CARD_SIZES[size] || RESULT_THUMB_CARD_SIZES.m
      : RESULT_THUMB_LIST_SIZES;
  // Column masonry reports the wrong distance for lazy images, so a visible
  // card stays blank. Card view loads the row images with the page.
  const loading = view === "cards" ? "eager" : "lazy";
  for (const el of document.querySelectorAll(
    "picture.thumb-src source[srcset], picture.thumb-src img[srcset]",
  )) {
    if (el.getAttribute("sizes") !== sizes) el.setAttribute("sizes", sizes);
  }
  for (const img of document.querySelectorAll("picture.thumb-src img")) {
    if (img.getAttribute("loading") !== loading) img.setAttribute("loading", loading);
  }
}

applyResultThumbSizes(
  document.documentElement.getAttribute("data-results-view") || "list",
  document.documentElement.getAttribute("data-card-size") || "m",
);

document.addEventListener("DOMContentLoaded", () => {
  for (const img of document.querySelectorAll("img.screenshot")) {
    img.addEventListener("error", () => {
      const fig = img.closest(".detail-screenshot");
      if (fig) fig.remove();
      else img.remove();
    });
  }
  for (const img of document.querySelectorAll("img.portrait, img.still, img.thumb, img.detail-photo:not(.screenshot)")) {
    img.addEventListener("error", () => {
      const fallback = img.getAttribute("data-portrait-fallback");
      if (fallback) {
        if (img.dataset.portraitFell === "1") return;
        img.dataset.portraitFell = "1";
        if ((img.getAttribute("src") || "") === fallback) return;
        img.removeAttribute("srcset");
        const picture = img.closest("picture");
        if (picture) {
          for (const source of picture.querySelectorAll("source")) source.remove();
        }
        img.src = fallback;
        return;
      }
      const span = document.createElement("span");
      span.className = img.className.includes("detail-photo")
        ? "initials detail-photo"
        : "initials thumb";
      span.setAttribute("aria-hidden", "true");
      span.textContent = String(img.alt || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "•";
      img.replaceWith(span);
    });
  }

  const toastEl = document.getElementById("tui-toast");
  const toastMsg = toastEl?.querySelector(".toast-msg");
  let toastTimer;
  function showToast(text) {
    if (!toastEl || !toastMsg || !text) return;
    toastMsg.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 2200);
  }
  showToast(document.body.getAttribute("data-toast") || "page loaded");

  const THEME_KEY = "exittrace-theme";
  function lockGlassTheme() {
    document.documentElement.setAttribute("data-theme", "glass");
    try {
      const prev = localStorage.getItem(THEME_KEY);
      if (prev && prev !== "glass") localStorage.removeItem(THEME_KEY);
      localStorage.setItem(THEME_KEY, "glass");
    } catch {
      /* private mode / quota */
    }
  }
  lockGlassTheme();

  const PAGE_SIZES = [17, 34, 51];
  const PAGE_SIZE_KEY = "exittrace-page-size";
  const pageSizeButtons = document.querySelectorAll("[data-page-size-set]");
  const pageSizeSelects = document.querySelectorAll("[data-page-size-select]");

  function applyPageSize(raw) {
    const n = Number.parseInt(String(raw ?? ""), 10);
    const size = PAGE_SIZES.includes(n) ? n : 17;
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      /* private mode / quota */
    }
    document.cookie = `${PAGE_SIZE_KEY}=${size}; Path=/; SameSite=Lax`;
    for (const btn of pageSizeButtons) {
      btn.setAttribute("aria-pressed", Number(btn.getAttribute("data-page-size-set")) === size ? "true" : "false");
    }
    for (const sel of pageSizeSelects) {
      sel.value = String(size);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("page");
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  for (const btn of pageSizeButtons) {
    btn.addEventListener("click", () => applyPageSize(btn.getAttribute("data-page-size-set")));
  }
  for (const sel of pageSizeSelects) {
    sel.addEventListener("change", () => applyPageSize(sel.value));
  }

  const RESULTS_VIEW_KEY = "exittrace-results-view";
  const CARD_SIZE_KEY = "exittrace-card-size";
  const RESULTS_VIEWS = ["list", "cards"];
  const CARD_SIZES = ["s", "m", "l"];
  const viewButtons = document.querySelectorAll("[data-results-view-set]");
  const cardSizeButtons = document.querySelectorAll("[data-card-size-set]");

  function storedChoice(key, allowed, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (allowed.includes(raw)) return raw;
    } catch {
      /* private mode / quota */
    }
    return fallback;
  }

  function storeChoice(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode / quota */
    }
  }

  function syncResultsView(view, size) {
    const nextView = RESULTS_VIEWS.includes(view) ? view : "list";
    const nextSize = CARD_SIZES.includes(size) ? size : "m";
    document.documentElement.setAttribute("data-results-view", nextView);
    document.documentElement.setAttribute("data-card-size", nextSize);
    applyResultThumbSizes(nextView, nextSize);
    for (const btn of viewButtons) {
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-results-view-set") === nextView ? "true" : "false",
      );
    }
    for (const btn of cardSizeButtons) {
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-card-size-set") === nextSize ? "true" : "false",
      );
    }
  }

  if (viewButtons.length || cardSizeButtons.length) {
    const root = document.documentElement;
    const view = RESULTS_VIEWS.includes(root.getAttribute("data-results-view"))
      ? root.getAttribute("data-results-view")
      : storedChoice(RESULTS_VIEW_KEY, RESULTS_VIEWS, "list");
    const size = CARD_SIZES.includes(root.getAttribute("data-card-size"))
      ? root.getAttribute("data-card-size")
      : storedChoice(CARD_SIZE_KEY, CARD_SIZES, "m");
    syncResultsView(view, size);
    for (const btn of viewButtons) {
      btn.addEventListener("click", () => {
        const next = btn.getAttribute("data-results-view-set");
        if (!RESULTS_VIEWS.includes(next)) return;
        storeChoice(RESULTS_VIEW_KEY, next);
        syncResultsView(next, document.documentElement.getAttribute("data-card-size"));
      });
    }
    for (const btn of cardSizeButtons) {
      btn.addEventListener("click", () => {
        const next = btn.getAttribute("data-card-size-set");
        if (!CARD_SIZES.includes(next)) return;
        storeChoice(CARD_SIZE_KEY, next);
        syncResultsView(document.documentElement.getAttribute("data-results-view"), next);
      });
    }
  }

  const DASH_RANGE_KEY = "exittrace-dash-range";
  const DASH_RANGE_IDS = ["all", "30d", "ytd", "since-2017", "custom"];

  function persistDashRange(token) {
    const text = String(token || "").trim();
    if (!text) return;
    try {
      localStorage.setItem(DASH_RANGE_KEY, text);
    } catch {
      /* private mode / quota */
    }
    document.cookie = `${DASH_RANGE_KEY}=${encodeURIComponent(text)}; Path=/; SameSite=Lax`;
  }

  function dashRangeTokenFromHref(href) {
    try {
      const url = new URL(href, window.location.origin);
      const id = url.searchParams.get("range") || "all";
      if (!DASH_RANGE_IDS.includes(id)) return "all";
      if (id !== "custom") return id;
      return `custom:${url.searchParams.get("from") || ""}:${url.searchParams.get("to") || ""}`;
    } catch {
      return "all";
    }
  }

  for (const link of document.querySelectorAll("a[data-dash-range-set]")) {
    link.addEventListener("click", () => persistDashRange(dashRangeTokenFromHref(link.href)));
  }
  for (const form of document.querySelectorAll("form.dash-range-custom")) {
    form.addEventListener("submit", () => {
      const data = new FormData(form);
      const from = String(data.get("from") || "");
      const to = String(data.get("to") || "");
      persistDashRange(`custom:${from}:${to}`);
    });
  }

  function bindDashTips() {
    for (const chart of document.querySelectorAll(".dash-chart")) {
      const tip = chart.querySelector(".dash-tip");
      if (!tip) continue;
      const pts = chart.querySelectorAll("[data-date][data-count]");
      const hide = () => {
        tip.hidden = true;
        tip.textContent = "";
      };
      const show = (pt) => {
        const date = pt.getAttribute("data-date") || "";
        const count = pt.getAttribute("data-count") || "0";
        tip.textContent = `${date} · ${count}`;
        tip.hidden = false;
      };
      for (const pt of pts) {
        pt.addEventListener("pointerenter", () => show(pt));
        pt.addEventListener("pointerleave", hide);
        pt.addEventListener("focus", () => show(pt));
        pt.addEventListener("blur", hide);
      }
    }
  }
  bindDashTips();

  const reduceMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function countUp(el) {
    const raw = el.getAttribute("data-count");
    if (raw === null || raw === "") return;
    const end = Number(raw);
    if (!Number.isFinite(end)) return;
    if (reduceMotion || end <= 0) {
      el.textContent = String(end);
      return;
    }
    const start = performance.now();
    const ms = 700;
    function frame(now) {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) * (1 - t);
      el.textContent = String(Math.round(end * eased));
      if (t < 1) requestAnimationFrame(frame);
    }
    el.textContent = "0";
    requestAnimationFrame(frame);
  }
  for (const el of document.querySelectorAll(".dash-count[data-count]")) countUp(el);

  const modal = document.getElementById("tui-modal");
  const modalOk = document.getElementById("modal-ok");
  let modalHref = "";

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    modalHref = "";
  }

  function confirmModal() {
    if (modalHref) {
      window.open(modalHref, "_blank", "noopener,noreferrer");
    }
    closeModal();
  }

  modalOk?.addEventListener("click", confirmModal);
  modal?.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  const lightbox = document.getElementById("tui-lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxVideo = document.getElementById("lightbox-video");
  const lightboxTitle = document.getElementById("lightbox-title");

  function stopLightboxVideo() {
    if (!lightboxVideo) return;
    lightboxVideo.pause();
    lightboxVideo.removeAttribute("src");
    lightboxVideo.removeAttribute("poster");
    lightboxVideo.hidden = true;
    lightboxVideo.load();
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    stopLightboxVideo();
    if (lightboxImg) {
      lightboxImg.hidden = false;
      lightboxImg.removeAttribute("src");
      lightboxImg.alt = "";
    }
    if (lightboxTitle) lightboxTitle.textContent = "";
  }

  function openLightbox({ src, alt, credit, kind, poster }) {
    if (!lightbox || !lightboxImg || !src) return;
    const video = kind === "video" && lightboxVideo;
    if (lightboxTitle) lightboxTitle.textContent = credit || alt || "";
    if (video) {
      lightboxImg.hidden = true;
      lightboxImg.removeAttribute("src");
      lightboxVideo.hidden = false;
      lightboxVideo.poster = poster || "";
      lightboxVideo.src = src;
      lightbox.hidden = false;
      lightboxVideo.focus();
      lightboxVideo.play().catch(() => {});
      showToast("video opened");
      return;
    }
    stopLightboxVideo();
    lightboxImg.hidden = false;
    lightboxImg.src = src;
    lightboxImg.alt = alt || "";
    lightbox.hidden = false;
    lightbox.querySelector("[data-close-lightbox]")?.focus();
    showToast("image opened");
  }

  lightbox?.querySelectorAll("[data-close-lightbox]").forEach((el) => {
    el.addEventListener("click", closeLightbox);
  });

  for (const video of document.querySelectorAll(".post-shot-media video")) {
    const ready = () => video.classList.add("is-ready");
    if (video.readyState >= 2) ready();
    else video.addEventListener("loadeddata", ready, { once: true });
  }

  document.addEventListener(
    "click",
    (e) => {
      const shot = e.target.closest?.(".lightbox-open");
      if (shot) {
        e.preventDefault();
        e.stopPropagation();
        openLightbox({
          src: shot.getAttribute("data-lightbox") || "",
          alt: shot.getAttribute("data-lightbox-alt") || "",
          credit: shot.getAttribute("data-lightbox-credit") || "",
          kind: shot.getAttribute("data-lightbox-kind") || "",
          poster: shot.getAttribute("data-lightbox-poster") || "",
        });
      }
    },
    true,
  );

  const rows = [...document.querySelectorAll(".tui-row")];
  function selectRow(row) {
    for (const r of rows) r.classList.remove("is-selected");
    if (row) {
      row.classList.add("is-selected");
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest" });
      const idx = rows.indexOf(row) + 1;
      for (const el of document.querySelectorAll("[data-list-pos]")) {
        el.textContent = `${idx}/${rows.length}`;
      }
    }
  }

  for (const row of rows) {
    row.addEventListener("mouseenter", () => selectRow(row));
    row.addEventListener("focus", () => selectRow(row));
  }

  function typingInField(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
  }

  function catalogFilterPath(raw) {
    const value = String(raw || "");
    return value.startsWith("/") && !value.startsWith("//") ? value : "";
  }

  for (const sel of document.querySelectorAll("[data-filter-select]")) {
    sel.addEventListener("change", () => {
      const href = catalogFilterPath(sel.value);
      if (href) window.location.assign(href);
    });
  }

  document.addEventListener("keydown", (e) => {
    if (typingInField(document.activeElement)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (lightbox && !lightbox.hidden) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLightbox();
      }
      return;
    }

    if (!modal?.hidden) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      } else if (e.key === "Enter") {
        e.preventDefault();
        confirmModal();
      }
      return;
    }

    const key = e.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      const cur = rows.findIndex((r) => r.classList.contains("is-selected"));
      const next =
        key === "ArrowDown"
          ? Math.min(rows.length - 1, (cur < 0 ? -1 : cur) + 1)
          : Math.max(0, (cur < 0 ? 0 : cur) - 1);
      selectRow(rows[next]);
      return;
    }
    if (key === "Enter") {
      const sel = document.querySelector(".tui-row.is-selected");
      if (sel && sel.href) {
        e.preventDefault();
        window.location.href = sel.href;
      }
      return;
    }

    const chip = document.querySelector(`.keychip[data-key="${CSS.escape(key)}"]`);
    if (chip && chip.href) {
      e.preventDefault();
      window.location.href = chip.href;
    }
  });
});

/**
 * Tag search (home and /search). Pure helpers first, then the binder.
 * Chip picks, Match, Clear and back/forward run here with NO network request:
 * counts come from the inline [data-tf-data] mask payload the page shipped with.
 * Only the form submit navigates (one /search request, the limited one).
 */
const ET_TAG_SEARCH = {
  parse(search, ids) {
    const params = new URLSearchParams(search || "");
    const known = new Set(ids || []);
    const tags = [];
    const raw = params.getAll("tags").slice(0, 32).join(",");
    if (raw.length <= 1024) {
      for (const tok of raw.split(",").slice(0, 32)) {
        const id = tok.trim().toLowerCase().replace(/-/g, "_");
        if (known.has(id) && !tags.includes(id)) tags.push(id);
      }
    }
    tags.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    const match = String(params.get("match") || "").trim().toLowerCase() === "any" ? "any" : "all";
    return { q: (params.get("q") || "").trim(), tags, match };
  },
  href(base, state, ids) {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    const known = new Set(ids || []);
    const tags = (state.tags || []).filter((id) => known.has(id));
    if (tags.length) {
      params.set("tags", tags.join(","));
      params.set("match", state.match === "any" ? "any" : "all");
    }
    const qs = params.toString().replace(/%2C/g, ",");
    return qs ? `${base}?${qs}` : base;
  },
  count(data, tags, match) {
    let want = 0;
    for (const id of new Set(tags || [])) {
      const i = (data.ids || []).indexOf(id);
      if (i >= 0) want += 2 ** i;
    }
    if (!want) return 0;
    let n = 0;
    for (const [m, people] of data.masks || []) {
      const hit = m & want;
      if (match === "any" ? hit !== 0 : hit === want) n += people;
    }
    return n;
  },
};

function bindTagSearch() {
  const root = document.querySelector("[data-tag-filter]");
  const form = root && root.closest("form");
  const dataEl = root && root.querySelector("[data-tf-data]");
  if (!root || !form || !dataEl) return;
  let data;
  try {
    data = JSON.parse(dataEl.textContent || "{}");
  } catch {
    return;
  }
  const ids = Array.isArray(data.ids) ? data.ids : [];
  const base = root.getAttribute("data-tf-base") === "/" ? "/" : "/search";
  const applied = root.getAttribute("data-tf-applied") || "";
  const details = root.querySelector("[data-tf-add]");
  const findWrap = root.querySelector("[data-tf-find-wrap]");
  const find = root.querySelector("[data-tf-find]");
  const opts = [...root.querySelectorAll("[data-tf-opt]")];
  const boxes = opts.map((o) => o.querySelector('input[name="tags"]'));
  const radios = [...root.querySelectorAll('input[name="match"]')];
  const chipsRow = root.querySelector("[data-tf-chips]");
  const clear = root.querySelector("[data-tf-clear]");
  const countEl = root.querySelector("[data-tf-count]");
  const nEl = root.querySelector("[data-tf-n]");
  const nounEl = root.querySelector("[data-tf-noun]");
  const qInput = form.querySelector('input[name="q"]');
  const labelOf = (id) => {
    const box = boxes.find((b) => b && b.value === id);
    const t = box && box.closest("[data-tf-opt]").querySelector(".tf-opt-t");
    return t ? t.textContent : id;
  };
  // URL keyword: the q the page was loaded with (typed text only goes out on submit).
  const urlQ = () => ET_TAG_SEARCH.parse(location.search, ids).q;
  const state = () => ({
    q: base === "/search" ? urlQ() : "",
    tags: boxes.filter((b) => b && b.checked).map((b) => b.value),
    match: (radios.find((r) => r.checked) || {}).value === "any" ? "any" : "all",
  });
  if (findWrap) findWrap.hidden = false;
  // The submit (or Enter) builds the canonical /search URL: one /search request.
  // Chips and Match update the live count and the URL locally.
  function render() {
    const s = state();
    for (const o of opts) {
      const box = o.querySelector("input");
      o.classList.toggle("is-on", Boolean(box && box.checked));
    }
    for (const r of radios) r.closest(".tf-radio")?.classList.toggle("is-on", r.checked);
    for (const chip of [...chipsRow.querySelectorAll("[data-tf-chip]")]) chip.remove();
    for (const id of s.tags) {
      const chip = document.createElement("span");
      chip.className = "tf-chip";
      chip.setAttribute("data-tf-chip", id);
      chip.textContent = labelOf(id);
      const x = document.createElement("a");
      x.className = "tf-chip-x";
      x.setAttribute("data-tf-remove", id);
      x.setAttribute("aria-label", `Remove ${labelOf(id)}`);
      x.href = ET_TAG_SEARCH.href(base, { ...s, tags: s.tags.filter((t) => t !== id) }, ids);
      x.textContent = "✕";
      chip.appendChild(x);
      chipsRow.insertBefore(chip, clear);
    }
    if (clear) clear.href = ET_TAG_SEARCH.href(base, { q: s.q, tags: [] }, ids);
    chipsRow.hidden = !s.tags.length;
    const n = ET_TAG_SEARCH.count(data, s.tags, s.match);
    if (nEl) nEl.textContent = String(n);
    if (nounEl) nounEl.textContent = n === 1 ? "person matches" : "people match";
    if (countEl) countEl.hidden = !s.tags.length || !Array.isArray(data.masks);
    const pending = base === "/search" && ET_TAG_SEARCH.href("/search", s, ids) !== applied;
    document.documentElement.toggleAttribute("data-tf-pending", pending);
  }
  function pushUrl() {
    const url = ET_TAG_SEARCH.href(base, state(), ids);
    if (url !== `${location.pathname}${location.search}`) history.pushState({ tf: 1 }, "", url);
  }
  function setFrom(search) {
    const s = ET_TAG_SEARCH.parse(search, ids);
    for (const b of boxes) if (b) b.checked = s.tags.includes(b.value);
    for (const r of radios) r.checked = r.value === s.match;
    render();
  }
  for (const b of boxes) b?.addEventListener("change", () => { render(); pushUrl(); });
  for (const r of radios) r.addEventListener("change", () => { render(); pushUrl(); });
  root.addEventListener("click", (e) => {
    const x = e.target.closest("[data-tf-remove]");
    if (x) {
      e.preventDefault();
      const box = boxes.find((b) => b && b.value === x.getAttribute("data-tf-remove"));
      if (box) box.checked = false;
      render();
      pushUrl();
      return;
    }
    if (e.target.closest("[data-tf-clear]")) {
      e.preventDefault();
      for (const b of boxes) if (b) b.checked = false;
      render();
      pushUrl();
    }
  });
  find?.addEventListener("input", () => {
    const needle = find.value.trim().toLowerCase();
    for (const o of opts) o.hidden = Boolean(needle) && !(o.getAttribute("data-tf-find-text") || "").includes(needle);
  });
  find?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });
  details?.addEventListener("toggle", () => {
    if (details.open && find && window.matchMedia("(hover: hover)").matches) find.focus();
  });
  document.addEventListener("click", (e) => {
    if (details?.open && !details.contains(e.target)) details.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && details?.open) {
      details.open = false;
      details.querySelector("summary")?.focus();
    }
  });
  window.addEventListener("popstate", () => setFrom(location.search));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const s = state();
    s.q = qInput ? qInput.value.trim() : "";
    window.location.assign(ET_TAG_SEARCH.href("/search", s, ids));
  });
  render();
}

document.addEventListener("DOMContentLoaded", bindTagSearch);
