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
  for (const el of document.querySelectorAll(
    "picture.thumb-src source[srcset], picture.thumb-src img[srcset]",
  )) {
    if (el.getAttribute("sizes") !== sizes) el.setAttribute("sizes", sizes);
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
    const url = new URL(window.location.href);
    url.searchParams.delete("page");
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  for (const btn of pageSizeButtons) {
    btn.addEventListener("click", () => applyPageSize(btn.getAttribute("data-page-size-set")));
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
