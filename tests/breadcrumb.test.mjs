import assert from "node:assert/strict";
import { test } from "node:test";
import { breadcrumbItems, breadcrumbNav, layout } from "../app/lib/html.mjs";

test("home trail is Home only", () => {
  const items = breadcrumbItems({ path: "/", mode: "home" });
  assert.deepEqual(items, [{ href: "/", label: "Home" }]);
});

test("list pages nest death and indictment indexes", () => {
  assert.deepEqual(breadcrumbItems({ path: "/firings" }), [
    { href: "/", label: "Home" },
    { href: "/firings", label: "Firings" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/corona-comms" }), [
    { href: "/", label: "Home" },
    { href: "/corona-comms", label: "Corona" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/dashboard/reason" }), [
    { href: "/", label: "Home" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/dashboard/reason", label: "Reason" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/dashboard/age" }), [
    { href: "/", label: "Home" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/dashboard/age", label: "Age" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/grokipedia" }), [
    { href: "/", label: "Home" },
    { href: "/search", label: "Search" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/deaths" }), [
    { href: "/", label: "Home" },
    { href: "/deaths", label: "Deaths" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/deaths/celebrities" }), [
    { href: "/", label: "Home" },
    { href: "/deaths", label: "Deaths" },
    { href: "/deaths/celebrities", label: "Celebrities" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/deaths/ceos" }), [
    { href: "/", label: "Home" },
    { href: "/deaths", label: "Deaths" },
    { href: "/deaths/ceos", label: "Executives" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/indictments/non-civilians" }), [
    { href: "/", label: "Home" },
    { href: "/indictments", label: "Indictments" },
    { href: "/indictments/non-civilians", label: "Non-civilians" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/group-operations" }), [
    { href: "/", label: "Home" },
    { href: "/group-operations", label: "Operations" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/group-operations/missing-kids" }), [
    { href: "/", label: "Home" },
    { href: "/group-operations", label: "Operations" },
    { href: "/group-operations/missing-kids", label: "Missing Kids" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/group-operations/human-smuggling" }), [
    { href: "/", label: "Home" },
    { href: "/group-operations", label: "Operations" },
    { href: "/group-operations/human-smuggling", label: "Human Smuggling" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/group-operations/fugitives" }), [
    { href: "/", label: "Home" },
    { href: "/group-operations", label: "Operations" },
    { href: "/group-operations/fugitives", label: "Fugitives" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/group-operations/cybercrime" }), [
    { href: "/", label: "Home" },
    { href: "/group-operations", label: "Operations" },
    { href: "/group-operations/cybercrime", label: "Cybercrime" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/group-operations/drug-trafficking" }), [
    { href: "/", label: "Home" },
    { href: "/group-operations", label: "Operations" },
    { href: "/group-operations/drug-trafficking", label: "Drug Trafficking" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/group-operations/violent-crime" }), [
    { href: "/", label: "Home" },
    { href: "/group-operations", label: "Operations" },
    { href: "/group-operations/violent-crime", label: "Violent Crime" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/group-operations/fraud" }), [
    { href: "/", label: "Home" },
    { href: "/group-operations", label: "Operations" },
    { href: "/group-operations/fraud", label: "Fraud" },
  ]);
});

test("detail pages link back through the parent catalog", () => {
  assert.deepEqual(
    breadcrumbItems({
      path: "/people/james-comey",
      categoryId: "firings",
      label: "James Comey",
    }),
    [
      { href: "/", label: "Home" },
      { href: "/firings", label: "Firings" },
      { href: "/people/james-comey", label: "James Comey" },
    ],
  );
  assert.deepEqual(
    breadcrumbItems({
      path: "/people/casey-vale",
      categoryId: "corona_comms",
      label: "Casey Vale",
    }),
    [
      { href: "/", label: "Home" },
      { href: "/corona-comms", label: "Corona" },
      { href: "/people/casey-vale", label: "Casey Vale" },
    ],
  );
  assert.deepEqual(
    breadcrumbItems({
      path: "/people/mary-tyler-moore",
      categoryId: "death_celebrity",
      label: "Mary Tyler Moore",
    }),
    [
      { href: "/", label: "Home" },
      { href: "/deaths", label: "Deaths" },
      { href: "/deaths/celebrities", label: "Celebrities" },
      { href: "/people/mary-tyler-moore", label: "Mary Tyler Moore" },
    ],
  );
  assert.deepEqual(
    breadcrumbItems({
      path: "/operations/operation-restore-justice",
      categoryId: "missing_kids",
      label: "Operation Restore Justice",
    }),
    [
      { href: "/", label: "Home" },
      { href: "/group-operations", label: "Operations" },
      { href: "/group-operations/missing-kids", label: "Missing Kids" },
      { href: "/operations/operation-restore-justice", label: "Operation Restore Justice" },
    ],
  );
  assert.deepEqual(
    breadcrumbItems({
      path: "/dog-comms/dod-k9-2020",
      label: "@DeptofDefense",
    }),
    [
      { href: "/", label: "Home" },
      { href: "/dog-comms", label: "Dog comms" },
      { href: "/dog-comms/dod-k9-2020", label: "@DeptofDefense" },
    ],
  );
  assert.deepEqual(
    breadcrumbItems({ path: "/posts/abc-1", label: "Source post" }),
    [
      { href: "/", label: "Home" },
      { href: "/unsorted", label: "Unsorted" },
      { href: "/posts/abc-1", label: "Source post" },
    ],
  );
});

test("breadcrumb markup links ancestors and marks the current page", () => {
  const html = breadcrumbNav(
    breadcrumbItems({ path: "/deaths/celebrities" }),
  );
  assert.match(html, /aria-label="Breadcrumb"/);
  assert.match(html, /href="\/"/);
  assert.match(html, /href="\/deaths"/);
  assert.match(html, /aria-current="page">Celebrities/);
  assert.doesNotMatch(html, /href="\/deaths\/celebrities"/);

  const page = layout({
    title: "Firings",
    path: "/firings",
    heading: "Firings",
    body: "<p>list</p>",
  });
  assert.match(page, /class="tui-q crumbs"/);
  assert.match(page, /<a href="\/">Home<\/a>/);
  assert.match(page, /class="tui-app-link" href="\/"/);
});
