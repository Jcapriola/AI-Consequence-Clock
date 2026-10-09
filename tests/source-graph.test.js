/*
 * Render tests for the source graph shown on a record card.
 *
 *   node tests/source-graph.test.js
 *
 * Runs js/source-graph.js in a sandbox and reads the markup it returns: one box per
 * source, one line per declared derivation, the verdict evidence.js gave, and nothing
 * from a record unescaped.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const E = require(path.join(__dirname, "..", "js", "evidence.js"));

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "js", "source-graph.js"), "utf8");
const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "incidents.json"), "utf8"));

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
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

const sandbox = { window: { ClockEvidence: E } };
vm.runInNewContext(SOURCE, sandbox);
const section = sandbox.window.ClockSourceGraph.section;
const count = (html, needle) => html.split(needle).length - 1;

const derived = (internal, external) => ({
  kind: "DERIVED",
  derives_from_internal: internal,
  derives_from_external: external,
  note: "Fixture."
});
const ORIGINAL = { kind: "ORIGINAL", derives_from_internal: [], derives_from_external: [], note: null };
const source = (id, publisher, grade, provenance) => ({
  id,
  publisher,
  url: "https://" + id + ".example/x",
  evidence_grade: grade,
  provenance
});

const SHARED = {
  id: "shared",
  sources: [
    source("wire", "Example Wire", "INDEPENDENT_SECONDARY", derived([], ["vendor:acme-post"])),
    source("daily", "Example Daily", "INDEPENDENT_SECONDARY", derived([], ["vendor:acme-post"]))
  ]
};
const CITED = {
  id: "cited",
  sources: [
    source("court", "Example Court", "PRIMARY", ORIGINAL),
    source("daily", "Example Daily", "INDEPENDENT_SECONDARY", derived(["court"], [])),
    source("list", "Example Roundup", "ROUNDUP", undefined)
  ]
};

console.log("Shared outside origin");
const shared = section(SHARED);
check("one box per source, plus the shared origin", count(shared, 'class="roots-box'), 3);
check("one line from each source to the origin", count(shared, "<line "), 2);
check("the two sources sit in a single outline", count(shared, 'class="roots-group"'), 1);
ok("the origin is named", shared.indexOf("vendor:acme-post") !== -1);
ok("the verdict label comes from evidence.js", shared.indexOf(E.verdictDefinition("SINGLE_ROOT").label) !== -1);
ok("the section is closed unless asked", shared.indexOf("<details class=\"roots\">") === 0);
ok("it opens when asked", section(SHARED, true).indexOf("<details class=\"roots\" open>") === 0);

console.log("\nCitation between attached sources");
const cited = section(CITED);
check("one box per source", count(cited, 'class="roots-box'), 3);
check("one curve for the citation", count(cited, "<path "), 1);
check("the roundup is drawn but marked as not counted", count(cited, "NOT COUNTED"), 1);
check("one traced piece of evidence", count(cited, "PIECE OF EVIDENCE"), 1);
ok("the published check shows the publisher count", cited.indexOf("<strong>2 differently named</strong>") !== -1);
ok("the roundup box is dimmed", cited.indexOf("roots-box-weak") !== -1);

console.log("\nFigures and labels come from evidence.js");
dataset.incidents.forEach((record) => {
  const roots = E.sourceRoots(record);
  const html = section(record);
  check(record.id + ": one box per source", count(html, 'class="roots-box'), record.sources.length);
  const traced = roots.components.filter((c) => c.qualifying && !c.untraced).length;
  const untraced = roots.components.filter((c) => c.qualifying && c.untraced).length;
  check(record.id + ": only traced groups are called pieces of evidence", count(html, "PIECE OF EVIDENCE"), traced);
  check(record.id + ": untraced groups say so", count(html, "ORIGIN NOT RECORDED"), untraced);
  ok(record.id + ": no NaN or undefined in the markup", !/NaN|undefined/.test(html));
  ok(
    record.id + ": shows the audit's verdict and publisher count",
    html.indexOf(E.verdictDefinition(roots.verdict).text) !== -1 &&
      html.indexOf("<strong>" + roots.distinct_publisher_count + " differently named</strong>") !== -1
  );
});

console.log("\nLayout");
const many = {
  id: "many",
  sources: [0, 1, 2, 3, 4, 5, 6].map((n) => source("s" + n, "Same Publisher", "PRIMARY", ORIGINAL))
};
const positions = section(many).match(/<rect x="[\d.]+" y="[\d.]+" width="220"/g) || [];
check("seven sources in one root get seven boxes", positions.length, 7);
check("no two boxes share a position", new Set(positions).size, 7);
ok("the drawing has a numeric size", /viewBox="0 0 \d+ \d+"/.test(section(many)));
ok("a traced root is called a piece of evidence", section(many).indexOf("PIECE OF EVIDENCE 1") !== -1);
const unrecorded = section({ id: "u", sources: [source("a", "Alpha", "PRIMARY", undefined)] });
ok("an untraced group is not called a piece of evidence", unrecorded.indexOf("PIECE OF EVIDENCE") === -1);

console.log("\nHostile strings");
const HOSTILE = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
const hostile = section({
  id: HOSTILE,
  sources: [
    {
      id: "a",
      publisher: HOSTILE,
      url: "https://a.example/x",
      evidence_grade: "PRIMARY",
      provenance: derived([], [HOSTILE])
    }
  ]
});
ok("a box was drawn", count(hostile, 'class="roots-box') >= 1);
ok("no img element reaches markup", !/<img/i.test(hostile));
ok("no script element reaches markup", !/<script/i.test(hostile));
ok("the hostile text is shown escaped", hostile.indexOf("&lt;img") !== -1);
ok("quotes are escaped too", hostile.indexOf("&quot;&gt;&lt;img") !== -1);

console.log("\nMalformed records");
ok("a record with no sources says so", section({ id: "x", sources: [] }).indexOf("No sources attached.") !== -1);
ok("a record with no sources field does not throw", section({ id: "x" }).indexOf("<details") === 0);

console.log("\n" + "-".repeat(64));
if (failures.length) {
  console.log("FAILED: " + failures.length + " assertion(s) failed, " + passed + " passed.");
  process.exit(1);
}
console.log("PASSED: " + passed + " assertions.");
