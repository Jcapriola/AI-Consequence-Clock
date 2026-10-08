# Methodology direction for the preview (v0.2)

Excellent Milestone 0. Before any public PREVIEW path on AImodularity, use these rules.

## Required separations

1. **Unauthorized action ≠ authorization gap.**
   - `unauthorized_claim = true` drives “Unauthorized AI actions.”
   - `authorization_evidence = none_documented` drives the hero metric.
   - Do not OR those conditions together.

2. **Verification status ≠ evidence grade.**
   - Status: REPORTED / UNDER_REVIEW / VERIFIED / CORROBORATED / DISPUTED / RETRACTED
   - Grade: ROUNDUP / INDEPENDENT_SECONDARY / PRIMARY
   - One secondary source cannot be CORROBORATED.
   - A roundup cannot be PRIMARY.
   - Grade follows attached sources only.

3. **Agent-caused is a field, not a regex.**
   - Use `causal_role ∈ {agent_initiated, agent_executed}`.
   - Do not scan titles or summaries for “agent” / “autonomous.”

## Six fields now required on every record

causal_role · adversary · authorization_evidence · reversibility · consequence_class · disclosure_lag_days

Plus `unauthorized_claim`.

Authorization evidence taxonomy:

`none_documented | policy_only | ui_confirmation | human_approval | unknown`

Current validator vocabulary also defines:

- causal_role: `agent_initiated | agent_executed | human_used_ai | unknown`
- adversary: `attacker | no_attacker | research_demo`
- consequence_class: `legal | data | infrastructure | physical | financial`

## Headline rule

Eligible only if status is VERIFIED or CORROBORATED **and** grade is PRIMARY or INDEPENDENT_SECONDARY.

## What this preview already changed

- Seed records recoded; several former CORROBORATED rows are now REPORTED + ROUNDUP.
- Counters derive from structured fields only.
- Feed still shows every seed row so reviewers can see what was excluded and why.
