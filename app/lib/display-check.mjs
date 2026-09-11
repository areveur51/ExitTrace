/** After insert/promote, live list + detail HTML must show the row. Counts are not enough. */

import { categoryById, isGroupOpsKeepKind } from "./categories.mjs";

export class DisplayError extends Error {
  constructor(message, code = "display_failed") {
    super(message);
    this.name = "DisplayError";
    this.code = code;
  }
}

const DEATH_LIST_PATHS = {
  death_celebrity: "/deaths/celebrities",
  death_official: "/deaths/officials",
  death_ceo: "/deaths/ceos",
};

const INDICTMENT_LIST_PATHS = {
  indictment_civilian: "/indictments/civilians",
  indictment_non_civilian: "/indictments/non-civilians",
};

export function listPathForPerson(category) {
  const id = String(category || "").trim();
  if (DEATH_LIST_PATHS[id]) return DEATH_LIST_PATHS[id];
  if (INDICTMENT_LIST_PATHS[id]) return INDICTMENT_LIST_PATHS[id];
  const cat = categoryById(id);
  if (!cat || cat.kind !== "person") {
    throw new DisplayError(
      `no person list page for category: ${id || "(empty)"}`,
      "invalid_list_path",
    );
  }
  if (cat.id === "death_unspecified" || cat.path === "/deaths") {
    throw new DisplayError(
      "/deaths is an empty index; celebrities/officials/ceos are the list pages",
      "deaths_index",
    );
  }
  if (cat.id === "indictment_unspecified" || cat.path === "/indictments") {
    throw new DisplayError(
      "/indictments is an empty index; civilians/non-civilians are the list pages",
      "indictments_index",
    );
  }
  if (cat.id === "group_ops_unspecified" || cat.path === "/group-operations") {
    throw new DisplayError(
      "/group-operations lists every operation; signed tags are the list pages",
      "group_ops_index",
    );
  }
  return cat.path;
}

export function listPathForDog() {
  return "/dog-comms";
}

export function listPathForOperation(operation) {
  if (operation === "group_ops_unspecified") {
    throw new DisplayError(
      "/group-operations lists every operation; signed tags are the list pages",
      "group_ops_index",
    );
  }
  const tags = Array.isArray(operation?.tags)
    ? operation.tags
    : [typeof operation === "string" ? operation : operation?.tags].flat().filter(Boolean);
  for (const id of tags) {
    if (!isGroupOpsKeepKind(id)) continue;
    const cat = categoryById(id);
    if (cat?.path && cat.id !== "group_ops_unspecified") return cat.path;
  }
  throw new DisplayError(
    "/group-operations lists every operation; signed tags are the list pages",
    "group_ops_index",
  );
}

