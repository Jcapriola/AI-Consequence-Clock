# Contributing

Canonical project control stays with AI Blockchain Ventures LLC / AI Modularity.

## Code

1. Fork the canonical repository.
2. Open a pull request.
3. Do not expect production credentials.
4. Do not commit secrets, admin tokens, or private incident material.
5. Credit may appear in CONTRIBUTORS. Credit is not ownership.

Before opening a pull request, run `node tests/derive.test.js`. If you changed a record, the suite fails until you run `node tests/update-expected.js` and include the resulting baseline diff — that diff is how a reviewer sees which published totals your change moved.

Two rules for code touching the page:

- **Treat every record field as hostile.** Records arrive from public submission. Anything interpolated into markup goes through the escape helper in `js/clock.js`, and any URL from a record goes through the URL check, which passes only `http` and `https`. A contributed `javascript:` link must render as no link at all.
- **Derive numbers in `js/evidence.js`, never in `js/clock.js`.** The rendering layer is deliberately incapable of computing a figure, which is what lets the test suite guarantee the page shows nothing the data does not support.

## Incident submissions

Public submissions should include:

- Neutral title and 1–3 sentence summary
- Incident date if known, disclosure date if known
- Why AI/agent behavior is material
- At least one attributable source URL
- Proposed category and severity

Submissions enter `UNDER_REVIEW`. They do not hit headline counters until a reviewer sets VERIFIED or CORROBORATED.

## Corrections

Factual disputes should include the incident id, the claimed error, and a source. Corrections create a new revision. They do not silently rewrite history.
