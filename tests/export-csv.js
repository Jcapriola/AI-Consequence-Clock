/*
 * Writes data/incidents.csv from data/incidents.json.
 *
 * JSON is the record of truth; this is a convenience for researchers who work in a
 * spreadsheet or in R. It is generated, never edited, and regenerating it is the only
 * supported way to change it.
 *
 * Two rules matter more than the format:
 *
 * 1. Every row carries verification_status, evidence_grade and in_headline_totals. A CSV
 *    stripped of those columns would let a reader total a column of incidents that this
 *    project deliberately does not total. The eligibility flag travels with the row.
 *
 * 2. Money columns stay separate and stay currency-tagged. confirmed and estimated are
 *    never merged into one "cost" column, because a spreadsheet will happily sum a mixed
 *    column and produce a figure no source supports.
 *
 * One consequence worth stating plainly: the per-record flag columns describe every row,
 * including rows the site does not count. Totalling agent_caused over the whole file
 * gives a larger number than the page reports, because the page counts it only within
 * headline-eligible records. Filter on in_headline_totals = yes to reproduce the site.
 *
 *   node tests/export-csv.js
 */

var fs = require("fs");
var path = require("path");
var E = require(path.join(__dirname, "..", "js", "evidence.js"));

var dataPath = path.join(__dirname, "..", "data", "incidents.json");
var outPath = path.join(__dirname, "..", "data", "incidents.csv");
var records = JSON.parse(fs.readFileSync(dataPath, "utf8")).incidents;

/*
 * Excel and Sheets treat a leading =, +, - or @ in a cell as the start of a formula. Our
 * text fields are quoted judicial and vendor prose, so this is a real path to a formula
 * executing in a reader's spreadsheet. Prefixing an apostrophe keeps the cell as text.
 */
function csvCell(value) {
  if (value === null || value === undefined) return "";
  var s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

var COLUMNS = [
  ["id", function (r) { return r.id; }],
  ["title", function (r) { return r.title; }],
  ["incident_date", function (r) { return r.incident_date; }],
  ["disclosure_date", function (r) { return r.disclosure_date; }],
  ["disclosure_year", function (r) { return String(r.disclosure_date || "").slice(0, 4); }],
  ["disclosure_lag_days", function (r) { return r.disclosure_lag_days; }],
  ["verification_status", function (r) { return r.verification_status; }],
  ["evidence_grade", function (r) { return r.evidence_grade; }],
  // Derived by the same function the page uses, so the CSV cannot disagree with the site.
  ["in_headline_totals", function (r) { return E.isHeadlineEligible(r) ? "yes" : "no"; }],
  // exclusion() returns a structured object. Split it across two columns rather than
  // stringifying it, so the reason is filterable and the explanation stays readable.
  ["excluded_because", function (r) { var x = E.exclusion(r); return x ? x.code : ""; }],
  ["exclusion_detail", function (r) { var x = E.exclusion(r); return x ? x.detail : ""; }],
  ["occurrence", function (r) { return E.occurrence(r); }],
  ["country_region", function (r) { return E.geographySupported(r) ? r.country_region : ""; }],
  ["geography_established", function (r) { return E.geographySupported(r) ? "yes" : "no"; }],
  ["sector", function (r) { return r.sector; }],
  ["category", function (r) { return r.category; }],
  ["category_definition", function (r) { return E.vulnerabilityDefinition(r.category) || ""; }],
  ["consequence_class", function (r) { return r.consequence_class; }],
  ["severity", function (r) { return r.severity; }],
  ["reversibility", function (r) { return r.reversibility; }],
  ["causal_role", function (r) { return r.causal_role; }],
  ["agent_caused", function (r) { return E.isAgentCaused(r) ? "yes" : "no"; }],
  ["adversary", function (r) { return r.adversary; }],
  ["unauthorized_claim", function (r) { return r.unauthorized_claim; }],
  ["authorization_evidence", function (r) { return r.authorization_evidence; }],
  ["execution_auth_documented", function (r) { return r.execution_auth_documented; }],
  ["authorization_gap", function (r) { return E.isAuthGap(r) ? "yes" : "no"; }],
  ["money_confirmed_amount", function (r) { return r.financial_loss_confirmed ? r.financial_loss_confirmed.amount : ""; }],
  ["money_confirmed_currency", function (r) { return r.financial_loss_confirmed ? r.financial_loss_confirmed.currency : ""; }],
  ["money_confirmed_note", function (r) { return r.financial_loss_confirmed ? r.financial_loss_confirmed.note : ""; }],
  ["money_estimated_amount", function (r) { return r.financial_loss_estimated ? r.financial_loss_estimated.amount : ""; }],
  ["money_estimated_currency", function (r) { return r.financial_loss_estimated ? r.financial_loss_estimated.currency : ""; }],
  ["money_estimated_note", function (r) { return r.financial_loss_estimated ? r.financial_loss_estimated.note : ""; }],
  ["primary_source_url", function (r) { return r.primary_source_url || ""; }],
  ["source_count", function (r) { return (r.sources || []).length; }],
  ["source_urls", function (r) { return (r.sources || []).map(function (s) { return s.url; }).join(" | "); }],
  ["archived_source_count", function (r) { return (r.sources || []).filter(function (s) { return !!s.archived_url; }).length; }],
  ["archived_urls", function (r) { return (r.sources || []).filter(function (s) { return s.archived_url; }).map(function (s) { return s.archived_url; }).join(" | "); }],
  ["ai_materiality", function (r) { return r.ai_materiality; }],
  ["source_quality_basis", function (r) { return r.source_quality_basis; }],
  ["revision", function (r) { return r.revision; }]
];

var lines = [COLUMNS.map(function (c) { return csvCell(c[0]); }).join(",")];

records.forEach(function (record) {
  lines.push(
    COLUMNS.map(function (c) {
      return csvCell(c[1](record));
    }).join(",")
  );
});

// CRLF is what RFC 4180 specifies and what Excel expects. A UTF-8 BOM keeps non-ASCII
// characters in the judicial citations from being mangled when Excel opens the file.
fs.writeFileSync(outPath, "\ufeff" + lines.join("\r\n") + "\r\n", "utf8");

/*
 * The CSV once wrote empty money columns because it read r.money.confirmed, a field
 * that does not exist. Confirmed CAD 812.02 was on the record and invisible in the
 * spreadsheet. If a confirmed amount is on a record, it must appear in that record's
 * row or this write is a lie.
 */
records.forEach(function (record, i) {
  var row = lines[i + 1];
  var confirmed = record.financial_loss_confirmed;
  if (confirmed && typeof confirmed.amount === "number") {
    if (row.indexOf(csvCell(confirmed.amount)) === -1 || row.indexOf(csvCell(confirmed.currency)) === -1) {
      throw new Error(
        record.id +
          ": confirmed " +
          confirmed.amount +
          " " +
          confirmed.currency +
          " is on the record but missing from the CSV row"
      );
    }
  }
});

console.log("Wrote data/incidents.csv: " + records.length + " rows, " + COLUMNS.length + " columns.");
console.log("Generated file. Edit data/incidents.json and re-run; never edit the CSV.");
