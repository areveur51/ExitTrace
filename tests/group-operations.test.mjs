import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "url";
import path from "path";
import {
  GROUP_OPS_KEEP_IDS,
  IMPORT_CATEGORY_IDS,
  PROMOTE_CATEGORY_IDS,
  catalogListKinds,
  categoryById,
  categoryByPath,
  isGroupOpsCategory,
  isGroupOpsKeepKind,
  isIndexCategory,
  mapImportCategory,
} from "../app/lib/categories.mjs";
import { DisplayError, checkOperationDisplayed, listPathForOperation, listPathForPerson } from "../app/lib/display-check.mjs";
import { operationRow } from "../app/lib/html.mjs";
import {
  PromoteError,
  validateIdentifiedPersonInput,
} from "../app/lib/promote.mjs";
import {
  assertNoNamedChildren,
  validateIdentifiedOperationInput,
} from "../app/lib/operation.mjs";
import { handle } from "../app/server.mjs";
import {
  applyIdentifiedOperation,
  applyIdentifiedPerson,
  countOperations,
  getOperation,
  setMemory,
  loadSeedFile,
} from "../app/lib/store.mjs";
import { operationStanding, operationStandingByTag } from "../app/lib/dashboard.mjs";
import { NEW_PERSON_LOCK } from "./new-person-lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITES = [
  "https://www.example.com/news/restore-justice",
  "https://www.justice.gov/opa/pr/restore-justice",
];
const SOCIAL = [
  "https://x.com/randomuser/status/1234567890123456789",
  "https://twitter.com/someone/status/9876543210987654321",
];

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url: pathname, headers: { host: "127.0.0.1" } };
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      writeHead(status) {
        this.statusCode = status;
      },
      end(body) {
        if (body) chunks.push(body);
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

const OP_LOCK = {
  name: "Operation Restore Justice",
  event_date: "2024-08-01",
  agencies: ["U.S. Department of Justice"],
  summary: "Federal operation recorded by official public cites.",
  tags: ["missing_kids"],
  cite_urls: CITES,
};

test("group-ops IA is an operation lane: parent lists all, child filters by tag", () => {
  const index = categoryByPath("/group-operations");
  const kids = categoryByPath("/group-operations/missing-kids");
  assert.equal(index.id, "group_ops_unspecified");
  assert.equal(index.kind, "operation");
  assert.equal(index.nav, "Operations");
  assert.equal(index.title, "Operations");
  assert.equal(kids.id, "missing_kids");
  assert.equal(kids.kind, "operation");
  assert.equal(kids.nav, "Missing Kids");
  assert.equal(kids.title, "Operations — missing kids");
  assert.deepEqual(GROUP_OPS_KEEP_IDS, [
    "missing_kids",
    "human_smuggling",
    "fugitives",
    "cybercrime",
    "drug_trafficking",
    "violent_crime",
    "fraud",
  ]);
  assert.deepEqual(catalogListKinds("group_ops_unspecified"), [
    "missing_kids",
    "human_smuggling",
    "fugitives",
    "cybercrime",
    "drug_trafficking",
    "violent_crime",
    "fraud",
  ]);
  assert.deepEqual(catalogListKinds("missing_kids"), ["missing_kids"]);
  assert.deepEqual(catalogListKinds("human_smuggling"), ["human_smuggling"]);
  assert.deepEqual(catalogListKinds("fugitives"), ["fugitives"]);
  assert.deepEqual(catalogListKinds("cybercrime"), ["cybercrime"]);
  assert.deepEqual(catalogListKinds("drug_trafficking"), ["drug_trafficking"]);
  assert.deepEqual(catalogListKinds("violent_crime"), ["violent_crime"]);
  assert.deepEqual(catalogListKinds("fraud"), ["fraud"]);
  assert.ok(!PROMOTE_CATEGORY_IDS.includes("missing_kids"));
  assert.ok(!PROMOTE_CATEGORY_IDS.includes("human_smuggling"));
  assert.ok(!PROMOTE_CATEGORY_IDS.includes("fugitives"));
  assert.ok(!PROMOTE_CATEGORY_IDS.includes("cybercrime"));
  assert.ok(!PROMOTE_CATEGORY_IDS.includes("drug_trafficking"));
  assert.ok(!PROMOTE_CATEGORY_IDS.includes("violent_crime"));
  assert.ok(!PROMOTE_CATEGORY_IDS.includes("fraud"));
  assert.ok(!PROMOTE_CATEGORY_IDS.includes("group_ops_unspecified"));
  assert.ok(!IMPORT_CATEGORY_IDS.includes("missing_kids"));
  assert.ok(!IMPORT_CATEGORY_IDS.includes("human_smuggling"));
  assert.ok(!IMPORT_CATEGORY_IDS.includes("fugitives"));
  assert.ok(!IMPORT_CATEGORY_IDS.includes("cybercrime"));
  assert.ok(!IMPORT_CATEGORY_IDS.includes("drug_trafficking"));
  assert.ok(!IMPORT_CATEGORY_IDS.includes("violent_crime"));
  assert.ok(!IMPORT_CATEGORY_IDS.includes("fraud"));
  assert.equal(mapImportCategory("missing_kids"), null);
  assert.equal(mapImportCategory("human_smuggling"), null);
  assert.equal(mapImportCategory("fugitives"), null);
  assert.equal(mapImportCategory("cybercrime"), null);
  assert.equal(mapImportCategory("drug_trafficking"), null);
  assert.equal(mapImportCategory("violent_crime"), null);
  assert.equal(mapImportCategory("fraud"), null);
  assert.equal(isGroupOpsKeepKind("missing_kids"), true);
  assert.equal(isGroupOpsKeepKind("human_smuggling"), true);
  assert.equal(isGroupOpsKeepKind("fugitives"), true);
  assert.equal(isGroupOpsKeepKind("cybercrime"), true);
  assert.equal(isGroupOpsKeepKind("drug_trafficking"), true);
  assert.equal(isGroupOpsKeepKind("violent_crime"), true);
  assert.equal(isGroupOpsKeepKind("fraud"), true);
  assert.equal(isGroupOpsKeepKind("group_ops_unspecified"), false);
  assert.equal(isGroupOpsCategory("missing_kids"), true);
  assert.equal(isGroupOpsCategory("human_smuggling"), true);
  assert.equal(isGroupOpsCategory("fugitives"), true);
  assert.equal(isGroupOpsCategory("cybercrime"), true);
  assert.equal(isGroupOpsCategory("drug_trafficking"), true);
  assert.equal(isGroupOpsCategory("violent_crime"), true);
  assert.equal(isGroupOpsCategory("fraud"), true);
  assert.equal(isGroupOpsCategory("group_ops_unspecified"), true);
  assert.equal(isGroupOpsCategory("death_celebrity"), false);
  assert.equal(isIndexCategory("group_ops_unspecified"), true);
});

test("group-ops routes render empty HUD lists; parent is not a person dump", async () => {
  setMemory(goldSeed());
  const paths = [
    "/group-operations",
    "/group-operations/missing-kids",
    "/group-operations/human-smuggling",
    "/group-operations/fugitives",
    "/group-operations/cybercrime",
    "/group-operations/drug-trafficking",
    "/group-operations/violent-crime",
    "/group-operations/fraud",
  ];
  for (const p of paths) {
    const res = await requestPage(p);
    assert.equal(res.status, 200, p);
    assert.match(res.body, /ExitTrace/);
    assert.match(res.body, /class="tui hud/);
    assert.match(res.body, /class="hud-stage"/);
    assert.match(res.body, /class="pager"/);
    assert.match(res.body, /No rows on this page/);
    assert.doesNotMatch(res.body, /person-card/);
    assert.doesNotMatch(res.body, /widgets\.js/);
    assert.doesNotMatch(res.body, /CLOSE HACK|SAMURAI PROTOCOL|BREACH PROTOCOL/i);
    assert.doesNotMatch(res.body, /Operation Meridian/i);
    assert.doesNotMatch(res.body, /Batman|Warner/i);
    assert.doesNotMatch(res.body, /class="age-filter"/);
  }

  const index = await requestPage("/group-operations");
  assert.match(index.body, /<title>Operations · ExitTrace/);
  assert.match(index.body, /value="\/group-operations\/missing-kids"/);
  assert.match(index.body, /value="\/group-operations\/human-smuggling"/);
  assert.match(index.body, /value="\/group-operations\/fugitives"/);
  assert.match(index.body, /value="\/group-operations\/cybercrime"/);
  assert.match(index.body, /value="\/group-operations\/drug-trafficking"/);
  assert.match(index.body, /value="\/group-operations\/violent-crime"/);
  assert.match(index.body, /value="\/group-operations\/fraud"/);
  assert.match(index.body, />Missing Kids</);
  assert.match(index.body, />Human Smuggling</);
  assert.match(index.body, />Fugitives</);
  assert.match(index.body, />Cybercrime</);
  assert.match(index.body, />Drug Trafficking</);
  assert.match(index.body, />Violent Crime</);
  assert.match(index.body, />Fraud</);
  assert.match(index.body, />All</);
  assert.doesNotMatch(index.body, /Group Operations/);
  assert.doesNotMatch(index.body, />Civilians</);
  assert.doesNotMatch(index.body, /source-card/);
  assert.doesNotMatch(
    index.body,
    /\/group-operations\/(?!missing-kids|human-smuggling|fugitives|cybercrime|drug-trafficking|violent-crime|fraud)/,
  );

  const kids = await requestPage("/group-operations/missing-kids");
  assert.match(kids.body, /<title>Operations — missing kids · ExitTrace/);
  assert.match(kids.body, /data-key="m"/);
  assert.match(kids.body, /href="\/group-operations"/);
  assert.match(kids.body, /value="\/group-operations\/missing-kids"[^>]*selected/);
  assert.match(kids.body, /Missing Kids/);
  assert.doesNotMatch(kids.body, /Group Operations/);
  assert.match(kids.body, /aria-label="Identity filters"/);
  assert.doesNotMatch(kids.body, />Age</);
  assert.doesNotMatch(kids.body, /Age at death/);
  assert.doesNotMatch(kids.body, /href="\/deaths\/celebrities"/);

  const smug = await requestPage("/group-operations/human-smuggling");
  assert.match(smug.body, /<title>Operations — human smuggling · ExitTrace/);
  assert.match(smug.body, /value="\/group-operations\/human-smuggling"[^>]*selected/);
  assert.match(smug.body, /Human Smuggling/);
  assert.doesNotMatch(smug.body, /Group Operations/);
  assert.doesNotMatch(smug.body, /person-card/);

  const fug = await requestPage("/group-operations/fugitives");
  assert.match(fug.body, /<title>Operations — fugitives · ExitTrace/);
  assert.match(fug.body, /value="\/group-operations\/fugitives"[^>]*selected/);
  assert.match(fug.body, /Fugitives/);
  assert.doesNotMatch(fug.body, /Group Operations/);
  assert.doesNotMatch(fug.body, /person-card/);

  const cyber = await requestPage("/group-operations/cybercrime");
  assert.match(cyber.body, /<title>Operations — cybercrime · ExitTrace/);
  assert.match(cyber.body, /value="\/group-operations\/cybercrime"[^>]*selected/);
  assert.match(cyber.body, /Cybercrime/);
  assert.doesNotMatch(cyber.body, /Group Operations/);
  assert.doesNotMatch(cyber.body, /person-card/);

  const drugs = await requestPage("/group-operations/drug-trafficking");
  assert.match(drugs.body, /<title>Operations — drug trafficking · ExitTrace/);
  assert.match(drugs.body, /value="\/group-operations\/drug-trafficking"[^>]*selected/);
  assert.match(drugs.body, /Drug Trafficking/);
  assert.doesNotMatch(drugs.body, /Group Operations/);
  assert.doesNotMatch(drugs.body, /person-card/);

  const violent = await requestPage("/group-operations/violent-crime");
  assert.match(violent.body, /<title>Operations — violent crime · ExitTrace/);
  assert.match(violent.body, /value="\/group-operations\/violent-crime"[^>]*selected/);
  assert.match(violent.body, /Violent Crime/);
  assert.doesNotMatch(violent.body, /Group Operations/);
  assert.doesNotMatch(violent.body, /person-card/);

  const fraud = await requestPage("/group-operations/fraud");
  assert.match(fraud.body, /<title>Operations — fraud · ExitTrace/);
  assert.match(fraud.body, /value="\/group-operations\/fraud"[^>]*selected/);
  assert.match(fraud.body, /Fraud/);
  assert.doesNotMatch(fraud.body, /Group Operations/);
  assert.doesNotMatch(fraud.body, /person-card/);
});

test("home and add nav know Operations; person form omits missing_kids", async () => {
  setMemory(goldSeed());
  const home = await requestPage("/");
  assert.equal(home.status, 200);
  assert.match(home.body, /href="\/group-operations"/);
  assert.match(home.body, /data-key="m"/);
  assert.match(home.body, /\]<\/span> Operations</);

  const add = await requestPage("/add");
  assert.equal(add.status, 200);
  assert.doesNotMatch(add.body, /value="missing_kids"/);
  assert.doesNotMatch(add.body, /value="human_smuggling"/);
  assert.doesNotMatch(add.body, /value="fugitives"/);
  assert.doesNotMatch(add.body, /value="cybercrime"/);
  assert.doesNotMatch(add.body, /value="drug_trafficking"/);
  assert.doesNotMatch(add.body, /value="violent_crime"/);
  assert.doesNotMatch(add.body, /value="fraud"/);
  assert.doesNotMatch(add.body, /value="group_ops_unspecified"/);
  assert.match(add.body, /href="\/add\?mode=operation"/);

  const opAdd = await requestPage("/add?mode=operation");
  assert.equal(opAdd.status, 200);
  assert.match(opAdd.body, /value="operation"/);
  assert.match(opAdd.body, /value="missing_kids"/);
  assert.match(opAdd.body, /value="human_smuggling"/);
  assert.match(opAdd.body, /value="fugitives"/);
  assert.match(opAdd.body, /value="cybercrime"/);
  assert.match(opAdd.body, /value="drug_trafficking"/);
  assert.match(opAdd.body, /value="violent_crime"/);
  assert.match(opAdd.body, /value="fraud"/);
  assert.doesNotMatch(opAdd.body, /value="group_ops_unspecified"/);
  assert.match(opAdd.body, /name="victim_count"/);
  assert.match(opAdd.body, /name="arrest_count"/);
  assert.match(opAdd.body, /Named children are not stored/);
});

test("person classify rejects missing_kids; operation validate fail-closes the index slug", () => {
  assert.throws(
    () =>
      validateIdentifiedPersonInput({
        subject: "Casey Vale",
        event_date: "2024-08-01",
        category: "missing_kids",
        cite_urls: CITES,
      }),
    (err) => err instanceof PromoteError && err.code === "invalid_category",
  );
  const op = validateIdentifiedOperationInput(OP_LOCK);
  assert.deepEqual(op.tags, ["missing_kids"]);
  const smug = validateIdentifiedOperationInput({
    ...OP_LOCK,
    name: "Clan Del Golfo Human Smuggling",
    tags: ["human_smuggling"],
  });
  assert.deepEqual(smug.tags, ["human_smuggling"]);
  const fug = validateIdentifiedOperationInput({
    ...OP_LOCK,
    name: "Operation North Star",
    tags: ["fugitives"],
    arrest_count: 3421,
  });
  assert.deepEqual(fug.tags, ["fugitives"]);
  assert.equal(fug.arrest_count, 3421);
  const cyber = validateIdentifiedOperationInput({
    ...OP_LOCK,
    name: "911 S5 Botnet",
    tags: ["cybercrime"],
  });
  assert.deepEqual(cyber.tags, ["cybercrime"]);
  const drugs = validateIdentifiedOperationInput({
    ...OP_LOCK,
    name: "Sinaloa Cartel Global Operation",
    tags: ["drug_trafficking"],
  });
  assert.deepEqual(drugs.tags, ["drug_trafficking"]);
  const violent = validateIdentifiedOperationInput({
    ...OP_LOCK,
    name: "Operation Legend",
    tags: ["violent_crime"],
  });
  assert.deepEqual(violent.tags, ["violent_crime"]);
  const fraud = validateIdentifiedOperationInput({
    ...OP_LOCK,
    name: "2018 National Health Care Fraud Takedown",
    tags: ["fraud"],
  });
  assert.deepEqual(fraud.tags, ["fraud"]);
  assert.equal(op.victim_count, null);
  assert.equal(op.arrest_count, null);
  assert.throws(
    () =>
      validateIdentifiedOperationInput({
        ...OP_LOCK,
        tags: ["group_ops_unspecified"],
      }),
    (err) => err instanceof PromoteError && err.code === "invalid_tag",
  );
});

test("X and unofficial social are extra only — not operation cites", () => {
  assert.throws(
    () => validateIdentifiedOperationInput({ ...OP_LOCK, cite_urls: SOCIAL }),
    (err) => err instanceof PromoteError && err.code === "cites_floor",
  );
  assert.throws(
    () =>
      validateIdentifiedOperationInput({
        ...OP_LOCK,
        cite_urls: [CITES[0], SOCIAL[0]],
      }),
    (err) => err instanceof PromoteError && err.code === "cites_floor",
  );
});

test("operation insert refuses invented counts and named children", () => {
  assert.throws(
    () => validateIdentifiedOperationInput({ ...OP_LOCK, victim_count: "about 12" }),
    (err) => err instanceof PromoteError && err.code === "invalid_count",
  );
  assert.throws(
    () =>
      validateIdentifiedOperationInput({
        ...OP_LOCK,
        child_names: ["do not store"],
      }),
    (err) => err instanceof PromoteError && err.code === "named_children",
  );
  assert.doesNotThrow(() => assertNoNamedChildren(OP_LOCK));
  const stored = validateIdentifiedOperationInput({
    ...OP_LOCK,
    victim_count: 12,
    arrest_count: 4,
  });
  assert.equal(stored.victim_count, 12);
  assert.equal(stored.arrest_count, 4);
});

test("list paths skip person KEEP for group-ops", () => {
  assert.throws(
    () => listPathForPerson("missing_kids"),
    (err) => err instanceof DisplayError && err.code === "invalid_list_path",
  );
  assert.throws(
    () => listPathForPerson("group_ops_unspecified"),
    (err) => err instanceof DisplayError && err.code === "invalid_list_path",
  );
  assert.throws(
    () => listPathForOperation("group_ops_unspecified"),
    (err) => err instanceof DisplayError && err.code === "group_ops_index",
  );
  assert.equal(
    listPathForOperation({ tags: ["missing_kids"] }),
    "/group-operations/missing-kids",
  );
  assert.equal(
    listPathForOperation({ tags: ["human_smuggling"] }),
    "/group-operations/human-smuggling",
  );
  assert.equal(
    listPathForOperation({ tags: ["fugitives"] }),
    "/group-operations/fugitives",
  );
  assert.equal(
    listPathForOperation({ tags: ["cybercrime"] }),
    "/group-operations/cybercrime",
  );
  assert.equal(
    listPathForOperation({ tags: ["drug_trafficking"] }),
    "/group-operations/drug-trafficking",
  );
  assert.equal(
    listPathForOperation({ tags: ["violent_crime"] }),
    "/group-operations/violent-crime",
  );
  assert.equal(
    listPathForOperation({ tags: ["fraud"] }),
    "/group-operations/fraud",
  );
  assert.equal(categoryById("missing_kids").path, "/group-operations/missing-kids");
  assert.equal(categoryById("human_smuggling").path, "/group-operations/human-smuggling");
  assert.equal(categoryById("fugitives").path, "/group-operations/fugitives");
  assert.equal(categoryById("cybercrime").path, "/group-operations/cybercrime");
  assert.equal(categoryById("drug_trafficking").path, "/group-operations/drug-trafficking");
  assert.equal(categoryById("violent_crime").path, "/group-operations/violent-crime");
  assert.equal(categoryById("fraud").path, "/group-operations/fraud");
});

test("unique operation: parent lists all; child lists the tag; no person card", async () => {
  setMemory(goldSeed());
  const created = await applyIdentifiedOperation(OP_LOCK);
  assert.equal(created.action, "created");
  assert.equal(created.operation.name, "Operation Restore Justice");
  assert.equal(created.operation.event_date, "2024-08-01");
  assert.equal(created.operation.victim_count, null);
  assert.equal(created.operation.arrest_count, null);
  assert.deepEqual(created.operation.tags, ["missing_kids"]);
  assert.equal(created.operation.sources.length, 2);
  assert.equal(await countOperations(), 1);

  const shown = await checkOperationDisplayed(created.operation);
  assert.equal(shown.list, "/group-operations/missing-kids");
  assert.equal(shown.detail, "/operations/operation-restore-justice");

  const list = await requestPage("/group-operations/missing-kids");
  assert.match(list.body, /Operation Restore Justice/);
  assert.match(list.body, /href="\/operations\/operation-restore-justice"/);
  assert.match(list.body, /class="tui-row operation-card/);
  assert.doesNotMatch(list.body, /person-card/);
  assert.doesNotMatch(list.body, /Casey Vale/);
  const index = await requestPage("/group-operations");
  assert.match(index.body, /href="\/operations\/operation-restore-justice"/);
  assert.match(index.body, /Operation Restore Justice/);
  assert.match(index.body, /1 available/);
  const firings = await requestPage("/firings");
  assert.doesNotMatch(firings.body, /href="\/operations\/operation-restore-justice"/);

  const again = await applyIdentifiedOperation({
    ...OP_LOCK,
    event_date: "2024-09-01",
    cite_urls: ["https://www.example.com/news/restore-justice", "https://www.example.org/n/extra"],
  });
  assert.equal(again.action, "annotated");
  assert.equal(again.operation.id, "operation-restore-justice");
  assert.equal(again.operation.event_date, "2024-08-01");
  assert.equal(await countOperations(), 1);

  const detail = await requestPage("/operations/operation-restore-justice");
  assert.equal(detail.status, 200);
  assert.match(detail.body, /Operation Restore Justice/);
  assert.match(detail.body, /U\.S\. Department of Justice/);
});

test("human_smuggling lists on its child path and the parent, not missing-kids", async () => {
  setMemory(goldSeed());
  const created = await applyIdentifiedOperation({
    name: "Clan Del Golfo Human Smuggling",
    event_date: "2024-06-11",
    agencies: ["U.S. Department of Justice", "U.S. Department of State"],
    summary: "Official rewards for information on Clan del Golfo human smuggling leaders.",
    tags: ["human_smuggling"],
    cite_urls: CITES,
  });
  assert.equal(created.action, "created");
  assert.deepEqual(created.operation.tags, ["human_smuggling"]);
  const shown = await checkOperationDisplayed(created.operation);
  assert.equal(shown.list, "/group-operations/human-smuggling");
  assert.equal(shown.detail, "/operations/clan-del-golfo-human-smuggling");
  const list = await requestPage("/group-operations/human-smuggling");
  assert.match(list.body, /Clan Del Golfo Human Smuggling/);
  const kids = await requestPage("/group-operations/missing-kids");
  assert.doesNotMatch(kids.body, /Clan Del Golfo Human Smuggling/);
  const index = await requestPage("/group-operations");
  assert.match(index.body, /Clan Del Golfo Human Smuggling/);
});

test("fraud lists on its child path and the parent, not missing-kids", async () => {
  setMemory(goldSeed());
  const created = await applyIdentifiedOperation({
    name: "2018 National Health Care Fraud Takedown",
    event_date: "2018-06-28",
    agencies: ["U.S. Department of Justice", "U.S. Department of Health and Human Services"],
    summary: "Medicare Fraud Strike Force national health care fraud takedown.",
    tags: ["fraud"],
    cite_urls: CITES,
  });
  assert.equal(created.action, "created");
  assert.deepEqual(created.operation.tags, ["fraud"]);
  const shown = await checkOperationDisplayed(created.operation);
  assert.equal(shown.list, "/group-operations/fraud");
  assert.equal(shown.detail, "/operations/2018-national-health-care-fraud-takedown");
  const list = await requestPage("/group-operations/fraud");
  assert.match(list.body, /2018 National Health Care Fraud Takedown/);
  const kids = await requestPage("/group-operations/missing-kids");
  assert.doesNotMatch(kids.body, /2018 National Health Care Fraud Takedown/);
  const index = await requestPage("/group-operations");
  assert.match(index.body, /2018 National Health Care Fraud Takedown/);
});

test("operation is not a person KEEP annotation", async () => {
  setMemory(goldSeed());
  const arrest = await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: [
      "https://www.example.com/news/casey-vale-held",
      "https://www.example.net/world/casey-vale-arrest",
    ],
  });
  assert.equal(arrest.action, "created");
  assert.throws(
    () =>
      validateIdentifiedPersonInput({
        subject: "Casey Vale",
        event_date: "2024-08-01",
        category: "missing_kids",
        cite_urls: CITES,
      }),
    (err) => err instanceof PromoteError && err.code === "invalid_category",
  );
  const op = await applyIdentifiedOperation(OP_LOCK);
  assert.equal(op.action, "created");
  const vale = await requestPage("/people/casey-vale");
  assert.doesNotMatch(vale.body, /Operations — missing kids/);
  const list = await requestPage("/group-operations/missing-kids");
  assert.doesNotMatch(list.body, /Casey Vale/);
  assert.match(list.body, /Operation Restore Justice/);
});

