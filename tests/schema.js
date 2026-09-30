/*
 * Field vocabulary and shape rules for a single incident record.
 *
 * This file exists because the derivation tests check arithmetic, not input. A record
 * with verification_status "verified" in lowercase produces correct arithmetic and
 * silently drops out of every headline total, because it matches no known status. The
 * clock would get quieter with no error anywhere. That is the failure this guards.
 *
 * Adding a value here is a deliberate act. It should come with a definition in
 * VULNERABILITY_DEFINITIONS (for a category) and a note in methodology.html.
 */

var ENUMS = {
  verification_status: ["REPORTED", "UNDER_REVIEW", "VERIFIED", "CORROBORATED", "DISPUTED", "RETRACTED"],
  evidence_grade: ["ROUNDUP", "INDEPENDENT_SECONDARY", "PRIMARY"],
  category: [
    "prompt_injection",
    "unauthorized_action",
    "data_exposure",
    "data_destruction",
    "policy_misrepresentation",
    "containment_failure",
    "fabricated_output"
  ],
  causal_role: ["agent_initiated", "agent_executed", "human_used_ai", "unknown"],
  adversary: ["attacker", "no_attacker", "research_demo"],
  authorization_evidence: ["none_documented", "policy_only", "ui_confirmation", "human_approval", "unknown"],
  unauthorized_claim: ["true", "false", "unknown"],
  reversibility: ["rolled_back", "irreversible", "unknown"],
  consequence_class: ["legal", "data", "infrastructure", "physical", "financial"],
  severity: ["Low", "Medium", "High", "Critical"],
  execution_auth_documented: ["yes", "no", "unknown"]
};

var SOURCE_ENUMS = {
  source_type: [
    "court_tribunal",
    "regulator",
    "cve_record",
    "government_vulnerability_database",
    "researcher_advisory",
    "security_research",
    "security_research_roundup",
    "incident_database",
    "news",
    "company_statement"
  ],
  evidence_grade: ["ROUNDUP", "INDEPENDENT_SECONDARY", "PRIMARY"]
};

/* Free-text fields that must be present and non-empty.
 * country_region is not in this list: null is a meaningful value, meaning the
 * attached sources did not establish a region. Treating it as required prose would
 * force a placeholder string, which is the geography defect this schema forbids.
 */
var REQUIRED_TEXT = [
  "id",
  "title",
  "summary",
  "disclosure_date",
  "ai_materiality",
  "organization",
  "sector",
  "source_quality_basis"
];

var REQUIRED_BOOLEAN = ["human_intervention", "rolled_back"];

/* Records that carry a real geography must not use a placeholder as a country name. */
var GEOGRAPHY_PLACEHOLDERS = ["unknown", "n/a", "na", "none", "tbd", "", "-"];

var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
var ID_PATTERN = /^acc-\d{4}(-\d{2})?(-\d{2})?-[a-z0-9-]+$/;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidIsoDate(value) {
  if (!ISO_DATE.test(value)) return false;
  var parts = value.split("-").map(Number);
  var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return (
    d.getUTCFullYear() === parts[0] &&
    d.getUTCMonth() === parts[1] - 1 &&
    d.getUTCDate() === parts[2]
  );
}

/*
 * A money block is either null or a fully specified amount. A bare number, a missing
 * currency, or a zero amount are all rejected: an unexplained figure in a published
 * total is the defect this dataset most needs to avoid.
 */
function moneyErrors(field, value) {
  if (value === null || value === undefined) return [];
  if (!isPlainObject(value)) return [field + " must be null or an object with amount, currency and note"];
  var out = [];
  if (typeof value.amount !== "number" || !isFinite(value.amount) || value.amount <= 0) {
    out.push(field + ".amount must be a positive number");
  }
  if (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency)) {
    out.push(field + ".currency must be a three-letter uppercase code");
  }
  if (typeof value.note !== "string" || !value.note.trim()) {
    out.push(field + ".note must say what the figure covers and what it excludes");
  }
  return out;
}

module.exports = {
  ENUMS: ENUMS,
  SOURCE_ENUMS: SOURCE_ENUMS,
  REQUIRED_TEXT: REQUIRED_TEXT,
  REQUIRED_BOOLEAN: REQUIRED_BOOLEAN,
  GEOGRAPHY_PLACEHOLDERS: GEOGRAPHY_PLACEHOLDERS,
  ID_PATTERN: ID_PATTERN,
  isPlainObject: isPlainObject,
  isValidIsoDate: isValidIsoDate,
  moneyErrors: moneyErrors
};
