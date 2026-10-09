/*
 * Rendering for the two tables on methodology.html: the sensitivity table and the
 * independence audit.
 *
 * Same contract as js/clock.js: this file owns the DOM and computes nothing. Every
 * figure and label comes from ClockEvidence, and everything is escaped.
 */
(function () {
  "use strict";

  var E = window.ClockEvidence;
  var sensitivity = document.getElementById("sensitivity");
  var audit = document.getElementById("provenance-audit");
  if (!sensitivity && !audit) return;

  var NOT_LOADED = "This table could not be loaded. Try reloading the page.";
  var NOT_DRAWN = "This table could not be shown.";

  function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function num(value) {
    if (value === null || value === undefined) return "-";
    return Number(value).toLocaleString("en-US");
  }

  function countCell(value) {
    return '<td class="n n-headline">' + esc(num(value)) + "</td>";
  }

  function table(className, caption, headings, rows) {
    return (
      '<table class="' + className + '">' +
      "<caption>" +
      esc(caption) +
      "</caption>" +
      "<thead><tr>" +
      headings.join("") +
      "</tr></thead>" +
      "<tbody>" +
      rows.join("") +
      "</tbody>" +
      "</table>"
    );
  }

  function heading(text, numeric) {
    return '<th scope="col"' + (numeric ? ' class="n"' : "") + ">" + esc(text) + "</th>";
  }

  function hint(text) {
    return (
      ' <button type="button" class="hint" aria-label="' + esc(text) + '" data-tip="' + esc(text) + '">?</button>'
    );
  }

  function sensitivityRow(row) {
    return (
      '<tr class="axis-row' +
      (row.published ? " sens-published" : "") +
      '">' +
      '<th scope="row">' +
      esc(row.id) +
      (row.published ? ' <span class="tag tag-in sens-mark">published rule</span>' : "") +
      "</th>" +
      "<td>" +
      esc(row.label) +
      hint(row.rationale) +
      "</td>" +
      countCell(row.total) +
      countCell(row.documented) +
      countCell(row.demonstrated) +
      "</tr>"
    );
  }

  function renderSensitivity(rows) {
    sensitivity.innerHTML = table(
      "axis-table sens-table",
      "What the count would be under each rule",
      [
        heading("Rule"),
        heading("What it admits"),
        heading("Records counted", true),
        heading("Documented occurrences", true),
        heading("Demonstrated capabilities", true)
      ],
      rows.map(sensitivityRow)
    );
  }

  function auditRow(summary, verdict) {
    return (
      '<tr class="axis-row"><th scope="row">' +
      esc(E.verdictDefinition(verdict).label) +
      '<span class="axis-def">' +
      esc(E.verdictDefinition(verdict).text) +
      "</span></th>" +
      countCell(summary.verdicts[verdict]) +
      "</tr>"
    );
  }

  function renderAudit(summary) {
    audit.innerHTML = table(
      "axis-table",
      "Independence audit: " +
        num(summary.total) +
        " counted records, " +
        num(summary.annotated_qualifying_count) +
        " of " +
        num(summary.qualifying_source_count) +
        " sources with their origin recorded",
      [heading("Result"), heading("Counted records", true)],
      E.PROVENANCE_VERDICTS.map(function (verdict) {
        return auditRow(summary, verdict);
      })
    );
  }

  function fail(node, message, err) {
    if (!node) return;
    node.textContent = message;
    console.error("Could not render a methodology table.", err);
  }

  /* One table failing must not take the other down with it. */
  function attempt(node, draw) {
    if (!node) return;
    try {
      draw();
    } catch (err) {
      fail(node, NOT_DRAWN, err);
    }
  }

  fetch("./data/incidents.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (dataset) {
      var records = dataset.incidents;
      attempt(sensitivity, function () {
        renderSensitivity(E.sensitivityTable(records));
      });
      attempt(audit, function () {
        renderAudit(E.provenanceSummary(records));
      });
    })
    .catch(function (err) {
      fail(sensitivity, NOT_LOADED, err);
      fail(audit, NOT_LOADED, err);
    });
})();
