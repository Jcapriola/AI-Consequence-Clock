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
