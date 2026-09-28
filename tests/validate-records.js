/*
 * Record-level validation for data/incidents.json.
 *
 * Run: node tests/validate-records.js
 *
 * derive.test.js proves the arithmetic on whatever the file contains. This proves the
 * file contains what the methodology says a record is. The two failures it exists to
 * catch loudly rather than silently:
 *
 *   1. A value outside the published vocabulary. "verified" in lowercase matches no
 *      status, so the record quietly leaves every headline total with no error.
 *   2. A record that claims a headline-qualifying grade without a source that carries
 *      it, which would let a total assert evidence the file does not hold.
 */

var fs = require("fs");
var path = require("path");
var S = require(path.join(__dirname, "schema.js"));
var E = require(path.join(__dirname, "..", "js", "evidence.js"));

function validateDataset(db) {
  var records = (db && db.incidents) || [];
  var problems = [];
  var checked = 0;
  var archivePresent = 0;
  var archiveAbsent = 0;
  var archiveUnchecked = 0;

function fail(id, message) {
  problems.push((id || "(no id)") + " :: " + message);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

var seenIds = Object.create(null);

records.forEach(function (record, index) {
  var id = record && record.id ? record.id : "record[" + index + "]";

  if (!S.isPlainObject(record)) {
    fail(id, "record is not an object");
    return;
  }

  /* Identity */
  if (!nonEmptyString(record.id)) {
    fail(id, "id is required");
  } else {
    if (!S.ID_PATTERN.test(record.id)) {
      fail(id, "id must look like acc-<year>[-month][-day]-<slug>, lowercase");
    }
    if (seenIds[record.id]) fail(id, "duplicate id");
    seenIds[record.id] = true;
  }

  /* Required prose */
  S.REQUIRED_TEXT.forEach(function (field) {
    if (!nonEmptyString(record[field])) fail(id, field + " is required and must be non-empty");
    checked++;
  });

  /* Required booleans, not truthy strings */
  S.REQUIRED_BOOLEAN.forEach(function (field) {
    if (typeof record[field] !== "boolean") fail(id, field + " must be a boolean, got " + typeof record[field]);
    checked++;
  });

  /* Controlled vocabularies. Case-sensitive on purpose. */
  Object.keys(S.ENUMS).forEach(function (field) {
    var allowed = S.ENUMS[field];
    var value = record[field];
    if (value === undefined) {
      fail(id, field + " is required");
    } else if (allowed.indexOf(value) === -1) {
      fail(
        id,
        field + ' has unknown value "' + value + '". Allowed: ' + allowed.join(", ")
      );
    }
    checked++;
  });

  /* Every category must carry a published definition, so no class renders undefined. */
  if (record.category && !E.vulnerabilityDefinition(record.category)) {
    fail(id, 'category "' + record.category + '" has no definition in evidence.js VULNERABILITY_DEFINITIONS');
  }
  checked++;

  /* Geography: null means the sources did not establish one. A placeholder string does not. */
  if (record.country_region !== null && record.country_region !== undefined) {
    if (!nonEmptyString(record.country_region)) {
      fail(id, "country_region must be null or a non-empty region name");
    } else if (S.GEOGRAPHY_PLACEHOLDERS.indexOf(record.country_region.trim().toLowerCase()) !== -1) {
      fail(
        id,
        'country_region must be null when sources do not establish a region, not the placeholder "' +
          record.country_region +
          '"'
      );
    }
  }
  checked++;

  /* Dates */
  if (!nonEmptyString(record.disclosure_date) || !S.isValidIsoDate(record.disclosure_date)) {
    fail(id, "disclosure_date must be a real YYYY-MM-DD date");
  }
  if (record.incident_date !== null && record.incident_date !== undefined) {
    if (!S.isValidIsoDate(record.incident_date)) {
      fail(id, "incident_date must be null or a real YYYY-MM-DD date");
    } else if (record.disclosure_date && record.incident_date > record.disclosure_date) {
      fail(id, "incident_date " + record.incident_date + " is after disclosure_date " + record.disclosure_date);
    }
  }
  checked += 2;

  /* Stored lag must equal the dates it claims to describe. */
  if (record.incident_date && record.disclosure_date) {
    var computed = E.daysBetween(record.incident_date, record.disclosure_date);
    if (record.disclosure_lag_days !== computed) {
      fail(
        id,
        "disclosure_lag_days is " + record.disclosure_lag_days + " but the dates give " + computed
      );
    }
    checked++;
  }

  /* Money */
  S.moneyErrors("financial_loss_confirmed", record.financial_loss_confirmed).forEach(function (m) {
    fail(id, m);
  });
  S.moneyErrors("financial_loss_estimated", record.financial_loss_estimated).forEach(function (m) {
    fail(id, m);
  });
  checked += 2;

  /* Sources */
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    fail(id, "at least one source is required");
  } else {
    record.sources.forEach(function (source, si) {
      var where = "sources[" + si + "]";
      if (!S.isPlainObject(source)) {
        fail(id, where + " is not an object");
        return;
      }
      ["publisher", "title"].forEach(function (f) {
        if (!nonEmptyString(source[f])) fail(id, where + "." + f + " is required");
      });
      if (!nonEmptyString(source.url) || !/^https?:\/\//i.test(source.url.trim())) {
        fail(id, where + ".url must be an absolute http or https URL");
      }
      if (!nonEmptyString(source.publication_date) || !S.isValidIsoDate(source.publication_date)) {
        fail(id, where + ".publication_date must be a real YYYY-MM-DD date");
      }
      Object.keys(S.SOURCE_ENUMS).forEach(function (field) {
        var allowed = S.SOURCE_ENUMS[field];
        if (allowed.indexOf(source[field]) === -1) {
          fail(id, where + "." + field + ' has unknown value "' + source[field] + '". Allowed: ' + allowed.join(", "));
        }
      });

      /*
       * archived_url is optional, but a present value must be a real archive URL and
       * must be paired with a date. An undefined field means "not checked yet"; null
       * means "checked, nothing on file". The two are deliberately different.
       */
      if (source.archived_url !== undefined) {
        if (source.archived_url === null) {
          if (source.archived_at !== null) {
            fail(id, where + ".archived_at must be null when archived_url is null");
          }
          archiveAbsent++;
        } else if (!/^https:\/\/web\.archive\.org\/web\//.test(String(source.archived_url))) {
          fail(id, where + ".archived_url must be a https://web.archive.org/web/ URL or null");
        } else if (!S.isValidIsoDate(String(source.archived_at))) {
          fail(id, where + ".archived_at must be a real YYYY-MM-DD date when a snapshot is recorded");
        } else {
          archivePresent++;
        }
      } else {
        archiveUnchecked++;
      }
      checked += 6;
    });
  }

  /*
   * The headline rule must be backed by the file. A record claiming a qualifying grade
   * needs a source that actually carries it, otherwise a published total asserts
   * evidence that is not attached.
   */
  if (E.isHeadlineEligible(record)) {
    var qualifying = (record.sources || []).filter(function (s) {
      return s && E.HEADLINE_GRADES.indexOf(s.evidence_grade) !== -1;
    });
    if (qualifying.length === 0) {
      fail(
        id,
        "is headline-eligible at " +
          record.evidence_grade +
          " but no attached source carries a qualifying grade"
      );
    }
    if (record.verification_status === "CORROBORATED") {
      var independent = {};
      qualifying.forEach(function (s) {
        independent[String(s.publisher).trim().toLowerCase()] = true;
      });
      if (Object.keys(independent).length < 2) {
        fail(
          id,
          "is CORROBORATED but carries fewer than two independently published qualifying sources"
        );
      }
    }
    /*
     * primary_source_url is the canonical citation, not a synonym for the grade. A
     * CORROBORATED record may legitimately have none, because no attached source is
     * PRIMARY. What must never happen is a citation pointing somewhere the record does
     * not actually cite, or a PRIMARY grade with no primary document named.
     */
    if (record.evidence_grade === "PRIMARY" && !nonEmptyString(record.primary_source_url)) {
      fail(id, "evidence_grade is PRIMARY but no primary_source_url is named");
    }
    if (nonEmptyString(record.primary_source_url)) {
      var urls = (record.sources || []).map(function (s) {
        return String(s && s.url).trim();
      });
      if (urls.indexOf(record.primary_source_url.trim()) === -1) {
        fail(id, "primary_source_url is not among the attached sources");
      }
    }
    checked += 3;
  }

  /* A revised record must say what changed. */
  if (record.revision && record.revision > 1) {
    if (!Array.isArray(record.change_log) || record.change_log.length === 0) {
      fail(id, "revision " + record.revision + " requires a change_log entry");
    }
    checked++;
  }
});

  /* Dataset-level */
  if (!nonEmptyString(db.last_evidence_review) || !S.isValidIsoDate(db.last_evidence_review)) {
    fail("(dataset)", "last_evidence_review must be a real YYYY-MM-DD date");
  }
  checked++;

  return {
    problems: problems,
    checked: checked,
    archivePresent: archivePresent,
    archiveAbsent: archiveAbsent,
    archiveUnchecked: archiveUnchecked,
    recordCount: records.length
  };
}

function report(result) {
  console.log("Validated " + result.recordCount + " records, " + result.checked + " field checks.");
  /*
   * Reported, not enforced. Archive coverage depends on a third party being reachable, so
   * failing the build on it would make the suite non-deterministic. Surfacing it keeps the
   * link-rot exposure visible instead of invisible.
   */
  console.log(
    "Source archive coverage: " +
      result.archivePresent +
      " snapshot, " +
      result.archiveAbsent +
      " confirmed none, " +
      result.archiveUnchecked +
      " not yet checked. Run: node tests/find-archives.js"
  );
  if (result.problems.length) {
    console.log("\n" + result.problems.length + " problem(s):\n");
    result.problems.forEach(function (p) {
      console.log("  " + p);
    });
    console.log("\nFAILED record validation.");
    process.exit(1);
  }
  console.log("PASSED record validation.");
}

if (require.main === module) {
  var db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "incidents.json"), "utf8"));
  report(validateDataset(db));
}

module.exports = { validateDataset: validateDataset };
