/*
 * Sensitivity table tests.
 *
 *   node tests/sensitivity.test.js
 *
 * The table on methodology.html shows what the headline count would be under six rule
 * sets. Its published row must be the published rule, exactly, or the table would be
 * arguing with the page it sits on.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const S = require(path.join(__dirname, "schema.js"));
const E = require(path.join(__dirname, "..", "js", "evidence.js"));

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "incidents.json"), "utf8"));
const expected = JSON.parse(fs.readFileSync(path.join(__dirname, "expected.json"), "utf8"));
const records = dataset.incidents;
const FIXED_TODAY = "2026-09-28";

let passed = 0;
const failures = [];

function check(name, actual, wanted) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(wanted);
  if (a === b) {
    passed += 1;
    console.log("  ok   " + name);
  } else {
    failures.push(name);
    console.log("  FAIL " + name + "\n         expected " + b + "\n         actual   " + a);
  }
}

function ok(name, condition) {
  check(name, !!condition, true);
}

const table = E.sensitivityTable(records);
const row = (id) => table.find((r) => r.id === id);
const summary = E.derive(dataset, FIXED_TODAY);

/* Independent recomputation, deliberately not reusing evidence.js internals. */
const independentHeadline = records
  .filter(
    (r) =>
      ["VERIFIED", "CORROBORATED"].includes(r.verification_status) &&
      ["PRIMARY", "INDEPENDENT_SECONDARY"].includes(r.evidence_grade)
  )
  .map((r) => r.id)
  .sort();

console.log("Published row");
check("R3 selects what an independent filter of the published rule selects", row("R3").ids, independentHeadline);
check("R3 total equals derive()", row("R3").total, summary.headline_count);
check("R3 documented equals derive()", row("R3").documented, summary.documented_occurrences);
check("R3 demonstrated equals derive()", row("R3").demonstrated, summary.demonstrated_capabilities);
check(
  "only R3 is marked published",
  table.filter((r) => r.published).map((r) => r.id),
  ["R3"]
);

console.log("\nShape");
table.forEach((r, i) => {
  if (i > 0) {
    const previous = table[i - 1];
    check(
      r.id + " contains every record of " + previous.id,
      previous.ids.filter((id) => !r.ids.includes(id)),
      []
    );
  }
  check(r.id + ": documented plus demonstrated equals total", r.documented + r.demonstrated, r.total);
  check(r.id + ": id list matches the total", r.ids.length, r.total);
});
check("R6 holds every record in the file", row("R6").total, records.length);

/*
 * R6 claims to be "no filter". If the schema gains a status or grade and R6 does not,
 * the last row silently stops being every record.
 */
const r6 = E.RULE_SETS.find((r) => r.id === "R6");
check("R6 statuses are the schema vocabulary", r6.statuses.slice().sort(), S.ENUMS.verification_status.slice().sort());
check("R6 grades are the schema vocabulary", r6.grades.slice().sort(), S.ENUMS.evidence_grade.slice().sort());
ok(
  "every status and grade present in the data is admitted by R6",
  records.every((r) => r6.statuses.includes(r.verification_status) && r6.grades.includes(r.evidence_grade))
);

check("output does not depend on record order", E.sensitivityTable(records.slice().reverse()), table);

/*
 * The live file holds few of the status and grade combinations, so a wrong rule could
 * still give the right totals. One synthetic record per combination pins every rule.
 */
console.log("\nEvery status and grade combination");
const grid = [];
S.ENUMS.verification_status.forEach((status) => {
  S.ENUMS.evidence_grade.forEach((grade) => {
    grid.push({ id: status + "/" + grade, verification_status: status, evidence_grade: grade });
  });
});
check(
  "totals over the full grid",
  E.sensitivityTable(grid).map((r) => r.id + "=" + r.total),
  ["R1=1", "R2=2", "R3=4", "R4=6", "R5=12", "R6=" + grid.length]
);
check("R1 admits only CORROBORATED with PRIMARY", E.sensitivityTable(grid)[0].ids, ["CORROBORATED/PRIMARY"]);

console.log("\nPinned baseline (tests/expected.json)");
check(
  "pinned sensitivity table",
  table.map((r) => ({
    id: r.id,
    total: r.total,
    documented: r.documented,
    demonstrated: r.demonstrated,
    ids: r.ids
  })),
  expected.sensitivity
);

console.log("\nRegression guard: mutating the data must move the table");
ok("R3 counts at least one record", row("R3").total > 0);
const victim = row("R3").ids[0];
const after = E.sensitivityTable(records.map((r) => (r.id === victim ? { ...r, evidence_grade: "ROUNDUP" } : r)));
const afterRow = (id) => after.find((r) => r.id === id);
check("downgrading a counted record to ROUNDUP lowers R3 by one", afterRow("R3").total, row("R3").total - 1);
check("and leaves R6 unchanged", afterRow("R6").total, row("R6").total);
check(
  "a missing record list gives an empty table, not an error",
  E.sensitivityTable(null).map((r) => r.total),
  E.RULE_SETS.map(() => 0)
);

console.log("\n" + "-".repeat(64));
if (failures.length) {
  console.log("FAILED: " + failures.length + " assertion(s) failed, " + passed + " passed.");
  process.exit(1);
}
console.log("PASSED: " + passed + " assertions.");
