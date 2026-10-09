/*
 * Render tests for the sensitivity table and the independence audit on methodology.html.
 *
 *   node tests/methodology-render.test.js
 *
 * Runs js/methodology.js against stand-in DOM nodes, so the page's promises are checked
 * without a browser: the figures shown are the figures evidence.js computed, nothing
 * reaches markup unescaped, and a failure leaves a readable message and no table.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const E = require(path.join(__dirname, "..", "js", "evidence.js"));

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "js", "methodology.js"), "utf8");
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

/* As in a real DOM, writing text discards the markup and writing markup discards the text. */
function fakeNode() {
  let html = "";
  let text = "";
  return {
    get innerHTML() { return html; },
    set innerHTML(value) { html = String(value); text = ""; },
    get textContent() { return text; },
    set textContent(value) { text = String(value); html = ""; }
  };
}

/*
 * Runs the page script once against the given node ids and resolves with those nodes.
 * `prelude` runs first inside the same sandbox, to tamper with its built-ins.
 */
function run(evidence, fetchImpl, ids, prelude) {
  const nodes = {};
  (ids || ["sensitivity", "provenance-audit"]).forEach((id) => (nodes[id] = fakeNode()));
  const context = {
    window: { ClockEvidence: evidence },
    document: { getElementById: (id) => nodes[id] || null },
    fetch: fetchImpl,
    console: { error: () => {} }
  };
  vm.runInNewContext((prelude || "") + SOURCE, context);
  const done = { sensitivity: nodes.sensitivity, audit: nodes["provenance-audit"] };
  return new Promise((resolve) => setImmediate(() => setImmediate(() => resolve(done))));
}

const served = (body) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const notFound = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });

