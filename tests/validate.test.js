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

console.log("\nValidator: fields that must not contradict each other");
function mutated(pred, mutate) {
  var copy = clone();
  var target = firstWhere(pred);
  mutate(
    copy.incidents.find(function (r) {
      return r.id === target.id;
    })
  );
  return { id: target.id, problems: V.validateDataset(copy).problems };
}
function rejects(name, result, pattern) {
  ok(
    name,
    result.problems.some(function (p) {
      return p.indexOf(result.id) !== -1 && pattern.test(p);
    })
  );
}
function any() {
  return true;
}

rejects(
  "a record graded above its best source fails",
  mutated(
    function (r) {
      return r.evidence_grade === "ROUNDUP";
    },
    function (r) {
      r.evidence_grade = "PRIMARY";
    }
  ),
  /exceeds the best grade on any attached source/
);
rejects(
  "CORROBORATED on a feed-only record still needs two qualifying publishers",
  mutated(
    function (r) {
      return r.evidence_grade === "ROUNDUP";
    },
    function (r) {
      r.verification_status = "CORROBORATED";
    }
  ),
  /CORROBORATED but carries fewer than two/
);
rejects(
  "a missing disclosure_lag_days fails",
  mutated(any, function (r) {
    delete r.disclosure_lag_days;
  }),
  /disclosure_lag_days is required/
);
rejects(
  "a lag with no incident_date fails",
  mutated(any, function (r) {
    r.incident_date = null;
  }),
  /disclosure_lag_days must be null when incident_date is null/
);
rejects(
  "a lag that is not a number fails",
  mutated(any, function (r) {
    r.disclosure_lag_days = "3";
  }),
  /disclosure_lag_days must be a number or null/
);
rejects(
  "rolled_back true against an irreversible record fails",
  mutated(
    function (r) {
      return r.reversibility === "irreversible";
    },
    function (r) {
      r.rolled_back = true;
    }
  ),
  /rolled_back is true but reversibility is "irreversible"/
);
rejects(
  "reversibility rolled_back with rolled_back false fails",
  mutated(
    function (r) {
      return r.reversibility === "rolled_back";
    },
    function (r) {
      r.rolled_back = false;
    }
  ),
  /rolled_back is false but reversibility is "rolled_back"/
);
rejects(
  "primary_source_url pointing at a non-PRIMARY source fails",
  mutated(
    function (r) {
      return (
        !!r.primary_source_url &&
        r.sources.some(function (s) {
          return s.evidence_grade !== "PRIMARY";
        })
      );
    },
    function (r) {
      r.primary_source_url = r.sources.find(function (s) {
        return s.evidence_grade !== "PRIMARY";
      }).url;
    }
  ),
  /primary_source_url points at a source that is not graded PRIMARY/
);
rejects(
  "primary_source_url on a feed-only record must still be attached",
  mutated(
    function (r) {
      return !E.isHeadlineEligible(r);
    },
    function (r) {
      r.primary_source_url = "https://unattached.example/document";
    }
  ),
  /primary_source_url is not among the attached sources/
);
rejects(
  "a record graded while none of its sources carries a valid grade fails",
  mutated(any, function (r) {
    r.sources.forEach(function (s) {
      s.evidence_grade = "primary";
    });
  }),
  /exceeds the best grade on any attached source, none/
);
rejects(
  "a security_research_roundup graded above ROUNDUP fails",
  mutated(
    function (r) {
      return r.sources.some(function (s) {
        return s.source_type === "security_research_roundup";
      });
    },
    function (r) {
      r.sources.find(function (s) {
        return s.source_type === "security_research_roundup";
      }).evidence_grade = "INDEPENDENT_SECONDARY";
    }
  ),
  /security_research_roundup and cannot be graded above ROUNDUP/
);

console.log("\n" + "-".repeat(64));
if (failed) {
  console.log("FAILED: " + failed + " assertion(s) failed, " + passed + " passed.");
  process.exit(1);
}
console.log("PASSED: " + passed + " assertions.");
