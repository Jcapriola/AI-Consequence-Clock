/*
 * Prints the independence audit of data/incidents.json and the annotation backlog.
 *
 *   node scripts/provenance-report.js [path to a dataset file]
 *
 * A reading aid for whoever annotates sources, not a published figure. Every count
 * comes from js/evidence.js, and the output depends only on the data file.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const E = require(path.join(__dirname, "..", "js", "evidence.js"));

const line = (label, value) => console.log("  " + label.padEnd(40) + ": " + value);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function printAudit(summary) {
  console.log("INDEPENDENCE AUDIT");
  console.log("Records counted by the published rule: " + summary.total + "\n");
  E.PROVENANCE_VERDICTS.forEach((verdict) => line(E.verdictDefinition(verdict).label, summary.verdicts[verdict]));
}

function printCoverage(summary) {
  console.log("\nANNOTATION COVERAGE (counted records)");
  line("Qualifying sources", summary.qualifying_source_count);
  line("Qualifying sources annotated", summary.annotated_qualifying_count);
  line("Sources pending annotation", summary.pending_source_count);
}

function pendingEntries(records) {
  return records
    .map((record) => ({ record, counted: E.isHeadlineEligible(record), roots: E.sourceRoots(record) }))
    .filter((entry) => entry.roots.pending_sources.length > 0)
    .sort(
      (a, b) =>
        Number(b.counted) - Number(a.counted) ||
        b.roots.qualifying_source_count - a.roots.qualifying_source_count ||
        compare(a.roots.id, b.roots.id)
    );
}

function printSource(source) {
  const id = typeof source.id === "string" ? source.id : "(no id)";
  console.log("      " + id.padEnd(10) + " " + String(source.evidence_grade).padEnd(22) + " " + source.publisher);
  console.log("          " + source.url);
}

function printPending(entries) {
  console.log("\nPENDING (counted records first, then most qualifying sources, then id)");
  if (!entries.length) console.log("  none");
  entries.forEach(({ record, counted, roots }) => {
    const state = (counted ? "counted" : "not counted") + ", " + record.verification_status;
    console.log("\n  [" + roots.id + "]  " + state + ', "' + record.title + '"');
    roots.pending_sources.forEach(printSource);
  });
}

function printAlerts(summary) {
  console.log("\nDATA QUALITY ALERTS (counted records)");
  line("Qualifying sources with no publisher", summary.missing_publisher_count);
}

const DATA_PATH = process.argv[2] || path.join(__dirname, "..", "data", "incidents.json");
const dataset = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const records = dataset.incidents || [];
const summary = E.provenanceSummary(records);

printAudit(summary);
printCoverage(summary);
printPending(pendingEntries(records));
printAlerts(summary);
