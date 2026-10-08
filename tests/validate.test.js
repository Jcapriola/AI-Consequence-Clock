/*
 * Proves the validator fails on the errors arithmetic cannot see.
 *
 * derive.test.js will happily compute a quieter clock from a record whose status is
 * "verified" in lowercase, because that string matches no published value and the
 * record simply leaves the headline set. This file is the other half of that pair:
 * the same mutation must fail validation, loudly, by id.
 *
 *   node tests/validate.test.js
 */

var fs = require("fs");
var path = require("path");
var V = require(path.join(__dirname, "validate-records.js"));
var E = require(path.join(__dirname, "..", "js", "evidence.js"));
var S = require(path.join(__dirname, "schema.js"));

var dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "incidents.json"), "utf8"));

var passed = 0;
var failed = 0;

function ok(name, cond) {
  if (cond) {
    passed++;
    console.log("  ok   " + name);
  } else {
    failed++;
    console.log("  FAIL " + name);
  }
}

function clone() {
  return JSON.parse(JSON.stringify(dataset));
}

function firstWhere(pred) {
  var r = dataset.incidents.find(pred);
  if (!r) throw new Error("fixture missing: no matching record in the seed file");
  return r;
}

console.log("Validator: live file");
var live = V.validateDataset(dataset);
ok("seed file has no field problems", live.problems.length === 0);
ok("seed file has records", live.recordCount === dataset.incidents.length);

console.log("\nValidator: methodology vocabulary stays in sync");
var methodology = fs.readFileSync(path.join(__dirname, "..", "methodology.html"), "utf8");
var direction = fs.readFileSync(path.join(__dirname, "..", "METHODOLOGY_DIRECTION.md"), "utf8");
function enumList(name, sep) {
  return S.ENUMS[name].join(sep || " / ");
}
function methodologyEnum(name) {
  var match = methodology.match(new RegExp('data-enum="' + name + '">([^<]+)</code>'));
  return match && match[1];
}
[
  "verification_status",
  "evidence_grade",
  "causal_role",
  "adversary",
  "authorization_evidence",
  "unauthorized_claim",
  "reversibility",
  "consequence_class"
].forEach(function (name) {
  ok("methodology.html enum " + name + " matches schema.js", methodologyEnum(name) === enumList(name));
});
ok("METHODOLOGY_DIRECTION status vocabulary matches schema.js", direction.indexOf("Status: " + enumList("verification_status")) !== -1);
ok("METHODOLOGY_DIRECTION grade vocabulary matches schema.js", direction.indexOf("Grade: " + enumList("evidence_grade")) !== -1);
ok(
  "METHODOLOGY_DIRECTION authorization vocabulary matches schema.js",
  direction.indexOf("`" + enumList("authorization_evidence", " | ") + "`") !== -1
);
ok(
  "METHODOLOGY_DIRECTION causal_role vocabulary matches schema.js",
  direction.indexOf("causal_role: `" + enumList("causal_role", " | ") + "`") !== -1
);
ok(
  "METHODOLOGY_DIRECTION adversary vocabulary matches schema.js",
  direction.indexOf("adversary: `" + enumList("adversary", " | ") + "`") !== -1
);
ok(
  "METHODOLOGY_DIRECTION consequence vocabulary matches schema.js",
  direction.indexOf("consequence_class: `" + enumList("consequence_class", " | ") + "`") !== -1
);

console.log("\nValidator: silent headline drop");
var lower = clone();
var victim = firstWhere(function (r) {
  return r.verification_status === "VERIFIED" && E.isHeadlineEligible(r);
});
var lowerRecord = lower.incidents.find(function (r) {
  return r.id === victim.id;
});
lowerRecord.verification_status = "verified";
ok(
  "lowercase status is not headline-eligible, so arithmetic would drop it with no error",
  E.isHeadlineEligible(lowerRecord) === false
);
var lowerResult = V.validateDataset(lower);
ok(
  "lowercase status fails validation by id",
  lowerResult.problems.some(function (p) {
    return p.indexOf(victim.id) !== -1 && /unknown value "verified"/i.test(p);
  })
);

console.log("\nValidator: hostile archive URL");
var hostile = clone();
var archived = firstWhere(function (r) {
  return (r.sources || []).some(function (s) {
    return s.archived_url;
  });
});
var hostileRecord = hostile.incidents.find(function (r) {
  return r.id === archived.id;
});
hostileRecord.sources.find(function (s) {
  return s.archived_url;
}).archived_url = "javascript:alert(1)";
var hostileResult = V.validateDataset(hostile);
ok(
  "javascript: archived_url fails validation",
  hostileResult.problems.some(function (p) {
    return p.indexOf(archived.id) !== -1 && p.indexOf("archived_url") !== -1;
  })
);

console.log("\nValidator: PRIMARY without a named primary document");
var naked = clone();
var primary = firstWhere(function (r) {
  return r.evidence_grade === "PRIMARY" && E.isHeadlineEligible(r);
});
var nakedRecord = naked.incidents.find(function (r) {
  return r.id === primary.id;
});
nakedRecord.primary_source_url = "";
var nakedResult = V.validateDataset(naked);
ok(
  "PRIMARY grade with no primary_source_url fails validation",
  nakedResult.problems.some(function (p) {
    return p.indexOf(primary.id) !== -1 && p.indexOf("primary_source_url") !== -1;
  })
);

