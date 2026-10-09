/*
 * Run: node tests/sensitivity.test.js
 * The sensitivity table must agree with the published rule and keep its own shape.
 */
var fs = require("fs");
var path = require("path");
var S = require(path.join(__dirname, "schema.js"));
var E = require(path.join(__dirname, "..", "js", "evidence.js"));

var db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "incidents.json"), "utf8"));
var records = db.incidents;
var table = E.sensitivityTable(records);
var failures = 0;

function check(name, ok, detail) {
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok || !detail ? "" : "\n        " + detail));
  if (!ok) failures++;
}
function sortedCopy(list) { return list.slice().sort(); }
function row(id) { return table.filter(function (r) { return r.id === id; })[0]; }

var headline = records.filter(E.isHeadlineEligible);
var published = row("R3");
var summary = E.derive(db, db.last_evidence_review);

check(
  "R3 selects exactly the records the published rule selects",
  JSON.stringify(published.ids) === JSON.stringify(sortedCopy(headline.map(function (r) { return r.id; })))
);
check(
  "R3 total equals the published headline count",
  published.total === summary.headline_count,
  "table " + published.total + " vs derive() " + summary.headline_count
);
if (typeof summary.documented_occurrences === "number") {
  check(
    "R3 documented / demonstrated equal the published split",
    published.documented === summary.documented_occurrences &&
      published.demonstrated === summary.demonstrated_capabilities
  );
}

var nested = true;
var nestedDetail = "";
for (var i = 1; i < table.length; i++) {
  table[i - 1].ids.forEach(function (id) {
    if (table[i].ids.indexOf(id) === -1) {
      nested = false;
      nestedDetail = table[i].id + " lost " + id + " held by " + table[i - 1].id;
    }
  });
}
check("each rule contains every record of the previous rule", nested, nestedDetail);

check(
  "totals never decrease down the table",
  table.every(function (r, k) { return k === 0 || r.total >= table[k - 1].total; })
);
check(
  "documented + demonstrated equals the row total in every row",
  table.every(function (r) { return r.documented + r.demonstrated === r.total; })
);
check(
  "R6 holds every record in the file",
  row("R6").total === records.length,
  "R6 " + row("R6").total + " vs " + records.length + " records"
);
check(
  "R6 vocabulary is exactly the schema vocabulary",
  JSON.stringify(sortedCopy(E.RULE_SETS[5].statuses)) === JSON.stringify(sortedCopy(S.ENUMS.verification_status)) &&
    JSON.stringify(sortedCopy(E.RULE_SETS[5].grades)) === JSON.stringify(sortedCopy(S.ENUMS.evidence_grade))
);
check(
  "output does not depend on record order",
  JSON.stringify(E.sensitivityTable(records.slice().reverse())) === JSON.stringify(table)
);

if (failures) {
  console.log("\n" + failures + " check(s) failed");
  process.exit(1);
}
console.log("\nAll sensitivity checks passed.");
