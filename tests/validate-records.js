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

/* SOURCE_ENUMS.evidence_grade is listed weakest first. */
var GRADE_ORDER = S.SOURCE_ENUMS.evidence_grade;

function gradeRank(grade) {
  return GRADE_ORDER.indexOf(grade);
}

function attachedSources(record) {
  return record.sources.filter(S.isPlainObject);
}

function qualifyingPublishers(sources) {
  var seen = {};
  sources.forEach(function (source) {
    var publisher = E.normalizePublisher(source.publisher);
    if (publisher && E.HEADLINE_GRADES.indexOf(source.evidence_grade) !== -1) seen[publisher] = true;
  });
  return Object.keys(seen);
}

/*
 * The checks below compare fields that state one fact twice. A disagreement moves no
 * total today, which is why nothing else would notice it.
 */
function checkDisclosureLag(record, id) {
  var lag = record.disclosure_lag_days;
  if (lag === undefined) {
    fail(id, "disclosure_lag_days is required: a number of days, or null when the lag is not known");
  } else if (lag !== null && (typeof lag !== "number" || !isFinite(lag))) {
    fail(id, "disclosure_lag_days must be a number or null");
  } else if (lag !== null && (record.incident_date === null || record.incident_date === undefined)) {
    fail(id, "disclosure_lag_days must be null when incident_date is null");
  }
}

function checkRollbackAgreement(record, id) {
  if (typeof record.rolled_back !== "boolean") return;
  if (record.rolled_back !== (record.reversibility === "rolled_back")) {
    fail(id, "rolled_back is " + record.rolled_back + ' but reversibility is "' + record.reversibility + '"');
  }
}

function checkSourceGrades(record, id) {
  if (!attachedSources(record).length) return;
  var best = -1;
  record.sources.forEach(function (source, si) {
    if (!S.isPlainObject(source)) return;
    best = Math.max(best, gradeRank(source.evidence_grade));
    if (source.source_type === "security_research_roundup" && gradeRank(source.evidence_grade) > gradeRank("ROUNDUP")) {
      fail(id, "sources[" + si + "] is a security_research_roundup and cannot be graded above ROUNDUP");
    }
  });
  /* A grade is assigned from the sources attached, so it cannot exceed the best of them. */
  if (gradeRank(record.evidence_grade) > best) {
    fail(
      id,
      "evidence_grade " + record.evidence_grade + " exceeds the best grade on any attached source, " +
        (best === -1 ? "none" : GRADE_ORDER[best])
    );
  }
}

/* The headline branch checks counted records. A feed-only CORROBORATED makes the same claim. */
function checkFeedOnlyCorroboration(record, id) {
  if (record.verification_status !== "CORROBORATED" || E.isHeadlineEligible(record)) return;
  if (qualifyingPublishers(attachedSources(record)).length < 2) {
    fail(id, "is CORROBORATED but carries fewer than two independently published qualifying sources");
  }
}

function checkPrimarySourceUrl(record, id) {
  if (!nonEmptyString(record.primary_source_url)) return;
  var cited = attachedSources(record).filter(function (source) {
    return String(source.url).trim() === record.primary_source_url.trim();
  });
  var citesPrimary = cited.some(function (source) {
    return source.evidence_grade === "PRIMARY";
  });
  if (cited.length === 0) {
    /* The headline branch already reports this for counted records. */
    if (!E.isHeadlineEligible(record)) fail(id, "primary_source_url is not among the attached sources");
  } else if (!citesPrimary) {
    fail(id, "primary_source_url points at a source that is not graded PRIMARY");
  }
}

/*
 * Provenance is optional. A source that declares none is UNKNOWN and is not checked.
 * One that declares it is making a claim, and a malformed claim would merge or split
 * roots silently.
 */
function checkProvenance(record, id) {
  var sourceIds = collectSourceIds(record, id);
  var internalEdges = Object.create(null);
  record.sources.forEach(function (source, si) {
    if (!S.isPlainObject(source) || source.provenance === undefined) return;
    var refs = checkDeclaration(source, "sources[" + si + "]", sourceIds, id);
    if (typeof source.id === "string") internalEdges[source.id] = refs;
  });
  var unresolved = unresolvedDerivations(internalEdges);
  if (unresolved.length) {
    fail(id, "provenance has a derivation cycle; sources on it or cited from it: " + unresolved.join(", "));
  }
}

