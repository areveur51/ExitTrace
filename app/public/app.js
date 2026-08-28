// Local UI only. No widgets.js, no live X / Wikimedia / news fetches.
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
  for (const row of document.querySelectorAll(".dog-row")) {
    const preview = row.querySelector(".hover-preview");
    if (!preview) continue;
    const show = () => {
      preview.hidden = false;
    };
    const hide = () => {
      if (!row.matches(":hover, :focus-within")) preview.hidden = true;
    };
    row.addEventListener("mouseenter", show);
    row.addEventListener("mouseleave", hide);
    row.addEventListener("focusin", show);
    row.addEventListener("focusout", hide);
  }
});
