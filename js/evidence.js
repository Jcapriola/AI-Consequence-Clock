/*
 * Evidence layer for the AI Consequence Clock preview.
 *
 * One module, loaded by both the browser and Node, so the arithmetic shown on
 * the page is the arithmetic under test. No build step: a plain script tag
 * assigns window.ClockEvidence, and require() picks up module.exports.
 *
 * Every function here is pure and takes records as an argument. Nothing in this
 * file reads the network, the clock, or the DOM. "Today" is always injected so
 * a day counter can be tested and cannot freeze against a literal date.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClockEvidence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Published headline rule. Both conditions must hold.
  var HEADLINE_STATUSES = ["VERIFIED", "CORROBORATED"];
  var HEADLINE_GRADES = ["PRIMARY", "INDEPENDENT_SECONDARY"];

  // Agent causation is a field, never a text match on title or summary.
  var AGENT_ROLES = ["agent_initiated", "agent_executed"];

  var AUTH_GAP = "none_documented";

  // Geography is grouped only where a record names a region. These values mean
  // the sources did not establish one, and they are never resolved to a country.
  var GEO_UNSUPPORTED = ["Unknown", "unknown", "", null, undefined];

  function has(list, value) {
    return list.indexOf(value) !== -1;
  }

  function isHeadlineEligible(record) {
    return (
      has(HEADLINE_STATUSES, record.verification_status) &&
      has(HEADLINE_GRADES, record.evidence_grade)
    );
  }

  /*
   * Why a record is not in the headline totals, in the same two axes the
   * methodology defines. A visitor seeing a total of 4 out of 10 needs this or
   * the missing six look like an omission instead of the rule working.
   */
  function exclusion(record) {
    if (isHeadlineEligible(record)) return null;
    var statusFails = !has(HEADLINE_STATUSES, record.verification_status);
    var gradeFails = !has(HEADLINE_GRADES, record.evidence_grade);
    var code = statusFails && gradeFails ? "status_and_grade" : statusFails ? "status" : "grade";
    var detail;
    if (code === "status_and_grade") {
      detail =
        "Review state is " + record.verification_status + " and attached evidence is " +
        record.evidence_grade + ". Both fail the headline rule.";
    } else if (code === "status") {
      detail =
        "Evidence grade " + record.evidence_grade + " qualifies, but review state is " +
        record.verification_status + ". A single qualifying source is REPORTED, not CORROBORATED.";
    } else {
      detail =
        "Review state " + record.verification_status + " qualifies, but attached evidence is " +
        record.evidence_grade + ", which cannot enter headline totals.";
    }
    return { code: code, status_fails: statusFails, grade_fails: gradeFails, detail: detail };
  }

  /*
   * Separates a documented occurrence from a demonstrated capability.
   *
   * A tribunal decision and a research proof-of-concept are both sourced, and
   * both belong on the page, but adding them into one number labelled
   * "incidents" claims something happened when the source says it was shown to
   * be possible. Derived from the existing adversary field only.
   */
  function occurrence(record) {
    return record.adversary === "research_demo" ? "demonstrated" : "documented";
  }

  function isAgentCaused(record) {
    return has(AGENT_ROLES, record.causal_role);
  }

  function isAuthGap(record) {
    return record.authorization_evidence === AUTH_GAP;
  }

  function isUnauthorizedClaim(record) {
    // The field is a tri-state string. Only an explicit "true" counts.
    return record.unauthorized_claim === "true" || record.unauthorized_claim === true;
  }

  function geographySupported(record) {
    return !has(GEO_UNSUPPORTED, record.country_region);
  }

  function daysBetween(from, to) {
    if (!from || !to) return null;
    var ms = Date.parse(to) - Date.parse(from);
    if (!isFinite(ms)) return null;
    return Math.round(ms / 86400000);
  }

  /*
   * Days since the most recent disclosure in the dataset. `today` is required
   * so this value moves with the calendar instead of freezing at the date the
   * seed file was generated.
   */
  function daysSinceLatestDisclosure(records, today) {
    var dated = records.filter(function (r) {
      return !!r.disclosure_date;
    });
    if (!dated.length) return null;
    var latest = dated
      .slice()
      .sort(function (a, b) {
        return Date.parse(b.disclosure_date) - Date.parse(a.disclosure_date);
      })[0];
    var d = daysBetween(latest.disclosure_date, today);
    if (d === null) return null;
    return { days: Math.max(0, d), record: latest };
  }

  /*
   * Confirmed amounts only, grouped by currency and never summed across them.
   * The estimate field is not read here at all.
   */
  function confirmedMoney(records) {
    var byCurrency = {};
    records.forEach(function (r) {
      var row = r.financial_loss_confirmed;
      if (!row || typeof row.amount !== "number" || !row.currency) return;
      if (!byCurrency[row.currency]) byCurrency[row.currency] = { amount: 0, ids: [] };
      byCurrency[row.currency].amount += row.amount;
      byCurrency[row.currency].ids.push(r.id);
    });
    return byCurrency;
  }

  function estimatedMoney(records) {
    var rows = [];
    records.forEach(function (r) {
      var row = r.financial_loss_estimated;
      if (!row || typeof row.amount !== "number" || !row.currency) return;
      rows.push({ id: r.id, amount: row.amount, currency: row.currency, note: row.note || null });
    });
    return rows;
  }

  // The four axes named in the brief: country, sector, vulnerability, consequence.
  var AXES = {
    country: {
      key: "country_region",
      title: "Country or region",
      note: "Grouped only where a record's sources establish a location. Never inferred."
    },
    sector: {
      key: "sector",
      title: "Sector",
      note: "The sector of the organization named on the record."
    },
    vulnerability: {
      key: "category",
      title: "Vulnerability class",
      note: "The failure mechanism recorded on the incident, not a vendor rating."
    },
    consequence: {
      key: "consequence_class",
      title: "Consequence",
      note: "What the sources show was actually affected."
    }
  };

  /*
   * Groups records along one axis. Every group reports headline-eligible and
   * feed-only counts separately, and never a single blended total, so no row on
   * the page can imply more verified evidence than exists.
   */
  function groupByAxis(records, axisName) {
    var axis = AXES[axisName];
    if (!axis) throw new Error("Unknown axis: " + axisName);
    var groups = {};

    records.forEach(function (record) {
      var raw = record[axis.key];
      var supported = axisName === "country" ? geographySupported(record) : !!raw;
      // Readable sentinel: this value appears in shareable deep links.
      var value = supported ? raw : "not-established";
      if (!groups[value]) {
        groups[value] = {
          axis: axisName,
          value: value,
          label: supported ? String(raw) : "Not established by sources",
          supported: supported,
          headline: 0,
          excluded: 0,
          total: 0,
          documented: 0,
          demonstrated: 0,
          exclusions: { status: 0, grade: 0, status_and_grade: 0 },
          headline_ids: [],
          excluded_ids: []
        };
      }
      var g = groups[value];
      g.total += 1;
      var ex = exclusion(record);
      if (ex) {
        g.excluded += 1;
        g.exclusions[ex.code] += 1;
        g.excluded_ids.push(record.id);
      } else {
        g.headline += 1;
        g.headline_ids.push(record.id);
        g[occurrence(record)] += 1;
      }
    });

    return Object.keys(groups)
      .map(function (k) {
        return groups[k];
      })
      .sort(function (a, b) {
        // Unsupported geography sorts last so it never reads as a country.
        if (a.supported !== b.supported) return a.supported ? -1 : 1;
        if (b.headline !== a.headline) return b.headline - a.headline;
        if (b.total !== a.total) return b.total - a.total;
        return a.label.localeCompare(b.label);
      });
  }

  function averageDisclosureLag(records) {
    var lags = records
      .map(function (r) {
        return typeof r.disclosure_lag_days === "number"
          ? r.disclosure_lag_days
          : daysBetween(r.incident_date, r.disclosure_date);
      })
      .filter(function (d) {
        return d !== null && d >= 0;
      });
    if (!lags.length) return { average: null, n: 0 };
    var sum = lags.reduce(function (a, b) {
      return a + b;
    }, 0);
    return { average: Math.round(sum / lags.length), n: lags.length };
  }

  /*
   * The whole derivation, in one pass, from records to every number the page
   * shows. Nothing downstream is allowed to compute a total of its own.
   */
  function derive(dataset, today) {
    var records = (dataset && dataset.incidents) || [];
    var headline = records.filter(isHeadlineEligible);
    var excluded = records.filter(function (r) {
      return !isHeadlineEligible(r);
    });
    var lag = averageDisclosureLag(headline);
    var since = daysSinceLatestDisclosure(records, today);

    return {
      methodology_version: (dataset && dataset.methodology_version) || null,
      dataset_status: (dataset && dataset.dataset_status) || null,
      generated_at: (dataset && dataset.generated_at) || null,

      record_count: records.length,
      headline_count: headline.length,
      excluded_count: excluded.length,
      headline_ids: headline.map(function (r) {
        return r.id;
      }),

      // Occurrence split. These two are never added together on the page.
      documented_occurrences: headline.filter(function (r) {
        return occurrence(r) === "documented";
      }).length,
      demonstrated_capabilities: headline.filter(function (r) {
        return occurrence(r) === "demonstrated";
      }).length,

      agent_caused: headline.filter(isAgentCaused).length,
      unauthorized_actions: headline.filter(isUnauthorizedClaim).length,
      authorization_gap: headline.filter(isAuthGap).length,

      human_interventions: headline.filter(function (r) {
        return r.human_intervention === true;
      }).length,
      rolled_back: headline.filter(function (r) {
        return r.reversibility === "rolled_back";
      }).length,
      irreversible: headline.filter(function (r) {
        return r.reversibility === "irreversible";
      }).length,

      confirmed_money: confirmedMoney(headline),
      estimated_money: estimatedMoney(records),

      disclosure_lag_average: lag.average,
      disclosure_lag_n: lag.n,
      days_since_latest_disclosure: since ? since.days : null,
      latest_disclosure_record: since ? since.record : null,

      axes: {
        country: groupByAxis(records, "country"),
        sector: groupByAxis(records, "sector"),
        vulnerability: groupByAxis(records, "vulnerability"),
        consequence: groupByAxis(records, "consequence")
      },

      geography_unsupported: records.filter(function (r) {
        return !geographySupported(r);
      }).length
    };
  }

  /*
   * Neutral definitions for the vulnerability classes present in the data.
   * Written from the field taxonomy in METHODOLOGY_DIRECTION.md. Any class not
   * listed renders without a definition rather than with an invented one.
   */
  var VULNERABILITY_DEFINITIONS = {
    prompt_injection:
      "Untrusted input reached the model's context and changed what the system did or revealed. The instruction came from content, not from the operator.",
    unauthorized_action:
      "The system took an action the record's sources describe as outside documented approval, scope, or policy.",
    data_exposure:
      "Data was exposed, leaked, or accessed outside approved handling, whether or not an attacker was involved.",
    data_destruction:
      "Data or backups were deleted or overwritten by the system's own execution.",
    policy_misrepresentation:
      "The system stated a policy, price, or commitment that the operator did not hold, and the statement was treated as the operator's own."
  };

  function vulnerabilityDefinition(category) {
    return VULNERABILITY_DEFINITIONS[category] || null;
  }

  return {
    HEADLINE_STATUSES: HEADLINE_STATUSES,
    HEADLINE_GRADES: HEADLINE_GRADES,
    AGENT_ROLES: AGENT_ROLES,
    AXES: AXES,
    isHeadlineEligible: isHeadlineEligible,
    exclusion: exclusion,
    occurrence: occurrence,
    isAgentCaused: isAgentCaused,
    isAuthGap: isAuthGap,
    isUnauthorizedClaim: isUnauthorizedClaim,
    geographySupported: geographySupported,
    daysBetween: daysBetween,
    daysSinceLatestDisclosure: daysSinceLatestDisclosure,
    confirmedMoney: confirmedMoney,
    estimatedMoney: estimatedMoney,
    groupByAxis: groupByAxis,
    averageDisclosureLag: averageDisclosureLag,
    vulnerabilityDefinition: vulnerabilityDefinition,
    derive: derive
  };
});
