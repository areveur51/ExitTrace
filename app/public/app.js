// Local UI only. No third-party embed scripts. No live X, Wikimedia, or news fetches.
document.addEventListener("DOMContentLoaded", () => {
  for (const img of document.querySelectorAll("img.portrait, img.still, img.thumb, img.detail-photo")) {
    img.addEventListener("error", () => {
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

  const THEME_IDS = ["cyberdeck", "phosphor", "greyscale", "stencil"];
  const THEME_KEY = "exittrace-theme";
  const themeButtons = document.querySelectorAll("[data-theme-set]");

  function applyTheme(id) {
    const theme = THEME_IDS.includes(id) ? id : "cyberdeck";
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode / quota */
    }
    for (const btn of themeButtons) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-theme-set") === theme ? "true" : "false");
    }
  }

  try {
    applyTheme(localStorage.getItem(THEME_KEY) || "cyberdeck");
  } catch {
    applyTheme("cyberdeck");
  }
  for (const btn of themeButtons) {
    btn.addEventListener("click", () => applyTheme(btn.getAttribute("data-theme-set")));
  }

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

  const modal = document.getElementById("tui-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");
  const modalOk = document.getElementById("modal-ok");
  let modalHref = "";
  let modalMode = "link";

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    modalHref = "";
    modalMode = "link";
  }

  function escText(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function openModal({ title, bodyHtml, href, mode, toast }) {
    if (!modal || !modalTitle || !modalBody || !modalOk) return;
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modalHref = href || "";
    modalMode = mode || "link";
    modalOk.hidden = !modalHref && mode !== "snapshot";
    modal.hidden = false;
    modalOk.focus();
    if (toast) showToast(toast);
  }

  function confirmModal() {
    if (modalMode === "snapshot") {
      closeModal();
      return;
    }
    if (modalHref) {
      window.open(modalHref, "_blank", "noopener,noreferrer");
    }
    closeModal();
  }

  modalOk?.addEventListener("click", confirmModal);
  modal?.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  function previewSource(src) {
    const label = src.getAttribute("data-label") || src.textContent;
    const title = src.getAttribute("data-title") || "";
    const date = src.getAttribute("data-date") || "";
    const href = src.getAttribute("href") || "";
    openModal({
      title: "Source preview",
      href,
      mode: "link",
      toast: "source preview",
      bodyHtml: `<p><strong>${escText(label)}</strong></p>
        ${title ? `<p>${escText(title)}</p>` : ""}
        ${date ? `<p>${escText(date)}</p>` : ""}
        <p class="cite">Citation only. This app does not fetch the page.</p>
        <p class="cite">${escText(href)}</p>`,
    });
  }

  function previewSnapshot() {
    const store = document.querySelector(".snapshot-store");
    openModal({
      title: "Stored snapshot",
      mode: "snapshot",
      toast: "snapshot opened",
      bodyHtml: store ? store.innerHTML : "<p>No stored snapshot.</p>",
    });
  }

  document.addEventListener(
    "click",
    (e) => {
      const src = e.target.closest?.(".source-link");
      if (src) {
        e.preventDefault();
        e.stopPropagation();
        previewSource(src);
        return;
      }
      const snap = e.target.closest?.("[data-snapshot-open]");
      if (snap) {
        e.preventDefault();
        e.stopPropagation();
        previewSnapshot();
      }
    },
    true,
  );
  for (const a of document.querySelectorAll(".source-link")) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      previewSource(a);
    });
  }
  for (const btn of document.querySelectorAll("[data-snapshot-open]")) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      previewSnapshot();
    });
  }

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
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  }

  document.addEventListener("keydown", (e) => {
    if (typingInField(document.activeElement)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

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
    if (key === "v") {
      const btn = document.querySelector("[data-snapshot-open]");
      if (btn) {
        e.preventDefault();
        btn.click();
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
