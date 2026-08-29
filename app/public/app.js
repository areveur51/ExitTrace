// Local UI only. No third-party embed scripts. No live X, Wikimedia, or news fetches.
document.addEventListener("DOMContentLoaded", () => {
  for (const img of document.querySelectorAll("img.portrait, img.still")) {
    img.addEventListener("error", () => {
      const span = document.createElement("span");
      span.className = "initials";
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

  function setPinned(row, open) {
    const preview = row.querySelector(".hover-preview");
    const toggle = row.querySelector(".dog-row-toggle");
    const hint = row.querySelector(".preview-hint");
    if (!preview) return;
    preview.hidden = !open;
    row.classList.toggle("is-open", open);
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (hint) hint.textContent = open ? "Hide snapshot" : "View snapshot";
  }

  function closePinned(except) {
    for (const row of document.querySelectorAll(".dog-row.is-open")) {
      if (row !== except) setPinned(row, false);
    }
  }

  for (const row of document.querySelectorAll(".dog-row")) {
    const preview = row.querySelector(".hover-preview");
    const toggle = row.querySelector(".dog-row-toggle") || row;
    if (!preview) continue;

    row.addEventListener("mouseenter", () => {
      preview.hidden = false;
    });
    row.addEventListener("mouseleave", () => {
      if (!row.classList.contains("is-open")) preview.hidden = true;
    });
    row.addEventListener("focusin", () => {
      preview.hidden = false;
    });
    row.addEventListener("focusout", (e) => {
      if (!row.contains(e.relatedTarget) && !row.classList.contains("is-open")) {
        preview.hidden = true;
      }
    });
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      const willOpen = !row.classList.contains("is-open");
      closePinned(row);
      setPinned(row, willOpen);
      if (!willOpen) toggle.blur();
    });
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest(".dog-row")) return;
    closePinned(null);
  });
});