test("operation cards use initials, not person thumbs", () => {
  const html = operationRow({
    id: "operation-restore-justice",
    name: "Operation Restore Justice",
    event_date: "2024-08-01",
    agencies: ["U.S. Department of Justice"],
    tags: ["missing_kids"],
    victim_count: null,
    arrest_count: null,
  });
  assert.match(html, /class="tui-row operation-card/);
  assert.match(html, /class="initials thumb"/);
  assert.doesNotMatch(html, /person-card/);
  assert.doesNotMatch(html, /\/media\/thumbs\/people\//);
});

test("dashboard standing sums stored counts only and respects date range", async () => {
  setMemory(goldSeed());
  await applyIdentifiedOperation({
    ...OP_LOCK,
    victim_count: 12,
    arrest_count: 3,
  });
  await applyIdentifiedOperation({
    name: "Operation Harbor Sweep",
    event_date: "2018-03-01",
    agencies: ["Department of Homeland Security"],
    summary: "Earlier tagged operation with official cites.",
    tags: ["missing_kids"],
    cite_urls: [
      "https://www.example.com/news/harbor-sweep",
      "https://www.dhs.gov/news/harbor-sweep",
    ],
    victim_count: 4,
    arrest_count: 1,
  });
  const { listOperations } = await import("../app/lib/store.mjs");
  const ops = await listOperations();
  const all = operationStanding(ops);
  assert.equal(all.operations, 2);
  assert.equal(all.victims, 16);
  assert.equal(all.arrests, 4);
  const ytd = operationStanding(ops, { id: "custom", from: "2024-01-01", to: "2024-12-31" });
  assert.equal(ytd.operations, 1);
  assert.equal(ytd.victims, 12);
  assert.equal(ytd.arrests, 3);
  const byTag = operationStandingByTag(ops);
  assert.ok(byTag.byTag.some((r) => r.key === "missing_kids" && r.victims === 16));

  const dash = await requestPage("/dashboard");
  assert.match(dash.body, /Operations standing/);
  assert.match(dash.body, /Victims/);
  assert.match(dash.body, /Arrests/);
  assert.match(dash.body, /Missing Kids/);
});
