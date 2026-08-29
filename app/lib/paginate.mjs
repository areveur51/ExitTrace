/** List-page pagination. Newest-first lists stay shareable via ?page=. */

export const PAGE_SIZE = 10;

export function parsePage(searchParams) {
  const raw =
    searchParams instanceof URLSearchParams
      ? searchParams.get("page")
      : searchParams;
  const n = Number.parseInt(String(raw ?? "1"), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function paginate({ total, page, pageSize = PAGE_SIZE }) {
  const safeSize = Math.max(1, Number(pageSize) || PAGE_SIZE);
  const totalNum = Math.max(0, Number(total) || 0);
  const totalPages = Math.max(1, Math.ceil(totalNum / safeSize) || 1);
  let current = Number.parseInt(page, 10);
  if (!Number.isFinite(current) || current < 1) current = 1;
  if (current > totalPages) current = totalPages;
  return {
    page: current,
    pageSize: safeSize,
    total: totalNum,
    totalPages,
    offset: (current - 1) * safeSize,
    limit: safeSize,
    hasPrev: current > 1,
    hasNext: current < totalPages,
  };
}

export function pageHref(basePath, page) {
  const path = basePath || "/";
  if (!page || page <= 1) return path;
  return `${path}?page=${page}`;
}

/** Compact page list that stays usable as totals grow (1 … 4 5 6 … 40). */
export function pageWindow(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const wanted = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) {
    [1, 2, 3, 4, 5].forEach((n) => wanted.add(n));
  }
  if (current >= total - 2) {
    [total - 4, total - 3, total - 2, total - 1, total].forEach((n) =>
      wanted.add(n),
    );
  }
  return [...wanted]
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
}