export async function fetchCatalogHtml(pathname) {
  const { handle } = await import("../server.mjs");
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      url: pathname,
      headers: { host: "127.0.0.1" },
      async *[Symbol.asyncIterator]() {},
    };
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      writeHead(status) {
        this.statusCode = status;
      },
      end(chunk) {
        if (chunk) chunks.push(chunk);
        resolve({
          status: this.statusCode || 200,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

function hasPersonOnList(html, person) {
  const href = `/people/${person.id}`;
  const name = String(person.name || "").trim();
  return html.includes(`href="${href}"`) && html.includes(name);
}

function hasPersonOnDetail(html, person) {
  const name = String(person.name || "").trim();
  return (
    html.includes(name) &&
    (html.includes(`href="/people/${person.id}"`) || html.includes(person.id))
  );
}

function hasDogOnList(html, dog) {
  const href = `/dog-comms/${dog.id}`;
  const handle = String(dog.handle || "").trim();
  return html.includes(`href="${href}"`) && html.includes(handle);
}

function hasDogOnDetail(html, dog) {
  const handle = String(dog.handle || "").trim();
  return html.includes(handle) && html.includes(dog.id);
}

function hasOperationOnList(html, operation) {
  const href = `/operations/${operation.id}`;
  const name = String(operation.name || "").trim();
  return html.includes(`href="${href}"`) && html.includes(name);
}

function hasOperationOnDetail(html, operation) {
  const name = String(operation.name || "").trim();
  return (
    html.includes(name) &&
    (html.includes(`href="/operations/${operation.id}"`) || html.includes(operation.id))
  );
}

async function walkListPages(listPath, found) {
  for (let page = 1; page <= 50; page += 1) {
    const path = page === 1 ? listPath : `${listPath}?page=${page}`;
    const res = await fetchCatalogHtml(path);
    if (res.status !== 200) {
      throw new DisplayError(
        `list page ${path} returned ${res.status} (health counts are not enough)`,
        "list_missing",
      );
    }
    if (found(res.body)) return path;
    const pages = res.body.match(/Page \d+ of (\d+)/);
    const totalPages = pages ? Number(pages[1]) : 1;
    if (page >= totalPages) break;
  }
  return null;
}

export async function checkPersonDisplayed(person) {
  if (!person?.id) {
    throw new DisplayError("person id is required for the display check", "missing_person");
  }
  const listPath = listPathForPerson(person.category);
  if (listPath === "/deaths") {
    throw new DisplayError(
      "/deaths is an empty index; celebrities/officials/ceos are the list pages",
      "deaths_index",
    );
  }
  if (listPath === "/indictments") {
    throw new DisplayError(
      "/indictments is an empty index; civilians/non-civilians are the list pages",
      "indictments_index",
    );
  }
  if (listPath === "/group-operations") {
    throw new DisplayError(
      "/group-operations lists every operation; signed tags are the list pages",
      "group_ops_index",
    );
  }
  const list = await walkListPages(listPath, (html) => hasPersonOnList(html, person));
  if (!list) {
    throw new DisplayError(
      `person ${person.id} is not on ${listPath} HTML (health counts are not enough)`,
      "list_missing",
    );
  }
  const detailPath = `/people/${person.id}`;
  const detail = await fetchCatalogHtml(detailPath);
  if (detail.status !== 200 || !hasPersonOnDetail(detail.body, person)) {
    throw new DisplayError(
      `person ${person.id} is not on ${detailPath} HTML (health counts are not enough)`,
      "detail_missing",
    );
  }
  return { list, detail: detailPath };
}

export async function checkDogDisplayed(dog) {
  if (!dog?.id) {
    throw new DisplayError("dog id is required for the display check", "missing_dog");
  }
  const listPath = listPathForDog();
  const list = await walkListPages(listPath, (html) => hasDogOnList(html, dog));
  if (!list) {
    throw new DisplayError(
      `dog ${dog.id} is not on ${listPath} HTML (health counts are not enough)`,
      "list_missing",
    );
  }
  const detailPath = `/dog-comms/${dog.id}`;
  const detail = await fetchCatalogHtml(detailPath);
  if (detail.status !== 200 || !hasDogOnDetail(detail.body, dog)) {
    throw new DisplayError(
      `dog ${dog.id} is not on ${detailPath} HTML (health counts are not enough)`,
      "detail_missing",
    );
  }
  return { list, detail: detailPath };
}

export async function checkOperationDisplayed(operation) {
  if (!operation?.id) {
    throw new DisplayError("operation id is required for the display check", "missing_operation");
  }
  const listPath = listPathForOperation(operation);
  const list = await walkListPages(listPath, (html) => hasOperationOnList(html, operation));
  if (!list) {
    throw new DisplayError(
      `operation ${operation.id} is not on ${listPath} HTML (health counts are not enough)`,
      "list_missing",
    );
  }
  const parent = await walkListPages("/group-operations", (html) =>
    hasOperationOnList(html, operation),
  );
  if (!parent) {
    throw new DisplayError(
      `operation ${operation.id} is not on /group-operations HTML (parent lists every operation)`,
      "list_missing",
    );
  }
  const detailPath = `/operations/${operation.id}`;
  const detail = await fetchCatalogHtml(detailPath);
  if (detail.status !== 200 || !hasOperationOnDetail(detail.body, operation)) {
    throw new DisplayError(
      `operation ${operation.id} is not on ${detailPath} HTML (health counts are not enough)`,
      "detail_missing",
    );
  }
  return { list, detail: detailPath };
}

export async function assertDisplayed(result) {
  if (result?.person) return checkPersonDisplayed(result.person);
  if (result?.dog) return checkDogDisplayed(result.dog);
  if (result?.operation) return checkOperationDisplayed(result.operation);
  throw new DisplayError(
    "insert/promote is not done until list + detail HTML show the row",
    "missing_row",
  );
}