/*
 * "Grade is assigned from the sources listed on the record." Each mutation below
 * computes perfectly, so only the validator can say the grade is not what the file holds.
 */
function hasSourceGraded(record, grade) {
  return (record.sources || []).some(function (s) {
    return s.evidence_grade === grade;
  });
}

console.log("\nValidator: grade above the attached sources");
var inflated = clone();
var secondary = firstWhere(function (r) {
  return E.isHeadlineEligible(r) && !hasSourceGraded(r, "PRIMARY");
});
var inflatedRecord = inflated.incidents.find(function (r) {
  return r.id === secondary.id;
});
inflatedRecord.evidence_grade = "PRIMARY";
inflatedRecord.verification_status = "VERIFIED";
inflatedRecord.primary_source_url = inflatedRecord.sources.find(function (s) {
  return s.evidence_grade !== "PRIMARY";
}).url;
var inflatedResult = V.validateDataset(inflated);
ok(
  "PRIMARY grade with no PRIMARY source attached fails validation by id",
  inflatedResult.problems.some(function (p) {
    return p.indexOf(secondary.id) !== -1 && p.indexOf("best attached source") !== -1;
  })
);

console.log("\nValidator: grade below the attached sources");
var under = clone();
var underRecord = under.incidents.find(function (r) {
  return r.id === primary.id;
});
underRecord.evidence_grade = "INDEPENDENT_SECONDARY";
ok(
  "under-grading stays headline-eligible, so arithmetic would not notice",
  E.isHeadlineEligible(underRecord)
);
var underResult = V.validateDataset(under);
ok(
  "INDEPENDENT_SECONDARY grade over an attached PRIMARY source fails validation by id",
  underResult.problems.some(function (p) {
    return p.indexOf(primary.id) !== -1 && p.indexOf("best attached source is PRIMARY") !== -1;
  })
);

console.log("\nValidator: PRIMARY citation pointing at a weaker source");
var miscited = clone();
var mixed = firstWhere(function (r) {
  return (
    r.evidence_grade === "PRIMARY" &&
    E.isHeadlineEligible(r) &&
    hasSourceGraded(r, "PRIMARY") &&
    (r.sources || []).some(function (s) {
      return s.evidence_grade !== "PRIMARY";
    })
  );
});
var miscitedRecord = miscited.incidents.find(function (r) {
  return r.id === mixed.id;
});
miscitedRecord.primary_source_url = miscitedRecord.sources.find(function (s) {
  return s.evidence_grade !== "PRIMARY";
}).url;
var miscitedResult = V.validateDataset(miscited);
ok(
  "PRIMARY record citing an attached non-PRIMARY source fails validation by id",
  miscitedResult.problems.some(function (p) {
    return p.indexOf(mixed.id) !== -1 && /primary_source_url points at a \w+ source/.test(p);
  })
);

console.log("\nValidator: disclosure after the last review");
var future = clone();
var futureRecord = future.incidents[0];
futureRecord.disclosure_date = "2030-01-01";
var futureResult = V.validateDataset(future);
ok(
  "a disclosure_date after last_evidence_review fails validation by id",
  futureResult.problems.some(function (p) {
    return p.indexOf(futureRecord.id) !== -1 && p.indexOf("last_evidence_review") !== -1;
  })
);
ok(
  "the day counter would clamp that record to 0 instead of reporting it",
  E.daysSinceLatestDisclosure(future.incidents, future.last_evidence_review).days === 0
);

console.log("\nValidator: revision bumped without a change_log entry");
var silent = clone();
var revised = firstWhere(function (r) {
  return r.revision > 1 && Array.isArray(r.change_log) && r.change_log.length > 0;
});
var silentRecord = silent.incidents.find(function (r) {
  return r.id === revised.id;
});
silentRecord.revision = revised.revision + 1;
var silentResult = V.validateDataset(silent);
ok(
  "a revision with no matching change_log entry fails validation by id",
  silentResult.problems.some(function (p) {
    return p.indexOf(revised.id) !== -1 && p.indexOf("change_log") !== -1;
  })
);

console.log("\nValidator: geography");
var geo = clone();
geo.incidents.forEach(function (r) {
  r.country_region = null;
});
var geoResult = V.validateDataset(geo);
ok("every country_region may be null", geoResult.problems.length === 0);
geo.incidents[0].country_region = "Unknown";
var placeholder = V.validateDataset(geo);
ok(
  "the placeholder Unknown is rejected",
  placeholder.problems.some(function (p) {
    return /placeholder/i.test(p);
  })
);

console.log("\n" + "-".repeat(64));
if (failed) {
  console.log("FAILED: " + failed + " assertion(s) failed, " + passed + " passed.");
  process.exit(1);
}
console.log("PASSED: " + passed + " assertions.");