const bodyRows = (html) => (html.split("<tbody>")[1] || "").split("</tbody>")[0].match(/<tr[\s\S]*?<\/tr>/g) || [];
const figures = (rowHtml) =>
  (rowHtml.match(/<td class="n[^"]*">([^<]*)<\/td>/g) || []).map((cell) => cell.replace(/<[^>]+>/g, ""));
const count = (html, needle) => html.split(needle).length - 1;
const rowCount = (node) => bodyRows(node.innerHTML).length;
const RULES = E.RULE_SETS.length;
const VERDICTS = E.PROVENANCE_VERDICTS.length;
const shown = (value) => Number(value).toLocaleString("en-US");
const showsMessageOnly = (node) => node.textContent.length > 10 && node.innerHTML === "";

async function main() {
  console.log("Sensitivity table");
  const table = E.sensitivityTable(dataset.incidents);
  const live = await run(E, served(dataset));
  const rows = bodyRows(live.sensitivity.innerHTML);
  const publishedRow = rows[table.findIndex((r) => r.published)];

  check("one row per rule", rows.length, RULES);
  check("the published mark appears exactly once", count(live.sensitivity.innerHTML, "sens-mark"), 1);
  check("the published row class appears exactly once", count(live.sensitivity.innerHTML, "sens-published"), 1);
  ok("the marked row is R3", /sens-published/.test(publishedRow) && />R3 </.test(publishedRow));
  check("five column headers carry scope=col", count(live.sensitivity.innerHTML, '<th scope="col"'), 5);
  ok("the table has a caption", /<caption>[^<]+<\/caption>/.test(live.sensitivity.innerHTML));
  table.forEach((r, i) => {
    ok(r.id + " shows its label", rows[i].indexOf(r.label) !== -1);
    ok(
      r.id + " carries its description for sight and for screen readers",
      rows[i].indexOf('aria-label="' + r.rationale + '"') !== -1 &&
        rows[i].indexOf('data-tip="' + r.rationale + '"') !== -1
    );
    check(
      r.id + ": total, documented, demonstrated are the evidence.js figures",
      figures(rows[i]),
      [shown(r.total), shown(r.documented), shown(r.demonstrated)]
    );
  });

  console.log("\nIndependence audit");
  const summary = E.provenanceSummary(dataset.incidents);
  const auditRows = bodyRows(live.audit.innerHTML);
  check("one row per verdict", auditRows.length, VERDICTS);
  E.PROVENANCE_VERDICTS.forEach((verdict, i) => {
    const row = auditRows[i];
    ok(verdict + " labels its own row", row.indexOf(">" + E.verdictDefinition(verdict).label + "<") !== -1);
    ok(verdict + " carries the evidence.js description", row.indexOf(E.verdictDefinition(verdict).text) !== -1);
    check(verdict + ": the figure is the evidence.js figure", figures(row), [shown(summary.verdicts[verdict])]);
  });
  const coverage =
    shown(summary.total) +
    " counted records, " +
    shown(summary.annotated_qualifying_count) +
    " of " +
    shown(summary.qualifying_source_count) +
    " sources with their origin recorded";
  ok("the caption states the counted set and the annotation coverage", live.audit.innerHTML.indexOf(coverage) !== -1);

  console.log("\nHostile strings");
  const HOSTILE = '<img src=x onerror="alert(1)">';
  const hostileEvidence = {
    sensitivityTable: () => [
      {
        id: HOSTILE,
        label: "<script>alert(2)</script>",
        rationale: "'\"><svg onload=alert(3)>",
        published: true,
        total: 4,
        documented: 1,
        demonstrated: 3,
        ids: []
      }
    ],
    provenanceSummary: () => ({
      total: 9,
      annotated_qualifying_count: 0,
      qualifying_source_count: 0,
      verdicts: { [HOSTILE]: 1 }
    }),
    PROVENANCE_VERDICTS: [HOSTILE],
    verdictDefinition: () => ({ label: HOSTILE, text: "<script>alert(5)</script>" })
  };
  const hostile = await run(hostileEvidence, served({ incidents: [] }));
  ok("the sensitivity table rendered a row", bodyRows(hostile.sensitivity.innerHTML).length === 1);
  ok("the audit rendered a row", bodyRows(hostile.audit.innerHTML).length === 1);
  [hostile.sensitivity, hostile.audit].forEach((node, i) => {
    const where = i === 0 ? "sensitivity table" : "audit";
    ok("no img element reaches the " + where, !/<img/i.test(node.innerHTML));
    ok("no script element reaches the " + where, !/<script/i.test(node.innerHTML));
    ok("no svg element reaches the " + where, !/<svg/i.test(node.innerHTML));
  });
  ok(
    "a quote cannot close the tooltip attributes",
    hostile.sensitivity.innerHTML.indexOf('data-tip="&#39;&quot;&gt;&lt;svg') !== -1
  );
  ok(
    "the hostile text is shown escaped",
    hostile.sensitivity.innerHTML.indexOf("&lt;script&gt;alert(2)&lt;/script&gt;") !== -1
  );

  /* Number formatting that returns markup, so the escape applied to figures is what is tested. */
  const hostileFormat = 'Number.prototype.toLocaleString = function () { return "<b>4</b>"; };\n';
  const figureRun = await run(E, served(dataset), null, hostileFormat);
  ok("a figure cannot carry markup into the sensitivity table", !/<b>/.test(figureRun.sensitivity.innerHTML));
  ok("a figure cannot carry markup into the audit", !/<b>/.test(figureRun.audit.innerHTML));
  ok("the figure text is shown escaped", figureRun.sensitivity.innerHTML.indexOf("&lt;b&gt;4&lt;/b&gt;") !== -1);

  console.log("\nFailed load");
  const rejected = await run(E, () => Promise.reject(new Error("network down")));
  ok("rejected fetch leaves a message and no table", showsMessageOnly(rejected.sensitivity));
  ok("rejected fetch leaves a message and no table in the audit", showsMessageOnly(rejected.audit));
  const missing = await run(E, notFound);
  ok("HTTP 404 leaves a message and no table", showsMessageOnly(missing.sensitivity));
  ok("HTTP 404 leaves a message and no table in the audit", showsMessageOnly(missing.audit));

  console.log("\nThe two tables fail independently");
  const boom = () => {
    throw new Error("derivation failed");
  };
  const auditDown = await run({ ...E, provenanceSummary: boom }, served(dataset));
  check("the sensitivity table still renders when the audit throws", rowCount(auditDown.sensitivity), RULES);
  ok("the audit shows a message and no table", showsMessageOnly(auditDown.audit));
  ok("the message does not blame the load", !/could not be loaded/.test(auditDown.audit.textContent));
  const tableDown = await run({ ...E, sensitivityTable: boom }, served(dataset));
  check("the audit still renders when the sensitivity table throws", rowCount(tableDown.audit), VERDICTS);
  ok("the sensitivity node shows a message and no table", showsMessageOnly(tableDown.sensitivity));

  console.log("\nA page holding only one of the two nodes");
  const onlyTable = await run(E, served(dataset), ["sensitivity"]);
  check("the sensitivity table renders by itself", rowCount(onlyTable.sensitivity), RULES);
  const onlyAudit = await run(E, served(dataset), ["provenance-audit"]);
  check("the audit renders by itself", rowCount(onlyAudit.audit), VERDICTS);

  let fetched = 0;
  const counting = () => {
    fetched += 1;
    return served(dataset)();
  };
  await run(E, counting, []);
  check("a page with neither node does not fetch the data", fetched, 0);

  console.log("\n" + "-".repeat(64));
  if (failures.length) {
    console.log("FAILED: " + failures.length + " assertion(s) failed, " + passed + " passed.");
    process.exit(1);
  }
  console.log("PASSED: " + passed + " assertions.");
}

main().catch((err) => {
  console.log("  FAIL test run threw: " + (err && err.stack ? err.stack : err));
  process.exit(1);
});
