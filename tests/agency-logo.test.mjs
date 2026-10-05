import assert from "node:assert/strict";
import { test } from "node:test";
import { operationLeadAgencyId, operationLeadLogo } from "../app/lib/agency-logo.mjs";
import { operationDetail, operationRow } from "../app/lib/html.mjs";
import { mergeOperationAnnotate, normalizeOperation } from "../app/lib/operation.mjs";

const CASES = [
  [["U.S. Department of Justice", "U.S. Department of Health and Human Services", "Federal Bureau of Investigation"], "fbi"],
  [["DOJ", "HHS-OIG", "FBI", "DEA", "CMS"], "hhs-oig"],
  [["U.S. Department of Justice"], "doj"],
  [["U.S. Department of Justice", "Federal Bureau of Investigation", "U.S. Department of the Treasury"], "fbi"],
  [["U.S. Department of Justice", "U.S. Department of Homeland Security", "U.S. Department of State", "Homeland Security Investigations", "U.S. Customs and Border Protection"], "hsi"],
  [["U.S. Marshals Service", "Bureau of Alcohol", "Tobacco", "Firearms and Explosives", "Drug Enforcement Administration", "Federal Bureau of Investigation", "United States Attorney's Office for the District of Columbia"], "usms"],
  [["FBI", "U.S. Department of Justice", "White House Task Force to Eliminate Fraud"], "fbi"],
  [["U.S. Department of Homeland Security", "U.S. Department of Health and Human Services", "U.S. Department of Justice", "ICE"], "ice"],
  [["New York State Division of Criminal Justice Services Missing Persons Clearinghouse", "New York State Office of Children and Family Services", "National Child Protection Task Force", "New York State Police", "Federal Bureau of Investigation"], "nysp"],
  [["U.S. Department of Justice", "DEA", "Government of Mexico"], "dea"],
  [["ICE", "DHS"], "ice"],
  [["U.S. Department of Justice", "Office of Juvenile Justice and Delinquency Prevention"], "doj"],
  [["U.S. Department of Justice", "Internet Crimes Against Children Task Forces"], "doj"],
  [["Federal Bureau of Investigation", "U.S. Department of Justice"], "fbi"],
  [["U.S. Department of Justice", "Drug Enforcement Administration"], "dea"],
  [["U.S. Department of Justice", "Homeland Security Investigations"], "hsi"],
  [["U.S. Marshals Service", "U.S. Department of Justice"], "usms"],
  [["Department of Justice", "Federal Bureau of Investigation"], "fbi"],
  [["U.S. Attorney's Office Central District of California", "ICE"], "ice"],
  [["Drug Enforcement Administration", "U.S. Department of Justice"], "dea"],
  [["U.S. Department of Justice", "Federal Bureau of Investigation", "Drug Enforcement Administration", "Bureau of Alcohol, Tobacco, Firearms and Explosives", "U.S. Marshals Service"], "fbi"],
  [["ICE", "Homeland Security Investigations", "ATF", "Georgia State Patrol"], "ice"],
  [["U.S. Department of Justice", "U.S. Marshals Service"], "usms"],
  [["U.S. Department of Justice", "U.S. Department of State"], "doj"],
  [["U.S. Department of Justice", "FBI", "Child Exploitation and Obscenity Section", "U.S. Attorney's Offices"], "fbi"],
  [["CBP", "HSI", "NCMEC", "Internet Crimes Against Children Task Force"], "cbp"],
  [["U.S. Department of Justice", "Federal Bureau of Investigation", "U.S. Department of Homeland Security", "U.S. Department of the Treasury", "U.S. Postal Inspection Service"], "fbi"],
  [["U.S. Immigration and Customs Enforcement", "Florida Highway Patrol", "Lee County Sheriff's Office", "U.S. Customs and Border Protection"], "ice"],
  [["Department of Homeland Security"], "dhs"],
  [["Example Clearinghouse"], ""],
  [[], ""],
];

test("lead seal is the first law-enforcement agency, then a department fallback", () => {
  for (const [agencies, id] of CASES) {
    assert.equal(operationLeadAgencyId(agencies), id, agencies.join(" | "));
  }
  const dojOnly = operationLeadLogo(["U.S. Department of Justice"]);
  assert.equal(dojOnly.photo, "/media/agencies/doj.jpg");
  assert.match(dojOnly.photo_credit, /Department of Justice/);
  assert.match(dojOnly.photo_credit, /Wikimedia Commons/);
  assert.doesNotMatch(dojOnly.photo_credit, /https?:\/\//);
  assert.deepEqual(operationLeadLogo(["Example Clearinghouse"]), { photo: "", photo_credit: "" });
});

test("a stored gold still is kept and a screenshot path is not a portrait", () => {
  const kept = normalizeOperation({
    id: "operation-restore-justice",
    name: "Operation Restore Justice",
    agencies: ["FBI"],
    photo: "/media/people/jordan-hale.jpg",
    photo_credit: "Supplied still",
  });
  assert.equal(kept.photo, "/media/people/jordan-hale.jpg");
  assert.equal(kept.photo_credit, "Supplied still");

  const derived = normalizeOperation({
    id: "operation-restore-justice",
    name: "Operation Restore Justice",
    agencies: ["U.S. Department of Justice", "FBI"],
    photo: "/media/screenshots/operations/restore.jpg",
  });
  assert.equal(derived.photo, "/media/agencies/fbi.png");
  assert.match(derived.photo_credit, /Federal Bureau of Investigation/);

  const merged = mergeOperationAnnotate(
    { id: "op", name: "Op", agencies: [] },
    { id: "op", name: "Op", agencies: ["Drug Enforcement Administration"] },
  );
  assert.equal(merged.photo, "/media/agencies/dea.png");
});

test("operation list and detail paint the seal and leave an unmapped card empty", () => {
  const list = operationRow({
    id: "long-island-missing-child-rescue-operation",
    name: "Long Island Missing Child Rescue Operation",
    agencies: [
      "National Child Protection Task Force",
      "New York State Police",
      "Federal Bureau of Investigation",
    ],
  });
  assert.match(list, /\/media\/thumbs\/agencies\/nysp\.jpg\?p=5/);
  assert.doesNotMatch(list, /\/media\/thumbs\/agencies\/fbi/);
  assert.doesNotMatch(list, /class="[^"]*empty-portrait/);

  const detail = operationDetail({
    id: "2026-election-crime-cases",
    name: "2026 Election Crime Cases",
    agencies: ["U.S. Department of Justice"],
    summary: "Roundup.",
  });
  assert.match(detail, /\/media\/agencies\/doj\.jpg\?p=5/);
  assert.match(detail, /data-lightbox="\/media\/agencies\/doj\.jpg"/);
  assert.match(detail, /United States Department of Justice/);
  assert.doesNotMatch(detail, /class="[^"]*empty-portrait/);

  const blank = operationRow({
    id: "unmapped",
    name: "Unmapped",
    agencies: ["National Child Protection Task Force"],
  });
  assert.match(blank, /empty-portrait/);
  assert.doesNotMatch(blank, /\/media\/agencies\//);
});