function collectSourceIds(record, id) {
  var sourceIds = Object.create(null);
  record.sources.forEach(function (source, si) {
    if (!S.isPlainObject(source) || source.id === undefined) return;
    var where = "sources[" + si + "]";
    if (typeof source.id !== "string" || !E.SOURCE_ID.test(source.id)) {
      fail(id, where + ".id must be a lowercase slug of letters, digits and hyphens");
    } else if (sourceIds[source.id]) {
      fail(id, where + '.id "' + source.id + '" is a duplicate source id within the record');
    } else {
      sourceIds[source.id] = true;
    }
  });
  return sourceIds;
}

function stringListOrFail(value, where, id) {
  var isList =
    Array.isArray(value) &&
    value.every(function (item) {
      return typeof item === "string";
    });
  if (!isList) fail(id, where + " must be an array of strings");
  return isList ? value : [];
}

function checkDeclarationShape(source, sourceWhere, id) {
  var where = sourceWhere + ".provenance";
  var p = source.provenance;
  if (!S.isPlainObject(p)) {
    fail(id, where + " must be an object with kind, derives_from_internal, derives_from_external and optionally note");
    return false;
  }
  if (source.id === undefined) {
    fail(id, sourceWhere + ".id is required on a source that declares provenance");
  }
  if (E.PROVENANCE_KINDS.indexOf(p.kind) === -1) {
    fail(id, where + '.kind has unknown value "' + p.kind + '". Allowed: ' + E.PROVENANCE_KINDS.join(", "));
  }
  if (p.note !== undefined && p.note !== null && typeof p.note !== "string") {
    fail(id, where + ".note must be a string");
  }
  return true;
}

function checkReferenceCount(kind, count, where, id) {
  if ((kind === "ORIGINAL" || kind === "UNKNOWN") && count > 0) {
    fail(id, where + " is " + kind + " and must not list anything it derives from");
  }
  if (kind === "DERIVED" && count === 0) {
    fail(id, where + " is DERIVED and must name at least one source or external root");
  }
}

function checkExternalKeys(keys, where, id) {
  keys.forEach(function (key) {
    if (E.EXTERNAL_ROOT_KEY.test(key)) return;
    fail(
      id,
      where + '.derives_from_external key "' + key + '" must look like <prefix>:<slug> with prefix in ' +
        E.EXTERNAL_ROOT_PREFIXES.join(", ")
    );
  });
}

function resolvedInternalRefs(refs, source, sourceIds, where, id) {
  var resolved = [];
  refs.forEach(function (ref) {
    if (ref === source.id) {
      fail(id, where + ".derives_from_internal must not reference the source itself");
    } else if (!sourceIds[ref]) {
      fail(id, where + '.derives_from_internal names "' + ref + '", which is not a source id on this record');
    } else {
      resolved.push(ref);
    }
  });
  return resolved;
}

/* Checks one declared provenance and returns the internal references that resolve. */
function checkDeclaration(source, sourceWhere, sourceIds, id) {
  if (!checkDeclarationShape(source, sourceWhere, id)) return [];
  var where = sourceWhere + ".provenance";
  var p = source.provenance;
  var internal = stringListOrFail(p.derives_from_internal, where + ".derives_from_internal", id);
  var external = stringListOrFail(p.derives_from_external, where + ".derives_from_external", id);
  checkReferenceCount(p.kind, internal.length + external.length, where, id);
  checkExternalKeys(external, where, id);
  return resolvedInternalRefs(internal, source, sourceIds, where, id);
}

/* Kahn's algorithm. What cannot be ordered is on a derivation loop or cited from one. */
function unresolvedDerivations(edges) {
  var nodes = Object.keys(edges).sort();
  var indegree = Object.create(null);
  nodes.forEach(function (from) {
    edges[from].forEach(function (to) {
      if (edges[to]) indegree[to] = (indegree[to] || 0) + 1;
    });
  });
  var ready = nodes.filter(function (node) {
    return !indegree[node];
  });
  while (ready.length) {
    edges[ready.shift()].forEach(function (to) {
      if (!edges[to]) return;
      indegree[to] -= 1;
      if (indegree[to] === 0) ready.push(to);
    });
  }
  return nodes.filter(function (node) {
    return indegree[node] > 0;
  });
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

  checkDisclosureLag(record, id);
  checkRollbackAgreement(record, id);
  if (Array.isArray(record.sources)) {
    checkSourceGrades(record, id);
    checkFeedOnlyCorroboration(record, id);
    checkPrimarySourceUrl(record, id);
    checkProvenance(record, id);
  }
  checked += 6;

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
      if (qualifyingPublishers(qualifying).length < 2) {
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
