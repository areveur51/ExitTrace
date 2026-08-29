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

  const rows = [...document.querySelectorAll(".tui-row")];
  function selectRow(row) {
    for (const r of rows) r.classList.remove("is-selected");
    if (row) {
      row.classList.add("is-selected");
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest" });
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
