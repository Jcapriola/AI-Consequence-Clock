# AI Consequence Clock™ — Implementation Proposal

**Prepared for:** AI Blockchain Ventures LLC / AI Modularity
**Against:** Development Specification v1.0
**Date:** 24 September 2026
**Status:** Milestone 0/1 preview delivered in this folder

## Chosen stack and why

| Layer | Choice | Why |
| --- | --- | --- |
| Preview frontend | Static HTML/CSS/JS | Zero build step, runs on GitHub Pages, Cloudflare Pages, or a path under aimodularity.com. Matches “cheap by default.” |
| Production frontend | Astro (preferred) or Next.js static export | Fast static pages, TypeScript, no mandatory server lock-in. |
| Public API (Milestone 2) | Cloudflare Workers or equivalent serverless JSON | Public read endpoints, cheap, no hidden proprietary runtime. |
| Canonical store | Postgres via Neon or Supabase | Versioned rows, audit table, free tier enough for MVP. |
| Admin review | Separate authenticated route, not in the public bundle | Spec requires human approval for VERIFIED in MVP. |
| Discovery jobs | GitHub Actions on a schedule, pluggable fetchers | No single AI-vendor dependency. |
| License | Not granted yet; Apache-2.0 candidate pending counsel | Do not assume reuse rights until a `LICENSE` file exists; brand/data stay with ABV. |

This preview already derives every on-page number from `data/incidents.json`. No production counter is typed into the frontend.

## MVP timeline and team size

| Milestone | What ships | Effort |
| --- | --- | --- |
| 0 — this folder | Preview page, limitation statement, methodology, seed file, concept-art reference | Done |
| 1 | Responsive production styling, deep-linkable incident drawer, accessible charts | 3–5 days, 1 frontend |
| 2 | Schema, public read API, admin review, audit log, derived `/summary` | 10–14 days, 1 full-stack |
| 3 | Scheduled discovery + candidate queue; VERIFIED still human-gated | 7–10 days |
| 4 | Public submission form, CONTRIBUTING, correction path | 4–6 days |
| 5 | Replace seed with reviewed corpus, announce repo, freeze methodology v1 | 3–5 days + editorial review |

**Team size:** one senior full-stack plus one reviewer/editor for evidence. A second engineer only if discovery connectors expand in parallel.

## No-cost / contributed development

- Hosting: Cloudflare Pages or GitHub Pages until traffic requires more.
- Database: Neon/Supabase free tier.
- CI: GitHub Actions free minutes.
- Fonts/CDN: public Google Fonts or self-host later.
- This preview code can be the public repo starter.

Future cost only appears with paid search APIs, high Worker volume, or a dedicated reviewer’s time — not from the architecture itself.

## Source provenance and deduplication

1. Every incident stores `sources[]` with URL, publisher, title, date, and source type.
2. Dedup key for MVP: normalized organization + incident_date window ±7 days + category, with manual merge in review UI.
3. Headline aggregates query only VERIFIED and CORROBORATED.
4. Revisions increment `revision` and append `change_log`. Retractions force a new revision and a counter recompute.
5. The preview already refuses to mix confirmed and estimated money.

## Canonical control for ABV / AI Modularity

- Create `AI-Blockchain-Ventures/ai-consequence-clock` (or org-equivalent) as the only canonical repo.
- Production deploy tokens live in ABV-controlled Cloudflare/GitHub orgs.
- Contributors fork + PR. No production credentials by default.
- Trademark, domain, official dataset, and governance stay with ABV even if the code later becomes Apache-2.0.
- Brand assets and the official seed-to-production dataset are not implied to be relicensed by a code contribution.

## Assumptions and requested spec changes

1. **Primary counter label.** Spec already allows a research label. This preview uses *Observable cases lacking documented execution-time authorization* and will not display the concept-art 8.8B figure. Recommend keeping that rule through launch.
2. **Seed ≠ launch.** The 10 records here are public, citable examples so the UI can run. They are not the Milestone 5 corpus. Several secondary sources are roundups; production should prefer primary filings, vendor advisories, or court/tribunal records where they exist.
3. **Map.** Geography is plotted only when the record has a supported `country_region`. No inferred city-level points.
4. **Neutral page.** Footer mentions A2SPA only as methodology provenance, not as a campaign CTA, per spec section 2.
5. **Counsel items still open:** final OSI license, whether a CLA is required, and trademark notice text.

## Non-negotiables honored

- No ownership claim over brand, domain, official dataset, or canonical repo.
- No hidden proprietary dependency required to run the preview.
- No fabricated production totals.
- Methodology and source links exist before any “live global” claim.
- Counters are computed from records.
